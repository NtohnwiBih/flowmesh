package eventstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

var testPool *pgxpool.Pool

// TestMain runs once before all tests in this package.
func TestMain(m *testing.M) {
	ctx := context.Background()

	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
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
		log.Fatalf("start postgres container: %v", err)
	}

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		log.Fatalf("connection string: %v", err)
	}
	testPool, err = pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("pool: %v", err)
	}
	if err := applyMigrations(ctx, testPool); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	code := m.Run() // run all the tests

	testPool.Close()
	_ = ctr.Terminate(ctx)
	os.Exit(code)
}

// applyMigrations runs every *.up.sql file in order.
func applyMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	files, err := filepath.Glob("../../../db/migrations/*.up.sql")
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return errors.New("no migration files found")
	}
	sort.Strings(files)
	for _, f := range files {
		sqlBytes, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		// Simple protocol allows several statements in one string.
		if _, err := pool.Exec(ctx, string(sqlBytes), pgx.QueryExecModeSimpleProtocol); err != nil {
			return fmt.Errorf("apply %s: %w", f, err)
		}
	}
	return nil
}

// seedExecution creates the parent rows an execution needs and returns its id.
func seedExecution(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	var wsID, wfID, verID, execID string

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	must(testPool.QueryRow(ctx,
		`INSERT INTO workspaces (name, slug) VALUES ('test', gen_random_uuid()::text) RETURNING id::text`).Scan(&wsID))
	must(testPool.QueryRow(ctx,
		`INSERT INTO workflows (workspace_id, name) VALUES ($1, 'wf') RETURNING id::text`, wsID).Scan(&wfID))
	must(testPool.QueryRow(ctx,
		`INSERT INTO workflow_versions (workflow_id, version, definition) VALUES ($1, 1, '{}') RETURNING id::text`, wfID).Scan(&verID))
	must(testPool.QueryRow(ctx,
		`INSERT INTO workflow_executions (workflow_id, workflow_version_id, initiated_by)
		 VALUES ($1, $2, 'test') RETURNING id::text`, wfID, verID).Scan(&execID))
	return execID
}

func TestAppendAndLoad(t *testing.T) {
	ctx := context.Background()
	store := New(testPool)
	execID := seedExecution(t)

	err := store.Append(ctx, execID, 0, []NewEvent{
		{Type: EventExecutionStarted},
		{Type: EventNodeScheduled, NodeID: "ingest", Attempt: 1},
	})
	if err != nil {
		t.Fatalf("first append: %v", err)
	}
	err = store.Append(ctx, execID, 2, []NewEvent{
		{Type: EventNodeCompleted, NodeID: "ingest", Attempt: 1, InlinePayload: json.RawMessage(`{"ok":true}`)},
	})
	if err != nil {
		t.Fatalf("second append: %v", err)
	}

	events, err := store.Load(ctx, execID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("want 3 events, got %d", len(events))
	}
	for i, e := range events {
		if e.Sequence != i+1 {
			t.Errorf("event %d has sequence %d", i, e.Sequence)
		}
	}
	// NULL columns round-trip back to zero values.
	if events[0].NodeID != "" || events[0].Attempt != 0 || events[0].InlinePayload != nil {
		t.Errorf("event 0 should have no node/attempt/payload: %+v", events[0])
	}
	if events[2].NodeID != "ingest" || events[2].Attempt != 1 || events[2].Type != EventNodeCompleted {
		t.Errorf("event 2 wrong: %+v", events[2])
	}
	// jsonb normalises whitespace, so compare meaning, not text.
	var payload map[string]any
	if err := json.Unmarshal(events[2].InlinePayload, &payload); err != nil {
		t.Fatalf("payload not valid JSON: %v", err)
	}
	if payload["ok"] != true {
		t.Errorf("payload wrong: %v", payload)
	}
}

func TestAppendRejectsStaleOrGappedSequence(t *testing.T) {
	ctx := context.Background()
	store := New(testPool)
	execID := seedExecution(t)
	one := []NewEvent{{Type: EventExecutionStarted}}

	if err := store.Append(ctx, execID, 0, one); err != nil {
		t.Fatalf("append: %v", err)
	}
	// Stale: we claim the history is empty, but it already has an event.
	if err := store.Append(ctx, execID, 0, one); !errors.Is(err, ErrConflict) {
		t.Errorf("stale append: want ErrConflict, got %v", err)
	}
	// Gap: we claim 5 events exist, which would leave holes.
	if err := store.Append(ctx, execID, 5, one); !errors.Is(err, ErrConflict) {
		t.Errorf("gapped append: want ErrConflict, got %v", err)
	}
	events, _ := store.Load(ctx, execID)
	if len(events) != 1 {
		t.Errorf("history should be untouched, got %d events", len(events))
	}
}

func TestAppendIsAtomic(t *testing.T) {
	ctx := context.Background()
	store := New(testPool)
	execID := seedExecution(t)

	// The second event's type is 101 chars, but the column allows only 100.
	bad := strings.Repeat("x", 101)
	err := store.Append(ctx, execID, 0, []NewEvent{
		{Type: EventExecutionStarted},
		{Type: bad},
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrConflict) {
		t.Fatalf("should be a data error, not a conflict: %v", err)
	}
	events, _ := store.Load(ctx, execID)
	if len(events) != 0 {
		t.Errorf("first event should have been rolled back, got %d events", len(events))
	}
}

func TestConcurrentAppendExactlyOneWins(t *testing.T) {
	ctx := context.Background()
	store := New(testPool)
	execID := seedExecution(t)

	const writers = 10
	results := make([]error, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = store.Append(ctx, execID, 0, []NewEvent{{Type: EventExecutionStarted}})
		}(i)
	}
	wg.Wait()

	wins := 0
	for _, err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, ErrConflict):
			// expected for the losers
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if wins != 1 {
		t.Errorf("want exactly 1 winner, got %d", wins)
	}
	events, _ := store.Load(ctx, execID)
	if len(events) != 1 {
		t.Errorf("want 1 event stored, got %d", len(events))
	}
}

func TestEventsCannotBeUpdated(t *testing.T) {
	ctx := context.Background()
	store := New(testPool)
	execID := seedExecution(t)

	if err := store.Append(ctx, execID, 0, []NewEvent{{Type: EventExecutionStarted}}); err != nil {
		t.Fatalf("append: %v", err)
	}
	// There must be a row to update, or the trigger never fires.
	_, err := testPool.Exec(ctx,
		`UPDATE execution_events SET event_type = 'HACKED' WHERE execution_id = $1`, execID)
	if err == nil {
		t.Fatal("expected the UPDATE to be rejected by the trigger")
	}
}

func TestLoadUnknownExecutionIsEmpty(t *testing.T) {
	store := New(testPool)
	events, err := store.Load(context.Background(), "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("want no events, got %d", len(events))
	}
}
