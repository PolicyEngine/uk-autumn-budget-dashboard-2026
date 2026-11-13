"""Active ordered structural comparison contracts; no population data.

The installed release must refuse unavailable capabilities. Positive cases
require the genuine API; source experiments run these against its actual
recorded proposal source, never a substitute identity implementation.
"""

import copy
import sys
from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation

from tests import ordered_phase_measures as modifiers
from uk_budget_data import budget_policy, reforms
from uk_budget_data.forecast import with_forecast
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication import receipt, template_proof
from uk_budget_data.publication.combine import (
    CombineInconsistent,
    combine_measures,
    member_order,
)
from uk_budget_data.publication.generate import _run_identities

REVISION = receipt.CodeRevision("a" * 40, True)
CONFIG = DataConfig(years=[2027])


def members():
    return member_order(
        [
            Reform(
                id="a",
                name="A",
                simulation_modifier=modifiers.before_add,
                applied_before_data_load=True,
            ),
            Reform(
                id="b",
                name="B",
                simulation_modifier=modifiers.before_multiply,
                applied_before_data_load=True,
            ),
            Reform(id="c", name="C", simulation_modifier=modifiers.after_add),
            Reform(
                id="d", name="D", simulation_modifier=modifiers.after_multiply
            ),
        ]
    )


def document():
    executions, records, composition = receipt.combined_execution(
        members(), CONFIG, REVISION
    )
    result = {
        "dashboard": {
            "members": records,
            "composition": composition,
            "config_baseline": receipt.comparison_identity(
                None, name="configured baseline", revision=REVISION
            ).model_dump(mode="json"),
        },
        "execution_receipt": {
            "model": {"version": "2.174.1"},
            **{
                side: execution.identity.model_dump(mode="json")
                for side, execution in zip(("baseline", "reform"), executions)
            },
        },
    }
    return result, executions


def test_default_reform_modifier_timing_remains_after_data_load():
    reform = Reform(
        id="test", name="Test", simulation_modifier=modifiers.after_add
    )
    assert reform.applied_before_data_load is False
    assert reform.baseline_applied_before_data_load is False
    assert reform.to_scenario().applied_before_data_load is False


def test_old_definitions_default_late_and_explicit_custom_baseline_timing_survives():
    old = Reform.model_validate(
        {"id": "old", "name": "Old", "parameter_changes": {}}
    )
    assert old.to_scenario().applied_before_data_load is False
    reform = old.model_copy(
        update={
            "simulation_modifier": modifiers.before_add,
            "applied_before_data_load": True,
            "baseline_simulation_modifier": modifiers.before_multiply,
            "baseline_parameter_changes": {},
            "baseline_applied_before_data_load": True,
        }
    )
    assert reform.to_scenario().applied_before_data_load is True
    assert (
        reform.baseline_scenario_for(CONFIG).applied_before_data_load is True
    )
    restored = Reform.model_validate(reform.model_dump())
    assert (
        restored.baseline_scenario_for(CONFIG).simulation_modifier
        is modifiers.before_multiply
    )
    assert (
        restored.baseline_scenario_for(CONFIG).applied_before_data_load is True
    )


def test_missing_genuine_ordered_api_refuses_instead_of_flattening(
    monkeypatch,
):
    monkeypatch.setitem(
        sys.modules, "policyengine.provenance.ordered_scenario", None
    )
    with pytest.raises(receipt.ReceiptUnavailable, match="ordered.*API"):
        receipt.combined_execution(members(), CONFIG, REVISION)


def test_native_nine_parameter_identities_keep_their_existing_contract():
    assert len(reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS) == 9
    for key in reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS:
        reform = reforms.get_reform(key)
        assert reform.simulation_modifier is None
        assert reform.baseline_simulation_modifier is None
        actual = receipt.measure_identities(reform, CONFIG, REVISION)
        for identity, raw in zip(
            actual,
            (reform.baseline_scenario_for(CONFIG), reform.to_scenario()),
        ):
            expected = receipt.scenario_identity(
                with_forecast(raw), name="old", revision=REVISION
            )
            assert receipt._identity_core(
                identity.model_dump(mode="json")
            ) == receipt._identity_core(expected.model_dump(mode="json"))


