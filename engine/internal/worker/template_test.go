package worker

import (
	"encoding/json"
	"strings"
	"testing"
)

const tctx = `{"input":{"order_id":42,"name":"Ada","items":[{"id":"x1"},{"id":"x2"}]},
                "nodes":{"ingest":{"status":200}}}`

func TestResolve(t *testing.T) {
	tests := []struct {
		name, doc, want, wantErr string
	}{
		{name: "no placeholders", doc: `{"a":"plain","b":1}`, want: `{"a":"plain","b":1}`},
		{name: "inside text", doc: `{"u":"/orders/{{ input.order_id }}/x"}`, want: `{"u":"/orders/42/x"}`},
		{name: "whole value keeps type", doc: `{"n":"{{input.order_id}}"}`, want: `{"n":42}`},
		{name: "object value", doc: `{"o":"{{ nodes.ingest }}"}`, want: `{"o":{"status":200}}`},
		{name: "array index", doc: `{"i":"{{ input.items.1.id }}"}`, want: `{"i":"x2"}`},
		{name: "nested in array", doc: `["{{ input.name }}"]`, want: `["Ada"]`},
		{name: "two placeholders", doc: `{"s":"{{input.name}}#{{input.order_id}}"}`, want: `{"s":"Ada#42"}`},
		{name: "missing key", doc: `{"u":"{{ input.nope }}"}`, wantErr: "not found"},
		{name: "bad index", doc: `{"u":"{{ input.items.9 }}"}`, wantErr: "bad index"},
		{name: "descend into scalar", doc: `{"u":"{{ input.name.x }}"}`, wantErr: "cannot descend"},
		{name: "empty placeholder", doc: `{"u":"{{ }}"}`, wantErr: "empty placeholder"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Resolve(json.RawMessage(tc.doc), json.RawMessage(tctx))
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var g, w any
			_ = json.Unmarshal(got, &g)
			_ = json.Unmarshal([]byte(tc.want), &w)
			if !equalJSON(g, w) {
				t.Errorf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}