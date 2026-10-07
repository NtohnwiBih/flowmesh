package scheduler

import (
	"reflect"
	"testing"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

const (
	started   = eventstore.EventExecutionStarted
	scheduled = eventstore.EventNodeScheduled
	completed = eventstore.EventNodeCompleted
	failed    = eventstore.EventNodeFailed
)

// diamond:   a -> b -> d
//            a -> c -> d
const diamondJSON = `{
	"schema_version": 1,
	"nodes": [
		{"id":"a","type":"x"}, {"id":"b","type":"x"},
		{"id":"c","type":"x"}, {"id":"d","type":"x"}
	],
	"edges": [
		{"from":"a","to":"b"}, {"from":"a","to":"c"},
		{"from":"b","to":"d"}, {"from":"c","to":"d"}
	]
}`

// retryJSON: a (3 attempts, 5s backoff) -> b (no retry policy)
const retryJSON = `{
	"schema_version": 1,
	"nodes": [
		{"id":"a","type":"x","retry":{"max_attempts":3,"backoff_seconds":5}},
		{"id":"b","type":"x"}
	],
	"edges": [{"from":"a","to":"b"}]
}`

func mustParse(t *testing.T, src string) *workflow.Definition {
	t.Helper()
	def, err := workflow.Parse([]byte(src))
	if err != nil {
		t.Fatalf("bad test workflow: %v", err)
	}
	return def
}

func ev(typ, node string, attempt int) eventstore.Event {
	return eventstore.Event{Type: typ, NodeID: node, Attempt: attempt}
}

func history(evs ...eventstore.Event) []eventstore.Event {
	for i := range evs {
		evs[i].Sequence = i + 1
	}
	return evs
}

func sched(node string, attempt int) Action {
	return Action{Type: ActScheduleNode, NodeID: node, Attempt: attempt}
}

func TestNext(t *testing.T) {
	tests := []struct {
		name   string
		def    string
		events []eventstore.Event
		want   []Action
	}{
		{
			name: "not started: start it",
			def:  diamondJSON,
			want: []Action{{Type: ActStartExecution}},
		},
		{
			name:   "started: only the root is ready",
			def:    diamondJSON,
			events: history(ev(started, "", 0)),
			want:   []Action{sched("a", 1)},
		},
		{
			name: "root in flight: wait",
			def:  diamondJSON,
			events: history(ev(started, "", 0), ev(scheduled, "a", 1)),
			want: nil,
		},
		{
			name: "root done: b and c run in parallel",
			def:  diamondJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1)),
			want: []Action{sched("b", 1), sched("c", 1)},
		},
		{
			name: "d waits until BOTH b and c are done",
			def:  diamondJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1), ev(completed, "b", 1),
				ev(scheduled, "c", 1)),
			want: nil,
		},
		{
			name: "b and c done: d is ready",
			def:  diamondJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1), ev(completed, "b", 1),
				ev(scheduled, "c", 1), ev(completed, "c", 1)),
			want: []Action{sched("d", 1)},
		},
		{
			name: "everything done: complete the execution",
			def:  diamondJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1), ev(completed, "b", 1),
				ev(scheduled, "c", 1), ev(completed, "c", 1),
				ev(scheduled, "d", 1), ev(completed, "d", 1)),
			want: []Action{{Type: ActCompleteExecution}},
		},
		{
			name: "failed with retries left: reschedule with backoff",
			def:  retryJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(failed, "a", 1)),
			want: []Action{{Type: ActScheduleNode, NodeID: "a", Attempt: 2, Delay: 5 * time.Second}},
		},
		{
			name: "third failure exhausts retries: fail the execution",
			def:  retryJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(failed, "a", 1),
				ev(scheduled, "a", 2), ev(failed, "a", 2),
				ev(scheduled, "a", 3), ev(failed, "a", 3)),
			want: []Action{{Type: ActFailExecution, NodeID: "a"}},
		},
		{
			name: "no retry policy means one attempt only",
			def:  retryJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1), ev(failed, "b", 1)),
			want: []Action{{Type: ActFailExecution, NodeID: "b"}},
		},
		{
			name: "finished execution: nothing to do",
			def:  retryJSON,
			events: history(ev(started, "", 0),
				ev(scheduled, "a", 1), ev(failed, "a", 1),
				ev(eventstore.EventExecutionFailed, "", 0)),
			want: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			def := mustParse(t, tc.def)
			st, err := replay.Replay(def, tc.events)
			if err != nil {
				t.Fatalf("replay: %v", err)
			}
			got := Next(def, st)
			for i := range got {
				got[i].Reason = "" // wording is not part of the contract
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got  %+v\nwant %+v", got, tc.want)
			}
		})
	}
}

// Run the whole engine loop in memory: replay, ask the scheduler, apply its
// actions as events, pretend every node succeeds, repeat. Every history that
// the scheduler produces must be accepted by Replay, and must finish.
func TestSimulationCompletesAndStaysValid(t *testing.T) {
	def := mustParse(t, diamondJSON)
	var events []eventstore.Event

	add := func(n eventstore.NewEvent) {
		events = append(events, eventstore.Event{
			Sequence: len(events) + 1,
			Type:     n.Type, NodeID: n.NodeID, Attempt: n.Attempt,
		})
	}

	for step := 0; step < 50; step++ {
		st, err := replay.Replay(def, events)
		if err != nil {
			t.Fatalf("scheduler produced an invalid history at step %d: %v", step, err)
		}
		if st.Status == replay.ExecCompleted {
			return // success
		}
		actions := Next(def, st)
		if len(actions) == 0 {
			t.Fatalf("stuck at step %d with status %s", step, st.Status)
		}
		for _, a := range actions {
			add(a.Event())
			if a.Type == ActScheduleNode { // the "worker" succeeds immediately
				add(eventstore.NewEvent{Type: completed, NodeID: a.NodeID, Attempt: a.Attempt})
			}
		}
	}
	t.Fatal("simulation did not finish within 50 steps")
}