def test_multiple_modifiers_per_phase_execute_in_order_without_flattening():
    data, executions = document()
    assert receipt.composition_problems(data) == []
    bound = executions[1].runtime
    actual = with_forecast(bound)
    before, after = actual.parts_by_data_load()
    assert before is not None and after is not None
    assert before.applied_before_data_load is True
    assert after.applied_before_data_load is False
    assert (
        before.parameter_changes == budget_policy.pre_budget_policy_changes()
    )
    sim = Simulation(
        situation={
            "people": {"person": {"age": {2027: 40}}},
            "benunits": {"benunit": {"members": ["person"]}},
            "households": {"household": {"members": ["person"]}},
        },
        scenario=actual,
    )
    assert sim.ordered_events == (
        "before_add",
        "before_multiply",
        "after_add",
        "after_multiply",
    )
    assert sim.ordered_value == 20
    assert template_proof.modifier_counts(data) == {"baseline": 0, "reform": 4}


def test_native_ordered_recipe_rebuild_is_data_only_and_rejects_tampering(
    monkeypatch,
):
    data, _ = document()
    import importlib

    def refuse_import(name, *args, **kwargs):
        raise AssertionError(f"receipt must not import a locator: {name}")

    monkeypatch.setattr(importlib, "import_module", refuse_import)
    assert receipt.composition_problems(data) == []
    changed = copy.deepcopy(data)
    changed["dashboard"]["members"][0]["reform_delta"]["before"][
        "modifier_leaves"
    ][0]["module"] = "nonexistent_receipt_locator"
    assert receipt.composition_problems(changed)


def test_ordered_worker_rebinds_live_sources_and_common_reference():
    data, _ = document()
    ordered = members()
    combined = combine_measures(ordered, CONFIG)
    job = SimpleNamespace(
        common_policy_reference=receipt.common_policy_reference(REVISION),
        key=combined.id,
        config=CONFIG,
        revision=REVISION,
        identities=tuple(
            data["execution_receipt"][side] for side in ("baseline", "reform")
        ),
        composition=data["dashboard"]["composition"],
        members=data["dashboard"]["members"],
        uses_config_baseline=True,
        member_revisions=None,
    )
    actual = _run_identities(job, combined, ordered)
    assert (
        tuple(identity.model_dump(mode="json") for identity in actual)
        == job.identities
    )
    job.common_policy_reference = {"changed": True}
    with pytest.raises(
        receipt.ReceiptUnavailable, match="common policy reference changed"
    ):
        _run_identities(job, combined, ordered)


def test_private_area_binding_keeps_actual_member_revisions_and_refuses_changes():
    ordered = members()
    combined = combine_measures(ordered, CONFIG)
    revisions = {
        member.id: receipt.CodeRevision(str(index + 1) * 40, True)
        for index, member in enumerate(ordered)
    }
    binding = receipt.execution_binding(
        combined, CONFIG, REVISION, members=ordered, member_revisions=revisions
    )
    actual = receipt.rebind_execution(
        combined, CONFIG, binding, members=ordered
    )
    assert [
        execution.identity.model_dump(mode="json") for execution in actual
    ] == binding["identities"]
    leaves = binding["composition"]["reform_plan"]
    assert [
        leaf["code_revision"]["git_sha"]
        for phase in ("before", "after")
        for leaf in leaves[phase]["modifier_leaves"]
    ] == [str(index + 1) * 40 for index in range(4)]
    changed = copy.deepcopy(binding)
    changed["identities"][1]["reform_sha256"] = "f" * 64
    with pytest.raises(receipt.ReceiptUnavailable, match="changed since"):
        receipt.rebind_execution(combined, CONFIG, changed, members=ordered)
    changed = copy.deepcopy(binding)
    changed["revision"]["git_sha"] = receipt.DEFINITION_REVISION.git_sha
    with pytest.raises(
        receipt.ReceiptUnavailable, match="actual approved revision"
    ):
        receipt.rebind_execution(combined, CONFIG, changed, members=ordered)


def test_area_executes_the_carried_live_plan_without_git_or_an_extra_rollback(
    monkeypatch,
):
    from uk_budget_data import geography

    ordered = members()
    combined = combine_measures(ordered, CONFIG).model_copy(
        update={"id": "synthetic_phases"}
    )
    lookup = {member.id: member for member in ordered}
    lookup[combined.id] = combined
    monkeypatch.setattr(
        geography,
        "PACKAGES",
        {combined.id: tuple(member.id for member in ordered)},
    )
    monkeypatch.setattr(geography, "get_reform", lookup.get)
    monkeypatch.setattr(
        geography,
        "build_microsimulation",
        lambda dataset, scenario=None: Simulation(
            situation={
                "people": {"p": {"age": {2027: 40}}},
                "benunits": {"b": {"members": ["p"]}},
                "households": {"h": {"members": ["p"]}},
            },
            scenario=with_forecast(scenario),
        ),
    )
    binding = receipt.execution_binding(
        combined, CONFIG, REVISION, members=ordered
    )
    monkeypatch.setattr(
        receipt,
        "code_revision",
        lambda *args: pytest.fail("worker must use its carried revision"),
    )
    checks = []
    _, actual = geography.simulate_reform(
        combined,
        None,
        [2027],
        execution_binding=binding,
        execution_checks=checks,
    )
    assert actual.ordered_value == 20
    assert len(checks) == 3
    for check in checks:
        check()


