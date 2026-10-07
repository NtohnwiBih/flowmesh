package scheduler

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

type ActionType string

const (
	ActStartExecution    ActionType = "START_EXECUTION"
	ActScheduleNode      ActionType = "SCHEDULE_NODE"
	ActCompleteExecution ActionType = "COMPLETE_EXECUTION"
	ActFailExecution     ActionType = "FAIL_EXECUTION"
)

// Action is an instruction produced by the scheduler. It describes what the
// engine should do. It does not do anything itself.
type Action struct {
	Type    ActionType
	NodeID  string        // for ScheduleNode and FailExecution
	Attempt int           // for ScheduleNode
	Delay   time.Duration // for ScheduleNode: wait this long before dispatching
	Reason  string        // for FailExecution: human-readable explanation
}

// Event converts an action into the event to record in the event store.
func (a Action) Event() eventstore.NewEvent {
	switch a.Type {
	case ActStartExecution:
		return eventstore.NewEvent{Type: eventstore.EventExecutionStarted}
	case ActScheduleNode:
		return eventstore.NewEvent{
			Type:    eventstore.EventNodeScheduled,
			NodeID:  a.NodeID,
			Attempt: a.Attempt,
		}
	case ActCompleteExecution:
		return eventstore.NewEvent{Type: eventstore.EventExecutionCompleted}
	case ActFailExecution:
		payload, _ := json.Marshal(map[string]string{"reason": a.Reason}) // cannot fail for a string map
		return eventstore.NewEvent{
			Type:          eventstore.EventExecutionFailed,
			NodeID:        a.NodeID,
			InlinePayload: payload,
		}
	}
	panic(fmt.Sprintf("scheduler: unknown action type %q", a.Type))
}

// Next decides what should happen next. It is pure: same input, same output.
func Next(def *workflow.Definition, st *replay.State) []Action {
	switch {
	case st.Status.IsTerminal():
		return nil
	case st.Status == replay.ExecPending:
		return []Action{{Type: ActStartExecution}}
	}

	upstream := upstreamOf(def)
	var actions []Action
	allDone := true

	for _, n := range def.Nodes { // definition order keeps the output deterministic
		ns := st.Nodes[n.ID]
		if ns.Status != replay.NodeCompleted {
			allDone = false
		}

		switch ns.Status {
		case replay.NodePending:
			if allCompleted(upstream[n.ID], st) {
				actions = append(actions, Action{
					Type: ActScheduleNode, NodeID: n.ID, Attempt: 1,
				})
			}

		case replay.NodeFailed:
			if ns.Attempt >= maxAttempts(n) {
				return []Action{{
					Type:   ActFailExecution,
					NodeID: n.ID,
					Reason: fmt.Sprintf("node %q failed after %d attempt(s)", n.ID, ns.Attempt),
				}}
			}
			actions = append(actions, Action{
				Type:    ActScheduleNode,
				NodeID:  n.ID,
				Attempt: ns.Attempt + 1,
				Delay:   backoff(n),
			})
		}
		// NodeScheduled: in flight, nothing to do. NodeCompleted: done.
	}

	if allDone {
		return []Action{{Type: ActCompleteExecution}}
	}
	return actions
}

// upstreamOf maps each node to the nodes that must finish before it.
func upstreamOf(def *workflow.Definition) map[string][]string {
	up := make(map[string][]string, len(def.Nodes))
	for _, e := range def.Edges {
		up[e.To] = append(up[e.To], e.From)
	}
	return up
}

func allCompleted(ids []string, st *replay.State) bool {
	for _, id := range ids {
		if st.Nodes[id].Status != replay.NodeCompleted {
			return false
		}
	}
	return true // also true for an empty list: a start node has no prerequisites
}

// maxAttempts: a node with no retry policy gets exactly one attempt.
func maxAttempts(n workflow.Node) int {
	if n.Retry == nil {
		return 1
	}
	return n.Retry.MaxAttempts
}

func backoff(n workflow.Node) time.Duration {
	if n.Retry == nil {
		return 0
	}
	return time.Duration(n.Retry.BackoffSeconds) * time.Second
}