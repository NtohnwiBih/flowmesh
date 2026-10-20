from typing import Any

from pydantic import ValidationError

from app.catalog import BY_ID, VALIDATORS
from app.definition import DefinitionShape, Issue, graph_issues


def catalog_issues(defn: DefinitionShape) -> list[Issue]:
    """Node types must exist and be available, and configs must match their schema."""
    issues: list[Issue] = []
    for n in defn.nodes:
        nt = BY_ID.get(n.type)
        if nt is None:
            issues.append(Issue(code="unknown_node_type", node_id=n.id,
                                message=f"unknown node type {n.type!r}"))
            continue
        if not nt["available"]:
            issues.append(Issue(code="node_type_unavailable", node_id=n.id,
                                message=f"{nt['label']} is not available yet: {nt['unavailable_reason']}"))
            continue
        for err in sorted(VALIDATORS[n.type].iter_errors(n.config or {}), key=lambda e: list(e.absolute_path)):
            path = ".".join(["config", *map(str, err.absolute_path)])
            issues.append(Issue(code="invalid_config", node_id=n.id, path=path, message=err.message))
    return issues


def _from_pydantic(raw: Any, err: dict) -> Issue:
    loc = err["loc"]
    node_id = None
    if len(loc) >= 2 and loc[0] == "nodes" and isinstance(loc[1], int) and isinstance(raw, dict):
        nodes = raw.get("nodes")
        if isinstance(nodes, list) and loc[1] < len(nodes) and isinstance(nodes[loc[1]], dict):
            nid = nodes[loc[1]].get("id")
            node_id = nid if isinstance(nid, str) else None
    return Issue(code=err["type"], message=err["msg"], node_id=node_id, path=".".join(map(str, loc)) or None)


def collect_issues(raw: Any) -> list[Issue]:
    """Everything wrong with a definition, for the Validate button."""
    try:
        shape = DefinitionShape.model_validate(raw)
    except ValidationError as exc:
        return [_from_pydantic(raw, e) for e in exc.errors()]
    return graph_issues(shape) + catalog_issues(shape)