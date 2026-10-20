ALTER TABLE webhooks DROP COLUMN IF EXISTS node_id, DROP COLUMN IF EXISTS environment;

ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS uq_execution_idempotency;
DELETE FROM workflow_executions WHERE environment = 'staging';
ALTER TABLE workflow_executions DROP COLUMN IF EXISTS environment;
ALTER TABLE workflow_executions
    ADD CONSTRAINT uq_execution_idempotency UNIQUE (workflow_id, idempotency_key);

DROP TABLE IF EXISTS workflow_drafts;
ALTER TABLE workflows DROP COLUMN IF EXISTS production_version_id;

DROP INDEX IF EXISTS uq_staging_snapshot;
ALTER TABLE workflow_versions DROP CONSTRAINT IF EXISTS ck_version_numbering;
DELETE FROM workflow_versions WHERE environment = 'staging';
ALTER TABLE workflow_versions
    ALTER COLUMN version SET NOT NULL,
    DROP COLUMN IF EXISTS definition_hash,
    DROP COLUMN IF EXISTS environment;

DROP TYPE IF EXISTS environment;