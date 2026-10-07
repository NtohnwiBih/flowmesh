package dispatch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

const (
	keyLeases   = "fm:leases"       // sorted set: task id -> deadline (unix ms)
	keyOwners   = "fm:lease_owners" // hash: task id -> worker id
	keyDelayed  = "fm:delayed"      // sorted set: "queue|taskid" -> run-at (unix ms)
	keyResults  = "fm:results"      // list of Result JSON
	prefixQueue = "fm:queue:"
	prefixTask  = "fm:task:"

	// How long a finished task's record is kept. While it exists,
	// re-enqueueing the same task id is a no-op (duplicate protection).
	doneTTL = time.Hour
)

// Task is one unit of work for a worker.
type Task struct {
	ID             string          `json:"id"` // execution:node:attempt
	ExecutionID    string          `json:"execution_id"`
	NodeID         string          `json:"node_id"`
	Attempt        int             `json:"attempt"`
	Queue          string          `json:"queue"`           // which workers may take it
	IdempotencyKey string          `json:"idempotency_key"` // same for every attempt
	Config         json.RawMessage `json:"config,omitempty"`
}

// NewTask builds the task for one attempt of one node.
func NewTask(executionID string, n workflow.Node, attempt int) Task {
	sum := sha256.Sum256([]byte(executionID + ":" + n.ID))
	return Task{
		ID:             fmt.Sprintf("%s:%s:%d", executionID, n.ID, attempt),
		ExecutionID:    executionID,
		NodeID:         n.ID,
		Attempt:        attempt,
		Queue:          n.Type,
		IdempotencyKey: hex.EncodeToString(sum[:]),
		Config:         n.Config,
	}
}

// Result is what a worker reports when it finishes a task.
type Result struct {
	TaskID      string          `json:"task_id"`
	ExecutionID string          `json:"execution_id"`
	NodeID      string          `json:"node_id"`
	Attempt     int             `json:"attempt"`
	OK          bool            `json:"ok"`
	Output      json.RawMessage `json:"output,omitempty"`
	Error       string          `json:"error,omitempty"`
}

type Dispatcher struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Dispatcher {
	return &Dispatcher{rdb: rdb}
}

// ---------------------------------------------------------------- scripts

// Store the task (only if new), then queue it now or later.
var enqueueScript = redis.NewScript(`
if not redis.call('SET', KEYS[1], ARGV[1], 'NX') then return 0 end
if tonumber(ARGV[4]) > 0 then
  local t = redis.call('TIME')
  local now = t[1] * 1000 + math.floor(t[2] / 1000)
  redis.call('ZADD', KEYS[2], now + ARGV[4], ARGV[3] .. '|' .. ARGV[2])
else
  redis.call('LPUSH', ARGV[5] .. ARGV[3], ARGV[2])
end
return 1
`)

// Pop a task AND create its lease in one indivisible step.
var claimScript = redis.NewScript(`
local id = redis.call('RPOP', KEYS[1])
if not id then return nil end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZADD', KEYS[2], now + ARGV[2], id)
redis.call('HSET', KEYS[3], id, ARGV[1])
return redis.call('GET', ARGV[3] .. id)
`)

// Extend a lease, but only for its owner and only if it hasn't expired.
var heartbeatScript = redis.NewScript(`
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then return 0 end
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score then return 0 end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
if tonumber(score) < now then return 0 end
redis.call('ZADD', KEYS[1], now + ARGV[3], ARGV[1])
return 1
`)

// Finish a task: drop the lease and publish the result, only for the owner.
var ackScript = redis.NewScript(`
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
redis.call('LPUSH', KEYS[4], ARGV[3])
return 1
`)

// Read (without removing) leases whose deadline has passed.
var expiredScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, ARGV[1])
local out = {}
for _, id in ipairs(ids) do
  local body = redis.call('GET', ARGV[2] .. id)
  if body then out[#out + 1] = body end
end
return out
`)

// Move delayed tasks whose time has come onto their queues.
var promoteScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, ARGV[1])
for _, m in ipairs(due) do
  local q, id = string.match(m, '^(.-)|(.+)$')
  redis.call('LPUSH', ARGV[2] .. q, id)
  redis.call('ZREM', KEYS[1], m)
end
return #due
`)

// ---------------------------------------------------------------- methods

