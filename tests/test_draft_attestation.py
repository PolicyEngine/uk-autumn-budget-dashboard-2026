"""Native parameter receipts need no modifier draft.

Explicit historical synthetic identities exercise known helper drafts;
none of these fixtures represents a model run or a certified publication.
"""

import importlib
import importlib.util
import json
from pathlib import Path

import pytest

from uk_budget_data import reforms
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication import receipt as receipt_module

SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "draft_attestation.py"
)
HAND_WRITTEN = (
    reforms.BUS_FARE_CAP_ID,
    reforms.PLAN_2_ID,
    reforms.STATE_PENSION_ALLOWANCE_ID,
)
# Historical forward helpers, retained for explicit identity-bound drafts.
HISTORICAL_BUDGET_MODIFIERS = (
    reforms.BUS_FARE_CAP_ID,
    reforms.CARERS_ALLOWANCE_TAPER_ID,
    reforms.ELECTRICITY_VAT_ID,
    reforms.FUEL_DUTY_DEFERRAL_ID,
    reforms.HOUSEHOLD_ENERGY_PAYMENT_ID,
    reforms.STATE_PENSION_ALLOWANCE_ID,
)


def _load_script():
    spec = importlib.util.spec_from_file_location("draft_attestation", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_hand_written_measure_has_a_drafted_reason():
    assert reforms.STATE_PENSION_PROTECTION_DESIGN == "tax_reduction"
    assert set(HAND_WRITTEN) <= set(_load_script().REASONS)


def test_native_budget_measures_do_not_require_legacy_modifier_reasons():
    registered = {reform.id: reform for reform in reforms.get_all_reforms()}
    with_modifier = {
        measure_id
        for measure_id, reform in registered.items()
        if reform.simulation_modifier is not None
        and not measure_id.startswith("autumn_budget_2026")
    }
    assert with_modifier == set()
    assert set(HISTORICAL_BUDGET_MODIFIERS) <= set(_load_script().REASONS)


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

    def draft(
        key,
        measure_ids,
        *,
        historical=False,
        tamper=None,
        unknown_modifier=False,
    ):
        artifact = tmp_path / "artifact"
        artifact.mkdir(exist_ok=True)
        config = DataConfig(years=[2027, 2028])
        revision = receipt_module.CodeRevision("a" * 40, True)
        api, _ = receipt_module.receipt_api()
        definitions = {}
        for measure_id in sorted(measure_ids):
            try:
                measure = reforms.get_reform(measure_id)
            except (KeyError, ValueError):
                measure = None
            if measure is None:
                measure = Reform(
                    id=measure_id,
                    name=measure_id,
                    parameter_changes={
                        f"gov.synthetic.drafter.{measure_id}": {"2027": 1}
                    },
                )
            if historical and measure_id in script.REASON_MODIFIERS:
                paths = script.REASON_MODIFIERS[measure_id]
                path = next(
                    path for path in paths if ":pre_budget_" not in path
                )
                module, function = path.split(":")
                helper = getattr(importlib.import_module(module), function)
                if unknown_modifier:
                    from tests.fixed_shape_measures import (
                        module_level_modifier,
                    )

                    helper = module_level_modifier
                measure = measure.model_copy(
                    update={
                        "parameter_changes": None,
                        "baseline_parameter_changes": None,
                        "baseline_simulation_modifier": None,
                        "simulation_modifier": helper,
                    }
                )
            definitions[measure_id] = measure
        if len(measure_ids) == 1:
            measure = definitions[measure_ids[0]]
            bind = (
                receipt_module.scenario_identity
                if historical
                else receipt_module.comparison_identity
            )
            baseline = bind(
                measure.baseline_scenario_for(config),
                name="baseline",
                revision=revision,
            )
            reform = bind(measure.to_scenario(), name=key, revision=revision)
            members, composition, configured = None, None, None
        elif historical:
            members = []
            for index, measure in enumerate(definitions.values()):
                baseline = receipt_module.scenario_identity(
                    measure.baseline_scenario_for(config),
                    name="baseline",
                    revision=revision,
                )
                reform = receipt_module.scenario_identity(
                    measure.to_scenario(), name=measure.id, revision=revision
                )
                members.append(
                    {
                        "id": measure.id,
                        "baseline": baseline.model_dump(mode="json"),
                        "reform": reform.model_dump(mode="json"),
                        "baseline_bound": index == 0,
                    }
                )
            baseline = api.composed_reform_identity(
                [
                    api.ReformIdentity.model_validate(member["baseline"])
                    for member in members
                    if member["baseline_bound"]
                ],
                applied_before_data_load=False,
            )
            reform = api.composed_reform_identity(
                [
                    api.ReformIdentity.model_validate(member["reform"])
                    for member in members
                ],
                applied_before_data_load=False,
            )
            composition = {
                "baseline_applied_before_data_load": False,
                "reform_applied_before_data_load": False,
            }
            configured = api.reform_identity(None).model_dump(mode="json")
        else:
            baseline, reform, members, composition = (
                receipt_module.combined_identities(
                    list(definitions.values()),
                    config,
                    revision,
                    baseline_applied_before_data_load=True,
                    reform_applied_before_data_load=True,
                )
            )
            configured = receipt_module.comparison_identity(
                None, name="configured", revision=revision
            ).model_dump(mode="json")
        receipt = {
            "dashboard": {
                "key": key,
                "measure_ids": sorted(measure_ids),
                "git_sha": revision.git_sha,
                "members": members,
                "composition": composition,
                "config_baseline": configured,
                "fixture_note": "synthetic drafter-only metadata; no model run or certification",
            },
            "execution_receipt": {
                "years": config.years,
                "baseline": baseline.model_dump(mode="json"),
                "reform": reform.model_dump(mode="json"),
            },
        }
        if tamper:
            tamper(receipt)
        (artifact / script.RECEIPT_FILE).write_text(json.dumps(receipt))
        with monkeypatch.context() as patch:
            patch.setattr(script, "get_reform", definitions.__getitem__)
            script.main(str(artifact))
        return json.loads(
            (tmp_path / "attestations" / f"{key}.json").read_text()
        )

    return draft


def test_a_package_reason_names_every_hand_written_member(drafted):
    from uk_budget_data.publication.combine import combined_key

    members = [*HAND_WRITTEN, "badr_lifetime_limit_cut"]
    record = drafted(
        combined_key(members),
        members,
        historical=True,
    )
    for measure_id in HAND_WRITTEN:
        assert measure_id in record["reason"]
    assert "badr_lifetime_limit_cut" not in record["reason"]
    assert (record["checker"], record["second"], record["released_at"]) == (
        "",
        "",
        "",
    )


def test_the_historical_nine_package_reason_names_its_bound_helpers(
    drafted,
):
    from uk_budget_data.publication.combine import combined_key

    members = list(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    key = combined_key(members)
    # Seven released on Budget day, the £2 bus fare cap from 29 October 2026
    # and the savings rates from 11 November 2026 (a parameter change, so the
    # reason does not name them)
    assert key == "combined--f25f6972a09c62a6"
    record = drafted(key, members, historical=True)
    assert record["measure_id"] == key
    assert (
        "hand-written bus_fare_cap_2027 and "
        "carers_allowance_earnings_taper and "
        "domestic_electricity_zero_vat and fuel_duty_rise_deferral and "
        "household_energy_payment_2026 and " in record["reason"]
    )
    assert reforms.STATE_PENSION_ALLOWANCE_ID in record["reason"]
    assert reforms.EMPLOYER_NI_ID not in record["reason"]
    assert record["checker"] == record["second"] == record["released_at"] == ""


def test_the_state_pension_draft_leaves_the_signatures_empty(drafted):
    record = drafted(
        reforms.STATE_PENSION_ALLOWANCE_ID,
        [reforms.STATE_PENSION_ALLOWANCE_ID],
        historical=True,
    )
    assert record["measure_id"] == reforms.STATE_PENSION_ALLOWANCE_ID
    assert "budget_measures.pension_tax_allowance" in record["reason"]
    assert record["checker"] == record["second"] == record["released_at"] == ""


@pytest.mark.parametrize(
    "measure_id", reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
)
def test_native_parameter_identities_never_acquire_a_legacy_reason(
    drafted, measure_id, tmp_path
):
    with pytest.raises(SystemExit, match="no hand-written modifier"):
        drafted(measure_id, [measure_id])
    assert not (tmp_path / "attestations").exists()


def test_a_native_parameter_package_has_no_modifier_attestation(drafted):
    from uk_budget_data.publication.combine import combined_key

    members = list(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    with pytest.raises(SystemExit, match="no hand-written modifier"):
        drafted(combined_key(members), members)


def test_an_unknown_modifier_cannot_borrow_a_known_measures_reason(drafted):
    with pytest.raises(
        SystemExit, match="no drafted reason for this modifier"
    ):
        drafted(
            reforms.BUS_FARE_CAP_ID,
            [reforms.BUS_FARE_CAP_ID],
            historical=True,
            unknown_modifier=True,
        )


def test_a_changed_modifier_identity_is_refused(drafted):
    def tamper(document):
        document["execution_receipt"]["reform"]["reform_sha256"] = "b" * 64

    with pytest.raises(SystemExit, match="modifier identity differs"):
        drafted(
            reforms.BUS_FARE_CAP_ID,
            [reforms.BUS_FARE_CAP_ID],
            historical=True,
            tamper=tamper,
        )


def test_a_claimed_handwritten_proof_cannot_turn_parameters_into_a_modifier(
    drafted,
):
    def tamper(document):
        document["dashboard"]["modifier_templates"] = {
            "baseline": [],
            "reform": [None],
        }

    with pytest.raises(SystemExit, match="no hand-written modifier"):
        drafted(
            reforms.BUS_FARE_CAP_ID, [reforms.BUS_FARE_CAP_ID], tamper=tamper
        )


def test_a_package_cannot_draft_for_tampered_member_identities(drafted):
    from uk_budget_data.publication.combine import combined_key

    def tamper(document):
        document["dashboard"]["members"][0]["reform"]["reform_sha256"] = (
            "b" * 64
        )

    with pytest.raises(SystemExit, match="invalid member composition"):
        members = [reforms.BUS_FARE_CAP_ID, "badr_lifetime_limit_cut"]
        drafted(
            combined_key(members),
            members,
            historical=True,
            tamper=tamper,
        )


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_a_content_bound_opposite_side_cannot_borrow_a_helper_reason(
    side, monkeypatch
):
    from uk_budget_data.budget_measures.pre_budget_vat_on_domestic_electricity import (
        pre_budget_vat_on_domestic_electricity,
    )
    from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
        zero_vat_on_domestic_electricity,
    )

    script = _load_script()
    measure = reforms.get_reform(reforms.ELECTRICITY_VAT_ID).model_copy(
        update={
            "parameter_changes": None,
            "baseline_parameter_changes": None,
            "simulation_modifier": zero_vat_on_domestic_electricity,
            "baseline_simulation_modifier": pre_budget_vat_on_domestic_electricity,
        }
    )
    monkeypatch.setattr(script, "get_reform", lambda _: measure)
    config = DataConfig(years=[2027])
    revision = receipt_module.CodeRevision("a" * 40, True)
    identities = {
        name: receipt_module.scenario_identity(
            scenario, name=name, revision=revision
        ).model_dump(mode="json")
        for name, scenario in (
            ("baseline", measure.baseline_scenario_for(config)),
            ("reform", measure.to_scenario()),
        )
    }
    identities[side].update(binding="content", reform_sha256="b" * 64)
    with pytest.raises(SystemExit, match="modifier identity differs"):
        script._member_reason(measure.id, identities, config, revision)


@pytest.mark.parametrize(
    "wrong_key", [reforms.BUS_FARE_CAP_ID, "combined--unrelated"]
)
def test_a_package_cannot_draft_under_another_key(
    drafted, tmp_path, wrong_key
):
    from uk_budget_data.publication.combine import combined_key

    members = [reforms.PLAN_2_ID, "badr_lifetime_limit_cut"]

    def tamper(document):
        document["dashboard"]["key"] = wrong_key

    with pytest.raises(SystemExit, match="key does not match its members"):
        drafted(combined_key(members), members, historical=True, tamper=tamper)
    assert not (tmp_path / "attestations").exists()
