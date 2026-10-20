package workflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"
)

var ErrCycle = errors.New("workflow contains a cycle")

// Limits mirror the database columns and the Python validator.
const (
	maxIDLen    = 100
	maxNameLen  = 255
	maxLabelLen = 100
)

type Definition struct {
	SchemaVersion int    `json:"schema_version"`
	Nodes         []Node `json:"nodes"`
	Edges         []Edge `json:"edges"`
}

// Position is a canvas coordinate. The engine carries it but never uses it.
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// EdgeUI remembers which sides of the node cards an edge attaches to.
type EdgeUI struct {
	SourceHandle string `json:"source_handle,omitempty"`
	TargetHandle string `json:"target_handle,omitempty"`
}

type Node struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Name   string          `json:"name,omitempty"`
	Config json.RawMessage `json:"config,omitempty"`
	Retry  *RetryPolicy    `json:"retry,omitempty"`
	UI     *Position       `json:"ui,omitempty"`
}

type RetryPolicy struct {
	MaxAttempts    int `json:"max_attempts"`
	BackoffSeconds int `json:"backoff_seconds"`
}

type Edge struct {
	From  string  `json:"from"`
	To    string  `json:"to"`
	Label string  `json:"label,omitempty"`
	UI    *EdgeUI `json:"ui,omitempty"`
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

func configIsObject(raw json.RawMessage) bool {
	t := bytes.TrimSpace(raw)
	return len(t) == 0 || string(t) == "null" || t[0] == '{'
}

// Validate checks structural rules and rejects cycles.
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
		if utf8.RuneCountInString(node.ID) > maxIDLen {
			return fmt.Errorf("node ID is longer than %d characters", maxIDLen)
		}
		if node.Type == "" {
			return fmt.Errorf("node %q must have a type", node.ID)
		}
		if utf8.RuneCountInString(node.Name) > maxNameLen {
			return fmt.Errorf("node %q: name is longer than %d characters", node.ID, maxNameLen)
		}
		if !configIsObject(node.Config) {
			return fmt.Errorf("node %q: config must be a JSON object", node.ID)
		}
		if ids[node.ID] {
			return fmt.Errorf("duplicate node ID %q", node.ID)
		}
		ids[node.ID] = true
		if node.Retry != nil {
			if node.Retry.MaxAttempts < 1 {
				return fmt.Errorf("node %q has invalid retry policy: max_attempts must be >= 1", node.ID)
			}
			if node.Retry.BackoffSeconds < 0 {
				return fmt.Errorf("node %q has invalid retry policy: backoff_seconds must be >= 0", node.ID)
			}
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
		if utf8.RuneCountInString(e.Label) > maxLabelLen {
			return fmt.Errorf("edge %q -> %q: label is longer than %d characters", e.From, e.To, maxLabelLen)
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