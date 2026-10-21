import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser, require
from app.definition import Definition, definition_hash
from app.deps import Pool
from app.routes import _decode_json, _publish, _raise_issues
from app.validation import collect_issues

router = APIRouter()

MAX_DRAFT_BYTES = 1024 * 1024  # 1 MiB


def _etag(revision: int) -> str:
    return f'"{revision}"'


def _parse_if_match(value: str | None) -> int:
    if value is None:
        raise HTTPException(428, "If-Match header is required: send the ETag you loaded")
    try:
        return int(value.strip().removeprefix("W/").strip('"'))
    except ValueError:
        raise HTTPException(412, "invalid ETag")


def _check_shape(defn: Any) -> None:
    """The only rules for SAVING: enough structure for the editor to load it again."""
    if (not isinstance(defn, dict) or defn.get("schema_version") != 1
            or not isinstance(defn.get("nodes"), list) or not isinstance(defn.get("edges"), list)):
        raise HTTPException(422, "draft must be an object with schema_version 1, nodes[] and edges[]")
    if len(json.dumps(defn)) > MAX_DRAFT_BYTES:
        raise HTTPException(413, "draft too large")


async def _staging_verified(pool, workflow_id: UUID, h: str) -> bool:
    """Has this exact draft completed a staging run?"""
    return bool(await pool.fetchval(
        """SELECT EXISTS (
             SELECT 1 FROM workflow_executions e
               JOIN workflow_versions v ON v.id = e.workflow_version_id
              WHERE e.workflow_id = $1 AND e.environment = 'staging'
                AND e.status = 'COMPLETED' AND v.definition_hash = $2)""",
        workflow_id, h,
    ))


# ------------------------------------------------------------------ draft
@router.get("/v1/workflows/{workflow_id}/draft",
            dependencies=[Depends(require("viewer", "workflow"))])
async def get_draft(workflow_id: UUID, pool: Pool, response: Response):
    row = await pool.fetchrow(
        """SELECT d.definition, d.base_version, d.revision, d.updated_at, d.updated_by,
                  w.production_version_id
             FROM workflow_drafts d JOIN workflows w ON w.id = d.workflow_id
            WHERE d.workflow_id = $1""",
        workflow_id,
    )
    if row is None:
        raise HTTPException(404, "draft not found")
    raw = _decode_json(row["definition"])
    h = definition_hash(raw)

    prod = None
    if row["production_version_id"] is not None:
        prod = await pool.fetchrow(
            "SELECT version, definition FROM workflow_versions WHERE id = $1", row["production_version_id"])
    changed = prod is None or definition_hash(_decode_json(prod["definition"])) != h

    response.headers["ETag"] = _etag(row["revision"])
    return {
        "definition": raw,
        "base_version": row["base_version"],
        "production_version": prod["version"] if prod else None,
        "has_unpublished_changes": changed,
        "staging_verified": await _staging_verified(pool, workflow_id, h),
        "revision": row["revision"],
        "etag": _etag(row["revision"]),
        "updated_at": row["updated_at"],
        "updated_by": row["updated_by"],
    }


class DraftPut(BaseModel):
    definition: Any  # raw on purpose: half-built graphs must be saveable


@router.put("/v1/workflows/{workflow_id}/draft",
            dependencies=[Depends(require("editor", "workflow"))])
async def put_draft(
    workflow_id: UUID, body: DraftPut, pool: Pool, user: CurrentUser, response: Response,
    if_match: Annotated[str | None, Header()] = None,
):
    expected = _parse_if_match(if_match)
    _check_shape(body.definition)
    row = await pool.fetchrow(
        """UPDATE workflow_drafts
              SET definition = $2::jsonb, revision = revision + 1, updated_by = $3, updated_at = NOW()
            WHERE workflow_id = $1 AND revision = $4
        RETURNING revision, updated_at""",
        workflow_id, json.dumps(body.definition), user, expected,
    )
    if row is None:
        exists = await pool.fetchval("SELECT 1 FROM workflow_drafts WHERE workflow_id = $1", workflow_id)
        if exists is None:
            raise HTTPException(404, "draft not found")
        raise HTTPException(412, "the draft was changed by someone else: reload it")
    response.headers["ETag"] = _etag(row["revision"])
    issues = collect_issues(body.definition)   # warnings, not errors: saving never blocks
    return {"etag": _etag(row["revision"]), "revision": row["revision"], "updated_at": row["updated_at"],
            "issues": [i.model_dump(exclude_none=True) for i in issues]}


