package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/scheduler"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

const (
	maxAdvanceSteps = 1000 // safety net against a logic bug looping forever
	maxConflicts    = 5
)

type Runner struct {
	store *eventstore.Store
	disp  *dispatch.Dispatcher
	repo  Repo
	tick  time.Duration
}

func New(store *eventstore.Store, disp *dispatch.Dispatcher, repo Repo, tick time.Duration) *Runner {
	if tick <= 0 {
		tick = time.Second
	}
	return &Runner{store: store, disp: disp, repo: repo, tick: tick}
}

// ------------------------------------------------------------------ loop

// Run recovers unfinished work, then ticks until ctx is cancelled.
func (r *Runner) Run(ctx context.Context) error {
	// Crash recovery: re-drive every unfinished execution from its event log.
	ids, err := r.repo.ListByStatus(ctx, "PENDING", "RUNNING")
	if err != nil {
		return fmt.Errorf("recover: %w", err)
	}
	for _, id := range ids {
		if err := r.Advance(ctx, id); err != nil {
			slog.Error("recover: advance failed", "execution", id, "err", err)
		}
	}

	ticker := time.NewTicker(r.tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			r.Tick(ctx)
		}
	}
}

// Tick performs one round of housekeeping. It is exported so tests can drive
// the engine step by step.
func (r *Runner) Tick(ctx context.Context) {
	if _, err := r.disp.Promote(ctx, 100); err != nil {
		slog.Error("promote", "err", err)
	}
	r.startPending(ctx)
	r.drainResults(ctx)
	r.reap(ctx)
}

func (r *Runner) startPending(ctx context.Context) {
	ids, err := r.repo.ListByStatus(ctx, "PENDING")
	if err != nil {
		slog.Error("list pending", "err", err)
		return
	}
	for _, id := range ids {
		if err := r.Advance(ctx, id); err != nil {
			slog.Error("start execution", "execution", id, "err", err)
		}
	}
}

// ------------------------------------------------------------- Advance

