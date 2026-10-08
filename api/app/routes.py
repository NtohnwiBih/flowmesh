import json
from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.definition import Definition

router = APIRouter()


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


Pool = Annotated[asyncpg.Pool, Depends(get_pool)]


# ------------------------------------------------------------ request bodies
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    definition: Definition | None = None  # if given, published as version 1


class VersionCreate(BaseModel):
    definition: Definition


# ------------------------------------------------------------------ helpers
def _dump(defn: Definition) -> str:
    """Canonical JSON for storage. Matches what the Go engine parses."""
    return json.dumps(defn.model_dump(mode="json", by_alias=True, exclude_none=True))


def _decode_json(value):
    return json.loads(value) if isinstance(value, str) else value


async def _publish(conn: asyncpg.Connection, workflow_id: UUID, defn: Definition) -> dict:
    # Lock the workflow row so two concurrent publishes cannot pick the same number.
    locked = await conn.fetchval("SELECT id FROM workflows WHERE id = $1 FOR UPDATE", workflow_id)
    if locked is None:
        raise HTTPException(404, "workflow not found")
    row = await conn.fetchrow(
        """INSERT INTO workflow_versions (workflow_id, version, definition)
           SELECT $1::uuid, COALESCE(MAX(version), 0) + 1, $2::jsonb
             FROM workflow_versions WHERE workflow_id = $1::uuid
           RETURNING id, version, created_at""",
        workflow_id, _dump(defn),
    )
    return dict(row)


# ---------------------------------------------------------------- endpoints
@router.get("/healthz")
async def healthz(pool: Pool):
    await pool.fetchval("SELECT 1")
    return {"status": "ok"}


@router.post("/v1/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreate, pool: Pool):
    try:
        row = await pool.fetchrow(
            "INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at",
            body.name, body.slug,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "slug already in use")
    return dict(row)


@router.post("/v1/workspaces/{workspace_id}/workflows", status_code=201)
async def create_workflow(workspace_id: UUID, body: WorkflowCreate, pool: Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                wf = await conn.fetchrow(
                    """INSERT INTO workflows (workspace_id, name, description)
                       VALUES ($1, $2, $3) RETURNING id, workspace_id, name, description, is_active, created_at""",
                    workspace_id, body.name, body.description,
                )
            except asyncpg.ForeignKeyViolationError:
                raise HTTPException(404, "workspace not found")
            out = dict(wf)
            out["latest_version"] = None
            if body.definition is not None:
                out["latest_version"] = (await _publish(conn, wf["id"], body.definition))["version"]
    return out


@router.get("/v1/workspaces/{workspace_id}/workflows")
async def list_workflows(workspace_id: UUID, pool: Pool):
    rows = await pool.fetch(
        """SELECT w.id, w.name, w.description, w.is_active, w.created_at,
                  (SELECT MAX(version) FROM workflow_versions v WHERE v.workflow_id = w.id) AS latest_version
             FROM workflows w WHERE w.workspace_id = $1 ORDER BY w.created_at""",
        workspace_id,
    )
    return [dict(r) for r in rows]


@router.post("/v1/workflows/{workflow_id}/versions", status_code=201)
async def publish_version(workflow_id: UUID, body: VersionCreate, pool: Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await _publish(conn, workflow_id, body.definition)


@router.get("/v1/workflows/{workflow_id}/versions/{version}")
async def get_version(workflow_id: UUID, version: int, pool: Pool):
    row = await pool.fetchrow(
        "SELECT id, version, definition, created_at FROM workflow_versions WHERE workflow_id = $1 AND version = $2",
        workflow_id, version,
    )
    if row is None:
        raise HTTPException(404, "version not found")
    out = dict(row)
    out["definition"] = _decode_json(out["definition"])
    return out


@router.post("/v1/workflows/{workflow_id}/executions", status_code=202)
async def trigger_execution(
    workflow_id: UUID,
    response: Response,
    pool: Pool,
    idempotency_key: Annotated[str | None, Header(max_length=255)] = None,
):
    wf = await pool.fetchrow("SELECT id, is_active FROM workflows WHERE id = $1", workflow_id)
    if wf is None:
        raise HTTPException(404, "workflow not found")
    if not wf["is_active"]:
        raise HTTPException(409, "workflow is not active")

    version_id = await pool.fetchval(
        "SELECT id FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1",
        workflow_id,
    )
    if version_id is None:
        raise HTTPException(409, "workflow has no published version")

    row = await pool.fetchrow(
        """INSERT INTO workflow_executions (workflow_id, workflow_version_id, initiated_by, idempotency_key)
           VALUES ($1, $2, 'api', $3)
           ON CONFLICT (workflow_id, idempotency_key) DO NOTHING
           RETURNING id, status::text AS status, workflow_version_id""",
        workflow_id, version_id, idempotency_key,
    )
    if row is None:  # same key seen before: return the original execution
        row = await pool.fetchrow(
            """SELECT id, status::text AS status, workflow_version_id FROM workflow_executions
               WHERE workflow_id = $1 AND idempotency_key = $2""",
            workflow_id, idempotency_key,
        )
        response.status_code = 200
    return dict(row)


@router.get("/v1/executions/{execution_id}")
async def get_execution(execution_id: UUID, pool: Pool):
    row = await pool.fetchrow(
        """SELECT id, workflow_id, workflow_version_id, status::text AS status, initiated_by,
                  started_at, completed_at, created_at
             FROM workflow_executions WHERE id = $1""",
        execution_id,
    )
    if row is None:
        raise HTTPException(404, "execution not found")
    return dict(row)


@router.get("/v1/executions/{execution_id}/events")
async def get_events(execution_id: UUID, pool: Pool):
    exists = await pool.fetchval("SELECT 1 FROM workflow_executions WHERE id = $1", execution_id)
    if exists is None:
        raise HTTPException(404, "execution not found")
    rows = await pool.fetch(
        """SELECT sequence_num, event_type, node_id, attempt, payload_ref, inline_payload, created_at
             FROM execution_events WHERE execution_id = $1 ORDER BY sequence_num""",
        execution_id,
    )
    events = []
    for r in rows:
        e = dict(r)
        e["inline_payload"] = _decode_json(e["inline_payload"])
        events.append(e)
    return events