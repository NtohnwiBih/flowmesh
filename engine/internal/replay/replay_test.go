package replay

import (
	"errors"
	"reflect"
	"testing"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

// testDef returns a simple chain: a -> b -> c.
func testDef(t *testing.T) *workflow.Definition {
	t.Helper()
	def, err := workflow.Parse([]byte(`{
		"schema_version": 1,
		"nodes": [
			{"id":"a","type":"x"},
			{"id":"b","type":"x"},
			{"id":"c","type":"x"}
		],
		"edges": [
			{"from":"a","to":"b"},
			{"from":"b","to":"c"}
		]
	}`))
	if err != nil {
		t.Fatalf("bad test workflow: %v", err)
	}
	return def
}

// ev builds one event. history() numbers them 1, 2, 3...
func ev(typ, node string, attempt int) eventstore.Event {
	return eventstore.Event{Type: typ, NodeID: node, Attempt: attempt}
}

func history(evs ...eventstore.Event) []eventstore.Event {
	for i := range evs {
		evs[i].Sequence = i + 1
	}
	return evs
}

const (
	started   = eventstore.EventExecutionStarted
	scheduled = eventstore.EventNodeScheduled
	completed = eventstore.EventNodeCompleted
	failed    = eventstore.EventNodeFailed
	done      = eventstore.EventExecutionCompleted
	abort     = eventstore.EventExecutionFailed
)

func TestReplayValid(t *testing.T) {
	tests := []struct {
		name        string
		events      []eventstore.Event
		wantStatus  ExecStatus
		wantNodes   map[string]NodeStatus
		wantAttempt map[string]int
	}{
		{
			name:       "empty history is pending",
			events:     nil,
			wantStatus: ExecPending,
			wantNodes:  map[string]NodeStatus{"a": NodePending, "b": NodePending, "c": NodePending},
		},
		{
			name:       "started",
			events:     history(ev(started, "", 0)),
			wantStatus: ExecRunning,
			wantNodes:  map[string]NodeStatus{"a": NodePending, "b": NodePending, "c": NodePending},
		},
		{
			name: "midway: a done, b scheduled",
			events: history(
				ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1),
			),
			wantStatus: ExecRunning,
			wantNodes:  map[string]NodeStatus{"a": NodeCompleted, "b": NodeScheduled, "c": NodePending},
		},
		{
			name: "worker crash: node b re-dispatched as attempt 2",
			events: history(
				ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1),
				ev(scheduled, "b", 2), // lease expired, engine re-dispatches
				ev(completed, "b", 2),
			),
			wantStatus:  ExecRunning,
			wantNodes:   map[string]NodeStatus{"a": NodeCompleted, "b": NodeCompleted, "c": NodePending},
			wantAttempt: map[string]int{"a": 1, "b": 2},
		},
		{
			name: "failure then retry",
			events: history(
				ev(started, "", 0),
				ev(scheduled, "a", 1), ev(failed, "a", 1),
				ev(scheduled, "a", 2), ev(completed, "a", 2),
			),
			wantStatus:  ExecRunning,
			wantNodes:   map[string]NodeStatus{"a": NodeCompleted, "b": NodePending, "c": NodePending},
			wantAttempt: map[string]int{"a": 2},
		},
		{
			name: "full happy path",
			events: history(
				ev(started, "", 0),
				ev(scheduled, "a", 1), ev(completed, "a", 1),
				ev(scheduled, "b", 1), ev(completed, "b", 1),
				ev(scheduled, "c", 1), ev(completed, "c", 1),
				ev(done, "", 0),
			),
			wantStatus: ExecCompleted,
			wantNodes:  map[string]NodeStatus{"a": NodeCompleted, "b": NodeCompleted, "c": NodeCompleted},
		},
		{
			name: "execution failed",
			events: history(
				ev(started, "", 0),
				ev(scheduled, "a", 1), ev(failed, "a", 1),
				ev(abort, "", 0),
			),
			wantStatus: ExecFailed,
			wantNodes:  map[string]NodeStatus{"a": NodeFailed, "b": NodePending, "c": NodePending},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, err := Replay(testDef(t), tc.events)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if s.Status != tc.wantStatus {
				t.Errorf("status = %s, want %s", s.Status, tc.wantStatus)
			}
			if s.LastSeq != len(tc.events) {
				t.Errorf("LastSeq = %d, want %d", s.LastSeq, len(tc.events))
			}
			for id, want := range tc.wantNodes {
				if got := s.Nodes[id].Status; got != want {
					t.Errorf("node %s = %s, want %s", id, got, want)
				}
			}
			for id, want := range tc.wantAttempt {
				if got := s.Nodes[id].Attempt; got != want {
					t.Errorf("node %s attempt = %d, want %d", id, got, want)
				}
			}
		})
	}
}

