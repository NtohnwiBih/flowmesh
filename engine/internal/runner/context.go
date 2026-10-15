package runner

import (
	"encoding/json"

	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

// buildContext assembles what a node may read: the trigger input and the
// outputs of completed nodes. It is a pure function of the replayed state.
func buildContext(def *workflow.Definition, st *replay.State) json.RawMessage {
	nodes := map[string]json.RawMessage{}
	for _, n := range def.Nodes {
		ns := st.Nodes[n.ID]
		if ns.Status == replay.NodeCompleted && len(ns.Output) > 0 {
			nodes[n.ID] = ns.Output
		}
	}
	input := st.Input
	if len(input) == 0 {
		input = json.RawMessage("null")
	}
	b, _ := json.Marshal(struct {
		Input json.RawMessage            `json:"input"`
		Nodes map[string]json.RawMessage `json:"nodes"`
	}{input, nodes}) // marshalling raw JSON we already validated cannot fail
	return b
}