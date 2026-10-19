CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(320) NOT NULL UNIQUE,   -- stored lower-case
    password_hash TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TYPE workspace_role AS ENUM ('viewer', 'editor', 'admin');

CREATE TABLE workspace_members (
    workspace_id UUID           NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         workspace_role NOT NULL,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_members_user ON workspace_members(user_id);