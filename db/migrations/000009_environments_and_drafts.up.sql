CREATE TYPE environment AS ENUM ('staging', 'production');

-- Published versions are 'production' and numbered.
-- Staging snapshots (test runs of a draft) are unnumbered and deduplicated by hash.
ALTER TABLE workflow_versions
    ADD COLUMN environment     environment NOT NULL DEFAULT 'production',
    ADD COLUMN definition_hash VARCHAR(64),
    ALTER COLUMN version DROP NOT NULL;

ALTER TABLE workflow_versions ADD CONSTRAINT ck_version_numbering CHECK (
    (environment = 'production' AND version IS NOT NULL) OR
    (environment = 'staging'    AND version IS NULL));

CREATE UNIQUE INDEX uq_staging_snapshot
    ON workflow_versions (workflow_id, definition_hash) WHERE environment = 'staging';

-- Which version is live. Explicit, so rollback is just moving the pointer.
ALTER TABLE workflows
    ADD COLUMN production_version_id UUID REFERENCES workflow_versions(id) ON DELETE SET NULL;

UPDATE workflows w SET production_version_id = (
    SELECT v.id FROM workflow_versions v
     WHERE v.workflow_id = w.id AND v.environment = 'production'
     ORDER BY v.version DESC LIMIT 1);

-- One mutable draft per workflow: this is "staging".
CREATE TABLE workflow_drafts (
    workflow_id  UUID PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
    definition   JSONB       NOT NULL,
    base_version INT,
    updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workflow_drafts (workflow_id, definition, base_version)
SELECT w.id, v.definition, v.version
  FROM workflows w JOIN workflow_versions v ON v.id = w.production_version_id;

-- Executions and webhooks know their environment.
ALTER TABLE workflow_executions ADD COLUMN environment environment NOT NULL DEFAULT 'production';
ALTER TABLE workflow_executions DROP CONSTRAINT uq_execution_idempotency;
ALTER TABLE workflow_executions
    ADD CONSTRAINT uq_execution_idempotency UNIQUE (workflow_id, environment, idempotency_key);

ALTER TABLE webhooks
    ADD COLUMN environment environment NOT NULL DEFAULT 'production',
    ADD COLUMN node_id     VARCHAR(100);