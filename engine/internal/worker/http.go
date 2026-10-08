package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
)

const maxResponseBytes = 1 << 20 // 1 MiB, until payload offloading exists

type httpConfig struct {
	Method string          `json:"method"`
	URL    string          `json:"url"`
	Body   json.RawMessage `json:"body,omitempty"`
}

// HTTPHandler performs an HTTP request described by the node's config.
// Every request carries X-Idempotency-Key, identical across attempts, so the
// remote service can recognise a retry of the same logical operation.
func HTTPHandler(client *http.Client) Handler {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return func(ctx context.Context, t dispatch.Task) (json.RawMessage, error) {
		var c httpConfig
		if err := json.Unmarshal(t.Config, &c); err != nil {
			return nil, fmt.Errorf("bad http config: %w", err)
		}
		if c.URL == "" {
			return nil, errors.New("bad http config: url is required")
		}
		if c.Method == "" {
			c.Method = http.MethodGet
		}

		var body io.Reader
		if len(c.Body) > 0 {
			body = bytes.NewReader(c.Body)
		}
		req, err := http.NewRequestWithContext(ctx, c.Method, c.URL, body)
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("X-Idempotency-Key", t.IdempotencyKey)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("send request: %w", err)
		}
		defer resp.Body.Close()

		data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		if len(data) > maxResponseBytes {
			return nil, errors.New("response larger than 1 MiB")
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil, fmt.Errorf("http status %d", resp.StatusCode)
		}
		return json.Marshal(map[string]any{"status": resp.StatusCode, "body": string(data)})
	}
}