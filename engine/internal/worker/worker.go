package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
)

// Handler does the actual work of one task. It must stop promptly when ctx
// is cancelled. It returns the node's output (valid JSON) or an error.
type Handler func(ctx context.Context, t dispatch.Task) (json.RawMessage, error)

type Config struct {
	ID             string // unique per worker process
	Queue          string // which queue to take tasks from
	Handler        Handler
	LeaseTTL       time.Duration // default 20s
	HeartbeatEvery time.Duration // default 5s; must be <= LeaseTTL/2
	PollEvery      time.Duration // default 500ms
}

type Worker struct {
	d   *dispatch.Dispatcher
	cfg Config
}

func New(d *dispatch.Dispatcher, cfg Config) (*Worker, error) {
	if cfg.ID == "" || cfg.Queue == "" || cfg.Handler == nil {
		return nil, errors.New("worker: ID, Queue and Handler are required")
	}
	if cfg.LeaseTTL == 0 {
		cfg.LeaseTTL = 20 * time.Second
	}
	if cfg.HeartbeatEvery == 0 {
		cfg.HeartbeatEvery = 5 * time.Second
	}
	if cfg.PollEvery == 0 {
		cfg.PollEvery = 500 * time.Millisecond
	}
	if cfg.HeartbeatEvery*2 > cfg.LeaseTTL {
		return nil, errors.New("worker: HeartbeatEvery must be at most half of LeaseTTL")
	}
	return &Worker{d: d, cfg: cfg}, nil
}

// Run processes tasks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) error {
	for ctx.Err() == nil {
		t, err := w.d.Claim(ctx, w.cfg.Queue, w.cfg.ID, w.cfg.LeaseTTL)
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("claim failed", "err", err)
				sleep(ctx, time.Second)
			}
			continue
		}
		if t == nil { // queue empty
			sleep(ctx, w.cfg.PollEvery)
			continue
		}
		w.process(ctx, t)
	}
	return nil
}

func (w *Worker) process(ctx context.Context, t *dispatch.Task) {
	log := slog.With("task", t.ID, "worker", w.cfg.ID)

	taskCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var leaseLost atomic.Bool
	hbDone := make(chan struct{})

	// Background heartbeat.
	go func() {
		defer close(hbDone)
		tick := time.NewTicker(w.cfg.HeartbeatEvery)
		defer tick.Stop()
		for {
			select {
			case <-taskCtx.Done():
				return
			case <-tick.C:
				ok, err := w.d.Heartbeat(taskCtx, t.ID, w.cfg.ID, w.cfg.LeaseTTL)
				if err != nil {
					if taskCtx.Err() == nil {
						log.Warn("heartbeat error", "err", err)
					}
					continue // transient: try again at the next tick
				}
				if !ok {
					leaseLost.Store(true)
					cancel() // tell the handler to stop
					return
				}
			}
		}
	}()

	out, herr := w.safeRun(taskCtx, *t)

	cancel()  // stop the heartbeat goroutine
	<-hbDone  // wait until it has really finished

	if leaseLost.Load() {
		log.Warn("lease lost; discarding result")
		return
	}
	if ctx.Err() != nil {
		log.Info("shutting down mid-task; lease will expire and the task will be retried")
		return
	}

	res := dispatch.Result{
		TaskID: t.ID, ExecutionID: t.ExecutionID, NodeID: t.NodeID, Attempt: t.Attempt,
	}
	if herr != nil {
		res.Error = herr.Error()
	} else {
		res.OK = true
		res.Output = out
	}
	owned, err := w.d.Ack(ctx, w.cfg.ID, res)
	switch {
	case err != nil:
		log.Error("ack failed", "err", err) // lease will expire; task is retried
	case !owned:
		log.Warn("ack refused: lease no longer ours")
	default:
		log.Info("task finished", "ok", res.OK)
	}
}

// safeRun calls the handler and turns a panic into an ordinary error.
func (w *Worker) safeRun(ctx context.Context, t dispatch.Task) (out json.RawMessage, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("handler panic: %v", r)
		}
	}()
	return w.cfg.Handler(ctx, t)
}

// sleep waits for d, or until ctx is cancelled, whichever comes first.
func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}