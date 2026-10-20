import base64
import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import CurrentUser, require
from app.catalog import NODE_TYPES
from app.deps import Pool
from app.validation import collect_issues

router = APIRouter()

STATUSES = {"PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"}


@router.get("/v1/me")
async def me(pool: Pool, user: CurrentUser):
    row = await pool.fetchrow("SELECT id, email, created_at FROM users WHERE id = $1", user)
    if row is None:
        raise HTTPException(401, "not authenticated")
    return dict(row)


@router.get("/v1/node-types")
async def node_types(_: CurrentUser):
    return NODE_TYPES


class ValidateBody(BaseModel):
    definition: Any  # raw on purpose: drafts may be malformed


@router.post("/v1/workflows/{workflow_id}/validate",
             dependencies=[Depends(require("editor", "workflow"))])
async def validate(workflow_id: UUID, body: ValidateBody):
    issues = collect_issues(body.definition)
    return {"valid": not issues, "issues": [i.model_dump(exclude_none=True) for i in issues]}


# ---- executions list, newest first, keyset pagination ----------------------
def _encode(ts: datetime, id_: UUID) -> str:
    return base64.urlsafe_b64encode(json.dumps({"t": ts.isoformat(), "i": str(id_)}).encode()).decode()


def _decode(cursor: str) -> tuple[datetime, UUID]:
    try:
        d = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return datetime.fromisoformat(d["t"]), UUID(d["i"])
    except Exception:
        raise HTTPException(400, "invalid cursor")


@router.get("/v1/workspaces/{workspace_id}/executions",
            dependencies=[Depends(require("viewer", "workspace"))])
async def list_executions(
    workspace_id: UUID,
    pool: Pool,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: Annotated[str | None, Query(max_length=300)] = None,
    status: Annotated[list[str] | None, Query()] = None,
    environment: Annotated[Literal["staging", "production"] | None, Query()] = None,
    workflow_id: Annotated[UUID | None, Query()] = None,
):
    if status and not set(status) <= STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(STATUSES)}")

    args: list[Any] = [workspace_id]
    where = ["w.workspace_id = $1"]

    def add(sql_fmt: str, value: Any) -> None:
        args.append(value)
        where.append(sql_fmt % len(args))

    if status:
        add("e.status::text = ANY($%d::text[])", status)
    if environment:
        add("e.environment::text = $%d", environment)
    if workflow_id:
        add("e.workflow_id = $%d", workflow_id)
    if cursor:
        ts, cid = _decode(cursor)
        args += [ts, cid]
        where.append(f"(e.created_at, e.id) < (${len(args) - 1}::timestamptz, ${len(args)}::uuid)")
    args.append(limit + 1)  # one extra row tells us whether another page exists

    rows = await pool.fetch(
        f"""SELECT e.id, e.workflow_id, w.name AS workflow_name, e.workflow_version_id, v.version,
                   e.environment::text AS environment, e.status::text AS status, e.initiated_by,
                   e.started_at, e.completed_at, e.created_at
              FROM workflow_executions e
              JOIN workflows w ON w.id = e.workflow_id
              JOIN workflow_versions v ON v.id = e.workflow_version_id
             WHERE {' AND '.join(where)}
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT ${len(args)}""",
        *args,
    )
    items = [dict(r) for r in rows[:limit]]
    next_cursor = _encode(items[-1]["created_at"], items[-1]["id"]) if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}