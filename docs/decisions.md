# Design Decisions

1. **Idempotency key**: sent to external systems as SHA256(execution_id + node_id).
   It is stable across retries. `attempt` is tracked internally only.
2. **Payload object key**: content-hash based (matches the Go handler).
3. **Event writer**: only the engine appends events to `execution_evente`
   (single writer per execution). Workers report results to the engine.
4. **Determinism**: timestamps, random IDs and LLM outputs are recorded as
   events and never recomputes on replay.
5. **Schema owner**: golang-migrate (`db/migrations`) owns the database schema.
6. **KB means 1024 bytes** for payload threshold.
7. **Environments**: staging is the mutable draft plus test snapshots; production is the
   published, numbered, immutable versions. `workflows.production_version_id` is the live
   pointer, and rollback only moves it.
8. **Idempotency scope**: (workflow, environment, key). A staging test can never collide
   with production.
9. **Webhooks reference a node**: the canvas node says "starts here"; the hashed token and
   URL live in the `webhooks` table. Secrets never enter versioned definitions.
10. **Validation**: field rules (Pydantic) first, then graph and catalog rules, collected
    as issues with a node id. Go and Python share fixtures in schemas/fixtures.
11. **Reaper, ZSET leases, 404-vs-403 policy, stream tickets**: see earlier phases;
    outsiders get 404, low roles get 403.
12. **Trigger nodes stay unavailable** until the engine can complete them.
13. **Drafts**: one mutable draft per workflow, saved leniently, guarded by an ETag (revision
    counter). Publish and staging runs validate strictly. Publish requires If-Match.
14. **Staging runs** snapshot the draft into an unnumbered `staging` version, deduplicated by a
    canonical hash. `staging_verified` = this exact draft completed a staging run (soft gate).
15. **Rollback** moves `production_version_id`; versions are never rewritten.
16. **Trigger nodes** are completed by the engine from replayed state, output `{"body": input}`.
    One trigger per workflow, no incoming edges.
17. **Last admin**: role changes and removals lock the admin rows and refuse to leave none.
18. **Lock order**: workflow row, then draft row, in every code path.