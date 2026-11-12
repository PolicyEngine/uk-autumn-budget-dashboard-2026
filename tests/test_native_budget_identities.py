"""The execution identity binds the shared reference once and actual policy.

No population data or estimates: these exercise the released identity API
and the runtime's parameter-scenario assembly.
"""

import copy
import json
from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import budget_policy, definitions, reforms
from uk_budget_data.forecast import with_forecast
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication import receipt
from uk_budget_data.publication.combine import combine_measures, member_order
from uk_budget_data.publication.generate import (
    _combined_run_identities,
    _config_baseline_identity,
    _run_identities,
)

REVISION = receipt.CodeRevision("a" * 40, tree_clean=True)


def _json(identity):
    return identity.model_dump(mode="json")


def _core(identity):
    return receipt._identity_core(_json(identity))


def _combined_document(config=None):
    config = config or DataConfig()
    members = member_order(
        [
            reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID),
            reforms.get_reform(reforms.HOUSEHOLD_ENERGY_PAYMENT_ID),
        ]
    )
    combined = combine_measures(members, config)
    baseline, reform, records, composition = _combined_run_identities(
        combined, members, config, REVISION, True
    )
    return (
        {
            "dashboard": {
                "members": records,
                "composition": composition,
                "config_baseline": _json(
                    _config_baseline_identity(config, REVISION)
                ),
            },
            "execution_receipt": {
                "model": {"version": "2.174.1"},
                "baseline": _json(baseline),
                "reform": _json(reform),
            },
        },
        combined,
        members,
    )


def test_single_binds_the_actual_shared_pre_budget_reference():
    reform = reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID)
    baseline, after = receipt.measure_identities(
        reform, DataConfig(), REVISION
    )
    assert baseline.kind == "reform"
    assert _core(baseline) == _core(
        receipt.scenario_identity(
            with_forecast(None), name="actual baseline", revision=REVISION
        )
    )
    assert _core(after) == _core(
        receipt.scenario_identity(
            with_forecast(reform.to_scenario()),
            name="actual reform",
            revision=REVISION,
        )
    )
    assert receipt.comparison_scenario(
        reform.to_scenario()
    ).applied_before_data_load


def test_pre_budget_record_mutation_changes_both_affected_identities(
    monkeypatch,
):
    reform = reforms.get_reform(reforms.HOUSEHOLD_ENERGY_PAYMENT_ID)
    before = receipt.measure_identities(reform, DataConfig(), REVISION)
    changed = budget_policy.policy_record()
    path = "gov.hmrc.income_tax.rates.property.basic"
    changed["measures"][reforms.PROPERTY_INCOME_RATES_ID]["paths"][path][
        "pre_budget_values"
    ]["2027-04-06"] = 0.21
    monkeypatch.setattr(
        budget_policy, "_stored_record", lambda: copy.deepcopy(changed)
    )
    after = receipt.measure_identities(reform, DataConfig(), REVISION)
    assert all(_core(old) != _core(new) for old, new in zip(before, after))


def test_api_definition_uses_the_same_effective_identity_pair():
    measure_id = reforms.PROPERTY_INCOME_RATES_ID
    definitions._definition.cache_clear()
    actual = definitions.measure_definition(measure_id, REVISION.git_sha)
    baseline, reform = receipt.measure_identities(
        reforms.get_reform(measure_id), DataConfig(), REVISION
    )
    assert actual["baseline"] == definitions.identity_core(baseline)
    assert actual["reform"] == definitions.identity_core(reform)


def test_configured_parameter_baseline_keeps_the_common_reference():
    config = DataConfig(
        baseline_parameter_changes={
            reforms.PERSONAL_ALLOWANCE: {"2027": 13_000}
        }
    )
    identity = _config_baseline_identity(config, REVISION)
    actual = with_forecast(config.get_baseline_scenario())
    assert (
        actual.parameter_changes[reforms.PERSONAL_ALLOWANCE]["2027"] == 13_000
    )
    assert (
        "gov.hmrc.income_tax.rates.property.basic" in actual.parameter_changes
    )
    assert _core(identity) == _core(
        receipt.scenario_identity(actual, name="configured", revision=REVISION)
    )


