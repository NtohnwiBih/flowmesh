import asyncio
import hashlib
import json
import secrets
from typing import Annotated, AsyncIterator
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.auth import CurrentUser, require
from app.deps import Pool

router = APIRouter()

TICKET_TTL_SECONDS = 30
POLL_SECONDS = 0.5
KEEPALIVE_SECONDS = 15
TERMINAL = {"EXECUTION_COMPLETED", "EXECUTION_FAILED"}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/v1/executions/{execution_id}/stream-ticket", status_code=201,
             dependencies=[Depends(require("viewer", "execution"))])
async def create_ticket(execution_id: UUID, pool: Pool, user: CurrentUser):
    token = secrets.token_urlsafe(32)
    await pool.execute("DELETE FROM stream_tickets WHERE expires_at < NOW()")  # lazy cleanup
    await pool.execute(
        """INSERT INTO stream_tickets (token_hash, execution_id, user_id, expires_at)
           VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))""",
        _hash(token), execution_id, user, float(TICKET_TTL_SECONDS),
    )
    return {"ticket": token, "expires_in": TICKET_TTL_SECONDS}


async def _authorize(request: Request, pool, execution_id: UUID, ticket: str | None) -> None:
    """Accept either a valid ticket for THIS execution, or a normal Bearer token
    whose user is a member of the owning workspace. Anything else is 401/404."""
    if ticket:
        # DELETE ... RETURNING makes the ticket single-use, atomically.
        row = await pool.fetchrow(
            """DELETE FROM stream_tickets
                WHERE token_hash = $1 AND execution_id = $2 AND expires_at > NOW()
            RETURNING user_id""",
            _hash(ticket), execution_id,
        )
        if row is None:
            raise HTTPException(401, "invalid or expired ticket")
        return
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(auth[7:], request.app.state.jwt_secret, algorithms=["HS256"],
                            options={"require": ["exp", "sub"]})
        user = UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "not authenticated", headers={"WWW-Authenticate": "Bearer"})
    role = await pool.fetchval(
        """SELECT m.role::text FROM workflow_executions e
             JOIN workflows w ON w.id = e.workflow_id
             JOIN workspace_members m ON m.workspace_id = w.workspace_id AND m.user_id = $2
            WHERE e.id = $1""",
        execution_id, user,
    )
    if role is None:
        raise HTTPException(404, "not found")


def _frame(row) -> str:
    payload = row["inline_payload"]
    data = {
        "sequence_num": row["sequence_num"],
        "event_type": row["event_type"],
        "node_id": row["node_id"],
        "attempt": row["attempt"],
        "payload_ref": row["payload_ref"],
        "inline_payload": json.loads(payload) if isinstance(payload, str) else payload,
        "created_at": row["created_at"].isoformat(),
    }
    return f"id: {row['sequence_num']}\nevent: {row['event_type']}\ndata: {json.dumps(data)}\n\n"


async def _events(request: Request, pool, execution_id: UUID, after: int) -> AsyncIterator[str]:
    idle = 0.0
    while not await request.is_disconnected():
        rows = await pool.fetch(
            """SELECT sequence_num, event_type, node_id, attempt, payload_ref, inline_payload, created_at
                 FROM execution_events
                WHERE execution_id = $1 AND sequence_num > $2
                ORDER BY sequence_num LIMIT 200""",
            execution_id, after,
        )
        for r in rows:
            yield _frame(r)
            after = r["sequence_num"]
            idle = 0.0
            if r["event_type"] in TERMINAL:
                return
        if not rows:
            await asyncio.sleep(POLL_SECONDS)
            idle += POLL_SECONDS
            if idle >= KEEPALIVE_SECONDS:
                yield ": keepalive\n\n"
                idle = 0.0


@router.get("/v1/executions/{execution_id}/stream")
async def stream(
    execution_id: UUID,
    request: Request,
    pool: Pool,
    ticket: Annotated[str | None, Query(max_length=128)] = None,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
):
    await _authorize(request, pool, execution_id, ticket)
    exists = await pool.fetchval("SELECT 1 FROM workflow_executions WHERE id = $1", execution_id)
    if exists is None:
        raise HTTPException(404, "not found")
    try:
        after = max(int(last_event_id), 0) if last_event_id else 0
    except ValueError:
        after = 0
    return StreamingResponse(
        _events(request, pool, execution_id, after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )