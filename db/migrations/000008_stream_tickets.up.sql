CREATE TABLE stream_tickets (
    token_hash   VARCHAR(64) PRIMARY KEY,
    execution_id UUID        NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_stream_tickets_expiry ON stream_tickets(expires_at);