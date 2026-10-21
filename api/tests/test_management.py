import asyncio

from tests.test_api import CHAIN, make_workflow


async def hook(client, wf, **kw):
    r = await client.post(f"/v1/workflows/{wf}/webhooks", json={"name": "h", **kw})
    assert r.status_code == 201, r.text
    return r.json()


# ---- webhooks -------------------------------------------------------------------------
async def test_staging_and_production_hooks_run_different_things(client, workspace):
    wf = await make_workflow(client, workspace)
    prod, stg = await hook(client, wf), await hook(client, wf, environment="staging")
    assert prod["environment"] == "production" and stg["environment"] == "staging"
    a = await client.post(f"/hooks/{prod['token']}", json={})
    b = await client.post(f"/hooks/{stg['token']}", json={})
    assert a.json()["environment"] == "production" and b.json()["environment"] == "staging"


async def test_listing_never_reveals_secrets(client, workspace):
    wf = await make_workflow(client, workspace)
    await hook(client, wf)
    items = (await client.get(f"/v1/workflows/{wf}/webhooks")).json()
    assert len(items) == 1 and not ({"token", "token_hash", "url"} & items[0].keys())


async def test_orphaned_hooks_are_flagged(client, workspace):
    wf = await make_workflow(client, workspace)               # nodes: a, b
    await hook(client, wf, node_id="a")
    await hook(client, wf, node_id="ghost")
    await hook(client, wf)
    flags = {i["node_id"]: i["orphaned"] for i in (await client.get(f"/v1/workflows/{wf}/webhooks")).json()}
    assert flags == {"a": False, "ghost": True, None: False}


async def test_disable_enable_rotate_delete(client, workspace):
    wf = await make_workflow(client, workspace)
    h = await hook(client, wf)
    call = lambda tok: client.post(f"/hooks/{tok}", json={})
    assert (await call(h["token"])).status_code == 202

    assert (await client.patch(f"/v1/webhooks/{h['id']}", json={"is_active": False})).status_code == 200
    assert (await call(h["token"])).status_code == 404
    await client.patch(f"/v1/webhooks/{h['id']}", json={"is_active": True})
    assert (await call(h["token"])).status_code == 202

    new = (await client.post(f"/v1/webhooks/{h['id']}/rotate")).json()
    assert new["token"] != h["token"]
    assert (await call(h["token"])).status_code == 404            # old token is dead
    assert (await call(new["token"])).status_code == 202

    assert (await client.delete(f"/v1/webhooks/{h['id']}")).status_code == 204
    assert (await client.get(f"/v1/workflows/{wf}/webhooks")).json() == []
    assert (await call(new["token"])).status_code == 404


async def test_webhook_management_needs_admin(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    h = await hook(client, wf)
    user, email = await new_user()
    assert (await user.patch(f"/v1/webhooks/{h['id']}", json={"is_active": False})).status_code == 404  # outsider
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": "editor"})
    assert (await user.get(f"/v1/workflows/{wf}/webhooks")).status_code == 200
    assert (await user.patch(f"/v1/webhooks/{h['id']}", json={"is_active": False})).status_code == 403
    assert (await user.post(f"/v1/webhooks/{h['id']}/rotate")).status_code == 403
    assert (await user.delete(f"/v1/webhooks/{h['id']}")).status_code == 403


# ---- members --------------------------------------------------------------------------
async def email_of(c):
    return (await c.get("/v1/me")).json()["email"]


async def test_list_and_remove_members(client, workspace, new_user):
    user, email = await new_user()
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": "viewer"})
    members = (await client.get(f"/v1/workspaces/{workspace}/members")).json()
    assert {m["email"] for m in members} >= {email} and len(members) == 2

    uid = next(m["user_id"] for m in members if m["email"] == email)
    assert (await user.get(f"/v1/workspaces/{workspace}/workflows")).status_code == 200
    assert (await client.delete(f"/v1/workspaces/{workspace}/members/{uid}")).status_code == 204
    assert (await user.get(f"/v1/workspaces/{workspace}/workflows")).status_code == 404   # access gone
    assert (await client.delete(f"/v1/workspaces/{workspace}/members/{uid}")).status_code == 404


async def test_the_last_admin_cannot_leave_or_be_demoted(client, workspace):
    me = (await client.get("/v1/me")).json()
    r = await client.post(f"/v1/workspaces/{workspace}/members", json={"email": me["email"], "role": "viewer"})
    assert r.status_code == 409
    assert (await client.delete(f"/v1/workspaces/{workspace}/members/{me['id']}")).status_code == 409
    assert (await client.get(f"/v1/workspaces/{workspace}/workflows")).status_code == 200


async def test_two_admins_cannot_demote_each_other_at_once(client, workspace, new_user):
    other, other_email = await new_user()
    await client.post(f"/v1/workspaces/{workspace}/members", json={"email": other_email, "role": "admin"})
    mine = await email_of(client)
    demote = lambda c, who: c.post(f"/v1/workspaces/{workspace}/members", json={"email": who, "role": "viewer"})
    rs = await asyncio.gather(demote(client, other_email), demote(other, mine))
    codes = sorted(r.status_code for r in rs)
    assert codes[0] == 200 and codes[1] in (403, 409), codes
    survivor = client if rs[0].status_code == 200 else other
    members = (await survivor.get(f"/v1/workspaces/{workspace}/members")).json()
    assert len([m for m in members if m["role"] == "admin"]) == 1