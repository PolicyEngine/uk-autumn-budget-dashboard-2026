"""The sign-off switch (uk_budget_data.sign_off): one value, read everywhere.

The checks that read it have their own tests of both positions:
tests/test_check_public_data.py, tests/test_check_public_files_build.py,
tests/test_publication_attestations.py, tests/test_publication_hardening_unit.py,
tests/test_results_on_modal_workflow.py and src/utils/publication/digest.test.js.
"""

import json
from argparse import Namespace
from pathlib import Path

import pytest

from uk_budget_data import sign_off
from uk_budget_data.living_standards import commands
from uk_budget_data.living_standards import review as living_standards_review
from uk_budget_data.publication.contract import contract

REPO = Path(__file__).resolve().parent.parent
COMMITTED = REPO / "src" / "utils" / "publication" / "contract.json"


def test_the_switch_is_a_boolean():
    assert isinstance(sign_off.REQUIRED, bool)


def test_the_page_contract_carries_the_switch():
    # The page and the build's check read it from the committed contract.
    assert contract()["sign_off_required"] is sign_off.REQUIRED
    assert (
        json.loads(COMMITTED.read_text())["sign_off_required"]
        is sign_off.REQUIRED
    )


@pytest.mark.parametrize("required", [True, False])
def test_the_outlook_commands_set_a_pending_row_only_with_sign_off_on(
    monkeypatch, required
):
    monkeypatch.setattr(sign_off, "REQUIRED", required)
    calls = []
    monkeypatch.setattr(
        living_standards_review,
        "set_pending",
        lambda *arguments: calls.append(arguments),
    )
    parsed = Namespace(
        output=Path("public/data/living_standards_outlook.json"),
        reviewer="vahid-ahmadi",
    )
    commands._mark_pending(parsed, "{}\n", "Basis")
    assert calls == (
        [
            (
                "public/data/living_standards_outlook.json",
                b"{}\n",
                "vahid-ahmadi",
                "Basis",
            )
        ]
        if required
        else []
    )