// Advance drives one execution as far as it can go right now.
// It is safe to call at any time, any number of times, from any engine.
func (r *Runner) Advance(ctx context.Context, executionID string) error {
	def, err := r.repo.Definition(ctx, executionID)
	if err != nil {
		return err
	}

	for step := 0; step < maxAdvanceSteps; step++ {
		events, err := r.store.Load(ctx, executionID)
		if err != nil {
			return err
		}
		st, err := replay.Replay(def, events)
		if err != nil {
			return fmt.Errorf("execution %s: %w", executionID, err)
		}

		actions := scheduler.Next(def, st)
		if len(actions) == 0 {
			return r.settle(ctx, executionID, def, st)
		}

		newEvents := make([]eventstore.NewEvent, len(actions))
		for i, a := range actions {
			newEvents[i] = a.Event()
		}
		err = r.store.Append(ctx, executionID, st.LastSeq, newEvents)
		if errors.Is(err, eventstore.ErrConflict) {
			continue // someone else wrote first: reload and recompute
		}
		if err != nil {
			return err
		}

		// Events are durable. Now hand the new work to the workers.
		for _, a := range actions {
			if a.Type != scheduler.ActScheduleNode {
				continue
			}
			node, ok := nodeByID(def, a.NodeID)
			if !ok {
				return fmt.Errorf("scheduler returned unknown node %q", a.NodeID)
			}
			task := dispatch.NewTask(executionID, node, a.Attempt)
			if _, err := r.disp.Enqueue(ctx, task, a.Delay); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("execution %s: advance did not settle", executionID)
}

// settle runs when nothing more can be decided. It saves the status and
// repairs the gap "event written, but crash before the task reached Redis".
func (r *Runner) settle(ctx context.Context, id string, def *workflow.Definition, st *replay.State) error {
	if err := r.repo.SetStatus(ctx, id, st.Status); err != nil {
		return err
	}
	if st.Status.IsTerminal() {
		return nil
	}
	for _, n := range def.Nodes {
		ns := st.Nodes[n.ID]
		if ns.Status == replay.NodeScheduled {
			// Idempotent: a no-op when the task is already in Redis.
			if _, err := r.disp.Enqueue(ctx, dispatch.NewTask(id, n, ns.Attempt), 0); err != nil {
				return err
			}
		}
	}
	return nil
}

func nodeByID(def *workflow.Definition, id string) (workflow.Node, bool) {
	for _, n := range def.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return workflow.Node{}, false
}

// ------------------------------------------------- recording outcomes

// recordOutcome appends NODE_COMPLETED / NODE_FAILED for (node, attempt), but
// only if that attempt is still the active one. A stale or duplicate report
// is silently ignored, which is what makes retries and zombies harmless.
func (r *Runner) recordOutcome(ctx context.Context, executionID string, ev eventstore.NewEvent) error {
	def, err := r.repo.Definition(ctx, executionID)
	if err != nil {
		return err
	}
	for try := 0; try < maxConflicts; try++ {
		events, err := r.store.Load(ctx, executionID)
		if err != nil {
			return err
		}
		st, err := replay.Replay(def, events)
		if err != nil {
			return err
		}
		ns, ok := st.Nodes[ev.NodeID]
		if !ok || st.Status != replay.ExecRunning ||
			ns.Status != replay.NodeScheduled || ns.Attempt != ev.Attempt {
			return nil // stale
		}
		err = r.store.Append(ctx, executionID, st.LastSeq, []eventstore.NewEvent{ev})
		if errors.Is(err, eventstore.ErrConflict) {
			continue
		}
		return err
	}
	return errors.New("recordOutcome: too many conflicts")
}

// drainResults handles worker reports: peek, record, then remove.
func (r *Runner) drainResults(ctx context.Context) {
	for i := 0; i < 100; i++ {
		raw, err := r.disp.PeekResult(ctx)
		if err != nil {
			slog.Error("peek result", "err", err)
			return
		}
		if raw == "" {
			return
		}

		var res dispatch.Result
		if err := json.Unmarshal([]byte(raw), &res); err != nil {
			slog.Error("dropping undecodable result", "err", err)
			_ = r.disp.DropResult(ctx, raw)
			continue
		}

		ev := eventstore.NewEvent{Type: eventstore.EventNodeCompleted, NodeID: res.NodeID, Attempt: res.Attempt}
		if res.OK {
			ev.InlinePayload = res.Output
		} else {
			ev.Type = eventstore.EventNodeFailed
			ev.InlinePayload, _ = json.Marshal(map[string]string{"error": res.Error})
		}

		if err := r.recordOutcome(ctx, res.ExecutionID, ev); err != nil {
			slog.Error("record result", "task", res.TaskID, "err", err)
			return // leave it in the queue; try again next tick
		}
		if err := r.Advance(ctx, res.ExecutionID); err != nil {
			slog.Error("advance after result", "task", res.TaskID, "err", err)
			return
		}
		if err := r.disp.DropResult(ctx, raw); err != nil {
			slog.Error("drop result", "err", err)
			return
		}
	}
}

// reap finds leases whose deadline has passed: the worker is presumed dead.
func (r *Runner) reap(ctx context.Context) {
	expired, err := r.disp.ListExpired(ctx, 100)
	if err != nil {
		slog.Error("list expired", "err", err)
		return
	}
	for _, t := range expired {
		payload, _ := json.Marshal(map[string]string{"error": "lease expired: worker presumed dead"})
		ev := eventstore.NewEvent{
			Type: eventstore.EventNodeFailed, NodeID: t.NodeID, Attempt: t.Attempt, InlinePayload: payload,
		}
		if err := r.recordOutcome(ctx, t.ExecutionID, ev); err != nil {
			slog.Error("reap: record", "task", t.ID, "err", err)
			continue
		}
		if err := r.Advance(ctx, t.ExecutionID); err != nil {
			slog.Error("reap: advance", "task", t.ID, "err", err)
			continue
		}
		slog.Warn("lease expired; attempt recorded as failed", "task", t.ID)
		// Release LAST. A crash before this line just means we redo the
		// steps above next tick, and every step is safe to repeat.
		if err := r.disp.Release(ctx, t.ID); err != nil {
			slog.Error("reap: release", "task", t.ID, "err", err)
		}
	}
}