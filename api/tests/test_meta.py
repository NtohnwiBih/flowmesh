import pytest

from tests.test_api import CHAIN, make_workflow

BAD = {
    "schema_version": 1,
    "nodes": [
        {"id": "a", "type": "http", "config": {}},   # missing url
        {"id": "a", "type": "email"},                # duplicate id and unknown type
    ],
    "edges": [{"from": "a", "to": "ghost"}],
}


def codes(issues):
    return {i["code"] for i in issues}


# ---- /v1/me and the catalog -------------------------------------------------
async def test_me_returns_the_current_user(client):
    r = await client.get("/v1/me")
    assert r.status_code == 200
    assert "@example.com" in r.json()["email"] and "password_hash" not in r.json()


async def test_me_and_catalog_require_auth(anon_client):
    assert (await anon_client.get("/v1/me")).status_code == 401
    assert (await anon_client.get("/v1/node-types")).status_code == 401


async def test_catalog_lists_types_with_schemas(client):
    types = {t["id"]: t for t in (await client.get("/v1/node-types")).json()}
    assert types["http"]["available"] is True
    assert types["webhook"]["available"] is False and types["webhook"]["unavailable_reason"]
    assert all("config_schema" in t for t in types.values())


# ---- /validate ---------------------------------------------------------------
async def test_validate_accepts_a_good_definition(client, workspace):
    wf = await make_workflow(client, workspace)
    r = await client.post(f"/v1/workflows/{wf}/validate", json={"definition": CHAIN})
    assert r.json() == {"valid": True, "issues": []}


async def test_validate_reports_every_problem_at_once(client, workspace):
    wf = await make_workflow(client, workspace)
    issues = (await client.post(f"/v1/workflows/{wf}/validate", json={"definition": BAD})).json()["issues"]
    assert {"duplicate_node_id", "unknown_edge_node", "invalid_config", "unknown_node_type"} <= codes(issues)
    assert all(i["node_id"] == "a" for i in issues if i["code"] == "invalid_config")


async def test_validate_names_the_nodes_in_a_cycle(client, workspace):
    wf = await make_workflow(client, workspace)
    d = {"schema_version": 1, "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}],
         "nodes": [{"id": i, "type": "http", "config": {"url": "http://x"}} for i in "ab"]}
    body = (await client.post(f"/v1/workflows/{wf}/validate", json={"definition": d})).json()
    assert body["valid"] is False
    assert {i["node_id"] for i in body["issues"] if i["code"] == "cycle"} == {"a", "b"}


async def test_validate_survives_malformed_input(client, workspace):
    wf = await make_workflow(client, workspace)
    for bad in ({**CHAIN, "nodse": []}, [], "text", None, {"schema_version": 1}):
        r = await client.post(f"/v1/workflows/{wf}/validate", json={"definition": bad})
        assert r.status_code == 200 and r.json()["valid"] is False


async def test_validate_needs_editor_role(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    user, email = await new_user()
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": "viewer"})
    r = await user.post(f"/v1/workflows/{wf}/validate", json={"definition": CHAIN})
    assert r.status_code == 403


# ---- publish enforces the catalog ------------------------------------------
@pytest.mark.parametrize("node, code", [
    ({"id": "a", "type": "email"}, "unknown_node_type"),
    ({"id": "a", "type": "webhook"}, "node_type_unavailable"),
    ({"id": "a", "type": "http"}, "invalid_config"),
    ({"id": "a", "type": "http", "config": {"url": "http://x", "colour": "red"}}, "invalid_config"),
    ({"id": "a", "type": "http", "config": {"url": "http://x", "method": "FETCH"}}, "invalid_config"),
])
async def test_publish_rejects_bad_nodes(client, workspace, node, code):
    d = {"schema_version": 1, "nodes": [node], "edges": []}
    r = await client.post(f"/v1/workspaces/{workspace}/workflows", json={"name": "w", "definition": d})
    assert r.status_code == 422
    assert code in codes(r.json()["detail"]["issues"])
    # The failed publish must not leave a half-created workflow behind.
    assert (await client.get(f"/v1/workspaces/{workspace}/workflows")).json() == []


async def test_new_version_is_checked_too(client, workspace):
    wf = await make_workflow(client, workspace)
    d = {"schema_version": 1, "nodes": [{"id": "a", "type": "email"}], "edges": []}
    assert (await client.post(f"/v1/workflows/{wf}/versions", json={"definition": d})).status_code == 422


async def test_publish_moves_the_production_pointer(client, workspace, dsn):
    from tests.test_api import db_value
    wf = await make_workflow(client, workspace)
    await client.post(f"/v1/workflows/{wf}/versions", json={"definition": CHAIN})
    v = await db_value(dsn, """SELECT v.version FROM workflows w
                                 JOIN workflow_versions v ON v.id = w.production_version_id
                                WHERE w.id = $1::uuid""", wf)
    assert v == 2


# ---- executions list ----------------------------------------------------------
async def test_executions_paginate_newest_first(client, workspace):
    wf = await make_workflow(client, workspace)
    ids = [(await client.post(f"/v1/workflows/{wf}/executions")).json()["id"] for _ in range(5)]
    seen, cursor, pages = [], None, 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        body = (await client.get(f"/v1/workspaces/{workspace}/executions", params=params)).json()
        seen += [x["id"] for x in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert seen == ids[::-1] and pages == 3


async def test_executions_row_shape_and_filters(client, workspace):
    wf = await make_workflow(client, workspace)
    other = await make_workflow(client, workspace)
    await client.post(f"/v1/workflows/{wf}/executions")
    await client.post(f"/v1/workflows/{other}/executions")
    url = f"/v1/workspaces/{workspace}/executions"

    item = (await client.get(url, params={"workflow_id": wf})).json()["items"]
    assert len(item) == 1
    assert item[0]["environment"] == "production" and item[0]["status"] == "PENDING"
    assert item[0]["version"] == 1 and item[0]["workflow_name"] == "wf"

    assert len((await client.get(url, params={"status": "PENDING"})).json()["items"]) == 2
    assert (await client.get(url, params={"status": "FAILED"})).json()["items"] == []
    assert (await client.get(url, params={"environment": "staging"})).json()["items"] == []


async def test_executions_list_rejects_bad_input_and_outsiders(client, workspace, new_user):
    url = f"/v1/workspaces/{workspace}/executions"
    assert (await client.get(url, params={"status": "NOPE"})).status_code == 422
    assert (await client.get(url, params={"cursor": "garbage"})).status_code == 400
    assert (await client.get(url, params={"limit": 0})).status_code == 422
    other, _ = await new_user()
    assert (await other.get(url)).status_code == 404