def test_combined_resolves_the_reference_once_then_bare_member_deltas():
    document, combined, _ = _combined_document()
    composition = document["dashboard"]["composition"]
    assert composition["method"] == receipt.RESOLVED_COMMON_POLICY
    assert set(composition) == {
        "method",
        "common_policy_reference",
        "baseline_applied_before_data_load",
        "reform_applied_before_data_load",
    }
    assert receipt.composition_problems(document) == []
    assert receipt._comparison_metadata_problems(document) == []
    actual = receipt.scenario_identity(
        with_forecast(combined.to_scenario()), name="actual", revision=REVISION
    )
    assert receipt._identity_core(
        document["execution_receipt"]["reform"]
    ) == _core(actual)
    members = document["dashboard"]["members"]
    assert [member["baseline_bound"] for member in members] == [True, False]
    assert all(
        member["baseline_delta"]["parameter_changes"] is None
        for member in members
    )
    assert all(
        member["reform_delta"]["parameter_changes"] for member in members
    )


@given(
    st.lists(
        st.sampled_from(tuple(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)),
        unique=True,
        min_size=1,
        max_size=3,
    )
)
@settings(max_examples=10, deadline=None)
def test_any_native_combination_identity_matches_the_actual_assembled_scenario(
    ids,
):
    members = member_order(
        [reforms.get_reform(measure_id) for measure_id in ids]
    )
    config = DataConfig()
    combined = combine_measures(members, config)
    baseline, after, _, _ = _combined_run_identities(
        combined, members, config, REVISION, True
    )
    for identity, scenario in (
        (baseline, combined.baseline_scenario_for(config, True)),
        (after, combined.to_scenario()),
    ):
        actual = receipt.scenario_identity(
            with_forecast(scenario), name="actual", revision=REVISION
        )
        assert _core(identity) == _core(actual)


def test_reapplying_effective_members_is_not_an_accepted_recipe():
    document, _, _ = _combined_document()
    api, _ = receipt.receipt_api()
    wrong = api.composed_reform_identity(
        [
            api.ReformIdentity.model_validate(member["reform"])
            for member in document["dashboard"]["members"]
        ],
        applied_before_data_load=True,
    )
    document["execution_receipt"]["reform"] = _json(wrong)
    assert any(
        "resolved common reference" in problem
        for problem in receipt.composition_problems(document)
    )


@pytest.mark.parametrize(
    "mutation",
    ["record_digest", "reference_identity", "member_delta", "phase", "method"],
)
def test_common_reference_recipe_rejects_tampering(mutation):
    document, _, _ = _combined_document()
    composition = document["dashboard"]["composition"]
    if mutation == "record_digest":
        composition["common_policy_reference"]["policy_record_sha256"] = (
            "b" * 64
        )
    elif mutation == "reference_identity":
        composition["common_policy_reference"]["identity"]["reform_sha256"] = (
            "b" * 64
        )
    elif mutation == "member_delta":
        member = document["dashboard"]["members"][0]
        member["reform_delta"]["parameter_changes"] = {}
    elif mutation == "phase":
        composition["reform_applied_before_data_load"] = False
    else:
        composition["method"] = "unknown/v1"
    assert receipt.composition_problems(document)


def test_a_stale_source_record_invalidates_an_existing_new_recipe(monkeypatch):
    document, _, _ = _combined_document()
    changed = budget_policy.policy_record()
    changed["comparison"] += " Updated attribution."
    monkeypatch.setattr(
        budget_policy, "_stored_record", lambda: copy.deepcopy(changed)
    )
    assert any(
        "source record differs" in problem
        for problem in receipt.composition_problems(document)
    )


def test_single_recipe_is_reconstructed_and_does_not_accept_a_bare_identity():
    reform = reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID)
    baseline, own = receipt.measure_identities(reform, DataConfig(), REVISION)
    document = {
        "dashboard": {
            "policy_comparison": receipt.comparison_metadata(
                reform, DataConfig(), REVISION
            )
        },
        "execution_receipt": {
            "model": {"version": "2.174.1"},
            "baseline": _json(baseline),
            "reform": _json(own),
        },
    }
    assert receipt._comparison_metadata_problems(document) == []
    document["execution_receipt"]["baseline"] = _json(
        receipt.scenario_identity(None, name="bare", revision=REVISION)
    )
    assert receipt._comparison_metadata_problems(document)


def test_configured_baseline_is_still_shared_once_in_combined_recipe():
    config = DataConfig(
        baseline_parameter_changes={
            reforms.PERSONAL_ALLOWANCE: {"2027": 13_000}
        }
    )
    document, _, _ = _combined_document(config)
    assert receipt.composition_problems(document) == []
    bound = [
        member
        for member in document["dashboard"]["members"]
        if member["baseline_bound"]
    ]
    assert len(bound) == 1


