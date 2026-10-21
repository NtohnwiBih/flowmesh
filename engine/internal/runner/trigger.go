package runner

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

// Trigger nodes do no work. The engine completes them itself, so no queue,
// lease or worker is involved. This is the only place that knows about them.
var triggerTypes = map[string]bool{"webhook": true}

func isTrigger(nodeType string) bool { return triggerTypes[nodeType] }

// triggerOutput wraps the execution input, so downstream templates read
// {{ nodes.<id>.body.<field> }}.
func triggerOutput(input json.RawMessage) json.RawMessage {
	if len(input) == 0 {
		input = json.RawMessage("null")
	}
	b, _ := json.Marshal(struct {
		Body json.RawMessage `json:"body"`
	}{input})
	return b
}

// completeTriggers records NODE_COMPLETED for every trigger node that is SCHEDULED.
// It returns true when it wrote events (or lost a race), so the caller reloads.
// Because it works from replayed state, a crash between "scheduled" and
// "completed" is repaired by the next pass.
func (r *Runner) completeTriggers(ctx context.Context, executionID string,
	def *workflow.Definition, st *replay.State) (bool, error) {
	var events []eventstore.NewEvent
	for _, n := range def.Nodes {
		ns := st.Nodes[n.ID]
		if isTrigger(n.Type) && ns.Status == replay.NodeScheduled {
			events = append(events, eventstore.NewEvent{
				Type: eventstore.EventNodeCompleted, NodeID: n.ID, Attempt: ns.Attempt,
				InlinePayload: triggerOutput(st.Input),
			})
		}
	}
	if len(events) == 0 {
		return false, nil
	}
	err := r.store.Append(ctx, executionID, st.LastSeq, events)
	if errors.Is(err, eventstore.ErrConflict) {
		return true, nil
	}
	return true, err
}