func TestReplayRejectsInvalidHistory(t *testing.T) {
	tests := []struct {
		name   string
		events []eventstore.Event
	}{
		{"schedule before start", history(ev(scheduled, "a", 1))},
		{"started twice", history(ev(started, "", 0), ev(started, "", 0))},
		{"unknown node", history(ev(started, "", 0), ev(scheduled, "zzz", 1))},
		{"complete without schedule", history(ev(started, "", 0), ev(completed, "a", 1))},
		{"attempt starts at 2", history(ev(started, "", 0), ev(scheduled, "a", 2))},
		{"attempt skips a number", history(
			ev(started, "", 0), ev(scheduled, "a", 1), ev(scheduled, "a", 3))},
		{"stale result from a zombie worker", history(
			ev(started, "", 0), ev(scheduled, "a", 1), ev(scheduled, "a", 2), ev(completed, "a", 1))},
		{"schedule an already completed node", history(
			ev(started, "", 0), ev(scheduled, "a", 1), ev(completed, "a", 1), ev(scheduled, "a", 2))},
		{"completed twice", history(
			ev(started, "", 0), ev(scheduled, "a", 1), ev(completed, "a", 1), ev(completed, "a", 1))},
		{"finish with unfinished nodes", history(
			ev(started, "", 0), ev(scheduled, "a", 1), ev(completed, "a", 1), ev(done, "", 0))},
		{"event after completion", history(
			ev(started, "", 0),
			ev(scheduled, "a", 1), ev(completed, "a", 1),
			ev(scheduled, "b", 1), ev(completed, "b", 1),
			ev(scheduled, "c", 1), ev(completed, "c", 1),
			ev(done, "", 0),
			ev(scheduled, "a", 2))},
		{"unknown event type", history(ev(started, "", 0), ev("BANANA", "", 0))},
		{"gap in sequence", []eventstore.Event{
			{Sequence: 1, Type: started},
			{Sequence: 3, Type: scheduled, NodeID: "a", Attempt: 1},
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Replay(testDef(t), tc.events)
			if !errors.Is(err, ErrInvalidHistory) {
				t.Fatalf("want ErrInvalidHistory, got %v", err)
			}
		})
	}
}

// Replaying any prefix of a valid history must also be valid. A crash can
// happen after any event, so every prefix is a state the engine may wake up in.
func TestEveryPrefixOfValidHistoryReplays(t *testing.T) {
	full := history(
		ev(started, "", 0),
		ev(scheduled, "a", 1), ev(scheduled, "a", 2), ev(completed, "a", 2),
		ev(scheduled, "b", 1), ev(failed, "b", 1), ev(scheduled, "b", 2), ev(completed, "b", 2),
		ev(scheduled, "c", 1), ev(completed, "c", 1),
		ev(done, "", 0),
	)
	def := testDef(t)
	for n := 0; n <= len(full); n++ {
		if _, err := Replay(def, full[:n]); err != nil {
			t.Fatalf("prefix of length %d failed: %v", n, err)
		}
	}
}

// Same input, same output. This is what "pure" means.
func TestReplayIsDeterministic(t *testing.T) {
	events := history(
		ev(started, "", 0),
		ev(scheduled, "a", 1), ev(completed, "a", 1),
	)
	def := testDef(t)
	first, err1 := Replay(def, events)
	second, err2 := Replay(def, events)
	if err1 != nil || err2 != nil {
		t.Fatalf("errors: %v, %v", err1, err2)
	}
	if !reflect.DeepEqual(first, second) {
		t.Error("two replays of the same history differ")
	}
}