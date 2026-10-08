package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/worker"
)

var (
	pool *pgxpool.Pool
	rdb  *redis.Client
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	pg, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("flowmesh_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		log.Fatalf("start postgres: %v", err)
	}
	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		log.Fatalf("dsn: %v", err)
	}
	if pool, err = pgxpool.New(ctx, dsn); err != nil {
		log.Fatalf("pool: %v", err)
	}
	if err := applyMigrations(ctx, pool); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	rd, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		log.Fatalf("start redis: %v", err)
	}
	uri, err := rd.ConnectionString(ctx)
	if err != nil {
		log.Fatalf("redis uri: %v", err)
	}
	opt, err := redis.ParseURL(uri)
	if err != nil {
		log.Fatalf("redis url: %v", err)
	}
	rdb = redis.NewClient(opt)

	code := m.Run()

	pool.Close()
	rdb.Close()
	_ = pg.Terminate(ctx)
	_ = rd.Terminate(ctx)
	os.Exit(code)
}

func applyMigrations(ctx context.Context, p *pgxpool.Pool) error {
	files, err := filepath.Glob("../../../db/migrations/*.up.sql")
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return errors.New("no migration files found")
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		if _, err := p.Exec(ctx, string(b), pgx.QueryExecModeSimpleProtocol); err != nil {
			return fmt.Errorf("apply %s: %w", f, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------- helpers

// a -> b -> c. a and b may be retried (3 attempts, no wait). c may not.
const chainJSON = `{"schema_version":1,
 "nodes":[
  {"id":"a","type":"http","retry":{"max_attempts":3,"backoff_seconds":0}},
  {"id":"b","type":"http","retry":{"max_attempts":3,"backoff_seconds":0}},
  {"id":"c","type":"http"}],
 "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}`

// seedExecution inserts a PENDING execution of the given definition.
func seedExecution(t *testing.T, defJSON string) string {
	t.Helper()
	ctx := context.Background()
	var wsID, wfID, verID, execID string
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	must(pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, slug) VALUES ('t', gen_random_uuid()::text) RETURNING id::text`).Scan(&wsID))
	must(pool.QueryRow(ctx,
		`INSERT INTO workflows (workspace_id, name) VALUES ($1, 'wf') RETURNING id::text`, wsID).Scan(&wfID))
	must(pool.QueryRow(ctx,
		`INSERT INTO workflow_versions (workflow_id, version, definition) VALUES ($1, 1, $2::jsonb) RETURNING id::text`,
		wfID, defJSON).Scan(&verID))
	must(pool.QueryRow(ctx,
		`INSERT INTO workflow_executions (workflow_id, workflow_version_id, initiated_by)
		 VALUES ($1, $2, 'test') RETURNING id::text`, wfID, verID).Scan(&execID))
	return execID
}

func fresh(t *testing.T) *dispatch.Dispatcher {
	t.Helper()
	if err := rdb.FlushAll(context.Background()).Err(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	return dispatch.New(rdb)
}

// runInBackground starts f and stops it (and waits) when the test ends.
func runInBackground(t *testing.T, f func(ctx context.Context)) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		f(ctx)
	}()
	t.Cleanup(func() { cancel(); <-done })
}

func startRunner(t *testing.T, d *dispatch.Dispatcher) {
	t.Helper()
	r := New(eventstore.New(pool), d, PGRepo{Pool: pool}, 50*time.Millisecond)
	runInBackground(t, func(ctx context.Context) { _ = r.Run(ctx) })
}

// counter records how many times each node's handler actually ran.
type counter struct {
	mu sync.Mutex
	n  map[string]int
}

func newCounter() *counter { return &counter{n: map[string]int{}} }

func (c *counter) handle(_ context.Context, t dispatch.Task) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n[t.NodeID]++
	return json.RawMessage(`{"ok":true}`), nil
}

func (c *counter) get(node string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n[node]
}

func startWorker(t *testing.T, d *dispatch.Dispatcher, h worker.Handler) {
	t.Helper()
	w, err := worker.New(d, worker.Config{
		ID: "good-worker", Queue: "http", Handler: h,
		LeaseTTL: 2 * time.Second, HeartbeatEvery: 200 * time.Millisecond,
		PollEvery: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	runInBackground(t, func(ctx context.Context) { _ = w.Run(ctx) })
}

func waitStatus(t *testing.T, execID, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var got string
	for time.Now().Before(deadline) {
		_ = pool.QueryRow(context.Background(),
			`SELECT status::text FROM workflow_executions WHERE id = $1`, execID).Scan(&got)
		if got == want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("execution status = %q after %v, want %q", got, timeout, want)
}

func loadEvents(t *testing.T, execID string) []eventstore.Event {
	t.Helper()
	evs, err := eventstore.New(pool).Load(context.Background(), execID)
	if err != nil {
		t.Fatal(err)
	}
	return evs
}

func has(evs []eventstore.Event, typ, node string, attempt int) bool {
	for _, e := range evs {
		if e.Type == typ && e.NodeID == node && e.Attempt == attempt {
			return true
		}
	}
	return false
}

// ------------------------------------------------------------------ tests

func TestChainRunsToCompletion(t *testing.T) {
	d := fresh(t)
	execID := seedExecution(t, chainJSON)
	c := newCounter()

	startRunner(t, d)
	startWorker(t, d, c.handle)
	waitStatus(t, execID, "COMPLETED", 10*time.Second)

	// START + 3 x (SCHEDULED + COMPLETED) + EXECUTION_COMPLETED
	if evs := loadEvents(t, execID); len(evs) != 8 {
		t.Errorf("want 8 events, got %d: %+v", len(evs), evs)
	}
	for _, n := range []string{"a", "b", "c"} {
		if c.get(n) != 1 {
			t.Errorf("node %s ran %d times, want 1", n, c.get(n))
		}
	}
}

// A worker takes node a, then dies silently (no heartbeat, no result).
func TestExpiredLeaseIsRetriedAsNextAttempt(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	execID := seedExecution(t, chainJSON)
	c := newCounter()

	startRunner(t, d)

	// The doomed worker: claim with a short lease, then vanish.
	var dead *dispatch.Task
	deadline := time.Now().Add(5 * time.Second)
	for dead == nil && time.Now().Before(deadline) {
		dead, _ = d.Claim(ctx, "http", "dead-worker", 300*time.Millisecond)
		if dead == nil {
			time.Sleep(20 * time.Millisecond)
		}
	}
	if dead == nil {
		t.Fatal("the runner never queued the first task")
	}
	if dead.NodeID != "a" || dead.Attempt != 1 {
		t.Fatalf("doomed worker got %s attempt %d, want a attempt 1", dead.NodeID, dead.Attempt)
	}

	startWorker(t, d, c.handle) // a healthy worker joins
	waitStatus(t, execID, "COMPLETED", 15*time.Second)

	evs := loadEvents(t, execID)
	if !has(evs, eventstore.EventNodeFailed, "a", 1) {
		t.Error("attempt 1 of a should be recorded as FAILED (lease expired)")
	}
	if !has(evs, eventstore.EventNodeScheduled, "a", 2) || !has(evs, eventstore.EventNodeCompleted, "a", 2) {
		t.Error("a should have been rescheduled and completed as attempt 2")
	}
	// The dead worker never ran the handler, so each node ran exactly once.
	for _, n := range []string{"a", "b", "c"} {
		if c.get(n) != 1 {
			t.Errorf("node %s handler ran %d times, want 1", n, c.get(n))
		}
	}
}

// Same crash, but node c has no retry policy: one attempt only.
func TestCrashWithoutRetryPolicyFailsTheExecution(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	execID := seedExecution(t, `{"schema_version":1,
		"nodes":[{"id":"only","type":"http"}],"edges":[]}`)

	startRunner(t, d)
	var dead *dispatch.Task
	for deadline := time.Now().Add(5 * time.Second); dead == nil && time.Now().Before(deadline); {
		dead, _ = d.Claim(ctx, "http", "dead-worker", 300*time.Millisecond)
		time.Sleep(20 * time.Millisecond)
	}
	if dead == nil {
		t.Fatal("no task was queued")
	}
	waitStatus(t, execID, "FAILED", 10*time.Second)
}