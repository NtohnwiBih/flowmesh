import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from app.auth import router as auth_router
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ["DATABASE_URL"]
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a random string of at least 32 characters")
    app.state.jwt_secret = secret
    app.state.pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
    yield
    await app.state.pool.close()


def create_app() -> FastAPI:
    app = FastAPI(title="FlowMesh Control Plane", version="0.1.0", lifespan=lifespan)
    app.include_router(auth_router)
    app.include_router(router)
    return app


app = create_app()