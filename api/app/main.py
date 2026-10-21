import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import router as auth_router
from app.routes import router
from app.stream import router as stream_router
from app.meta import router as meta_router
from app.drafts import router as drafts_router
from app.webhooks import router as webhooks_router


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
    app = FastAPI(
        title="FlowMesh Control Plane", 
        version="0.1.0", lifespan=lifespan
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=[
            "GET", "POST", "PUT", "PATCH",
            "DELETE", "OPTIONS",
        ],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "Last-Event-ID",
            "If-Match",
        ],
        expose_headers=["ETag"],
    )


    app.include_router(auth_router)
    app.include_router(router)
    app.include_router(stream_router)
    app.include_router(meta_router)
    app.include_router(drafts_router)
    app.include_router(webhooks_router)
    return app


app = create_app()