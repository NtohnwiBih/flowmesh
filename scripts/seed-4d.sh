#!/usr/bin/env bash
# Creates two logins and two workflows so every 4D behavior can be checked in a few minutes.
#   demo@example.com   (admin)   password: correct-horse-battery
#   viewer@example.com (viewer)  same password
# Needs the API running. Safe to run again: it makes a new workspace each time.
set -euo pipefail
API=${API:-localhost:8080}; PW="correct-horse-battery"; J='Content-Type: application/json'
pj()   { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
etag() { grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2; }

for who in demo viewer; do   # 409 when the account already exists: that is fine
  curl -s -o /dev/null -X POST "$API/v1/auth/register" -H "$J" -d "{\"email\":\"$who@example.com\",\"password\":\"$PW\"}"
done
TOKEN=$(curl -sf -X POST "$API/v1/auth/login" -H "$J" -d "{\"email\":\"demo@example.com\",\"password\":\"$PW\"}" | pj '["access_token"]')
A="Authorization: Bearer $TOKEN"

WS=$(curl -sf -X POST "$API/v1/workspaces" -H "$A" -H "$J" -d "{\"name\":\"4D demo\",\"slug\":\"demo-4d-$RANDOM\"}" | pj '["id"]')
curl -sf -X POST "$API/v1/workspaces/$WS/members" -H "$A" -H "$J" -d '{"email":"viewer@example.com","role":"viewer"}' >/dev/null

new_workflow() { curl -sf -X POST "$API/v1/workspaces/$WS/workflows" -H "$A" -H "$J" -d "{\"name\":\"$1\"}" | pj '["id"]'; }
draft_etag()   { curl -sf -D - -o /dev/null "$API/v1/workflows/$1/draft" -H "$A" | etag; }
save_draft()   { curl -sf -X PUT "$API/v1/workflows/$1/draft" -H "$A" -H "$J" -H "If-Match: $2" -d "$3" -D - -o /dev/null | etag; }

# 1. A healthy workflow: published as v1, then edited, so the draft has unpublished changes.
GOOD=$(new_workflow "Order flow")
E=$(draft_etag "$GOOD")
E=$(save_draft "$GOOD" "$E" '{"definition":{"schema_version":1,
  "nodes":[{"id":"hook","type":"webhook","name":"Order webhook","ui":{"x":50,"y":120}},
           {"id":"fetch","type":"http","name":"Fetch order","ui":{"x":340,"y":120},
            "config":{"url":"http://localhost:8000/order-{{ nodes.hook.body.order_id }}.json"},
            "retry":{"max_attempts":3,"backoff_seconds":5}}],
  "edges":[{"from":"hook","to":"fetch"}]}}')
curl -sf -X POST "$API/v1/workflows/$GOOD/publish" -H "$A" -H "If-Match: $E" >/dev/null
save_draft "$GOOD" "$E" '{"definition":{"schema_version":1,
  "nodes":[{"id":"hook","type":"webhook","name":"Order webhook","ui":{"x":50,"y":120}},
           {"id":"fetch","type":"http","name":"Fetch order","ui":{"x":340,"y":120},
            "config":{"url":"http://localhost:8000/order-{{ nodes.hook.body.order_id }}.json"},
            "retry":{"max_attempts":3,"backoff_seconds":5}},
           {"id":"notify","type":"http","name":"Notify team","ui":{"x":630,"y":120},
            "config":{"method":"POST","url":"http://localhost:8000/notify"}}],
  "edges":[{"from":"hook","to":"fetch"},{"from":"fetch","to":"notify"}]}}' >/dev/null

# 2. A broken one, for the validation checks: a step with no URL, and one that does not exist yet.
BAD=$(new_workflow "Broken flow")
E=$(draft_etag "$BAD")
save_draft "$BAD" "$E" '{"definition":{"schema_version":1,
  "nodes":[{"id":"hook","type":"webhook","name":"Start","ui":{"x":50,"y":120}},
           {"id":"call","type":"http","name":"Call without a URL","ui":{"x":340,"y":120}},
           {"id":"branch","type":"condition","name":"Needs the Condition node","ui":{"x":630,"y":120}}],
  "edges":[{"from":"hook","to":"call"},{"from":"call","to":"branch"}]}}' >/dev/null

echo
echo "Ready. Open http://localhost:3000 and sign in as demo@example.com / $PW"
echo "  Order flow   : v1 live, plus an unpublished edit (adds 'Notify team')"
echo "  Broken flow  : never published; has two problems for Validate to find"
echo "  Sign in as viewer@example.com to check the read-only views."
