import json
import pathlib

import pytest

from app.definition import Definition

CHAIN = {
    "schema_version": 1,
    "nodes": [
        {"id": "a", "type": "http", "config": {"method": "GET", "url": "http://localhost:8000/"}},
        {"id": "b", "type": "http", "retry": {"max_attempts": 3, "backoff_seconds": 1}},
    ],
    "edges": [{"from": "a", "to": "b"}],
}


async def make_workflow(client, workspace, definition=CHAIN) -> str:
    r = await client.post(
        f"/v1/workspaces/{workspace}/workflows", json={"name": "wf", "definition": definition}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


async def test_duplicate_slug_is_conflict(client, workspace):
    slug = (await client.get("/healthz")) and "dup-slug-test"
    body = {"name": "x", "slug": slug}
    assert (await client.post("/v1/workspaces", json=body)).status_code in (201, 409)
    assert (await client.post("/v1/workspaces", json=body)).status_code == 409


@pytest.mark.parametrize(
    "bad, why",
    [
        ({**CHAIN, "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}, "cycle"),
        ({**CHAIN, "edges": [{"from": "a", "to": "zzz"}]}, "unknown node"),
        ({**CHAIN, "nodes": CHAIN["nodes"] + [{"id": "a", "type": "x"}]}, "duplicate"),
        ({**CHAIN, "nodse": []}, "extra key"),
        ({**CHAIN, "schema_version": 2}, "bad version"),
        ({**CHAIN, "nodes": []}, "no nodes"),
    ],
)
async def test_invalid_definitions_are_rejected(client, workspace, bad, why):
    r = await client.post(f"/v1/workspaces/{workspace}/workflows", json={"name": "wf", "definition": bad})
    assert r.status_code == 422, f"{why}: {r.text}"


async def test_versions_increment(client, workspace):
    wf = await make_workflow(client, workspace)
    r = await client.post(f"/v1/workflows/{wf}/versions", json={"definition": CHAIN})
    assert r.status_code == 201 and r.json()["version"] == 2
    got = await client.get(f"/v1/workflows/{wf}/versions/2")
    assert got.json()["definition"]["nodes"][0]["id"] == "a"


async def test_stored_definition_uses_wire_names(client, workspace):
    wf = await make_workflow(client, workspace)
    stored = (await client.get(f"/v1/workflows/{wf}/versions/1")).json()["definition"]
    assert stored["edges"] == [{"from": "a", "to": "b"}]  # "from", not "from_"


async def test_workflow_in_missing_workspace_is_404(client):
    r = await client.post(
        "/v1/workspaces/00000000-0000-0000-0000-000000000000/workflows", json={"name": "wf"}
    )
    assert r.status_code == 404


async def test_trigger_creates_pending_execution(client, workspace):
    wf = await make_workflow(client, workspace)
    r = await client.post(f"/v1/workflows/{wf}/executions")
    assert r.status_code == 202
    assert r.json()["status"] == "PENDING"
    ex = r.json()["id"]
    assert (await client.get(f"/v1/executions/{ex}")).json()["status"] == "PENDING"
    assert (await client.get(f"/v1/executions/{ex}/events")).json() == []


async def test_trigger_requires_a_published_version(client, workspace):
    r = await client.post(f"/v1/workspaces/{workspace}/workflows", json={"name": "empty"})
    r = await client.post(f"/v1/workflows/{r.json()['id']}/executions")
    assert r.status_code == 409


async def test_idempotency_key_returns_same_execution(client, workspace):
    wf = await make_workflow(client, workspace)
    h = {"Idempotency-Key": "order-1001"}
    first = await client.post(f"/v1/workflows/{wf}/executions", headers=h)
    second = await client.post(f"/v1/workflows/{wf}/executions", headers=h)
    assert first.status_code == 202 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    other = await client.post(f"/v1/workflows/{wf}/executions", headers={"Idempotency-Key": "order-1002"})
    assert other.json()["id"] != first.json()["id"]


async def test_no_key_means_every_call_is_new(client, workspace):
    wf = await make_workflow(client, workspace)
    a = await client.post(f"/v1/workflows/{wf}/executions")
    b = await client.post(f"/v1/workflows/{wf}/executions")
    assert a.json()["id"] != b.json()["id"]


async def test_concurrent_triggers_with_one_key_create_one_execution(client, workspace):
    import asyncio

    wf = await make_workflow(client, workspace)
    h = {"Idempotency-Key": "race"}
    rs = await asyncio.gather(*[client.post(f"/v1/workflows/{wf}/executions", headers=h) for _ in range(10)])
    assert sorted(r.status_code for r in rs).count(202) == 1
    assert len({r.json()["id"] for r in rs}) == 1


def test_example_workflows_are_valid():
    root = pathlib.Path(__file__).resolve().parents[2] / "schemas" / "examples"
    files = list(root.glob("*.json"))
    assert files, "no example workflows found"
    for f in files:
        try:
            Definition.model_validate(json.loads(f.read_text()))
        except Exception as e:
            raise AssertionError(f"{f.name}: {e}") from e