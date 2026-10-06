CREATE TABLE workflows (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);

CREATE TABLE workflow_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version     INT         NOT NULL,
    definition  JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workflow_version UNIQUE (workflow_id, version)
);

CREATE TYPE execution_status AS ENUM
    ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE workflow_executions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id         UUID             NOT NULL REFERENCES workflows(id),
    workflow_version_id UUID             NOT NULL REFERENCES workflow_versions(id),
    status              execution_status NOT NULL DEFAULT 'PENDING',
    idempotency_key     VARCHAR(255) UNIQUE,
    initiated_by        VARCHAR(255)     NOT NULL,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_events (
    id             BIGSERIAL PRIMARY KEY,
    execution_id   UUID         NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    sequence_num   INT          NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    node_id        VARCHAR(100),
    attempt        INT,
    payload_ref    VARCHAR(512),
    inline_payload JSONB,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_execution_sequence UNIQUE (execution_id, sequence_num)
);

CREATE TABLE node_executions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id  UUID             NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    node_id       VARCHAR(100)     NOT NULL,
    attempt       INT              NOT NULL DEFAULT 1,
    status        execution_status NOT NULL DEFAULT 'PENDING',
    input_ref     VARCHAR(512),
    output_ref    VARCHAR(512),
    error_message TEXT,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    CONSTRAINT uq_node_attempt UNIQUE (execution_id, node_id, attempt)
);