"""Archived, synthetic single-phase publication comparison for old area tests.

Only dedicated compatibility fixtures opt in through World(historical=True,
archived_pipeline=True). This recreates the former comparison assembly, not
historical model calculations or real certification. Active structural
execution uses the genuine ordered-plan API; these fixtures recreate the
older bare-Scenario interfaces only within this explicit test context.

The legacy composer below is copied verbatim from the reviewed dashboard
source at 683dd8c2330d0e7fe018dda0d3696500130d7434.
"""

import json
from functools import partial
from typing import Mapping, Optional
from unittest.mock import patch

from uk_budget_data import forecast
from uk_budget_data.models import DataConfig
from uk_budget_data.publication import combine, generate, receipt
from uk_budget_data.publication.receipt import (
    CodeRevision,
    ReceiptUnavailable,
    is_code_defect,
    measure_identities,
    receipt_api,
)

ARCHIVED_SOURCE_COMMIT = "683dd8c2330d0e7fe018dda0d3696500130d7434"
ARCHIVED_COMPOSER_SHA256 = (
    "3248afac82df340d762530fea4f77b5ccbf75f0296e2207ad29436b9a6ca8fcc"
)


# fmt: off
def combined_identities(
    members,
    config,
    revision: CodeRevision,
    *,
    reform_applied_before_data_load: bool,
    baseline_applied_before_data_load: bool,
    member_revisions: Optional[Mapping[str, CodeRevision]] = None,
):
    """The (baseline, reform) identities of a combined run, its members and
    how they were composed.

    Each side is the ordered composition of the members' own identities,
    bound with the phase (before or after data load) that side's combined
    Scenario runs in. ``members`` must already be in application order.

    Each member record says whether its baseline is one of the composed
    baselines (``baseline_bound``), and the returned ``composition`` gives
    each side's phase, so the gate can rebuild both identities from the
    records alone (:func:`composition_problems`).

    A member in ``member_revisions`` is bound at that revision, the one its
    own receipt was made at (:func:`approved_revision`), so its record is
    the identity that receipt holds; the others are bound at ``revision``.
    """
    api, _ = receipt_api()
    baselines, reforms, records = [], [], []
    configured_included = False
    for member in members:
        baseline, reform = measure_identities(
            member, config, (member_revisions or {}).get(member.id, revision)
        )
        # Members without a baseline of their own share the configured one,
        # which the combined run applies once, so it is bound once.
        bound = member.has_custom_baseline() or not configured_included
        if bound:
            baselines.append(baseline)
            configured_included |= not member.has_custom_baseline()
        reforms.append(reform)
        records.append(
            {
                "id": member.id,
                "baseline": json.loads(baseline.model_dump_json()),
                "reform": json.loads(reform.model_dump_json()),
                "baseline_bound": bound,
            }
        )
    name = "+".join(member.id for member in members)
    composition = {
        "reform_applied_before_data_load": reform_applied_before_data_load,
        "baseline_applied_before_data_load": (
            baseline_applied_before_data_load
        ),
    }
    try:
        return (
            api.composed_reform_identity(
                baselines,
                applied_before_data_load=baseline_applied_before_data_load,
                name=f"{name} baseline",
            ),
            api.composed_reform_identity(
                reforms,
                applied_before_data_load=reform_applied_before_data_load,
                name=name,
            ),
            records,
            composition,
        )
    except (api.ReceiptError, ValueError) as error:
        if is_code_defect(error):
            raise
        raise ReceiptUnavailable(name, str(error)) from error
# fmt: on


def bare_scenario(scenario):
    return scenario


def bare_identity(scenario, *, name, revision):
    return receipt.scenario_identity(scenario, name=name, revision=revision)


def absent_reference(*args, **kwargs):
    return None


def bare_measure_execution(reform, config, revision):
    """The archived bare identities paired with their actual raw Scenarios."""
    identities = receipt.measure_identities(reform, config, revision)
    scenarios = (reform.baseline_scenario_for(config), reform.to_scenario())
    return tuple(
        receipt.ComparisonExecution(identity, scenario)
        for identity, scenario in zip(identities, scenarios)
    )


def archived_combined_run_identities(
    combined,
    ordered,
    config,
    revision,
    uses_config,
    member_revisions=None,
):
    """683dd8c's native phase arguments and exact vendored composer."""
    baseline = combined.baseline_scenario_for(config, uses_config)
    return combined_identities(
        ordered,
        config,
        revision,
        reform_applied_before_data_load=(
            combined.to_scenario().applied_before_data_load
        ),
        baseline_applied_before_data_load=(
            baseline.applied_before_data_load
            if baseline is not None
            else False
        ),
        member_revisions=member_revisions,
    )


