from typing import Annotated

import asyncpg
from fastapi import Depends, Request


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


Pool = Annotated[asyncpg.Pool, Depends(get_pool)]