# ---------------------------------------------------------------- publish
@router.post("/v1/workflows/{workflow_id}/publish", status_code=201,
             dependencies=[Depends(require("editor", "workflow"))])
async def publish_draft(workflow_id: UUID, pool: Pool,
                        if_match: Annotated[str | None, Header()] = None):
    expected = _parse_if_match(if_match)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.fetchval("SELECT id FROM workflows WHERE id = $1 FOR UPDATE", workflow_id)
            row = await conn.fetchrow(
                "SELECT definition, revision FROM workflow_drafts WHERE workflow_id = $1 FOR UPDATE",
                workflow_id)
            if row is None:
                raise HTTPException(404, "draft not found")
            if row["revision"] != expected:
                raise HTTPException(412, "the draft changed since you loaded it: reload and review")
            raw = _decode_json(row["definition"])
            issues = collect_issues(raw)
            if issues:
                _raise_issues(issues)
            version = await _publish(conn, workflow_id, Definition.model_validate(raw), overwrite_draft=False)

    verified = await _staging_verified(pool, workflow_id, definition_hash(raw))
    warnings = [] if verified else [{
        "code": "not_verified_in_staging",
        "message": "This exact draft has no successful staging run."}]
    return {**version, "staging_verified": verified, "warnings": warnings}


# --------------------------------------------------------------- versions
@router.get("/v1/workflows/{workflow_id}/versions",
            dependencies=[Depends(require("viewer", "workflow"))])
async def list_versions(workflow_id: UUID, pool: Pool):
    rows = await pool.fetch(
        """SELECT v.id, v.version, v.created_at, (v.id = w.production_version_id) AS is_production
             FROM workflow_versions v JOIN workflows w ON w.id = v.workflow_id
            WHERE v.workflow_id = $1 AND v.environment = 'production'
            ORDER BY v.version DESC""",
        workflow_id,
    )
    return [dict(r) for r in rows]


class RollbackBody(BaseModel):
    version: int = Field(ge=1)


@router.post("/v1/workflows/{workflow_id}/rollback",
             dependencies=[Depends(require("editor", "workflow"))])
async def rollback(workflow_id: UUID, body: RollbackBody, pool: Pool):
    """Point production at an older version. Nothing is deleted or rewritten."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.fetchval("SELECT id FROM workflows WHERE id = $1 FOR UPDATE", workflow_id)
            vid = await conn.fetchval(
                """SELECT id FROM workflow_versions
                    WHERE workflow_id = $1 AND environment = 'production' AND version = $2""",
                workflow_id, body.version)
            if vid is None:
                raise HTTPException(404, "version not found")
            await conn.execute(
                "UPDATE workflows SET production_version_id = $2, updated_at = NOW() WHERE id = $1",
                workflow_id, vid)
    return {"production_version": body.version}


# --------------------------------------------------------------- workflow
@router.get("/v1/workflows/{workflow_id}",
            dependencies=[Depends(require("viewer", "workflow"))])
async def get_workflow(workflow_id: UUID, pool: Pool):
    row = await pool.fetchrow(
        """SELECT w.id, w.workspace_id, w.name, w.description, w.is_active, w.created_at, w.updated_at,
                  pv.version AS production_version
             FROM workflows w LEFT JOIN workflow_versions pv ON pv.id = w.production_version_id
            WHERE w.id = $1""",
        workflow_id,
    )
    return dict(row)


class WorkflowPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    is_active: bool | None = None   # false = archived


@router.patch("/v1/workflows/{workflow_id}",
              dependencies=[Depends(require("editor", "workflow"))])
async def patch_workflow(workflow_id: UUID, body: WorkflowPatch, pool: Pool):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()
              if not (k in ("name", "is_active") and v is None)}
    if not fields:
        raise HTTPException(422, "nothing to update")
    # Column names come from this fixed list, never from the request.
    sets = ", ".join(f"{col} = ${i}" for i, col in enumerate(fields, start=2))
    row = await pool.fetchrow(
        f"""UPDATE workflows SET {sets}, updated_at = NOW() WHERE id = $1
            RETURNING id, name, description, is_active, updated_at""",
        workflow_id, *fields.values(),
    )
    return dict(row)