// Enqueue stores a task and queues it (after delay, if any).
// It returns false if this exact task (same id) was already enqueued.
func (d *Dispatcher) Enqueue(ctx context.Context, t Task, delay time.Duration) (bool, error) {
	if t.Queue == "" || strings.Contains(t.Queue, "|") {
		return false, fmt.Errorf("invalid queue name %q", t.Queue)
	}
	body, err := json.Marshal(t)
	if err != nil {
		return false, fmt.Errorf("marshal task: %w", err)
	}
	n, err := enqueueScript.Run(ctx, d.rdb,
		[]string{prefixTask + t.ID, keyDelayed},
		body, t.ID, t.Queue, delay.Milliseconds(), prefixQueue,
	).Int()
	if err != nil {
		return false, fmt.Errorf("enqueue: %w", err)
	}
	return n == 1, nil
}

// Promote moves due delayed tasks to their queues; returns how many moved.
func (d *Dispatcher) Promote(ctx context.Context, limit int) (int, error) {
	n, err := promoteScript.Run(ctx, d.rdb, []string{keyDelayed}, limit, prefixQueue).Int()
	if err != nil {
		return 0, fmt.Errorf("promote: %w", err)
	}
	return n, nil
}

// Claim takes the oldest task from a queue and leases it to workerID.
// It returns (nil, nil) when the queue is empty.
func (d *Dispatcher) Claim(ctx context.Context, queue, workerID string, ttl time.Duration) (*Task, error) {
	res, err := claimScript.Run(ctx, d.rdb,
		[]string{prefixQueue + queue, keyLeases, keyOwners},
		workerID, ttl.Milliseconds(), prefixTask,
	).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim: %w", err)
	}
	s, ok := res.(string)
	if !ok {
		return nil, fmt.Errorf("claim: unexpected reply %T", res)
	}
	var t Task
	if err := json.Unmarshal([]byte(s), &t); err != nil {
		return nil, fmt.Errorf("claim: decode task: %w", err)
	}
	return &t, nil
}

// Heartbeat renews a lease. false means the lease is gone (expired, reaped,
// finished, or owned by someone else) and the worker must stop working.
func (d *Dispatcher) Heartbeat(ctx context.Context, taskID, workerID string, ttl time.Duration) (bool, error) {
	n, err := heartbeatScript.Run(ctx, d.rdb,
		[]string{keyLeases, keyOwners}, taskID, workerID, ttl.Milliseconds(),
	).Int()
	if err != nil {
		return false, fmt.Errorf("heartbeat: %w", err)
	}
	return n == 1, nil
}

// Ack reports a finished task. false means the caller no longer owns it.
func (d *Dispatcher) Ack(ctx context.Context, workerID string, r Result) (bool, error) {
	body, err := json.Marshal(r)
	if err != nil {
		return false, fmt.Errorf("marshal result: %w", err)
	}
	n, err := ackScript.Run(ctx, d.rdb,
		[]string{keyLeases, keyOwners, prefixTask + r.TaskID, keyResults},
		r.TaskID, workerID, body, doneTTL.Milliseconds(),
	).Int()
	if err != nil {
		return false, fmt.Errorf("ack: %w", err)
	}
	return n == 1, nil
}

// ListExpired returns tasks whose lease deadline has passed. It does not
// remove them: call Release only after the engine has recorded what it did.
func (d *Dispatcher) ListExpired(ctx context.Context, limit int) ([]Task, error) {
	res, err := expiredScript.Run(ctx, d.rdb, []string{keyLeases}, limit, prefixTask).Result()
	if err != nil {
		return nil, fmt.Errorf("list expired: %w", err)
	}
	items, ok := res.([]interface{})
	if !ok {
		return nil, fmt.Errorf("list expired: unexpected reply %T", res)
	}
	tasks := make([]Task, 0, len(items))
	for _, it := range items {
		var t Task
		if err := json.Unmarshal([]byte(it.(string)), &t); err != nil {
			return nil, fmt.Errorf("list expired: decode: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, nil
}

// Release removes a lease for good (after the reaper has handled it).
func (d *Dispatcher) Release(ctx context.Context, taskID string) error {
	pipe := d.rdb.TxPipeline()
	pipe.ZRem(ctx, keyLeases, taskID)
	pipe.HDel(ctx, keyOwners, taskID)
	pipe.Expire(ctx, prefixTask+taskID, doneTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("release: %w", err)
	}
	return nil
}