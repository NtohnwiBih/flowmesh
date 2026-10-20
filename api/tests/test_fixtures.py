import json
import pathlib

import pytest
from pydantic import ValidationError

from app.definition import Definition
from app.validation import collect_issues

ROOT = pathlib.Path(__file__).resolve().parents[2] / "schemas" / "fixtures"
VALID = sorted((ROOT / "valid").glob("*.json"))
INVALID = sorted((ROOT / "invalid").glob("*.json"))
assert VALID and INVALID, "fixtures missing: run the generator script"


@pytest.mark.parametrize("f", VALID, ids=lambda f: f.name)
def test_valid_fixture_is_accepted(f):
    Definition.model_validate(json.loads(f.read_text()))


@pytest.mark.parametrize("f", INVALID, ids=lambda f: f.name)
def test_invalid_fixture_is_rejected(f):
    raw = json.loads(f.read_text())
    with pytest.raises(ValidationError):
        Definition.model_validate(raw)
    assert collect_issues(raw), "the Validate endpoint must also report a problem"