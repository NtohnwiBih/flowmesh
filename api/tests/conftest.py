import asyncio
import pathlib
import uuid

import asyncpg
import httpx
import pytest
import pytest_asyncio
from testcontainers.postgres import PostgresContainer

from app.main import create_app

MIGRATIONS = sorted(pathlib.Path(__file__).resolve().parents[2].glob("db/migrations/*.up.sql"))


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
async def client(dsn):
    app = create_app()
    app.state.pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
    transport = httpx.ASGITransport(app=app)  # talks to the app directly, no network
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await app.state.pool.close()


@pytest_asyncio.fixture
async def workspace(client) -> str:
    r = await client.post(
        "/v1/workspaces", json={"name": "acme", "slug": f"acme-{uuid.uuid4().hex[:10]}"}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]