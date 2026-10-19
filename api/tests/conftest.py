import asyncio
import pathlib
import uuid

import asyncpg
import httpx
import pytest
import pytest_asyncio
from testcontainers.community.postgres import PostgresContainer

from app.main import create_app

MIGRATIONS = sorted(pathlib.Path(__file__).resolve().parents[2].glob("db/migrations/*.up.sql"))

TEST_SECRET = "test-secret-" + "x" * 40


async def _migrate(dsn: str) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        for f in MIGRATIONS:
            await conn.execute(f.read_text())  # no params: multiple statements allowed
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def dsn():
    assert MIGRATIONS, "no migration files found"
    with PostgresContainer("postgres:16-alpine") as pg:
        url = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        asyncio.run(_migrate(url))
        yield url


@pytest_asyncio.fixture
async def app(dsn):
    app = create_app()
    app.state.pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
    app.state.jwt_secret = TEST_SECRET      # lifespan is not run by ASGITransport
    yield app
    await app.state.pool.close()


def _http(app, headers=None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    )


async def register_and_login(c: httpx.AsyncClient) -> tuple[dict, str]:
    email = f"u{uuid.uuid4().hex[:10]}@example.com"
    pw = "correct-horse-battery"
    r = await c.post("/v1/auth/register", json={"email": email, "password": pw})
    assert r.status_code == 201, r.text
    r = await c.post("/v1/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, email


@pytest_asyncio.fixture
async def anon_client(app):
    async with _http(app) as c:
        yield c


@pytest_asyncio.fixture
async def client(app):
    """A client logged in as a fresh user."""
    async with _http(app) as anon:
        headers, _ = await register_and_login(anon)
    async with _http(app, headers) as c:
        yield c


@pytest_asyncio.fixture
async def new_user(app):
    """Factory: returns (client, email) for another freshly registered user."""
    made = []

    async def make():
        async with _http(app) as anon:
            headers, email = await register_and_login(anon)
        c = _http(app, headers)
        made.append(c)
        return c, email

    yield make
    for c in made:
        await c.aclose()


@pytest_asyncio.fixture
async def workspace(client) -> str:
    r = await client.post(
        "/v1/workspaces", json={"name": "acme", "slug": f"acme-{uuid.uuid4().hex[:10]}"}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]