"""Regenerate schemas/fixtures/node-types.json from the API's node catalog.

Run from the api/ folder after changing app/catalog.py:

    python scripts/dump_catalog.py

The web tests read this file to check that the editor's forms understand every
config schema the API publishes, and a Python test fails if the file is stale.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.catalog import NODE_TYPES  # noqa: E402

OUT = ROOT.parent / "schemas" / "fixtures" / "node-types.json"
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(NODE_TYPES, indent=2) + "\n")
print(f"wrote {OUT} ({len(NODE_TYPES)} node types)")
