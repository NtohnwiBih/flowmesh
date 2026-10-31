import json
import pathlib

from app.catalog import BY_ID, NODE_TYPES

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "schemas" / "fixtures" / "node-types.json"


def test_catalog_matches_the_shared_fixture():
    """The web app's form tests read this fixture. If you changed app/catalog.py,
    regenerate it with:  python scripts/dump_catalog.py"""
    assert FIXTURE.exists(), "fixture missing: run  python scripts/dump_catalog.py"
    assert json.loads(FIXTURE.read_text()) == json.loads(json.dumps(NODE_TYPES)), (
        "schemas/fixtures/node-types.json is out of date: run  python scripts/dump_catalog.py"
    )


def test_every_available_type_has_an_object_schema_the_form_can_render():
    for t in NODE_TYPES:
        schema = t["config_schema"]
        assert schema["type"] == "object", t["id"]
        # Each property must be something the editor can turn into a field.
        for key, prop in schema.get("properties", {}).items():
            assert isinstance(prop, dict), f"{t['id']}.{key}"


def test_trigger_flag_is_only_set_on_triggers():
    assert {t["id"] for t in NODE_TYPES if t.get("trigger")} == {"webhook", "schedule"}
    assert all("trigger" not in BY_ID[i] for i in ("http", "condition", "code"))
