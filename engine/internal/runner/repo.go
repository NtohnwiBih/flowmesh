package runner

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/NtohnwiBih/flowmesh/engine/internal/replay"
	"github.com/NtohnwiBih/flowmesh/engine/internal/workflow"
)

// Repo is everything the Runner needs from the relational tables.
type Repo interface {
	Definition(ctx context.Context, executionID string) (*workflow.Definition, error)
	SetStatus(ctx context.Context, executionID string, st replay.ExecStatus) error
	ListByStatus(ctx context.Context, statuses ...string) ([]string, error)
}

// PGRepo implements Repo on PostgreSQL.
type PGRepo struct {
	Pool *pgxpool.Pool
}

func (p PGRepo) Definition(ctx context.Context, executionID string) (*workflow.Definition, error) {
	var raw []byte
	err := p.Pool.QueryRow(ctx,
		`SELECT v.definition
		   FROM workflow_executions e
		   JOIN workflow_versions v ON v.id = e.workflow_version_id
		  WHERE e.id = $1`, executionID).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("load definition for %s: %w", executionID, err)
	}
	return workflow.Parse(raw)
}

func (p PGRepo) SetStatus(ctx context.Context, executionID string, st replay.ExecStatus) error {
	_, err := p.Pool.Exec(ctx,
		`UPDATE workflow_executions
		    SET status       = $2::text::execution_status,
		        started_at   = COALESCE(started_at, NOW()),
		        completed_at = CASE WHEN $2::text IN ('COMPLETED','FAILED')
		                            THEN COALESCE(completed_at, NOW())
		                            ELSE completed_at END
		  WHERE id = $1`, executionID, string(st))
	if err != nil {
		return fmt.Errorf("set status: %w", err)
	}
	return nil
}

func (p PGRepo) ListByStatus(ctx context.Context, statuses ...string) ([]string, error) {
	rows, err := p.Pool.Query(ctx,
		`SELECT id::text FROM workflow_executions
		  WHERE status::text = ANY($1) ORDER BY created_at`, statuses)
	if err != nil {
		return nil, fmt.Errorf("list executions: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}