def test_cash_isa_baseline_modifier_is_refused_until_phases_can_be_bound():
    cash = reforms.get_reform(reforms.CASH_ISA_LIMIT_ID)
    assert cash.baseline_simulation_modifier is not None
    with pytest.raises(
        receipt.ReceiptUnavailable, match="phased or structural"
    ):
        receipt.measure_identities(cash, DataConfig(), REVISION)


def test_legacy_composition_is_valid_without_a_new_common_reference():
    api, _ = receipt.receipt_api()
    current = receipt.scenario_identity(
        None, name="legacy baseline", revision=REVISION
    )
    own = receipt.scenario_identity(
        Scenario(
            parameter_changes={reforms.PERSONAL_ALLOWANCE: {"2027": 13_000}}
        ),
        name="legacy delta",
        revision=REVISION,
    )
    document = {
        "dashboard": {
            "members": [
                {
                    "id": "legacy",
                    "baseline": _json(current),
                    "reform": _json(own),
                    "baseline_bound": True,
                }
            ],
            "composition": {
                "baseline_applied_before_data_load": False,
                "reform_applied_before_data_load": False,
            },
        },
        "execution_receipt": {
            # Synthetic historical metadata: no published dashboard
            # artifact used the new native model with this old recipe.
            "model": {"version": "2.165.1"},
            "wrapper": {"version": "6.16.2"},
            "baseline": _json(
                api.composed_reform_identity(
                    [current], applied_before_data_load=False
                )
            ),
            "reform": _json(
                api.composed_reform_identity(
                    [own], applied_before_data_load=False
                )
            ),
        },
    }
    assert receipt.composition_problems(document) == []


def test_native_single_cannot_delete_its_recipe_and_policy_label():
    document = {
        "dashboard": {"basis": {}},
        "execution_receipt": {
            "model": {"version": "2.174.1"},
            "wrapper": {"version": "6.17.2"},
        },
    }
    assert receipt._comparison_metadata_problems(document) == [
        "its native execution model requires an explicit common-policy comparison"
    ]


def test_native_combined_cannot_delete_its_recipe_and_policy_label():
    document, _, _ = _combined_document()
    composition = document["dashboard"]["composition"]
    del composition["method"]
    del composition["common_policy_reference"]
    document["dashboard"]["basis"] = {}
    assert receipt.composition_problems(document) == [
        "its native execution model requires the resolved common-policy composition"
    ]


def test_historical_single_keeps_its_original_identity_contract():
    assert (
        receipt._comparison_metadata_problems(
            {
                "dashboard": {},
                "execution_receipt": {
                    "model": {"version": "2.165.1"},
                    "wrapper": {"version": "6.16.2"},
                },
            }
        )
        == []
    )


def test_worker_refuses_a_changed_common_policy_record():
    reform = Reform(
        id="test",
        name="Test",
        parameter_changes={reforms.PERSONAL_ALLOWANCE: {"2027": 13_000}},
    )
    job = SimpleNamespace(
        common_policy_reference={"changed": True},
        revision=REVISION,
        key="test",
    )
    with pytest.raises(
        receipt.ReceiptUnavailable, match="common policy reference changed"
    ):
        _run_identities(job, reform, None)


def test_worker_reconstructs_the_same_single_and_combined_identities():
    config = DataConfig()
    own = reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID)
    expected = receipt.measure_identities(own, config, REVISION)
    job = SimpleNamespace(
        common_policy_reference=receipt.common_policy_reference(REVISION),
        config=config,
        revision=REVISION,
        key=own.id,
        identities=tuple(_json(identity) for identity in expected),
    )
    assert tuple(
        _core(identity) for identity in _run_identities(job, own, None)
    ) == tuple(_core(identity) for identity in expected)
    document, combined, members = _combined_document(config)
    job.key = combined.id
    job.identities = tuple(
        document["execution_receipt"][side] for side in ("baseline", "reform")
    )
    job.composition = document["dashboard"]["composition"]
    job.members = document["dashboard"]["members"]
    job.uses_config_baseline = True
    job.member_revisions = None
    assert (
        tuple(
            _json(identity)
            for identity in _run_identities(job, combined, members)
        )
        == job.identities
    )


def test_metadata_encodes_infinite_parameters_as_strict_json():
    encoded = receipt._encoded_parameters({"path": {"2027": float("inf")}})
    assert json.loads(json.dumps(encoded, allow_nan=False)) == encoded
    assert receipt._decoded_parameters(encoded)["path"]["2027"] == float("inf")
