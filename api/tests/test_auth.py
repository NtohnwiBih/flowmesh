import time

import jwt
import pytest

from tests.conftest import TEST_SECRET
from tests.test_api import CHAIN, make_workflow


async def test_healthz_and_hooks_stay_public(anon_client):
    assert (await anon_client.get("/healthz")).status_code == 200
    assert (await anon_client.post("/hooks/nope", json={})).status_code == 404  # not 401


async def test_register_is_case_insensitive_unique(anon_client):
    body = {"email": "Ada@Example.com", "password": "correct-horse-battery"}
    assert (await anon_client.post("/v1/auth/register", json=body)).status_code == 201
    body["email"] = "ada@example.COM"
    assert (await anon_client.post("/v1/auth/register", json=body)).status_code == 409


async def test_weak_password_is_rejected(anon_client):
    r = await anon_client.post("/v1/auth/register", json={"email": "a@b.co", "password": "short"})
    assert r.status_code == 422


async def test_password_is_stored_as_argon2_hash(anon_client, dsn):
    from tests.test_api import db_value
    await anon_client.post("/v1/auth/register", json={"email": "h@x.io", "password": "correct-horse-battery"})
    stored = await db_value(dsn, "SELECT password_hash FROM users WHERE email = 'h@x.io'")
    assert stored.startswith("$argon2id$") and "correct-horse" not in stored


async def test_bad_logins_look_identical(anon_client):
    await anon_client.post("/v1/auth/register", json={"email": "z@x.io", "password": "correct-horse-battery"})
    wrong = await anon_client.post("/v1/auth/login", json={"email": "z@x.io", "password": "nope-nope-nope"})
    unknown = await anon_client.post("/v1/auth/login", json={"email": "ghost@x.io", "password": "nope-nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def _token(secret=TEST_SECRET, exp_offset=600, alg="HS256", sub="00000000-0000-0000-0000-000000000001"):
    now = int(time.time())
    return jwt.encode({"sub": sub, "iat": now, "exp": now + exp_offset}, secret, algorithm=alg)


@pytest.mark.parametrize("headers", [
    {},                                                         # no token
    {"Authorization": "Bearer garbage"},                        # not a JWT
    {"Authorization": f"Bearer {_token(exp_offset=-10)}"},      # expired
    {"Authorization": f"Bearer {_token(secret='x' * 48)}"},     # wrong signature
    {"Authorization": f"Bearer {jwt.encode({'sub': 'x', 'exp': int(time.time()) + 600}, None, algorithm='none')}"},
])
async def test_protected_routes_reject_bad_tokens(anon_client, headers):
    r = await anon_client.get("/v1/workspaces", headers=headers)
    assert r.status_code == 401


async def test_outsider_gets_404_not_403(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    other, _ = await new_user()
    assert (await other.get(f"/v1/workspaces/{workspace}/workflows")).status_code == 404
    assert (await other.post(f"/v1/workflows/{wf}/executions")).status_code == 404
    assert (await other.get(f"/v1/workflows/{wf}/versions/1")).status_code == 404


async def test_list_workspaces_shows_only_mine(client, workspace, new_user):
    other, _ = await new_user()
    mine = (await client.get("/v1/workspaces")).json()
    theirs = (await other.get("/v1/workspaces")).json()
    assert [w["id"] for w in mine] == [workspace] and mine[0]["role"] == "admin"
    assert theirs == []


async def test_roles_are_enforced(client, workspace, new_user):
    wf = await make_workflow(client, workspace)
    user, email = await new_user()

    async def grant(role):
        r = await client.post(f"/v1/workspaces/{workspace}/members", json={"email": email, "role": role})
        assert r.status_code == 200, r.text

    await grant("viewer")
    assert (await user.get(f"/v1/workspaces/{workspace}/workflows")).status_code == 200
    assert (await user.post(f"/v1/workspaces/{workspace}/workflows", json={"name": "x"})).status_code == 403
    assert (await user.post(f"/v1/workflows/{wf}/executions")).status_code == 403

    await grant("editor")
    assert (await user.post(f"/v1/workflows/{wf}/executions")).status_code == 202
    assert (await user.post(f"/v1/workflows/{wf}/webhooks", json={"name": "h"})).status_code == 403
    assert (await user.post(f"/v1/workspaces/{workspace}/members",
                            json={"email": email, "role": "admin"})).status_code == 403

    await grant("admin")
    assert (await user.post(f"/v1/workflows/{wf}/webhooks", json={"name": "h"})).status_code == 201


async def test_execution_records_who_started_it(client, workspace, dsn):
    from tests.test_api import db_value
    wf = await make_workflow(client, workspace)
    ex = (await client.post(f"/v1/workflows/{wf}/executions")).json()["id"]
    by = await db_value(dsn, "SELECT initiated_by FROM workflow_executions WHERE id = $1::uuid", ex)
    assert by.startswith("user:")


async def test_adding_unknown_email_is_404(client, workspace):
    r = await client.post(f"/v1/workspaces/{workspace}/members",
                          json={"email": "nobody@x.io", "role": "viewer"})
    assert r.status_code == 404