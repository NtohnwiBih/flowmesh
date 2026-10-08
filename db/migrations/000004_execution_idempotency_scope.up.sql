ALTER TABLE workflow_executions
    DROP CONSTRAINT IF EXISTS workflow_executions_idempotency_key_key;

ALTER TABLE workflow_executions
    ADD CONSTRAINT uq_execution_idempotency UNIQUE (workflow_id, idempotency_key);