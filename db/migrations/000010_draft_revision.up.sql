-- Optimistic concurrency for drafts: every save bumps the revision.
ALTER TABLE workflow_drafts ADD COLUMN revision INT NOT NULL DEFAULT 1;