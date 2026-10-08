import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ["DATABASE_URL"]
    app.state.pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
    yield
    await app.state.pool.close()


def create_app() -> FastAPI:
    app = FastAPI(title="FlowMesh Control Plane", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()