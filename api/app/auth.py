import asyncio
import time
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.deps import Pool

router = APIRouter()

TOKEN_TTL_SECONDS = 15 * 60  # 15 minutes
ROLE_RANK =  {"viewer": 1, "editor": 2, "admin": 3}

_phasher = PasswordHasher()
_DUMMY_HASH = _phasher.hash("not-a-real-password")  # for timing attack mitigation

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"  # regex for basic email validation

# ------------------------------------------------------------- passwords
async def _hash(password: str) -> str:
    return await asyncio.to_thread(_phasher.hash, password)


async def _verify(password_hash: str, password: str) -> bool:
    def run() -> bool:
        try:
            return _phasher.verify(password_hash, password)
        except (InvalidHashError, VerifyMismatchError):
            return False

    return await asyncio.to_thread(run)


# ------------------------------------------------------------- tokens
def make_token(secret: str, user_id: UUID) -> str:
    now = int(time.time())
    claims = {"sub": str(user_id), "iat": now, "exp": now + TOKEN_TTL_SECONDS}
    return jwt.encode(claims, secret, algorithm="HS256")


_bearer = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(401, "not authenticated", headers={"WWW-Authenticate": "Bearer"})


async def current_user(
    request: Request,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> UUID:
    if creds is None:
        raise _unauthorized()
    try:
        claims = jwt.decode(
            creds.credentials,
            request.app.state.jwt_secret,
            algorithms=["HS256"],            # pinned: rejects alg=none and algorithm confusion
            options={"require": ["exp", "sub"]},
        )
        return UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError):
        raise _unauthorized()


CurrentUser = Annotated[UUID, Depends(current_user)]


# ---------------------------------------------------------- authorization
_ROLE_SQL = {
    "workspace": """SELECT m.role::text FROM workspace_members m
                     WHERE m.workspace_id = $1 AND m.user_id = $2""",
    "workflow": """SELECT m.role::text FROM workflows w
                     JOIN workspace_members m ON m.workspace_id = w.workspace_id AND m.user_id = $2
                    WHERE w.id = $1""",
    "execution": """SELECT m.role::text FROM workflow_executions e
                     JOIN workflows w ON w.id = e.workflow_id
                     JOIN workspace_members m ON m.workspace_id = w.workspace_id AND m.user_id = $2
                    WHERE e.id = $1""",
    "webhook": """SELECT m.role::text FROM webhooks h
                    JOIN workflows w ON w.id = h.workflow_id
                    JOIN workspace_members m ON m.workspace_id = w.workspace_id AND m.user_id = $2
                   WHERE h.id = $1""",
}


def require(min_role: Literal["viewer", "editor", "admin"],
            scope: Literal["workspace", "workflow", "execution"]):
    """Build a dependency: the caller must hold at least min_role in the workspace
    that owns the {workspace_id|workflow_id|execution_id} in the URL."""
    key = f"{scope}_id"

    async def check(request: Request, pool: Pool, user: CurrentUser) -> None:
        try:
            target = UUID(request.path_params[key])
        except (KeyError, ValueError):
            raise HTTPException(404, "not found")
        role = await pool.fetchval(_ROLE_SQL[scope], target, user)
        if role is None:                       # missing OR not a member: same answer
            raise HTTPException(404, "not found")
        if ROLE_RANK[role] < ROLE_RANK[min_role]:
            raise HTTPException(403, f"requires role {min_role}")

    return check


# -------------------------------------------------------------- endpoints
class Register(BaseModel):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=320)
    password: str = Field(min_length=10, max_length=128)


class Login(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=128)


class MemberSet(BaseModel):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=320)
    role: Literal["viewer", "editor", "admin"]


@router.post("/v1/auth/register", status_code=201)
async def register(body: Register, pool: Pool):
    email = body.email.strip().lower()
    password_hash = await _hash(body.password)
    try:
        row = await pool.fetchrow(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
            email, password_hash,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "email already registered")
    return dict(row)


@router.post("/v1/auth/login")
async def login(body: Login, request: Request, pool: Pool):
    row = await pool.fetchrow(
        "SELECT id, password_hash FROM users WHERE email = $1", body.email.strip().lower()
    )
    ok = await _verify(row["password_hash"] if row else _DUMMY_HASH, body.password)
    if row is None or not ok:
        raise HTTPException(401, "invalid email or password")
    return {
        "access_token": make_token(request.app.state.jwt_secret, row["id"]),
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
    }


async def _guard_last_admin(conn: asyncpg.Connection, workspace_id: UUID,
                            user_id: UUID, new_role: str | None) -> None:
    """Refuse changes that would leave a workspace with no admin.
    FOR UPDATE locks the admin rows, so two simultaneous demotions queue up:
    the second one sees the first one's result."""
    rows = await conn.fetch(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' FOR UPDATE",
        workspace_id,
    )
    admins = {r["user_id"] for r in rows}
    if user_id in admins and new_role != "admin" and len(admins) == 1:
        raise HTTPException(409, "cannot remove or demote the last admin")


@router.post("/v1/workspaces/{workspace_id}/members", status_code=200,
             dependencies=[Depends(require("admin", "workspace"))])
async def set_member(workspace_id: UUID, body: MemberSet, pool: Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE email = $1", body.email.strip().lower())
            if user_id is None:
                raise HTTPException(404, "no user with that email")
            await _guard_last_admin(conn, workspace_id, user_id, body.role)
            await conn.execute(
                """INSERT INTO workspace_members (workspace_id, user_id, role)
                   VALUES ($1, $2, $3::workspace_role)
                   ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role""",
                workspace_id, user_id, body.role,
            )
    return {"user_id": user_id, "role": body.role}


@router.get("/v1/workspaces/{workspace_id}/members",
            dependencies=[Depends(require("viewer", "workspace"))])
async def list_members(workspace_id: UUID, pool: Pool):
    rows = await pool.fetch(
        """SELECT u.id AS user_id, u.email, m.role::text AS role, m.created_at
             FROM workspace_members m JOIN users u ON u.id = m.user_id
            WHERE m.workspace_id = $1 ORDER BY m.created_at""",
        workspace_id,
    )
    return [dict(r) for r in rows]


@router.delete("/v1/workspaces/{workspace_id}/members/{user_id}", status_code=204,
               dependencies=[Depends(require("admin", "workspace"))])
async def remove_member(workspace_id: UUID, user_id: UUID, pool: Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _guard_last_admin(conn, workspace_id, user_id, None)
            gone = await conn.fetchval(
                "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING 1",
                workspace_id, user_id,
            )
    if gone is None:
        raise HTTPException(404, "not a member")