def test_generic_combination_retains_declared_native_phases():
    combined = combine_measures(members(), CONFIG)
    before, after = combined.to_scenario().parts_by_data_load()
    assert before is not None and after is not None
    sim = SimpleNamespace()
    before.simulation_modifier(sim)
    after.simulation_modifier(sim)
    assert sim.ordered_value == 20


def test_phased_combination_refuses_stale_public_definition_updates():
    combined = combine_measures(members(), CONFIG)
    changed = combined.model_copy(
        update={"parameter_changes": {"synthetic.changed": {"2027": 1}}}
    )
    with pytest.raises(
        CombineInconsistent, match="rebuild it from its members"
    ):
        changed.to_scenario()


def test_reference_is_applied_once_before_disjoint_native_restorations():
    selected = member_order(
        [
            reforms.get_reform(reforms.PROPERTY_INCOME_RATES_ID),
            reforms.get_reform(reforms.HOUSEHOLD_ENERGY_PAYMENT_ID),
            Reform(
                id="structural",
                name="Structural",
                simulation_modifier=modifiers.after_add,
            ),
        ]
    )
    executions, records, composition = receipt.combined_execution(
        selected, CONFIG, REVISION
    )
    expected = with_forecast(combine_measures(selected, CONFIG).to_scenario())
    before, _ = expected.parts_by_data_load()
    actual = executions[1].runtime.plan.model_dump(mode="json")
    assert actual["before"][
        "parameter_changes"
    ] == receipt._encoded_parameters(before.parameter_changes)
    assert len(actual["after"]["modifier_leaves"]) == 1
    data = {
        "dashboard": {
            "members": records,
            "composition": composition,
            "config_baseline": receipt.comparison_identity(
                None, name="configured", revision=REVISION
            ).model_dump(mode="json"),
        },
        "execution_receipt": {
            "model": {"version": "2.174.1"},
            **{
                side: execution.identity.model_dump(mode="json")
                for side, execution in zip(("baseline", "reform"), executions)
            },
        },
    }
    assert receipt.composition_problems(data) == []
    changed = copy.deepcopy(data)
    changed["dashboard"]["members"][-1]["reform_delta"] = copy.deepcopy(
        changed["dashboard"]["members"][0]["reform_delta"]
    )
    assert receipt.composition_problems(changed)


def test_repeated_modifier_occurrences_keep_separate_proofs_and_runtime_calls():
    selected = [
        Reform(id=key, name=key, simulation_modifier=modifiers.after_add)
        for key in ("a", "b")
    ]
    executions, records, composition = receipt.combined_execution(
        selected, CONFIG, REVISION
    )
    data = {
        "dashboard": {"members": records, "composition": composition},
        "execution_receipt": {},
    }
    assert template_proof.modifier_counts(data) == {"baseline": 0, "reform": 2}
    assert template_proof.combined_templates_proof(
        selected, CONFIG, REVISION
    ) == {"baseline": [], "reform": [None, None]}
    _, after = with_forecast(executions[1].runtime).parts_by_data_load()
    sim = SimpleNamespace()
    after.simulation_modifier(sim)
    assert sim.ordered_value == 6


def replace_one_boolean_with_number(value):
    """A strict JSON-type tamper that ordinary Python equality conceals."""
    if isinstance(value, dict):
        for key, item in value.items():
            if type(item) is bool:
                value[key] = int(item)
                return True
            if replace_one_boolean_with_number(item):
                return True
    elif isinstance(value, list):
        return any(replace_one_boolean_with_number(item) for item in value)
    return False


def test_effective_plan_rejects_boolean_number_substitution():
    data, _ = document()
    changes = data["dashboard"]["composition"]["reform_plan"]["before"][
        "parameter_changes"
    ]
    assert replace_one_boolean_with_number(changes)
    assert receipt.composition_problems(data)


def test_private_plan_rejects_boolean_number_substitution():
    ordered = members()
    combined = combine_measures(ordered, CONFIG)
    binding = receipt.execution_binding(
        combined, CONFIG, REVISION, members=ordered
    )
    assert replace_one_boolean_with_number(
        binding["composition"]["reform_plan"]["before"]["parameter_changes"]
    )
    with pytest.raises(receipt.ReceiptUnavailable, match="changed since"):
        receipt.rebind_execution(combined, CONFIG, binding, members=ordered)


