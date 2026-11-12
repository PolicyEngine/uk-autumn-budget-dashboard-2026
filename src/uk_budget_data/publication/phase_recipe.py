"""Resolve ordered comparisons using the genuine public execution-plan API.

Only trusted job definitions provide callables. Receipt plans remain inert
data, including their module/qualname provenance. This module owns the
dashboard's common-reference and conflict rules, never an identity digest.
"""

import copy

from policyengine_uk.utils.scenario import Scenario

METHOD = "resolved_common_policy_phases/v1"
SINGLE_SCHEMA = "uk-budget-dashboard/policy-comparison/v2"


def ordered_api():
    """Require the actual released API; there is no closure fallback."""
    from uk_budget_data.publication.receipt import ReceiptUnavailable

    try:
        import policyengine.provenance.ordered_scenario as api
    except ImportError as error:
        raise ReceiptUnavailable(
            "ordered pre-Budget comparison",
            "the genuine ordered Scenario API is required before structural publication",
        ) from error
    required = (
        "BoundOrderedScenario",
        "build_ordered_scenario",
        "bind_ordered_scenario_plan",
        "ordered_scenario_reform_identity",
    )
    if not all(hasattr(api, name) for name in required):
        raise ReceiptUnavailable(
            "ordered pre-Budget comparison",
            "the installed ordered Scenario API is incomplete",
        )
    return api


def structural(scenario) -> bool:
    """Whether a native scenario needs actual ordered modifier binding."""
    if scenario is None:
        return False
    return bool(scenario.dated_reforms) or any(
        part is not None and part.simulation_modifier is not None
        for part in scenario.parts_by_data_load()
    )


def _parts(scenario, revision):
    if scenario is None:
        return {}, (), ()
    if scenario.dated_reforms:
        raise ValueError(
            "Dated reforms have no ordered comparison representation"
        )
    before, after = scenario.parts_by_data_load()
    leaves = []
    for part in (before, after):
        if part is not None and part.dated_reforms:
            raise ValueError(
                "Dated reforms have no ordered comparison representation"
            )
        modifier = getattr(part, "simulation_modifier", None)
        leaves.append(
            () if modifier is None else ((modifier, revision.as_binding()),)
        )
    # Native addition canonicalises paths as the actual runtime does.
    changes = (Scenario() + scenario).parameter_changes or {}
    return changes, *leaves


def bare_plan(scenario, revision) -> dict:
    """Bind one raw member delta from its actual trusted native phases."""
    changes, before, after = _parts(scenario, revision)
    return (
        ordered_api()
        .build_ordered_scenario(
            changes, before_modifiers=before, after_modifiers=after
        )
        .plan.model_dump(mode="json")
    )


def _merge_parameters(changes):
    from uk_budget_data.publication.combine import _merge

    merged, owners = {}, {}
    for index, values in enumerate(changes):
        _merge(merged, owners, values, str(index), "ordered comparison")
    return merged


def _with_common(common_changes, changes):
    joined = Scenario(
        parameter_changes=common_changes, applied_before_data_load=True
    ) + Scenario(parameter_changes=changes)
    before, after = joined.parts_by_data_load()
    if after is not None:
        raise ValueError("Resolved parameters acquired a late phase")
    return before.parameter_changes or {}


def bind_comparison(sources, *, name):
    """Build the exact executable plan, common once then ordered raw leaves.

    ``sources`` is an ordered sequence of (actual Scenario, CodeRevision)
    pairs supplied by the trusted planner or worker, never by a receipt.
    """
    from uk_budget_data.budget_policy import pre_budget_policy_changes

    parts = [_parts(scenario, revision) for scenario, revision in sources]
    changes = _merge_parameters([part[0] for part in parts])
    return ordered_api().build_ordered_scenario(
        _with_common(pre_budget_policy_changes(), changes),
        before_modifiers=tuple(leaf for part in parts for leaf in part[1]),
        after_modifiers=tuple(leaf for part in parts for leaf in part[2]),
        name=name,
    )


def resolve_plan(common, deltas) -> dict:
    """Reconstruct a complete plan from data only; never resolve locators."""
    from uk_budget_data.publication.receipt import (
        _decoded_parameters,
        _encoded_parameters,
    )

    api = ordered_api()
    if not deltas:
        raise ValueError(
            "An ordered recipe needs its explicit raw member plans"
        )
    # The official parser checks the closed shape and each inert leaf.
    for delta in deltas:
        api.ordered_scenario_reform_identity(delta)
    result = copy.deepcopy(deltas[0])
    if any(
        delta["adapter_source_sha256"] != result["adapter_source_sha256"]
        for delta in deltas
    ):
        raise ValueError("Ordered members name different execution adapters")
    merged = _merge_parameters(
        [
            _decoded_parameters(delta["before"]["parameter_changes"])
            for delta in deltas
        ]
    )
    result["before"]["parameter_changes"] = _encoded_parameters(
        _with_common(_decoded_parameters(common["parameter_changes"]), merged)
    )
    for phase in ("before", "after"):
        result[phase]["modifier_leaves"] = [
            copy.deepcopy(leaf)
            for delta in deltas
            for leaf in delta[phase]["modifier_leaves"]
        ]
    api.ordered_scenario_reform_identity(result)
    return result


def bound_native_scenario(value):
    """Unwrap only the genuine live-checked public type, never a flag."""
    try:
        from policyengine.provenance.ordered_scenario import (
            BoundOrderedScenario,
        )
    except ImportError:
        return None
    if type(value) is not BoundOrderedScenario:
        return None
    value.recheck()
    return value.scenario


def leaf_counts(document):
    """Count occurrences from validated effective ordered plans, or None."""
    dashboard = document.get("dashboard") or {}
    recipe = (
        dashboard.get("composition")
        or dashboard.get("policy_comparison")
        or {}
    )
    if not isinstance(recipe, dict):
        return None
    if (
        recipe.get("method") != METHOD
        and recipe.get("schema") != SINGLE_SCHEMA
    ):
        return None
    api = ordered_api()
    result = {}
    for side in ("baseline", "reform"):
        plan = recipe[f"{side}_plan"]
        api.ordered_scenario_reform_identity(plan)
        result[side] = sum(
            len(plan[phase]["modifier_leaves"])
            for phase in ("before", "after")
        )
    return result
