package workflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

var ErrCycle = errors.New("workflow contains a cycle")

type Definition struct {
	SchemaVersion int    `json:"schema_version"`
	Nodes         []Node `json:"nodes"`
	Edges         []Edge `json:"edges"`
}

type Node struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Config json.RawMessage `json:"config,omitempty"`
	Retry  *RetryPolicy    `json:"retry,omitempty"`
}

type RetryPolicy struct {
	MaxAttempts    int `json:"max_attempts"`
	BackoffSeconds int `json:"backoff_seconds"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Parse decoded JSON abd validates it
func Parse(data []byte) (*Definition, error) {
	var d Definition
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return nil, fmt.Errorf("failed to decode workflow definition: %w", err)
	}
	if err := d.Validate(); err != nil {
		return nil, err 
	}
	return &d, nil
}

// Validate checks structural rules and rejects cycles in the workflow definition.
func (d *Definition) Validate() error {
	if d.SchemaVersion != 1 {
		return fmt.Errorf("unsupported schema_version %d", d.SchemaVersion)
	}
	if len(d.Nodes) == 0 {
		return errors.New("workflow must contain at least one node")
	}

	ids := make(map[string]bool, len(d.Nodes))
	for _, node := range d.Nodes {
		if node.ID == "" {
			return errors.New("node ID cannot be empty")
		}
		if node.Type == "" {
			return fmt.Errorf("node %q must have a type", node.ID)
		}
		if ids[node.ID] {
			return fmt.Errorf("duplicate node ID %q", node.ID)
		}
		ids[node.ID] = true
		if node.Retry != nil && node.Retry.MaxAttempts < 1 {
			return fmt.Errorf("node %q has invalid retry policy: max_attempts must be >= 1", node.ID)
		}
	}

	indegree := make(map[string]int, len(ids))
	next := make(map[string][]string, len(ids))
	for id := range ids {
		indegree[id] = 0
	}
	for _, e := range d.Edges {
		if !ids[e.From] {
			return fmt.Errorf("edge references unknown node %q", e.From)
		}
		if !ids[e.To] {
			return fmt.Errorf("edge references unknown node %q", e.To)
		}
		next[e.From] = append(next[e.From], e.To)
		indegree[e.To]++
	}

	// Kahn's algorithm: repeatedly remove nodes with no remaining inputs.
	queue := make([]string, 0, len(ids))
	for id, deg := range indegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}
	visited := 0
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		visited++
		for _, n := range next[cur] {
			indegree[n]--
			if indegree[n] == 0 {
				queue = append(queue, n)
			}
		}
	}
	if visited != len(d.Nodes) {
		return ErrCycle
	}
	return nil
}