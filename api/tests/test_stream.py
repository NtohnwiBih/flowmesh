import json
import uuid

import asyncpg

from tests.test_api import CHAIN, make_workflow


async def add_events(dsn, execution_id, events):
    conn = await asyncpg.connect(dsn)
    try:
        for i, (typ, node, payload) in enumerate(events, start=1):
            await conn.execute(
                """INSERT INTO execution_events (execution_id, sequence_num, event_type, node_id, inline_payload)
                   VALUES ($1::uuid, $2, $3, $4, $5::jsonb)""",
                execution_id, i, typ, node, json.dumps(payload) if payload is not None else None,
            )
    finally:
        await conn.close()


DONE = [
    ("EXECUTION_STARTED", None, None),
    ("NODE_SCHEDULED", "a", None),
    ("NODE_COMPLETED", "a", {"ok": True}),
    ("EXECUTION_COMPLETED", None, None),
]


async def new_execution(client, workspace) -> str:
    wf = await make_workflow(client, workspace)
    return (await client.post(f"/v1/workflows/{wf}/executions")).json()["id"]


def parse(body: str):
    frames = []
    for block in body.strip().split("\n\n"):
        if block.startswith(":"):
            continue
        f = dict(line.split(": ", 1) for line in block.splitlines())
        frames.append(f)
    return frames


async def test_stream_replays_history_then_ends(client, workspace, dsn):
    ex = await new_execution(client, workspace)
    await add_events(dsn, ex, DONE)
    t = (await client.post(f"/v1/executions/{ex}/stream-ticket")).json()["ticket"]
    r = await client.get(f"/v1/executions/{ex}/stream", params={"ticket": t})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    frames = parse(r.text)
    assert [f["id"] for f in frames] == ["1", "2", "3", "4"]
    assert frames[2]["event"] == "NODE_COMPLETED"
    assert json.loads(frames[2]["data"])["inline_payload"] == {"ok": True}


async def test_last_event_id_resumes(client, workspace, dsn):
    ex = await new_execution(client, workspace)
    await add_events(dsn, ex, DONE)
    t = (await client.post(f"/v1/executions/{ex}/stream-ticket")).json()["ticket"]
    r = await client.get(f"/v1/executions/{ex}/stream", params={"ticket": t},
                         headers={"Last-Event-ID": "2"})
    assert [f["id"] for f in parse(r.text)] == ["3", "4"]


async def test_ticket_is_single_use(client, workspace, dsn, anon_client):
    ex = await new_execution(client, workspace)
    await add_events(dsn, ex, DONE)
    t = (await client.post(f"/v1/executions/{ex}/stream-ticket")).json()["ticket"]
    assert (await anon_client.get(f"/v1/executions/{ex}/stream", params={"ticket": t})).status_code == 200
    assert (await anon_client.get(f"/v1/executions/{ex}/stream", params={"ticket": t})).status_code == 401


async def test_ticket_is_bound_to_its_execution(client, workspace, dsn, anon_client):
    ex1 = await new_execution(client, workspace)
    ex2 = await new_execution(client, workspace)
    await add_events(dsn, ex2, DONE)
    t = (await client.post(f"/v1/executions/{ex1}/stream-ticket")).json()["ticket"]
    r = await anon_client.get(f"/v1/executions/{ex2}/stream", params={"ticket": t})
    assert r.status_code == 401


async def test_expired_ticket_is_rejected(client, workspace, dsn, anon_client):
    ex = await new_execution(client, workspace)
    t = (await client.post(f"/v1/executions/{ex}/stream-ticket")).json()["ticket"]
    conn = await asyncpg.connect(dsn)
    await conn.execute("UPDATE stream_tickets SET expires_at = NOW() - interval '1 second'")
    await conn.close()
    assert (await anon_client.get(f"/v1/executions/{ex}/stream", params={"ticket": t})).status_code == 401


async def test_stream_requires_auth(anon_client, client, workspace):
    ex = await new_execution(client, workspace)
    assert (await anon_client.get(f"/v1/executions/{ex}/stream")).status_code == 401


async def test_bearer_header_also_works_for_non_browser_clients(client, workspace, dsn):
    ex = await new_execution(client, workspace)
    await add_events(dsn, ex, DONE)
    r = await client.get(f"/v1/executions/{ex}/stream")   # client carries its Bearer header
    assert r.status_code == 200 and len(parse(r.text)) == 4


async def test_outsider_cannot_get_a_ticket(client, workspace, new_user):
    ex = await new_execution(client, workspace)
    other, _ = await new_user()
    assert (await other.post(f"/v1/executions/{ex}/stream-ticket")).status_code == 404