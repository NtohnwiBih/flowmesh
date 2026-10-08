from collections import deque
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RetryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = Field(ge=1)
    backoff_seconds: int = Field(default=0, ge=0)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)  # DB column is VARCHAR(100)
    type: str = Field(min_length=1)
    config: dict[str, Any] | None = None
    retry: RetryPolicy | None = None


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_: str = Field(alias="from")  # "from" is a reserved word in Python
    to: str


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    nodes: list[Node] = Field(min_length=1)
    edges: list[Edge]

    @model_validator(mode="after")
    def check_graph(self) -> "Definition":
        ids: set[str] = set()
        for n in self.nodes:
            if n.id in ids:
                raise ValueError(f"duplicate node id {n.id!r}")
            ids.add(n.id)

        indegree = {i: 0 for i in ids}
        nxt: dict[str, list[str]] = {i: [] for i in ids}
        for e in self.edges:
            for end in (e.from_, e.to):
                if end not in ids:
                    raise ValueError(f"edge references unknown node {end!r}")
            nxt[e.from_].append(e.to)
            indegree[e.to] += 1

        # Kahn's algorithm, same as the Go validator.
        queue = deque(i for i, d in indegree.items() if d == 0)
        visited = 0
        while queue:
            cur = queue.popleft()
            visited += 1
            for n in nxt[cur]:
                indegree[n] -= 1
                if indegree[n] == 0:
                    queue.append(n)
        if visited != len(ids):
            raise ValueError("workflow contains a cycle")
        return self