def bare_combined_execution(
    members, config, revision, *, member_revisions=None
):
    """Carry each approved revision through the archived composition."""
    ordered = combine.member_order(members)
    combined = combine.combine_measures(ordered, config)
    uses_config = any(not member.has_custom_baseline() for member in ordered)
    baseline, changed, records, composition = archived_combined_run_identities(
        combined, ordered, config, revision, uses_config, member_revisions
    )
    scenarios = (
        combined.baseline_scenario_for(config, uses_config),
        combined.to_scenario(),
    )
    executions = tuple(
        receipt.ComparisonExecution(identity, scenario)
        for identity, scenario in zip((baseline, changed), scenarios)
    )
    return executions, records, composition


def archived_area_identities(
    reform_id, years, revision, member_revisions=None
):
    """683dd8c's area identity assembly using the fixture's live definitions."""
    from uk_budget_data import geography

    reform = geography.get_reform(reform_id)
    config = DataConfig(years=list(years))
    if reform_id not in geography.PACKAGES:
        return receipt.measure_identities(reform, config, revision)
    ordered = combine.member_order(
        [geography.get_reform(key) for key in geography.PACKAGES[reform_id]]
    )
    executions, _, _ = bare_combined_execution(
        ordered, config, revision, member_revisions=member_revisions
    )
    return tuple(execution.identity for execution in executions)


def archived_simulate_reform(reform, dataset, years):
    """683dd8c's watched raw-Scenario build, under synthetic fixture builders."""
    from uk_budget_data import data_limits, geography

    baseline, changed = geography._reform_scenarios(
        reform, years, check_composition=True
    )
    return tuple(
        data_limits.watched_build(
            geography.build_microsimulation, dataset, scenario
        )
        for scenario in (baseline, changed)
    )


def comparison_targets():
    """Every callable changed by this explicitly archived test context."""
    from uk_budget_data import geography

    replacements = [
        (forecast, "with_forecast", bare_scenario),
        (combine, "check_consistency", absent_reference),
        (
            generate,
            "_combined_run_identities",
            archived_combined_run_identities,
        ),
        (geography, "_area_identities", archived_area_identities),
        (geography, "simulate_reform", archived_simulate_reform),
    ]
    for module in (receipt, generate):
        replacements.extend(
            [
                (module, "comparison_identity", bare_identity),
                (module, "comparison_scenario", bare_scenario),
                (module, "comparison_metadata", absent_reference),
                (module, "common_policy_reference", absent_reference),
                (module, "combined_identities", combined_identities),
                (module, "measure_execution", bare_measure_execution),
                (module, "combined_execution", bare_combined_execution),
            ]
        )
    return replacements


def install(stack):
    for module, name, replacement in comparison_targets():
        stack.enter_context(patch.object(module, name, replacement))


def current_bindings():
    """Comparison assembly plus every World provenance mock to restore."""
    from policyengine.provenance import certification

    api, _ = receipt.receipt_api()
    targets = [(module, name) for module, name, _ in comparison_targets()]
    targets.extend(
        [
            (certification, "default_bundle_source_path"),
            (receipt, "load_bundle_manifest"),
            (receipt, "metadata"),
            (api, "installed_package_identity"),
            (api, "loaded_versions"),
            (api, "_projected_years"),
        ]
    )
    return [(module, name, getattr(module, name)) for module, name in targets]


def _archived_unit(root, function, unit):
    """Attach before the actual worker checks identities, then restore."""
    from tests import parallel_helpers
    from tests.publication_support import World

    originals = current_bindings()
    attached = World.attach(root)
    previous = parallel_helpers._WORLDS.get(root)
    parallel_helpers._WORLDS[root] = attached
    try:
        return function(unit)
    finally:
        if previous is None:
            parallel_helpers._WORLDS.pop(root, None)
        else:
            parallel_helpers._WORLDS[root] = previous
        attached.close()
        assert all(
            getattr(module, name) is original
            for module, name, original in originals
        )


class ArchivedRunner:
    """The real test runner, with the archived context before worker entry."""

    def __init__(self, root, runner):
        self.root = str(root)
        self.runner = runner
        self.jobs = runner.jobs
        self.in_process = getattr(runner, "in_process", False)
        if not 1 <= self.jobs <= 4:
            raise ValueError(
                "archived fixture workers must be between 1 and 4"
            )

    def map(self, function, units, on_result=lambda i, result: None):
        return self.runner.map(
            partial(_archived_unit, self.root, function),
            units,
            on_result=on_result,
        )
