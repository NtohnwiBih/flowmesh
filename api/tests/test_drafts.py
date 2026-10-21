import asyncio
import json

from tests.test_api import CHAIN, db_value, make_workflow


async def get_draft(client, wf):
    r = await client.get(f"/v1/workflows/{wf}/draft")
    assert r.status_code == 200, r.text
    return r.json(), r.headers["etag"]


def put(client, wf, definition, etag):
    return client.put(f"/v1/workflows/{wf}/draft", json={"definition": definition}, headers={"If-Match": etag})


def with_node(defn, node_id="c"):
    d = json.loads(json.dumps(defn))
    d["nodes"].append({"id": node_id, "type": "http", "config": {"url": "http://x"}})
    d["edges"].append({"from": "b", "to": node_id})
    return d


async def empty_workflow(client, workspace):
    r = await client.post(f"/v1/workspaces/{workspace}/workflows", json={"name": "empty"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def trigger(client, wf, **params):
    return await client.post(f"/v1/workflows/{wf}/executions", params=params)


# ---- the draft ----------------------------------------------------------------
async def test_new_workflows_have_a_draft(client, workspace):
    wf = await make_workflow(client, workspace)
    body, etag = await get_draft(client, wf)
    assert body["definition"]["nodes"][0]["id"] == "a" and body["etag"] == etag
    assert body["base_version"] == 1 and body["production_version"] == 1
    assert body["has_unpublished_changes"] is False

    blank = await empty_workflow(client, workspace)
    body, _ = await get_draft(client, blank)
    assert body["definition"]["nodes"] == [] and body["production_version"] is None
    assert body["has_unpublished_changes"] is True


async def test_saving_needs_a_fresh_etag(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    assert (await client.put(f"/v1/workflows/{wf}/draft", json={"definition": CHAIN})).status_code == 428
    r = await put(client, wf, with_node(CHAIN), etag)
    assert r.status_code == 200 and r.headers["etag"] != etag
    assert (await put(client, wf, CHAIN, etag)).status_code == 412      # stale
    body, _ = await get_draft(client, wf)
    assert body["has_unpublished_changes"] is True and len(body["definition"]["nodes"]) == 3


async def test_half_built_drafts_save_with_warnings(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    half = {"schema_version": 1, "nodes": [{"id": "a", "type": "email"}],
            "edges": [{"from": "a", "to": "ghost"}]}
    r = await put(client, wf, half, etag)
    assert r.status_code == 200
    assert {"unknown_node_type", "unknown_edge_node"} <= {i["code"] for i in r.json()["issues"]}
    assert len((await client.get(f"/v1/workflows/{wf}/versions")).json()) == 1   # production untouched


async def test_draft_shape_is_still_checked(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    for bad in ([], "x", {"schema_version": 2, "nodes": [], "edges": []},
                {"schema_version": 1, "nodes": {}, "edges": []}):
        assert (await put(client, wf, bad, etag)).status_code == 422


async def test_concurrent_saves_one_wins(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    rs = await asyncio.gather(*[put(client, wf, with_node(CHAIN, f"n{i}"), etag) for i in range(5)])
    codes = sorted(r.status_code for r in rs)
    assert codes == [200, 412, 412, 412, 412]


async def test_draft_roles(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    user, email = await new_user()
    assert (await user.get(f"/v1/workflows/{wf}/draft")).status_code == 404       # outsider
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": "viewer"})
    assert (await user.get(f"/v1/workflows/{wf}/draft")).status_code == 200
    assert (await put(user, wf, CHAIN, etag)).status_code == 403


# ---- publish and rollback --------------------------------------------------------
async def test_publish_makes_the_draft_live(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    etag2 = (await put(client, wf, with_node(CHAIN), etag)).headers["etag"]

    assert (await client.post(f"/v1/workflows/{wf}/publish")).status_code == 428
    assert (await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag})).status_code == 412
    r = await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag2})
    assert r.status_code == 201 and r.json()["version"] == 2

    body, _ = await get_draft(client, wf)
    assert body["production_version"] == 2 and body["base_version"] == 2
    assert body["has_unpublished_changes"] is False
    ex = (await trigger(client, wf)).json()
    versions = (await client.get(f"/v1/workflows/{wf}/versions")).json()
    assert ex["workflow_version_id"] == versions[0]["id"]


async def test_invalid_drafts_cannot_be_published(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    half = {"schema_version": 1, "nodes": [{"id": "a", "type": "email"}], "edges": []}
    etag2 = (await put(client, wf, half, etag)).headers["etag"]
    r = await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag2})
    assert r.status_code == 422 and r.json()["detail"]["issues"]
    assert len((await client.get(f"/v1/workflows/{wf}/versions")).json()) == 1


async def test_publish_warns_when_the_draft_was_never_run_in_staging(client, workspace, dsn):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    etag2 = (await put(client, wf, with_node(CHAIN), etag)).headers["etag"]
    r = await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag2})
    assert r.json()["staging_verified"] is False
    assert r.json()["warnings"][0]["code"] == "not_verified_in_staging"

    # A completed staging run of this exact draft clears the warning for the next publish.
    etag3 = (await put(client, wf, with_node(CHAIN, "d"), etag2)).headers["etag"]
    ex = (await trigger(client, wf, environment="staging")).json()["id"]
    await db_value(dsn, "UPDATE workflow_executions SET status = 'COMPLETED' WHERE id = $1::uuid RETURNING 1", ex)
    body, _ = await get_draft(client, wf)
    assert body["staging_verified"] is True
    r = await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag3})
    assert r.json()["staging_verified"] is True and r.json()["warnings"] == []


