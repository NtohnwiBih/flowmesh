package dispatch

import (
	"context"
	"log"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

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

// fresh wipes Redis so each test starts from nothing.
func fresh(t *testing.T) *Dispatcher {
	t.Helper()
	if err := rdb.FlushAll(context.Background()).Err(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	return New(rdb)
}

func taskFor(node string, attempt int) Task {
	return NewTask("exec-1", workflow.Node{ID: node, Type: "http"}, attempt)
}

func TestTaskIdentity(t *testing.T) {
	a1, a2 := taskFor("step3", 1), taskFor("step3", 2)
	if a1.ID == a2.ID {
		t.Error("different attempts must have different task ids")
	}
	if a1.IdempotencyKey != a2.IdempotencyKey {
		t.Error("idempotency key must be identical across attempts")
	}
	if a1.IdempotencyKey == taskFor("step4", 1).IdempotencyKey {
		t.Error("different nodes must have different idempotency keys")
	}
}

func TestEnqueueClaimIsFIFO(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	for _, n := range []string{"s1", "s2"} {
		if ok, err := d.Enqueue(ctx, taskFor(n, 1), 0); err != nil || !ok {
			t.Fatalf("enqueue %s: ok=%v err=%v", n, ok, err)
		}
	}
	for _, want := range []string{"s1", "s2"} {
		got, err := d.Claim(ctx, "http", "w1", time.Minute)
		if err != nil || got == nil {
			t.Fatalf("claim: %v %v", got, err)
		}
		if got.NodeID != want {
			t.Errorf("got %s, want %s", got.NodeID, want)
		}
	}
	if got, _ := d.Claim(ctx, "http", "w1", time.Minute); got != nil {
		t.Errorf("queue should be empty, got %+v", got)
	}
}

func TestEnqueueIsIdempotent(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	first, _ := d.Enqueue(ctx, taskFor("s1", 1), 0)
	second, _ := d.Enqueue(ctx, taskFor("s1", 1), 0)
	if !first || second {
		t.Fatalf("want (true,false), got (%v,%v)", first, second)
	}
	d.Claim(ctx, "http", "w1", time.Minute)
	if got, _ := d.Claim(ctx, "http", "w1", time.Minute); got != nil {
		t.Error("task was queued twice")
	}
}

func TestHeartbeatKeepsLeaseAlive(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	d.Enqueue(ctx, taskFor("s1", 1), 0)
	task, _ := d.Claim(ctx, "http", "w1", 600*time.Millisecond)

	for i := 0; i < 4; i++ { // 800ms total, longer than one TTL
		time.Sleep(200 * time.Millisecond)
		ok, err := d.Heartbeat(ctx, task.ID, "w1", 600*time.Millisecond)
		if err != nil || !ok {
			t.Fatalf("heartbeat %d: ok=%v err=%v", i, ok, err)
		}
	}
	if exp, _ := d.ListExpired(ctx, 10); len(exp) != 0 {
		t.Errorf("lease should be alive, got %d expired", len(exp))
	}
}

// A preview of the flagship test: the worker dies, the lease expires, and
// attempt 2 is dispatched with the SAME idempotency key.
func TestCrashedWorkerLeaseExpiresAndRetryRuns(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	d.Enqueue(ctx, taskFor("step3", 1), 0)
	d.Claim(ctx, "http", "doomed-worker", 200*time.Millisecond)
	// ...the worker is SIGKILLed here: no heartbeat, no ack...

	time.Sleep(400 * time.Millisecond)
	expired, err := d.ListExpired(ctx, 10)
	if err != nil || len(expired) != 1 || expired[0].Attempt != 1 {
		t.Fatalf("want 1 expired attempt-1 task, got %+v (%v)", expired, err)
	}

	if ok, _ := d.Enqueue(ctx, taskFor("step3", 2), 0); !ok {
		t.Fatal("attempt 2 should enqueue")
	}
	retry, _ := d.Claim(ctx, "http", "healthy-worker", time.Minute)
	if retry == nil || retry.Attempt != 2 {
		t.Fatalf("want attempt 2, got %+v", retry)
	}
	if retry.IdempotencyKey != expired[0].IdempotencyKey {
		t.Error("retry must carry the same idempotency key")
	}

	if err := d.Release(ctx, expired[0].ID); err != nil {
		t.Fatal(err)
	}
	if exp, _ := d.ListExpired(ctx, 10); len(exp) != 0 {
		t.Errorf("released lease still listed: %+v", exp)
	}
}

func TestZombieAndStrangerHeartbeatsRejected(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	d.Enqueue(ctx, taskFor("s1", 1), 0)
	task, _ := d.Claim(ctx, "http", "w1", 200*time.Millisecond)

	if ok, _ := d.Heartbeat(ctx, task.ID, "someone-else", time.Minute); ok {
		t.Error("a stranger must not extend the lease")
	}
	time.Sleep(400 * time.Millisecond)
	if ok, _ := d.Heartbeat(ctx, task.ID, "w1", time.Minute); ok {
		t.Error("an expired lease must not be revived")
	}
}

func TestAck(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	d.Enqueue(ctx, taskFor("s1", 1), 0)
	task, _ := d.Claim(ctx, "http", "w1", 200*time.Millisecond)
	res := Result{TaskID: task.ID, ExecutionID: task.ExecutionID, NodeID: task.NodeID, Attempt: 1, OK: true}

	if ok, _ := d.Ack(ctx, "someone-else", res); ok {
		t.Error("a stranger must not ack")
	}
	if ok, err := d.Ack(ctx, "w1", res); err != nil || !ok {
		t.Fatalf("ack: ok=%v err=%v", ok, err)
	}
	if ok, _ := d.Ack(ctx, "w1", res); ok {
		t.Error("second ack must be refused")
	}
	if n, _ := rdb.LLen(ctx, keyResults).Result(); n != 1 {
		t.Errorf("want 1 result queued, got %d", n)
	}
	time.Sleep(400 * time.Millisecond)
	if exp, _ := d.ListExpired(ctx, 10); len(exp) != 0 {
		t.Error("a finished task must never look expired")
	}
}

func TestDelayedTaskWaitsForPromotion(t *testing.T) {
	ctx := context.Background()
	d := fresh(t)
	d.Enqueue(ctx, taskFor("s1", 2), 300*time.Millisecond)

	if got, _ := d.Claim(ctx, "http", "w1", time.Minute); got != nil {
		t.Fatal("delayed task must not be claimable yet")
	}
	if n, _ := d.Promote(ctx, 10); n != 0 {
		t.Errorf("nothing is due yet, promoted %d", n)
	}
	time.Sleep(450 * time.Millisecond)
	if n, _ := d.Promote(ctx, 10); n != 1 {
		t.Fatalf("want 1 promoted, got %d", n)
	}
	if got, _ := d.Claim(ctx, "http", "w1", time.Minute); got == nil || got.Attempt != 2 {
		t.Errorf("want the delayed task, got %+v", got)
	}
}