def test_ordered_composition_cannot_drop_members_and_relabel_model_historical():
    data, _ = document()
    data["dashboard"]["members"] = []
    data["execution_receipt"]["model"]["version"] = "2.165.1"
    assert receipt.composition_problems(data)
    assert receipt._comparison_metadata_problems(data)


def test_national_worker_rejects_typed_carried_plan_tampering():
    data, _ = document()
    ordered = members()
    combined = combine_measures(ordered, CONFIG)
    job = SimpleNamespace(
        common_policy_reference=receipt.common_policy_reference(REVISION),
        key=combined.id,
        config=CONFIG,
        revision=REVISION,
        identities=tuple(
            data["execution_receipt"][side] for side in ("baseline", "reform")
        ),
        composition=data["dashboard"]["composition"],
        members=data["dashboard"]["members"],
        uses_config_baseline=True,
        member_revisions=None,
    )
    assert replace_one_boolean_with_number(
        job.composition["reform_plan"]["before"]["parameter_changes"]
    )
    with pytest.raises(
        receipt.ReceiptUnavailable, match="combined policy recipe changed"
    ):
        _run_identities(job, combined, ordered)


def test_raw_definition_edits_cannot_hide_behind_a_resolved_parameter_map():
    path = "gov.hmrc.income_tax.rates.uk[0].rate"
    reform = Reform(
        id="raw",
        name="Raw",
        parameter_changes={path: {"2027": 0.21}},
        simulation_modifier=modifiers.after_add,
    )
    original = receipt.measure_execution(reform, CONFIG, REVISION)
    job = SimpleNamespace(
        common_policy_reference=receipt.common_policy_reference(REVISION),
        key=reform.id,
        config=CONFIG,
        revision=REVISION,
        identities=tuple(
            execution.identity.model_dump(mode="json")
            for execution in original
        ),
    )
    reform.parameter_changes[path]["2027"] = 0.22
    with pytest.raises(
        receipt.ReceiptUnavailable, match="measure changed after its identity"
    ):
        _run_identities(job, reform, None)


def test_custom_structural_baselines_repeat_while_configured_parameters_apply_once():
    path = "gov.hmrc.income_tax.rates.uk[0].rate"
    config = DataConfig(
        years=[2027], baseline_parameter_changes={path: {"2027": 0.21}}
    )
    selected = [
        Reform(
            id=key,
            name=key,
            baseline_simulation_modifier=modifiers.before_add,
            baseline_applied_before_data_load=True,
        )
        for key in ("a", "b")
    ] + [Reform(id=key, name=key) for key in ("c", "d")]
    executions, records, composition = receipt.combined_execution(
        selected, config, REVISION
    )
    assert [record["baseline_bound"] for record in records] == [
        True,
        True,
        True,
        False,
    ]
    plan = executions[0].runtime.plan.model_dump(mode="json")
    assert plan["before"]["parameter_changes"][path] == {"2027": 0.21}
    assert len(plan["before"]["modifier_leaves"]) == 2
    before, after = with_forecast(executions[0].runtime).parts_by_data_load()
    assert after is None
    sim = SimpleNamespace()
    before.simulation_modifier(sim)
    assert sim.ordered_value == 2
    dashboard = {
        "members": records,
        "composition": composition,
        "config_baseline": receipt.comparison_identity(
            config.get_baseline_scenario(),
            name="configured",
            revision=REVISION,
        ).model_dump(mode="json"),
    }
    data = {
        "dashboard": dashboard,
        "execution_receipt": {
            "model": {"version": "2.174.1"},
            **{
                side: execution.identity.model_dump(mode="json")
                for side, execution in zip(("baseline", "reform"), executions)
            },
        },
    }
    assert receipt.composition_problems(data) == []
    records[1]["baseline_bound"] = False
    assert receipt._shared_baseline_problems(dashboard, records)


@settings(max_examples=5, deadline=None)
@given(st.permutations((0, 1, 2, 3)))
def test_member_input_order_does_not_change_canonical_phase_execution(order):
    ordered = members()
    expected, records, composition = receipt.combined_execution(
        ordered, CONFIG, REVISION
    )
    actual, shuffled_records, shuffled_composition = (
        receipt.combined_execution(
            [ordered[index] for index in order], CONFIG, REVISION
        )
    )
    assert [item.identity.model_dump(mode="json") for item in actual] == [
        item.identity.model_dump(mode="json") for item in expected
    ]
    assert shuffled_records == records
    assert shuffled_composition == composition
