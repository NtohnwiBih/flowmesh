import secrets
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require
from app.deps import Pool
from app.routes import _decode_json, _hash_token

router = APIRouter()


def _node_ids(raw: Any) -> set[str]:
    nodes = raw.get("nodes") if isinstance(raw, dict) else None
    if not isinstance(nodes, list):
        return set()
    return {n["id"] for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)}


@router.get("/v1/workflows/{workflow_id}/webhooks",
            dependencies=[Depends(require("viewer", "workflow"))])
async def list_webhooks(workflow_id: UUID, pool: Pool):
    """Names and state only. Tokens are shown once at creation and never again."""
    rows = await pool.fetch(
        """SELECT id, name, environment::text AS environment, node_id, is_active, created_at
             FROM webhooks WHERE workflow_id = $1 ORDER BY created_at""",
        workflow_id,
    )
    draft = await pool.fetchval("SELECT definition FROM workflow_drafts WHERE workflow_id = $1", workflow_id)
    live = await pool.fetchval(
        """SELECT v.definition FROM workflows w JOIN workflow_versions v ON v.id = w.production_version_id
            WHERE w.id = $1""", workflow_id)
    ids = {"staging": _node_ids(_decode_json(draft)), "production": _node_ids(_decode_json(live))}

    out = []
    for r in rows:
        item = dict(r)
        # A hook pointing at a node that no longer exists is shown as orphaned.
        item["orphaned"] = r["node_id"] is not None and r["node_id"] not in ids[r["environment"]]
        out.append(item)
    return out


class WebhookPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


@router.patch("/v1/webhooks/{webhook_id}", dependencies=[Depends(require("admin", "webhook"))])
async def patch_webhook(webhook_id: UUID, body: WebhookPatch, pool: Pool):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(422, "nothing to update")
    sets = ", ".join(f"{col} = ${i}" for i, col in enumerate(fields, start=2))
    row = await pool.fetchrow(
        f"""UPDATE webhooks SET {sets} WHERE id = $1
            RETURNING id, name, environment::text AS environment, node_id, is_active""",
        webhook_id, *fields.values(),
    )
    return dict(row)


@router.post("/v1/webhooks/{webhook_id}/rotate", dependencies=[Depends(require("admin", "webhook"))])
async def rotate_webhook(webhook_id: UUID, pool: Pool):
    """New token, old one dies immediately. The new token is shown once."""
    token = secrets.token_urlsafe(32)
    await pool.execute("UPDATE webhooks SET token_hash = $2 WHERE id = $1", webhook_id, _hash_token(token))
    return {"id": webhook_id, "token": token, "url": f"/hooks/{token}"}


@router.delete("/v1/webhooks/{webhook_id}", status_code=204,
               dependencies=[Depends(require("admin", "webhook"))])
async def delete_webhook(webhook_id: UUID, pool: Pool):
    await pool.execute("DELETE FROM webhooks WHERE id = $1", webhook_id)