from typing import Any

from jsonschema import Draft202012Validator 

# config_schema is standard JSON Schema. The server validates configs with it,
# and the UI will build each node's form from the same document.
NODE_TYPES: list[dict[str, Any]] = [
    {
        "id": "webhook", "label": "Webhook", "category": "Triggers", "icon": "webhook", "trigger": True,
        "description": "Starts the workflow when its URL is called. Its output is {body: <payload>}.",
        "available": True, "unavailable_reason": None,
        "config_schema": {"type": "object", "additionalProperties": False, "properties": {}},
    },
    {
        "id": "schedule", "label": "Schedule", "category": "Triggers", "icon": "clock", "trigger": True,
        "description": "Starts the workflow on a timetable.",
        "available": False, "unavailable_reason": "Needs the scheduler (coming soon).",
        "config_schema": {"type": "object", "properties": {}},
    },
    {
        "id": "http", "label": "HTTP Request", "category": "Core", "icon": "http",
        "description": "Calls an HTTP endpoint. Sends an Idempotency key header.",
        "available": True, "unavailable_reason": None,
        "config_schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["url"],
            "properties": {
                "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"],
                           "default": "GET", "title": "Method"},
                "url": {"type": "string", "minLength": 1, "title": "URL",
                        "description": "Supports {{ input.x }} and {{ nodes.id.x }} templates."},
                "body": {"title": "Body", "description": "JSON sent with the request."},
            },
        },
    },
    {
        "id": "condition", "label": "Condition", "category": "Core", "icon": "condition",
        "description": "Routes the run down a true or false branch.",
        "available": False, "unavailable_reason": "Needs branching support in the engine (coming soon).",
        "config_schema": {"type": "object", "properties": {}},
    },
    {
        "id": "code", "label": "Code", "category": "Core", "icon": "code",
        "description": "Runs a sandboxed snippet.",
        "available": False, "unavailable_reason": "Needs the sandboxed worker (coming soon).",
        "config_schema": {"type": "object", "properties": {}},
    },
    {
        "id": "ai_classifier", "label": "AI Classifier", "category": "AI", "icon": "ai",
        "description": "Classifies text into categories.",
        "available": False, "unavailable_reason": "Needs the AI worker (coming soon).",
        "config_schema": {"type": "object", "properties": {}},
    },
    {
        "id": "generate_text", "label": "Generate text", "category": "AI", "icon": "ai",
        "description": "Generates text with a model.",
        "available": False, "unavailable_reason": "Needs the AI worker (coming soon).",
        "config_schema": {"type": "object", "properties": {}},
    },
]

BY_ID = {t["id"]: t for t in NODE_TYPES}

# Fail at import time, not on the first request, if a schema is malformed.
VALIDATORS = {}
for _t in NODE_TYPES:
    Draft202012Validator.check_schema(_t["config_schema"])
    VALIDATORS[_t["id"]] = Draft202012Validator(_t["config_schema"])