# FlowMesh

[![CI](https://github.com/NtohnwiBih/flowmesh/actions/workflows/ci.yml/badge.svg)](https://github.com/NtohnwiBih/flowmesh/actions/workflows/ci.yml)

**A distributed workflow automation platform with durable execution.** Design a workflow as a graph, test it in
staging, publish it to production, and run it with a guarantee: if a worker (or the engine) is killed mid-run, the
execution picks up where it left off, and steps that already finished are not run again.

> **Status: under active development, not production-ready.** The execution core, control plane and a first web UI
> work end to end. Several planned features (payload offloading, branching, AI nodes, audit log) are not built yet.
> See [Status and roadmap](#status-and-roadmap) and [Known limitations](#known-limitations).

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Repository layout](#repository-layout)
4. [Quick start](#quick-start)
5. [Try it end to end](#try-it-end-to-end)
6. [Configuration](#configuration)
7. [How execution works](#how-execution-works)
8. [The workflow definition format](#the-workflow-definition-format)
9. [Staging and production](#staging-and-production)
10. [API reference](#api-reference)
11. [Security model](#security-model)
12. [Testing](#testing)
13. [Developing](#developing)
14. [Status and roadmap](#status-and-roadmap)
15. [Design decisions](#design-decisions)
16. [Known limitations](#known-limitations)
17. [Troubleshooting](#troubleshooting)
18. [License](#license)

---

## What it does

- **Durable, event-sourced execution.** Every state change is an immutable event in PostgreSQL. After a crash the
  engine rebuilds an execution's state by replaying its events and continues. Nothing is held only in memory.
- **No duplicated side effects.** Completed steps are never re-run. A step that was in flight when a worker died is
  retried with the **same idempotency key**, so the remote system can recognise it as the same operation.
- **Fault recovery you can see.** Workers hold a short lease on each task and heartbeat it. A dead worker's lease
  expires, the attempt is recorded as failed, and the node's retry policy decides what happens next.
- **Graph workflows.** Steps run in parallel where the graph allows it. A step starts when everything it depends on
  has completed.
- **Data flows between steps.** The trigger payload and every completed step's output are available to later steps
  through `{{ input.x }}` and `{{ nodes.step.y }}` templates.
- **Staging and production.** Edit a draft, run it in staging, publish an immutable numbered version, and roll back
  by moving a pointer.
- **Webhook triggers**, with hashed, rotatable tokens, separate for staging and production.
- **Live progress** over Server-Sent Events, with resume support.
- **A web UI** built on React Flow for browsing workflows and editing drafts (editing is being wired to the API; see
  the roadmap).

The flagship test starts a five-step workflow, `SIGKILL`s the worker mid-step, starts a new worker, and asserts that
the workflow completes, steps 1 and 2 ran exactly once, and step 3 succeeded on attempt 2 with the same idempotency
key.

## Architecture

```
                        ┌──────────────────────────────────┐
                        │  Next.js web app  (localhost:3000)│
                        │  React Flow canvas, workspaces    │
                        └─────────────────┬────────────────┘
                                          │ REST + SSE (JWT)
                                          ▼
                        ┌──────────────────────────────────┐
                        │  FastAPI control plane (:8080)    │
                        │  auth, roles, drafts, versions,   │
                        │  webhook gateway, event stream    │
                        └─────────────────┬────────────────┘
                                          │ SQL only (no RPC to the engine)
                                          ▼
        ┌────────────────────────── PostgreSQL 16 ──────────────────────────┐
        │ workflows, versions, drafts, executions, execution_events (log)   │
        └───────▲────────────────────────────────────────────────▲──────────┘
                │ load events, append events                     │
        ┌───────┴─────────────┐   enqueue / reap leases   ┌──────┴──────────┐
        │  Go engine          │◄─────────────────────────►│   Redis 7       │
        │  replay → schedule  │                           │ queues, leases, │
        │  → append → enqueue │                           │ delayed retries │
        └─────────────────────┘                           └──────▲──────────┘
                                                                 │ claim, heartbeat, ack
                                                          ┌──────┴──────────┐
                                                          │  Go workers     │
                                                          │  (http today)   │
                                                          └─────────────────┘
                                   MinIO (S3): provisioned, used from Phase 5
```

**The one rule that shapes everything:** the API and the engine never call each other. The API writes rows to
PostgreSQL (for example a `PENDING` execution) and the engine polls for work. If the engine is down, executions
queue up and start when it returns.

| Component | Technology | Responsibility |
|---|---|---|
| Web app | Next.js 16, React 19, Tailwind 4, shadcn/ui, `@xyflow/react`, TanStack Query | UI, calls the API directly |
| Control plane | Python 3.12, FastAPI, asyncpg, Pydantic | Auth, validation, CRUD, triggers, webhooks, SSE |
| Engine | Go | Replays events, decides what runs next, dispatches tasks, reaps dead leases |
| Workers | Go | Claim a task, run it, heartbeat, report the result |
| State | PostgreSQL 16 | Source of truth: all data and the event log |
| Queues and leases | Redis 7 | Task queues, leases, delayed retries. Rebuildable from Postgres. |
| Object storage | MinIO | Bucket is created; payload offloading arrives in Phase 5 |

## Repository layout

```
flowmesh/
├── engine/                     Go module: engine and workers
│   ├── cmd/engine/             the engine process
│   ├── cmd/worker/             a worker process (serves the "http" queue)
│   ├── cmd/smoke/              checks Postgres, Redis and MinIO are reachable
│   └── internal/
│       ├── workflow/           definition parser and validator (DAG, cycles)
│       ├── eventstore/         append-only event log, optimistic concurrency
│       ├── replay/             pure function: events → state
│       ├── scheduler/          pure function: state → next actions
│       ├── dispatch/           Redis queues, leases, heartbeats, delayed retries
│       ├── worker/             worker loop, HTTP handler, template resolver
│       └── runner/             the engine loop: ties everything together
├── api/                        Python control plane
│   ├── app/                    main, routes, auth, drafts, webhooks, stream,
│   │                           definition, catalog, validation, meta
│   └── tests/
├── web/                        Next.js app
│   └── src/{app,components,layouts,lib}
├── db/migrations/              numbered SQL migrations (golang-migrate)
├── schemas/                    workflow JSON Schema, examples and shared fixtures
├── docs/decisions.md           design decisions and deviations from the SRS
├── docker-compose.yml          Postgres, Redis, MinIO, one-shot init and migrate jobs
├── Makefile                    every common command
├── workers/, deploy/           reserved for later phases
└── .github/workflows/ci.yml    engine, api and web jobs
```

## Quick start

### Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Docker with Compose v2 | recent | Postgres, Redis, MinIO, and the test suites (testcontainers) |
| Go | see `engine/go.mod` | engine and workers |
| Python | 3.12 | API |
| Node.js | 20.9 or newer (CI uses 22) | web app |
| `make` | any | all common commands |
| [`golang-migrate`](https://github.com/golang-migrate/migrate) CLI | any | only for `make migrate-new` |

### Set up

```bash
git clone git@github.com:NtohnwiBih/flowmesh.git && cd flowmesh

# 1. Configuration. Generate a JWT secret and put it in .env
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"     # paste as JWT_SECRET

# 2. Infrastructure: Postgres, Redis, MinIO, bucket, migrations
make up

# 3. API dependencies
cd api && python3 -m venv .venv && source .venv/bin/activate \
  && pip install -r requirements.txt && cd ..

# 4. Web dependencies
make install-web && cp web/.env.example web/.env.local
```

### Run

The stack has four long-running processes. Use one terminal for each:

```bash
make run-engine     # decides what runs, reaps dead workers
make run-worker     # executes HTTP steps
make run-api        # http://localhost:8080   (interactive docs at /docs)
make run-web        # http://localhost:3000
```

Open <http://localhost:3000>, register an account, create a workspace and a workflow.

| URL | What |
|---|---|
| <http://localhost:3000> | Web app |
| <http://localhost:8080/docs> | Interactive API documentation (OpenAPI) |
| <http://localhost:9001> | MinIO console (credentials in `.env`) |

`make down` stops the containers and keeps data. `docker compose down -v` also deletes the data volumes.

## Try it end to end

This script exercises the whole system from the command line: it creates a workflow with a **webhook trigger** and an
**HTTP step**, runs it in **staging** through a webhook, publishes it, and runs it in **production**.

First, start a throwaway local "external API" for the HTTP step to call (a separate terminal):

```bash
mkdir -p /tmp/demo-site && echo '{"ok":true}' > /tmp/demo-site/order-42.json
cd /tmp/demo-site && python3 -m http.server 8000 --bind 127.0.0.1
```

> Serve an empty folder like this one. Running `http.server` in the repository root would publish your `.env`.

Then, with the engine, worker and API running:

```bash
cat > /tmp/demo.sh <<'EOF'
set -euo pipefail
API=localhost:8080; J='Content-Type: application/json'
pj() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
etag() { grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2; }

E="demo$RANDOM@example.com"; PW="correct-horse-battery"
curl -sf -X POST $API/v1/auth/register -H "$J" -d "{\"email\":\"$E\",\"password\":\"$PW\"}" >/dev/null
TOKEN=$(curl -sf -X POST $API/v1/auth/login -H "$J" -d "{\"email\":\"$E\",\"password\":\"$PW\"}" | pj '["access_token"]')
A="Authorization: Bearer $TOKEN"
WS=$(curl -sf -X POST $API/v1/workspaces -H "$A" -H "$J" -d "{\"name\":\"demo\",\"slug\":\"demo-$RANDOM\"}" | pj '["id"]')
WF=$(curl -sf -X POST $API/v1/workspaces/$WS/workflows -H "$A" -H "$J" -d '{"name":"order flow"}' | pj '["id"]')

# Save a draft (this is "staging"). The ETag protects against lost updates.
ETAG=$(curl -sf -D - -o /dev/null $API/v1/workflows/$WF/draft -H "$A" | etag)
DEF='{"definition":{"schema_version":1,
  "nodes":[{"id":"hook","type":"webhook","name":"Order webhook"},
           {"id":"fetch","type":"http","name":"Fetch order",
            "config":{"url":"http://localhost:8000/order-{{ nodes.hook.body.order_id }}.json"}}],
  "edges":[{"from":"hook","to":"fetch"}]}}'
ETAG=$(curl -sf -X PUT $API/v1/workflows/$WF/draft -H "$A" -H "$J" -H "If-Match: $ETAG" -d "$DEF" -D - -o /dev/null | etag)

show() { curl -s $API/v1/executions/$1/events -H "$A" | python3 -c '
import sys, json
for e in json.load(sys.stdin):
    err = (e["inline_payload"] or {}).get("error", "") if e["event_type"] == "NODE_FAILED" else ""
    print(" ", e["sequence_num"], e["event_type"], e["node_id"] or "", err)'; }

# Run in STAGING through a webhook. Staging runs a snapshot of the draft.
STG=$(curl -sf -X POST $API/v1/workflows/$WF/webhooks -H "$A" -H "$J" -d '{"name":"staging","environment":"staging","node_id":"hook"}' | pj '["token"]')
EX=$(curl -sf -X POST $API/hooks/$STG -H "$J" -d '{"order_id":42}' | pj '["id"]'); sleep 3
echo "staging run:"; show $EX

# Publish: creates the numbered, immutable version 1 and makes it live.
echo "publish:"; curl -s -X POST $API/v1/workflows/$WF/publish -H "$A" -H "If-Match: $ETAG" | python3 -m json.tool

# Run in PRODUCTION through a production webhook.
PROD=$(curl -sf -X POST $API/v1/workflows/$WF/webhooks -H "$A" -H "$J" -d '{"name":"production","node_id":"hook"}' | pj '["token"]')
EX2=$(curl -sf -X POST $API/hooks/$PROD -H "$J" -d '{"order_id":42}' | pj '["id"]'); sleep 3
echo "production run:"; show $EX2
EOF
bash /tmp/demo.sh
```

A healthy run prints six events per execution: `EXECUTION_STARTED`, `NODE_SCHEDULED hook`, `NODE_COMPLETED hook`
(completed by the engine itself, no worker involved), `NODE_SCHEDULED fetch`, `NODE_COMPLETED fetch`,
`EXECUTION_COMPLETED`. Publishing returns `"staging_verified": true` because this exact draft already completed a
staging run.

**See crash recovery yourself.** Give a node a retry policy (`"retry": {"max_attempts": 3}`) and point it at a slow
URL. While it runs, kill the worker with `kill -9 <pid>`, then start it again with `make run-worker`. After the lease
expires the timeline shows `NODE_FAILED` (lease expired) followed by `NODE_SCHEDULED` attempt 2 and, once the
worker is back, `NODE_COMPLETED`. The automated version of this is `TestExecutionRecoversAfterWorkerFailure`.

## Configuration

Copy `.env.example` to `.env`. The Makefile loads it for the engine, worker and API. The web app has its own file.

| Variable | Used by | Default / example | Notes |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Docker Compose | `flowmesh` / `flowmesh_dev` / `flowmesh` | Development values only |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` | Docker Compose | `flowmesh_minio` / `flowmesh_minio_secret` / `flowmesh-payloads` | Secret must be at least 8 characters |
| `DATABASE_URL` | engine, API | `postgres://flowmesh:flowmesh_dev@localhost:5432/flowmesh?sslmode=disable` | |
| `REDIS_ADDR` | engine, worker | `localhost:6379` | |
| `MINIO_ENDPOINT` | smoke test | `localhost:9000` | |
| `JWT_SECRET` | API | none | **Required**, at least 32 characters. The API refuses to start without it. |
| `CORS_ORIGINS` | API | `http://localhost:3000` | Comma-separated exact origins. `localhost` and `127.0.0.1` are different origins. |
| `APP_ENV` | API | `dev` | Optional. In `dev`, any `localhost`/`127.0.0.1` port is allowed for CORS. Set `production` anywhere deployed. |
| `TICK` | engine | `500ms` | How often the engine runs its housekeeping round |
| `LEASE_TTL`, `HEARTBEAT_EVERY` | worker | `20s`, `5s` | Heartbeat must be at most half the TTL |
| `NEXT_PUBLIC_API_URL` | web (`web/.env.local`) | `http://localhost:8080` | Baked into the browser bundle |

**Never commit `.env`.** It contains `JWT_SECRET`; anyone who has it can mint a valid login for any user. If it ever
leaks, rotate it. Deleting the file from git history is not enough.

## How execution works

### The loop

The engine holds no state between calls. For each execution it does this, over and over:

```
Load events ──► Replay ──► state ──► Scheduler.Next ──► actions
                                                          │
         record as events ◄───────────────────────────────┘
               │  Append(expectedLast = state.LastSeq)
               ▼
        enqueue tasks in Redis ──► workers claim, run, ack ──► results ──► (back to the top)
```

- **`Replay`** is a pure function (no database, no clock, no randomness). Given the event list it returns the
  state, or an error if the history breaks a rule (a gap in sequence numbers, a result for a stale attempt, an event
  after the execution ended, and so on).
- **`Scheduler.Next`** is also pure. A node is ready when it is `PENDING` and all its upstream nodes are
  `COMPLETED`. It returns instructions (start, schedule node N, complete, fail); it does not do anything itself.
- **`Append`** uses optimistic concurrency: "the last event I saw was #3, so add mine as #4". If another writer got
  there first, the write is refused (`ErrConflict`) and the caller reloads and recomputes. The unique constraint on
  `(execution_id, sequence_num)` is the second safety net.
- **The event is written before the task is queued.** A crash between the two leaves an event with no task, which
  the engine repairs on its next pass by re-enqueuing every `SCHEDULED` node. Enqueueing is idempotent.

Event types: `EXECUTION_STARTED`, `NODE_SCHEDULED`, `NODE_COMPLETED`, `NODE_FAILED`, `EXECUTION_COMPLETED`,
`EXECUTION_FAILED`. The `execution_events` table also rejects `UPDATE` with a database trigger.

### Workers, leases and crash recovery

1. A worker **claims** a task from its queue. Claiming pops the task and creates a lease in one atomic Redis script.
2. While it works, the worker **heartbeats** (default every 5 seconds) to renew the lease (default TTL 20 seconds).
3. If the lease is lost, the worker cancels the running handler and discards its result.
4. If the worker dies, the lease expires. The engine's reaper notices and records `NODE_FAILED` ("lease expired")
   for that attempt. The scheduler then applies the node's retry policy.
5. A late result from a superseded attempt is ignored, both by the engine and by `Replay`.

Leases live in a Redis **sorted set** keyed by deadline, not in keys with a TTL. An expired lease therefore stays
visible until the reaper deliberately removes it, so a missed expiry notification can never lose a task.

### Retries and idempotency

| Situation | Behaviour |
|---|---|
| Node has no `retry` block | Exactly one attempt. A failure, or a worker crash, fails the execution. |
| Node has `retry: {max_attempts, backoff_seconds}` | Failed or crashed attempts count toward `max_attempts`. The next attempt is delayed by `backoff_seconds`. |
| All attempts used | The execution fails (fail-fast). Late results from other nodes are ignored. |

Every HTTP request a worker makes carries `X-Idempotency-Key: SHA256(execution_id + ":" + node_id)`. The key is the
same on every attempt of the same node, so a remote service can recognise a retry of one operation instead of
treating it as a new one. If the key included the attempt number, a retry after a crash would look brand new and could,
for example, charge a card twice.

### Data between steps

Each task carries a context: `{"input": <trigger payload>, "nodes": {"<id>": <output>, ...}}`, built from the event
log. Inside string values of a node's `config`, the **worker** replaces `{{ path }}`:

- `{{ input.order_id }}` reads the execution input. `{{ nodes.fetch.status }}` reads a completed node's output.
- Paths use dots; array indexes work (`items.0.id`).
- A value that is **only** one placeholder keeps its type (`"{{ input.count }}"` becomes the number 42). Otherwise
  the value is inserted as text.
- A **missing path is an error**, never an empty string, so a typo fails loudly instead of calling the wrong URL.
- There are no expressions or functions. Templates can only read; they cannot execute code.

### Trigger nodes

A `webhook` node starts a workflow and does no work. The engine completes it itself, with output
`{"body": <execution input>}`, so downstream steps use `{{ nodes.hook.body.order_id }}`. A workflow can have **one**
trigger node, and it cannot have incoming edges.

### Live progress

`GET /v1/executions/{id}/stream` is a Server-Sent Events stream of the execution's events. It resumes after a
dropped connection using `Last-Event-ID` (the event's sequence number), sends a keepalive every 15 seconds, and ends
after the final event. Because browsers' `EventSource` cannot send an `Authorization` header, the web app first
requests a single-use, 30-second **stream ticket** and passes that instead.

## The workflow definition format

A workflow is a graph of nodes joined by edges. It is stored as JSON.

```json
{
  "schema_version": 1,
  "nodes": [
    { "id": "hook", "type": "webhook", "name": "Order webhook", "ui": { "x": 50, "y": 120 } },
    {
      "id": "fetch",
      "type": "http",
      "name": "Fetch order",
      "config": { "method": "GET", "url": "https://api.example.com/orders/{{ nodes.hook.body.order_id }}" },
      "retry": { "max_attempts": 3, "backoff_seconds": 5 },
      "ui": { "x": 340, "y": 120 }
    }
  ],
  "edges": [{ "from": "hook", "to": "fetch" }]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique within the workflow, up to 100 characters. It appears in templates, so it should stay stable. |
| `type` | The node type: which worker handles it, and which `config` it accepts |
| `name` | Optional display name, up to 255 characters |
| `config` | Type-specific settings. It must be a JSON object. The engine never reads it; the worker does. |
| `retry` | Optional. `max_attempts` ≥ 1, `backoff_seconds` ≥ 0 |
| `ui` | Optional canvas position. The engine carries it and never uses it. |
| Edge `label`, `ui` | Optional. A label (for future branching) and which sides of the cards the edge attaches to. |

Unknown fields are rejected everywhere, so a typo like `"nodse"` fails instead of being silently ignored. The graph
must be acyclic.

### Node types

`GET /v1/node-types` returns the catalog, including a JSON Schema for each type's `config`.

| Type | Status | Notes |
|---|---|---|
| `http` | Available | `config`: `method` (default GET), `url` (required), `body`. A non-2xx response is a failure. Responses over 1 MiB are rejected for now. |
| `webhook` | Available | Trigger node, completed by the engine |
| `schedule`, `condition`, `code`, `ai_classifier`, `generate_text` | Not yet | Listed in the catalog as unavailable. Publishing or running a workflow that uses one is refused. |

### Validation

There are two kinds of validation, on purpose:

- **Saving a draft is lenient.** Half-built graphs can be saved. The response lists the problems as warnings.
- **Publishing and staging runs are strict.** They reject unknown or unavailable node types, config that does not
  match the type's schema, cycles, duplicate ids, unknown edge targets, and trigger-node rules.

`POST /v1/workflows/{id}/validate` returns every problem at once, each with a `node_id` so the UI can highlight it.
The Go engine and the Python API implement the same structural rules independently. They are kept in agreement by the
**shared fixtures** in `schemas/fixtures/` (`valid/` and `invalid/`), which the Go, Python and TypeScript test suites
all read. When you change a rule, change the fixtures first.

## Staging and production

```
   edit ──► DRAFT (staging) ──► run in staging ──► PUBLISH ──► version N (production, immutable)
              mutable             snapshot of                        │
              ETag-guarded        the draft                     ROLLBACK moves the
                                                                production pointer to an older version
```

- **Draft.** One mutable draft per workflow. Saves require `If-Match: <etag>`; a stale ETag gets `412`, so two
  editors can never silently overwrite each other.
- **Staging runs** execute an unnumbered snapshot of the draft. Unchanged drafts reuse one snapshot (deduplicated by a
  canonical hash of the definition).
- **Publish** validates strictly, creates the next numbered, immutable version and points production at it. It
  requires `If-Match`, so you can only publish the exact draft you looked at. If that exact draft has no successful
  staging run, publish still succeeds but returns a `not_verified_in_staging` warning.
- **Rollback** only moves `workflows.production_version_id`. Versions are never rewritten or deleted.
- **Webhooks belong to an environment.** A staging hook runs the draft; a production hook runs the live version.
- **Idempotency keys are scoped per workflow and environment**, so a staging test can never collide with production.

## API reference

Base URL `http://localhost:8080`. Interactive docs with request and response schemas are at `/docs`.
All routes except those marked *public* need `Authorization: Bearer <token>`.

**Roles** are `viewer` < `editor` < `admin`, per workspace. A caller who is not a member gets `404` (not `403`), so
workspace and workflow ids cannot be probed.

| Method and path | Role | Purpose |
|---|---|---|
| `GET /healthz` | public | Liveness, checks the database |
| `POST /v1/auth/register`, `POST /v1/auth/login` | public | Create an account; get a 15-minute token |
| `GET /v1/me` | any | The current user |
| `GET /v1/node-types` | any | The node catalog |
| `POST /v1/workspaces`, `GET /v1/workspaces` | any | Create (you become admin); list yours, with your role |
| `GET`/`POST /v1/workspaces/{id}/members` | viewer / admin | List members; add or change a role |
| `DELETE /v1/workspaces/{id}/members/{user}` | admin | Remove a member. The last admin cannot be removed or demoted. |
| `GET`/`POST /v1/workspaces/{id}/workflows` | viewer / editor | List (`?include_archived=`); create |
| `GET /v1/workspaces/{id}/executions` | viewer | Paginated list (`limit`, `cursor`, `status`, `environment`, `workflow_id`) |
| `GET`/`PATCH /v1/workflows/{id}` | viewer / editor | Read; rename, edit description, archive (`is_active`) |
| `GET`/`PUT /v1/workflows/{id}/draft` | viewer / editor | Read the draft (returns `ETag`); save it (needs `If-Match`) |
| `POST /v1/workflows/{id}/validate` | editor | All validation issues for a definition |
| `POST /v1/workflows/{id}/publish` | editor | Publish the draft (needs `If-Match`) |
| `POST /v1/workflows/{id}/rollback` | editor | `{"version": N}`, points production at version N |
| `GET /v1/workflows/{id}/versions`, `GET .../versions/{n}` | viewer | List and read published versions |
| `POST /v1/workflows/{id}/executions` | editor | Run it. `?environment=staging\|production`, optional `Idempotency-Key` header, optional JSON body as input. `202` when created, `200` when the key was already used. |
| `GET`/`POST /v1/workflows/{id}/webhooks` | viewer / admin | List (no secrets, orphan flags); create (the token is shown once) |
| `PATCH`/`DELETE /v1/webhooks/{id}`, `POST .../rotate` | admin | Disable or rename; delete; rotate the token |
| `POST /hooks/{token}` | public | The webhook. The JSON body (max 1 MiB) becomes the execution input. Unknown, disabled and malformed tokens all return the same `404`. |
| `GET /v1/executions/{id}`, `GET .../events` | viewer | Status; the full event timeline |
| `POST /v1/executions/{id}/stream-ticket`, `GET .../stream` | viewer | Single-use SSE ticket; the event stream |

Status codes worth knowing: `401` missing or invalid token · `403` role too low · `404` missing or not yours ·
`409` conflict (duplicate slug, workflow not active, nothing published) · `412` stale `If-Match` ·
`422` validation failed (publish and staging runs include an `issues` list) · `428` `If-Match` missing.

## Security model

- **Passwords** are hashed with Argon2id. Hashing runs in a worker thread so it cannot stall other requests. An
  unknown email still performs a dummy hash check, so login timing and the error message do not reveal which emails
  exist.
- **Tokens** are HS256 JWTs valid for 15 minutes, with the algorithm pinned on verification. There is no refresh or
  revocation yet.
- **Webhook tokens** come from the OS random source (256 bits). Only a SHA-256 hash is stored, and the token is shown
  once. A fast hash is fine here because the secret is already random; passwords use a slow one because they are not.
  Treat webhook URLs like passwords: the token is in the path, so keep `/hooks/` paths out of access logs.
- **Definitions hold no secrets.** They are versioned, readable by every viewer, and will be exported to Git. Secrets
  and credentials belong in separate, encrypted storage (planned).
- **Template resolution cannot run code**, and an HTTP node only reads from the task's own context.
- **CORS** allows only the origins you list. Never use `*` for an API with logins.
- **The web app keeps the token in `sessionStorage`.** Any script running on the page could read it, which limits the
  protection against cross-site scripting to the token's short life. An httpOnly cookie is the production answer.

## Testing

```bash
make test           # all three suites
make test-engine    # Go
make test-api       # Python
make test-web       # TypeScript
make check-web      # exactly what the web CI job runs: lint, types, tests, build
```

| Suite | What it covers |
|---|---|
| **Go** | Parser and cycle detection; the event store, including concurrent writers and the append-only trigger; `Replay` (valid and invalid histories, every prefix of a valid history, determinism); the scheduler; Redis leases, heartbeats and delayed retries; the worker (heartbeats, lost leases, panics, templates); the runner; and **`TestExecutionRecoversAfterWorkerFailure`**, which `SIGKILL`s a real worker process |
| **Python** | Auth and roles, drafts and ETags, publish and rollback, staging runs, webhooks, members and the last-admin guard, validation, the executions list, the SSE stream, and the shared fixtures |
| **TypeScript** | The canvas converter (round trip, layout, cycle checks), the API client's error handling, id and slug generation, and the shared fixtures |

The Go and Python suites start real PostgreSQL (and Redis) containers with testcontainers, so **Docker must be
running**. The tests apply every `db/migrations/*.up.sql` file, so they exercise the real schema. The web tests read
`schemas/fixtures` from the repository root.

CI (`.github/workflows/ci.yml`) runs the `engine`, `api` and `web` jobs on every push and pull request.

## Developing

### Database migrations

Schema changes are numbered SQL files in `db/migrations/`, applied with golang-migrate.

```bash
make migrate-new name=add_thing      # creates NNNNNN_add_thing.up.sql and .down.sql
docker compose run --rm migrate      # apply them
```

**Never edit a migration that has been applied anywhere shared. Write a new one.** The `down` file of every
migration is for development only; some (for example migration 9) delete staging data.

### Adding a node type

1. Add its entry (label, category, `config_schema`, `available: true`) to `api/app/catalog.py`.
2. Write a handler in `engine/internal/worker` and serve it from a worker. The task queue is named after the node
   `type`, so a worker for type `email` takes tasks from the `email` queue.
3. If the type needs no worker (like `webhook`), register it as a trigger in `engine/internal/runner/trigger.go`.
4. Add tests on both sides, and add the type to the web app's display metadata in `web/src/lib/definition.ts`.

### Conventions that matter

- Keep `Replay` and `Scheduler.Next` **pure**: no I/O, no clock, no randomness. Anything non-deterministic must be
  recorded as an event.
- Only the engine appends to `execution_events`. Workers report results through Redis.
- Lock order in the API is always **workflow row, then draft row**, to avoid deadlocks.
- Never build SQL from request data. Values go through `$n` placeholders.
- Commit `schemas/fixtures` changes together with the validator changes they cover.

## Status and roadmap

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Monorepo, Docker Compose, migrations, CI | Done |
| 2. Engine | Parser, event store, replay, scheduler, Redis leases, worker, runner, crash-recovery test | Done |
| 3. Control plane | Workspaces, workflows, versions, idempotent triggers, webhooks, JWT and roles, SSE | Done |
| 4A. Editor foundations | Environments schema, definition fields, validation issues, node catalog, executions list | Done |
| 4B. Drafts and management | Drafts with ETag, publish, rollback, staging runs, environment-aware webhooks, trigger node, member and webhook management | Done |
| 4C. UI plumbing | Login, workspaces, workflow list, draft loader, canvas converter, web CI | Done |
| 4D. Editor on real data | Palette from the catalog, per-type config forms, Save, Validate, Publish, environment banner | **Next** |
| 4E. Run and inspect | Live node states (grey, orange, green, red, retrying), logs from the stream, executions pages on real data | Planned |
| 5. Payload offloading | Large payloads to MinIO, passed by reference (5 MB through three nodes) | Planned |
| 5.5. Control flow | Condition node, skipped branches, edge labels, execution timeout | Planned |
| 6. Workers and AI | Worker SDK, sandboxed Python worker, agent and reflector nodes, credential store, first integrations | Planned |
| 7. Governance and polish | Hash-chained audit log, Git sync, draft locking, visual diff, schedule trigger, dashboards | Planned |

## Design decisions

Decisions, and the places where the implementation deliberately differs from the original specification, are
recorded in [`docs/decisions.md`](docs/decisions.md). The most important ones:

| Topic | Decision | Why |
|---|---|---|
| Idempotency key | `SHA256(execution_id:node_id)`, the same for every attempt | An attempt-based key would defeat deduplication on retry |
| Leases | Redis sorted set by deadline, not TTL keys | Expired leases stay visible, so none can be missed |
| Crash handling | The reaper records `NODE_FAILED` and the scheduler decides | Retry policy lives in one place; a crash counts toward `max_attempts` |
| Event writer | Only the engine appends events, with optimistic concurrency | Prevents corrupted histories |
| Engine and API | Communicate only through Postgres | They stay decoupled and can fail independently |
| Template resolution | In the worker, not the engine | The engine stays ignorant of node types; large data never needs baking into stored config |
| Production version | An explicit pointer, not "highest number" | Makes rollback trivial and avoids ordering bugs with unnumbered staging snapshots |
| Webhooks | A node on the canvas says where a workflow starts; the secret lives in a hashed table | Definitions stay free of secrets |
| Missing resource vs forbidden | Outsiders get `404`, low roles get `403` | Ids cannot be probed |

## Known limitations

This is a development build. In particular:

- **Large payloads are stored inline in PostgreSQL.** The HTTP step rejects responses over 1 MiB until Phase 5 adds
  object-storage offloading. The MinIO bucket exists but nothing writes to it yet.
- **Only `http` and `webhook` nodes exist.** There is no branching, scheduling, code execution or AI node yet.
- **Unknown node types are rejected at publish time**, but an execution can still wait forever if a worker for a
  valid type is not running. An execution timeout is planned.
- **The web editor still simulates running.** Loading a draft is real. Save, Validate, Publish and Run are wired in
  4D and 4E. The dashboard, executions pages, usage meter and several sidebar items still show mock data.
- **Open registration, no email verification, no login rate limiting, no refresh or revocation of tokens.**
- **No audit log yet.** Publishes, rollbacks, token rotations and membership changes are not recorded.
- **Webhook rotation is immediate.** There is no grace period in which both tokens work.
- **Staging snapshots accumulate.** A retention job is planned.
- **Detection of a dead worker takes up to the lease TTL plus the engine's tick.** With the defaults (20 s TTL,
  500 ms tick) that is about 20 to 21 seconds.
- **One Redis instance and one engine process** are the tested configuration. Several engines are safe (conflicts
  are handled) but redundant.
- **No invitations or self-service leave** for workspace members. A member must already have an account.
- **The development credentials in `.env.example` are public.** Change every secret before exposing any service.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `make: *** No rule to make target` | Run `make` from the repository root. Recipe lines must start with a real TAB. |
| API exits immediately mentioning `JWT_SECRET` | Set it in `.env` (32+ characters), then restart `make run-api`. |
| Browser shows a CORS error, API logs `OPTIONS ... 400` | The page's origin is not in `CORS_ORIGINS`. Check the exact origin (`localhost` is not `127.0.0.1`, and Next may have moved to port 3001), then restart the API. |
| `Address already in use` on port 8000 or 8080 | Something else holds the port. Use `ss -ltnp \| grep :8000` to find it. The demo web server uses 8000; the API uses 8080. |
| `column ... does not exist` or `relation ... does not exist` | Migrations were not applied. Run `docker compose run --rm migrate`. |
| An execution stays `PENDING` | The engine is not running or cannot reach Postgres. Check its terminal. |
| An execution stays `RUNNING` | No worker is running, or a step's URL is unreachable. Check the worker terminal. |
| A step fails with `connection refused` | The service it calls is not running (for example the demo server on port 8000). |
| A step fails with `template: ... not found` | A `{{ path }}` points at something that does not exist in the context. Check the node id and field names. |
| Tests fail with a Docker error | Start Docker. The Go and Python suites use testcontainers. |
| `npm install` crashes with `edgesOut` | Use the committed `package-lock.json` and `npm ci`. Vitest 4 and 5 trigger this on npm 10.9; the project pins Vitest 3. |
| Login works but the app bounces to `/login` | The token expired (15 minutes). Sign in again. |
| `$WF`/`$EX` empty in a shell demo | Shell variables only exist in the terminal that set them. Run the whole demo as one script, as above. |

## License

Not yet chosen. The project is intended to be open source. Add a `LICENSE` file before publishing the repository.