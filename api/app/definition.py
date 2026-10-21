import hashlib
import json
from collections import deque
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator, ValidationError


class Issue(BaseModel):
    """One problem found in a definition. The UI uses node_id to highlight a node."""
    code: str
    message: str
    node_id: str | None = None
    edge: dict[str, str] | None = None
    path: str | None = None


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = 0.0
    y: float = 0.0


class EdgeUI(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_handle: str | None = None
    target_handle: str | None = None


class RetryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = Field(ge=1)
    backoff_seconds: int = Field(default=0, ge=0)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)  # DB column is VARCHAR(100)
    type: str = Field(min_length=1)
    name: str | None = Field(default=None, max_length=255)
    config: dict[str, Any] | None = None
    retry: RetryPolicy | None = None
    ui: Position | None = None


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_: str = Field(alias="from")  # "from" is a reserved word in Python
    to: str
    label: str | None = Field(default=None, max_length=100)
    ui: EdgeUI | None = None


class DefinitionShape(BaseModel):
    """Field-level rules only. Graph rules live in graph_issues()."""
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    nodes: list[Node] = Field(min_length=1)
    edges: list[Edge]


def graph_issues(defn: DefinitionShape) -> list[Issue]:
    """Every graph problem, not just the first."""
    issues: list[Issue] = []
    ids: set[str] = set()
    for n in defn.nodes:
        if n.id in ids:
            issues.append(Issue(code="duplicate_node_id", message=f"duplicate node id {n.id!r}", node_id=n.id))
        ids.add(n.id)

    indegree = {i: 0 for i in ids}
    nxt: dict[str, list[str]] = {i: [] for i in ids}
    for e in defn.edges:
        missing = [end for end in (e.from_, e.to) if end not in ids]
        for end in missing:
            issues.append(Issue(code="unknown_edge_node", message=f"edge references unknown node {end!r}",
                                edge={"from": e.from_, "to": e.to}))
        if missing:
            continue
        nxt[e.from_].append(e.to)
        indegree[e.to] += 1

    # Kahn's algorithm, same as the Go validator.
    queue = deque(i for i, d in indegree.items() if d == 0)
    done: set[str] = set()
    while queue:
        cur = queue.popleft()
        done.add(cur)
        for n in nxt[cur]:
            indegree[n] -= 1
            if indegree[n] == 0:
                queue.append(n)
    for node_id in sorted(ids - done):
        issues.append(Issue(code="cycle", message="node is part of a cycle or depends on one", node_id=node_id))
    return issues


class Definition(DefinitionShape):
    """The strict model: shape plus graph. Used wherever a definition is stored."""

    @model_validator(mode="after")
    def check_graph(self) -> "Definition":
        issues = graph_issues(self)
        if issues:
            raise ValueError(issues[0].message)
        return self

def normalize(raw: Any) -> Any:
    """The canonical form publishing would store, when the definition is valid."""
    try:
        return Definition.model_validate(raw).model_dump(mode="json", by_alias=True, exclude_none=True)
    except ValidationError:
        return raw


def definition_hash(raw: Any) -> str:
    """Stable fingerprint: key order, defaults and 50 vs 50.0 do not matter."""
    text = json.dumps(normalize(raw), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()