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