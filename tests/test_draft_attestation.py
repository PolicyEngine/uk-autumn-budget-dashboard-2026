"""scripts/draft_attestation.py drafts a reason for every hand-written
modifier, so a package's drafted reason names each one it holds."""

import importlib.util
import json
from pathlib import Path

import pytest

from uk_budget_data import reforms

SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "draft_attestation.py"
)
HAND_WRITTEN = (
    reforms.PLAN_2_ID,
    reforms.STATE_PENSION_ALLOWANCE_ID,
)


def _load_script():
    spec = importlib.util.spec_from_file_location("draft_attestation", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_hand_written_measure_has_a_drafted_reason():
    assert reforms.STATE_PENSION_PROTECTION_DESIGN == "total_income"
    assert set(HAND_WRITTEN) <= set(_load_script().REASONS)


def test_a_withdrawn_measure_has_no_drafted_reason():
    # Employer NI relief is withdrawn (27 October 2026): never drafted
    assert reforms.EMPLOYER_NI_ID not in _load_script().REASONS


def test_the_tapered_design_is_not_drafted_as_hand_written(monkeypatch):
    monkeypatch.setattr(reforms, "STATE_PENSION_PROTECTION_DESIGN", "tapered")
    assert reforms.STATE_PENSION_ALLOWANCE_ID not in _load_script().REASONS


@pytest.fixture
def drafted(tmp_path, monkeypatch):
    script = _load_script()
    monkeypatch.setattr(script, "ATTESTATIONS_ROOT", tmp_path / "attestations")
    monkeypatch.setattr(script, "receipt_document_sha256", lambda _: "0" * 64)

    def draft(key, measure_ids):
        artifact = tmp_path / "artifact"
        artifact.mkdir(exist_ok=True)
        receipt = {"dashboard": {"key": key, "measure_ids": measure_ids}}
        (artifact / script.RECEIPT_FILE).write_text(json.dumps(receipt))
        script.main(str(artifact))
        return json.loads(
            (tmp_path / "attestations" / f"{key}.json").read_text()
        )

    return draft


def test_a_package_reason_names_every_hand_written_member(drafted):
    record = drafted(
        "combined--example",
        [*HAND_WRITTEN, "badr_lifetime_limit_cut"],
    )
    for measure_id in HAND_WRITTEN:
        assert measure_id in record["reason"]
    assert "badr_lifetime_limit_cut" not in record["reason"]
    assert (record["checker"], record["second"], record["released_at"]) == (
        "",
        "",
        "",
    )


def test_the_eight_package_reason_names_its_two_hand_written_members(
    drafted,
):
    from uk_budget_data.publication.combine import combined_key

    members = list(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    key = combined_key(members)
    # Nine on Budget day, with the Carer's Allowance taper
    assert key == "combined--47727b6baf58047f"
    record = drafted(key, members)
    assert record["measure_id"] == key
    assert (
        "hand-written carers_allowance_earnings_taper and "
        "plan_2_threshold_unfreeze and " in record["reason"]
    )
    assert reforms.STATE_PENSION_ALLOWANCE_ID in record["reason"]
    assert reforms.EMPLOYER_NI_ID not in record["reason"]
    assert record["checker"] == record["second"] == record["released_at"] == ""


def test_the_state_pension_draft_leaves_the_signatures_empty(drafted):
    record = drafted(
        reforms.STATE_PENSION_ALLOWANCE_ID,
        [reforms.STATE_PENSION_ALLOWANCE_ID],
    )
    assert record["measure_id"] == reforms.STATE_PENSION_ALLOWANCE_ID
    assert "state_pension_only_income_tax_allowance" in record["reason"]
    assert record["checker"] == record["second"] == record["released_at"] == ""
