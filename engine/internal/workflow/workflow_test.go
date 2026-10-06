package workflow

import (
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string // empty means success expected
	}{
		{
			name: "valid linear",
			input: `{"schema_version":1,
			    "nodes":[{"id":"a","type":"x"},{"id":"b","type":"x"}],
			    "edges":[{"from":"a","to":"b"}]}`,
		},
		{
			name: "cycle",
			input: `{"schema_version":1,
			    "nodes":[{"id":"a","type":"x"},{"id":"b","type":"x"}],
			    "edges":[{"from":"a","to":"b"},{"from":"b","to":"a"}]}`,
			wantErr: "cycle",
		},
		{
			name: "self loop",
			input: `{"schema_version":1,
			    "nodes":[{"id":"a","type":"x"}],
			    "edges":[{"from":"a","to":"a"}]}`,
			wantErr: "cycle",
		},
		{
			name: "unknown node in edge",
			input: `{"schema_version":1,
				"nodes":[{"id":"a","type":"x"}],
				"edges":[{"from":"a","to":"zzz"}]}`,
			wantErr: "unknown node",
		},
		{
			name: "duplicate id",
			input: `{"schema_version":1,
				"nodes":[{"id":"a","type":"x"},{"id":"a","type":"x"}],
				"edges":[]}`,
			wantErr: "duplicate",
		},
		{
			name:    "typo in field name",
			input:   `{"schema_version":1,"nodse":[],"edges":[]}`,
			wantErr: "failed to decode workflow definition",
		},
		{
			name:    "no nodes",
			input:   `{"schema_version":1,"nodes":[],"edges":[]}`,
			wantErr: "at least one node",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.input))
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err, tc.wantErr)
			}
		})
	}
}