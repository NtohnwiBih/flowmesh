package worker

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var placeholder = regexp.MustCompile(`\{\{\s*([^{}]*?)\s*\}\}`)

// Resolve walks a JSON document and substitutes {{ path }} placeholders in
// every string value using ctx (also JSON). Object keys are never rewritten.
func Resolve(doc, ctx json.RawMessage) (json.RawMessage, error) {
	if len(doc) == 0 {
		return doc, nil
	}
	var d, c any
	if err := json.Unmarshal(doc, &d); err != nil {
		return nil, fmt.Errorf("template: bad document: %w", err)
	}
	if len(ctx) > 0 {
		if err := json.Unmarshal(ctx, &c); err != nil {
			return nil, fmt.Errorf("template: bad context: %w", err)
		}
	}
	out, err := walk(d, c)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func walk(v, ctx any) (any, error) {
	switch t := v.(type) {
	case string:
		return substitute(t, ctx)
	case []any:
		for i := range t {
			r, err := walk(t[i], ctx)
			if err != nil {
				return nil, err
			}
			t[i] = r
		}
		return t, nil
	case map[string]any:
		for k := range t {
			r, err := walk(t[k], ctx)
			if err != nil {
				return nil, err
			}
			t[k] = r
		}
		return t, nil
	default:
		return v, nil
	}
}

func substitute(s string, ctx any) (any, error) {
	locs := placeholder.FindAllStringSubmatchIndex(s, -1)
	if len(locs) == 0 {
		return s, nil
	}
	// A string that is exactly one placeholder keeps the value's real type.
	if len(locs) == 1 && locs[0][0] == 0 && locs[0][1] == len(s) {
		return lookup(ctx, s[locs[0][2]:locs[0][3]])
	}
	var b strings.Builder
	last := 0
	for _, l := range locs {
		b.WriteString(s[last:l[0]])
		v, err := lookup(ctx, s[l[2]:l[3]])
		if err != nil {
			return nil, err
		}
		b.WriteString(asText(v))
		last = l[1]
	}
	b.WriteString(s[last:])
	return b.String(), nil
}

// lookup follows a dotted path such as "nodes.ingest.status" or "items.0.id".
func lookup(ctx any, path string) (any, error) {
	if path == "" {
		return nil, fmt.Errorf("template: empty placeholder")
	}
	cur := ctx
	for _, part := range strings.Split(path, ".") {
		switch t := cur.(type) {
		case map[string]any:
			next, ok := t[part]
			if !ok {
				return nil, fmt.Errorf("template: %q not found (missing %q)", path, part)
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(t) {
				return nil, fmt.Errorf("template: %q: bad index %q", path, part)
			}
			cur = t[i]
		default:
			return nil, fmt.Errorf("template: %q: cannot descend into %T at %q", path, cur, part)
		}
	}
	return cur, nil
}

func asText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return "null"
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}