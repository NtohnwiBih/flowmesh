package worker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

const resultsKey = "fm:results" // the list Ack pushes to

var rdb *redis.Client

func TestMain(m *testing.M) {
	ctx := context.Background()
	ctr, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		log.Fatalf("start redis: %v", err)
	}
	uri, err := ctr.ConnectionString(ctx)
	if err != nil {
		log.Fatalf("redis uri: %v", err)
	}
	opt, err := redis.ParseURL(uri)
	if err != nil {
		log.Fatalf("parse uri: %v", err)
	}
	rdb = redis.NewClient(opt)

	code := m.Run()

	rdb.Close()
	_ = ctr.Terminate(ctx)
	os.Exit(code)
}

func fresh(t *testing.T) *dispatch.Dispatcher {
	t.Helper()
	if err := rdb.FlushAll(context.Background()).Err(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	return dispatch.New(rdb)
}

func newTask(node, cfg string) dispatch.Task {
	return dispatch.NewTask("exec-1",
		workflow.Node{ID: node, Type: "http", Config: json.RawMessage(cfg)}, 1)
}

// startWorker runs a worker in the background until the test ends.
func startWorker(t *testing.T, d *dispatch.Dispatcher, h Handler, ttl, hb time.Duration) {
	t.Helper()
	w, err := New(d, Config{
		ID: "w1", Queue: "http", Handler: h,
		LeaseTTL: ttl, HeartbeatEvery: hb, PollEvery: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.Run(ctx)
	}()
	t.Cleanup(func() { cancel(); <-done })
}

// waitResult blocks until a result appears (or the timeout passes).
func waitResult(t *testing.T, timeout time.Duration) *dispatch.Result {
	t.Helper()
	vals, err := rdb.BRPop(context.Background(), timeout, resultsKey).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		t.Fatalf("brpop: %v", err)
	}
	var r dispatch.Result
	if err := json.Unmarshal([]byte(vals[1]), &r); err != nil { // vals[0] is the key name
		t.Fatalf("decode result: %v", err)
	}
	return &r
}

func TestHTTPHandlerSendsIdempotencyKey(t *testing.T) {
	type seen struct{ key, method, body string }
	got := make(chan seen, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got <- seen{r.Header.Get("X-Idempotency-Key"), r.Method, string(b)}
		_, _ = w.Write([]byte("created"))
	}))
	defer srv.Close()

	task := newTask("step3", `{"method":"POST","url":"`+srv.URL+`","body":{"a":1}}`)
	out, err := HTTPHandler(nil)(context.Background(), task)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	s := <-got
	if s.key != task.IdempotencyKey || s.key == "" {
		t.Errorf("idempotency key = %q, want %q", s.key, task.IdempotencyKey)
	}
	if s.method != "POST" || s.body != `{"a":1}` {
		t.Errorf("request wrong: %+v", s)
	}
	var o map[string]any
	_ = json.Unmarshal(out, &o)
	if o["status"] != float64(200) || o["body"] != "created" {
		t.Errorf("output wrong: %s", out)
	}
}

func TestHTTPHandlerNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()

	_, err := HTTPHandler(nil)(context.Background(), newTask("s", `{"url":"`+srv.URL+`"}`))
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("want a 500 error, got %v", err)
	}
}

func TestWorkerRunsTaskAndAcks(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	d := fresh(t)
	task := newTask("step3", `{"url":"`+srv.URL+`"}`)
	if _, err := d.Enqueue(context.Background(), task, 0); err != nil {
		t.Fatal(err)
	}
	startWorker(t, d, HTTPHandler(nil), time.Second, 200*time.Millisecond)

	res := waitResult(t, 5*time.Second)
	if res == nil || !res.OK || res.TaskID != task.ID {
		t.Fatalf("bad result: %+v", res)
	}
	if hits.Load() != 1 {
		t.Errorf("server hit %d times, want 1", hits.Load())
	}
}

func TestHandlerErrorBecomesFailedResult(t *testing.T) {
	d := fresh(t)
	_, _ = d.Enqueue(context.Background(), newTask("s", ""), 0)
	startWorker(t, d, func(context.Context, dispatch.Task) (json.RawMessage, error) {
		return nil, errors.New("boom")
	}, time.Second, 200*time.Millisecond)

	res := waitResult(t, 5*time.Second)
	if res == nil || res.OK || !strings.Contains(res.Error, "boom") {
		t.Fatalf("want a failed result mentioning boom, got %+v", res)
	}
}

func TestPanicBecomesFailedResultAndWorkerSurvives(t *testing.T) {
	d := fresh(t)
	var calls atomic.Int32
	startWorker(t, d, func(context.Context, dispatch.Task) (json.RawMessage, error) {
		if calls.Add(1) == 1 {
			panic("kaboom")
		}
		return json.RawMessage(`{}`), nil
	}, time.Second, 200*time.Millisecond)

	_, _ = d.Enqueue(context.Background(), newTask("first", ""), 0)
	res := waitResult(t, 5*time.Second)
	if res == nil || res.OK || !strings.Contains(res.Error, "panic") {
		t.Fatalf("want a panic failure, got %+v", res)
	}

	_, _ = d.Enqueue(context.Background(), newTask("second", ""), 0)
	if res := waitResult(t, 5*time.Second); res == nil || !res.OK {
		t.Fatalf("worker should have survived the panic, got %+v", res)
	}
}

func TestHeartbeatKeepsSlowTaskAlive(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	_, _ = d.Enqueue(ctx, newTask("slow", ""), 0)

	// The task takes 900ms but the lease lasts only 300ms.
	startWorker(t, d, func(ctx context.Context, _ dispatch.Task) (json.RawMessage, error) {
		time.Sleep(900 * time.Millisecond)
		return json.RawMessage(`{}`), nil
	}, 300*time.Millisecond, 100*time.Millisecond)

	time.Sleep(600 * time.Millisecond) // well past the original deadline
	if exp, _ := d.ListExpired(ctx, 10); len(exp) != 0 {
		t.Fatalf("lease expired despite heartbeats: %+v", exp)
	}
	if res := waitResult(t, 5*time.Second); res == nil || !res.OK {
		t.Fatalf("want success, got %+v", res)
	}
}

func TestLostLeaseCancelsHandlerAndSkipsAck(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	task := newTask("zombie", "")
	_, _ = d.Enqueue(ctx, task, 0)

	started := make(chan struct{})
	cancelled := make(chan struct{})
	startWorker(t, d, func(ctx context.Context, _ dispatch.Task) (json.RawMessage, error) {
		close(started)
		<-ctx.Done() // block until told to stop
		close(cancelled)
		return nil, ctx.Err()
	}, 600*time.Millisecond, 100*time.Millisecond)

	<-started
	// The engine's reaper takes the lease away (as if we had been presumed dead).
	if err := d.Release(ctx, task.ID); err != nil {
		t.Fatal(err)
	}

	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("handler was not cancelled after the lease was lost")
	}
	time.Sleep(200 * time.Millisecond)
	if n, _ := rdb.LLen(ctx, resultsKey).Result(); n != 0 {
		t.Errorf("a zombie must not publish a result, found %d", n)
	}
}