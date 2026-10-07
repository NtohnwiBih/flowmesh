package eventstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Event types written by the engine
const (
	EventExecutionStarted   = "EXECUTION_STARTED"
	EventNodeScheduled      = "NODE_SCHEDULED"
	EventNodeCompleted	    = "NODE_COMPLETED"
	EventNodeFailed         = "NODE_FAILED"
	EventExecutionCompleted = "EXECUTION_COMPLETED"
	EventExecutionFailed    = "EXECUTION_FAILED"
)

// ErrConflict means another writer got there first(or the caller's view of
// the history is out of date). the caller should reload and retry.
var ErrConflict = errors.New("eventstore: sequence conflict")

// NewEvent is what a caller supplies. The store assigns sequence numbers.
type NewEvent struct {
	Type          string
	NodeID        string          // "" means "not tied to a node"
	Attempt       int             // 0 means "not applicable"
	PayloadRef    string          // s3://... for big payloads, else ""
	InlinePayload json.RawMessage // small payloads, else nil
}

// Event is what comes back out of the store.
type Event struct {
	ExecutionID   string
	Sequence      int
	Type          string
	NodeID        string
	Attempt       int
	PayloadRef    string
	InlinePayload json.RawMessage
	CreatedAt     time.Time // metadat only: never use it for decisions in replay
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Append writes as numbers expectedLast+1, expectedLast+2, ... and returns the new last sequence number.
// All events are written, or none are.
func (s *Store) Append(ctx context.Context, executionID string, expectedLast int, events []NewEvent) error {
	if len(events) == 0 {
		return nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // harmless no-op if we already committed

	var last int
	err = tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(sequence_num), 0)
		   FROM execution_events
		  WHERE execution_id = $1`, executionID).Scan(&last)
	if err != nil {
		return fmt.Errorf("read last sequence: %w", err)
	}
	if last != expectedLast {
		return fmt.Errorf("%w: expected last=%d, actual last=%d", ErrConflict, expectedLast, last)
	}

	for i,  e := range events {
		_, err := tx.Exec(ctx,
		    `INSERT INTO execution_events
			    (execution_id, sequence_num, event_type, node_id, attempt, payload_ref, inline_payload)
			 VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::int, 0), NULLIF($6::text, ''), $7)`,
			executionID, expectedLast+1+i, e.Type, e.NodeID, e.Attempt, e.PayloadRef, []byte(e.InlinePayload))
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505"{ // unique_violation
				return fmt.Errorf("%w: lost a race on sequence %d", ErrConflict, expectedLast+1+i)
			}
			return fmt.Errorf("insert event %d: %w", i, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}


// Load returns every event of an execution, oldest first.
func (s *Store) Load(ctx context.Context, executionID string) ([]Event, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT sequence_num, event_type, node_id, attempt, payload_ref, inline_payload, created_at
		   FROM execution_events
		  WHERE execution_id = $1
		  ORDER BY sequence_num ASC`, executionID)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var out []Event
	for rows.Next() {
		var (
			e          Event
			nodeID     *string
			attempt    *int
			payloadRef *string
			inline     []byte
		)
		if err := rows.Scan(&e.Sequence, &e.Type, &nodeID, &attempt, &payloadRef, &inline, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		if nodeID != nil {
			e.NodeID = *nodeID
		}
		if attempt != nil {
			e.Attempt = *attempt
		}
		if payloadRef != nil {
			e.PayloadRef = *payloadRef
		}
		e.InlinePayload = json.RawMessage(inline)
		e.ExecutionID = executionID
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	return out, nil
}