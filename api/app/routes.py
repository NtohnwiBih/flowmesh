import hashlib
import json
import secrets
from typing import Annotated, Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter,Body, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.definition import Definition

from app.deps import Pool
from app.auth import CurrentUser, require

router = APIRouter()



MAX_HOOK_BODY = 1024 * 1024  # 1 MiB


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


class WebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


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


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _start_execution(
    pool: asyncpg.Pool,
    workflow_id: UUID,
    input_value,
    idempotency_key: str | None,
    initiated_by: str,
) -> tuple[dict, bool]:
    """Create a PENDING execution of the latest version.
    Returns (row, created). created is False when the idempotency key was already used."""
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
        """INSERT INTO workflow_executions
               (workflow_id, workflow_version_id, initiated_by, idempotency_key, input)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (workflow_id, idempotency_key) DO NOTHING
           RETURNING id, status::text AS status, workflow_version_id""",
        workflow_id, version_id, initiated_by, idempotency_key,
        None if input_value is None else json.dumps(input_value),
    )
    if row is not None:
        return dict(row), True
    row = await pool.fetchrow(
        """SELECT id, status::text AS status, workflow_version_id FROM workflow_executions
           WHERE workflow_id = $1 AND idempotency_key = $2""",
        workflow_id, idempotency_key,
    )
    return dict(row), False


# ---------------------------------------------------------------- endpoints
@router.get("/healthz")
async def healthz(pool: Pool):
    await pool.fetchval("SELECT 1")
    return {"status": "ok"}


@router.post("/v1/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreate, pool: Pool, user: CurrentUser):
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                row = await conn.fetchrow(
                    "INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at",
                    body.name, body.slug,
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, "slug already in use")
            await conn.execute(
                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'admin')",
                row["id"], user,
            )
    return dict(row)


@router.get("/v1/workspaces")
async def list_workspaces(pool: Pool, user: CurrentUser):
    rows = await pool.fetch(
        """SELECT w.id, w.name, w.slug, m.role::text AS role
             FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
            WHERE m.user_id = $1 ORDER BY w.created_at""",
        user,
    )
    return [dict(r) for r in rows]


@router.post("/v1/workspaces/{workspace_id}/workflows", status_code=201,
             dependencies=[Depends(require("editor", "workspace"))])
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


@router.get("/v1/workspaces/{workspace_id}/workflows", dependencies=[Depends(require("viewer", "workspace"))])
async def list_workflows(workspace_id: UUID, pool: Pool):
    rows = await pool.fetch(
        """SELECT w.id, w.name, w.description, w.is_active, w.created_at,
                  (SELECT MAX(version) FROM workflow_versions v WHERE v.workflow_id = w.id) AS latest_version
             FROM workflows w WHERE w.workspace_id = $1 ORDER BY w.created_at""",
        workspace_id,
    )
    return [dict(r) for r in rows]


@router.post("/v1/workflows/{workflow_id}/versions", status_code=201, 
             dependencies=[Depends(require("editor", "workflow"))])
async def publish_version(workflow_id: UUID, body: VersionCreate, pool: Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await _publish(conn, workflow_id, body.definition)


@router.get("/v1/workflows/{workflow_id}/versions/{version}", dependencies=[Depends(require("viewer", "workflow"))])
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

@router.post("/v1/workflows/{workflow_id}/executions", status_code=202,
              dependencies=[Depends(require("editor", "workflow"))])
async def trigger_execution(
    workflow_id: UUID,
    response: Response,
    pool: Pool,
    user: CurrentUser,
    idempotency_key: Annotated[str | None, Header(max_length=255)] = None,
    input: Annotated[Any, Body()] = None,
):
    row, created = await _start_execution(pool, workflow_id, input, idempotency_key, f"user:{user}")
    if not created:
        response.status_code = 200
    return row


@router.get("/v1/executions/{execution_id}", dependencies=[Depends(require("viewer", "execution"))])
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


@router.get("/v1/executions/{execution_id}/events", dependencies=[Depends(require("viewer", "execution"))])
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


@router.post("/v1/workflows/{workflow_id}/webhooks", status_code=201, 
              dependencies=[Depends(require("admin", "workflow"))])
async def create_webhook(workflow_id: UUID, body: WebhookCreate, pool: Pool):
    token = secrets.token_urlsafe(32)
    try:
        row = await pool.fetchrow(
            """INSERT INTO webhooks (workflow_id, name, token_hash) VALUES ($1, $2, $3)
               RETURNING id, workflow_id, name, created_at""",
            workflow_id, body.name, _hash_token(token),
        )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(404, "workflow not found")
    out = dict(row)
    out["token"] = token            # shown ONCE: only the hash is stored
    out["url"] = f"/hooks/{token}"
    return out


@router.post("/hooks/{token}", status_code=202)
async def receive_hook(
    token: str,
    request: Request,
    response: Response,
    pool: Pool,
    idempotency_key: Annotated[str | None, Header(max_length=255)] = None,
):
    hook = await pool.fetchrow(
        "SELECT id, workflow_id FROM webhooks WHERE token_hash = $1 AND is_active",
        _hash_token(token),
    )
    if hook is None:
        raise HTTPException(404, "not found")

    # Read the body in chunks so an oversized upload is cut off early.
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_HOOK_BODY:
            raise HTTPException(413, "body too large")
        chunks.append(chunk)
    raw = b"".join(chunks)

    try:
        payload = json.loads(raw) if raw.strip() else None
    except ValueError:
        raise HTTPException(422, "body must be valid JSON")

    row, created = await _start_execution(
        pool, hook["workflow_id"], payload, idempotency_key, f"webhook:{hook['id']}"
    )
    if not created:
        response.status_code = 200
    return row