async def test_rollback_moves_only_the_pointer(client, workspace):
    wf = await make_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    etag2 = (await put(client, wf, with_node(CHAIN), etag)).headers["etag"]
    await client.post(f"/v1/workflows/{wf}/publish", headers={"If-Match": etag2})

    versions = (await client.get(f"/v1/workflows/{wf}/versions")).json()
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["is_production"]

    assert (await client.post(f"/v1/workflows/{wf}/rollback", json={"version": 1})).status_code == 200
    ex = (await trigger(client, wf)).json()
    assert ex["workflow_version_id"] == versions[1]["id"]          # v1 is live again
    assert (await client.post(f"/v1/workflows/{wf}/rollback", json={"version": 9})).status_code == 404
    body, _ = await get_draft(client, wf)
    assert body["production_version"] == 1 and body["has_unpublished_changes"] is True   # draft untouched


# ---- staging runs -------------------------------------------------------------------
async def test_staging_run_snapshots_the_draft(client, workspace, dsn):
    wf = await make_workflow(client, workspace)
    r1 = (await trigger(client, wf, environment="staging")).json()
    r2 = (await trigger(client, wf, environment="staging")).json()
    assert r1["environment"] == "staging" and r1["id"] != r2["id"]
    assert r1["workflow_version_id"] == r2["workflow_version_id"]            # unchanged draft: one snapshot

    kind = await db_value(dsn, """SELECT environment::text || ':' || COALESCE(version::text, 'none')
                                    FROM workflow_versions WHERE id = $1::uuid""", r1["workflow_version_id"])
    assert kind == "staging:none"

    _, etag = await get_draft(client, wf)
    await put(client, wf, with_node(CHAIN), etag)
    r3 = (await trigger(client, wf, environment="staging")).json()
    assert r3["workflow_version_id"] != r1["workflow_version_id"]            # edited draft: new snapshot
    prod = (await trigger(client, wf)).json()
    assert prod["environment"] == "production" and prod["workflow_version_id"] != r3["workflow_version_id"]


async def test_staging_works_before_anything_is_published(client, workspace):
    wf = await empty_workflow(client, workspace)
    _, etag = await get_draft(client, wf)
    await put(client, wf, CHAIN, etag)
    assert (await trigger(client, wf, environment="staging")).status_code == 202
    assert (await trigger(client, wf)).status_code == 409                    # nothing live yet


async def test_staging_rejects_invalid_drafts(client, workspace):
    wf = await empty_workflow(client, workspace)
    r = await trigger(client, wf, environment="staging")
    assert r.status_code == 422 and r.json()["detail"]["issues"]


async def test_idempotency_keys_do_not_cross_environments(client, workspace):
    wf = await make_workflow(client, workspace)
    h = {"Idempotency-Key": "order-1"}
    prod = await client.post(f"/v1/workflows/{wf}/executions", headers=h)
    stg = await client.post(f"/v1/workflows/{wf}/executions", headers=h, params={"environment": "staging"})
    assert prod.status_code == stg.status_code == 202 and prod.json()["id"] != stg.json()["id"]
    again = await client.post(f"/v1/workflows/{wf}/executions", headers=h, params={"environment": "staging"})
    assert again.status_code == 200 and again.json()["id"] == stg.json()["id"]


# ---- rename and archive -----------------------------------------------------------
async def test_rename_and_archive(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    r = await client.patch(f"/v1/workflows/{wf}", json={"name": "Renamed"})
    assert r.status_code == 200 and r.json()["name"] == "Renamed"
    assert (await client.patch(f"/v1/workflows/{wf}", json={})).status_code == 422

    await client.patch(f"/v1/workflows/{wf}", json={"is_active": False})
    assert (await trigger(client, wf)).status_code == 409
    url = f"/v1/workspaces/{workspace}/workflows"
    assert (await client.get(url)).json() == []
    assert len((await client.get(url, params={"include_archived": "true"})).json()) == 1

    user, email = await new_user()
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": "viewer"})
    assert (await user.patch(f"/v1/workflows/{wf}", json={"name": "x"})).status_code == 403