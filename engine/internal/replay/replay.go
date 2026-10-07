package replay

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

// ErrInvalidHistory means the event list breaks a rule of the state machine.
var ErrInvalidHistory = errors.New("replay: invalid history")

type NodeStatus string

const (
	NodePending   NodeStatus = "PENDING"
	NodeScheduled NodeStatus = "SCHEDULED"
	NodeCompleted NodeStatus = "COMPLETED"
	NodeFailed    NodeStatus = "FAILED"
)

type ExecStatus string

const (
	ExecPending   ExecStatus = "PENDING"
	ExecRunning   ExecStatus = "RUNNING"
	ExecCompleted ExecStatus = "COMPLETED"
	ExecFailed    ExecStatus = "FAILED"
)

// IsTerminal reports whether no further events are allowed.
func (s ExecStatus) IsTerminal() bool {
	return s == ExecCompleted || s == ExecFailed
}

type NodeState struct {
	Status    NodeStatus
	Attempt   int             // highest attempt scheduled so far (0 = never)
	Output    json.RawMessage // small result, set when COMPLETED
	OutputRef string          // s3://... result, set when COMPLETED
	Failure   json.RawMessage // details of the latest failure
}

type State struct {
	Status  ExecStatus
	Nodes   map[string]*NodeState
	LastSeq int // pass this as expectedLast to Store.Append
}

// Replay rebuilds the state of an execution from its history.
// It is pure: no I/O, no clock, no randomness.
func Replay(def *workflow.Definition, events []eventstore.Event) (*State, error) {
	s := &State{
		Status: ExecPending,
		Nodes:  make(map[string]*NodeState, len(def.Nodes)),
	}
	for _, n := range def.Nodes {
		s.Nodes[n.ID] = &NodeState{Status: NodePending}
	}

	for _, e := range events {
		if err := s.apply(e); err != nil {
			return nil, fmt.Errorf("%w: event #%d (%s): %w", ErrInvalidHistory, e.Sequence, e.Type, err)
		}
		s.LastSeq = e.Sequence
	}
	return s, nil
}

// apply moves the state forward by exactly one event.
func (s *State) apply(e eventstore.Event) error {
	if e.Sequence != s.LastSeq+1 {
		return fmt.Errorf("expected sequence %d, got %d", s.LastSeq+1, e.Sequence)
	}
	if s.Status.IsTerminal() {
		return errors.New("event after execution finished")
	}

	switch e.Type {
	case eventstore.EventExecutionStarted:
		if s.Status != ExecPending {
			return errors.New("execution already started")
		}
		s.Status = ExecRunning

	case eventstore.EventNodeScheduled:
		n, err := s.node(e)
		if err != nil {
			return err
		}
		if n.Status == NodeCompleted {
			return fmt.Errorf("node %q already completed", e.NodeID)
		}
		if e.Attempt != n.Attempt+1 {
			return fmt.Errorf("node %q: attempt must be %d, got %d", e.NodeID, n.Attempt+1, e.Attempt)
		}
		n.Status = NodeScheduled
		n.Attempt = e.Attempt

	case eventstore.EventNodeCompleted:
		n, err := s.activeNode(e)
		if err != nil {
			return err
		}
		n.Status = NodeCompleted
		n.Output = e.InlinePayload
		n.OutputRef = e.PayloadRef

	case eventstore.EventNodeFailed:
		n, err := s.activeNode(e)
		if err != nil {
			return err
		}
		n.Status = NodeFailed
		n.Failure = e.InlinePayload

	case eventstore.EventExecutionCompleted:
		if s.Status != ExecRunning {
			return errors.New("execution is not running")
		}
		for id, n := range s.Nodes {
			if n.Status != NodeCompleted {
				return fmt.Errorf("node %q is %s, not COMPLETED", id, n.Status)
			}
		}
		s.Status = ExecCompleted

	case eventstore.EventExecutionFailed:
		if s.Status != ExecRunning {
			return errors.New("execution is not running")
		}
		s.Status = ExecFailed

	default:
		return fmt.Errorf("unknown event type %q", e.Type)
	}
	return nil
}

// node looks up the node an event refers to. The execution must be running.
func (s *State) node(e eventstore.Event) (*NodeState, error) {
	if s.Status != ExecRunning {
		return nil, errors.New("execution is not running")
	}
	n, ok := s.Nodes[e.NodeID]
	if !ok {
		return nil, fmt.Errorf("unknown node %q", e.NodeID)
	}
	return n, nil
}

// activeNode is like node, but also requires the node to be SCHEDULED with
// the same attempt as the event. This rejects results from stale attempts.
func (s *State) activeNode(e eventstore.Event) (*NodeState, error) {
	n, err := s.node(e)
	if err != nil {
		return nil, err
	}
	if n.Status != NodeScheduled {
		return nil, fmt.Errorf("node %q is %s, not SCHEDULED", e.NodeID, n.Status)
	}
	if e.Attempt != n.Attempt {
		return nil, fmt.Errorf("node %q: result for attempt %d but current attempt is %d",
			e.NodeID, e.Attempt, n.Attempt)
	}
	return n, nil
}