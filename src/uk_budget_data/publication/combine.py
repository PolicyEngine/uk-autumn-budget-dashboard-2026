"""Combine measures into one simulation, and prove the combination.

Every combined statistic on the dashboard comes from one simulation of
exactly the selected measures, never from adding standalone results. This
module builds that combined measure and checks it before it is simulated.

**Order.** Members are applied in order of measure id, retaining their
declared before/after-data-load phases. Receipted structural runs require
the genuine ordered execution API: one common policy reference, merged
bare parameter deltas and ordered actual modifier leaves. Workers rebind
that complete plan from trusted member definitions. The all-after helper
keeps its existing closure for ordinary model callers; explicit early
modifiers use native phase sums. Receipt bindings use the original member
leaves through the public API.

On policyengine-uk 2.125.1 the engine ran a scenario's modifier before its
parameter changes, whose rebuild then discarded the modifier's parameter
edits, so the changes used to be applied inside the modifier. On 2.126.12
that would apply them after the build steps above, and a member that
changes a parameter those steps read (whether Universal Credit rebalancing
is active, for one) would give a different result combined than alone.
``tests/test_engine_order.py`` fails on an engine with the old order.

**Conflicts.** Two members may not change one parameter, even to the same
value, except a shared setting (``SHARED_SETTINGS``): a modelling setting
that says how a member is scored, not a policy, which members may each set
to the same values. The combination then sets it once.

**Consistency.** Before simulating, ``check_consistency`` builds household
simulations of each member alone and of the combination and compares every
parameter at sampled dates: each value a member changes must hold in the
combination, and the combination must change nothing that no member
changes.
"""

import copy
import hashlib
import json
from typing import Any, Callable, Optional

from pydantic import PrivateAttr

from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.artifacts import COMBINED_PREFIX

MAX_KEY_LENGTH = 120
ENGINE_BASELINE_COPY = "baseline"
# Modelling settings members may share (path prefixes): the capital gains
# realisation responses, which every measure that moves capital gains tax
# sets to none (reforms.static_capital_gains), so its figure is static.
SHARED_SETTINGS = ("gov.simulation.capital_gains_responses.",)

# A single adult; the check reads parameters, not results.
_SITUATION = {
    "people": {"adult": {"age": {"2027": 40}}},
    "benunits": {"benunit": {"members": ["adult"]}},
    "households": {"household": {"members": ["adult"]}},
}


class CombineConflict(ValueError):
    """Raised when two members set one parameter differently."""


class CombineInconsistent(ValueError):
    """Raised when a combined scenario is not the sum of its members."""


def member_order(measures: list[Reform]) -> list[Reform]:
    """Members in application order: by measure id."""
    ordered = sorted(measures, key=lambda measure: measure.id)
    ids = [measure.id for measure in ordered]
    if len(set(ids)) != len(ids):
        raise CombineConflict(f"a measure is listed twice: {ids}")
    return ordered


def combined_key(measure_ids: list[str]) -> str:
    """The artifact key of a combined set of measures."""
    ids = sorted(measure_ids)
    key = COMBINED_PREFIX + "+".join(ids)
    if len(key) <= MAX_KEY_LENGTH:
        return key
    digest = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    return COMBINED_PREFIX + digest[:16]


def _same(left: Any, right: Any) -> bool:
    if left != left and right != right:  # both NaN
        return True
    return left == right


def _merge(
    merged: dict,
    owners: dict,
    changes: Optional[dict],
    member_id: str,
    side: str,
) -> None:
    """Add one member's parameter changes.

    Members must change disjoint parameters (policyengine.py's composition
    v1): a second member touching a parameter another has changed is
    refused, even with the same value, since how two changes to one
    parameter merge depends on their form. A shared setting is the one
    exception: a second member may set it to exactly the same values for
    the same periods, so the merge cannot depend on order or form.
    """
    for path, periods in (changes or {}).items():
        if path in owners and owners[path] != member_id:
            if path.startswith(SHARED_SETTINGS):
                if _same_periods(merged[path], periods):
                    continue
                raise CombineConflict(
                    f"{side}: {path} is set differently by "
                    f"{owners[path]} and {member_id}"
                )
            raise CombineConflict(
                f"{side}: {path} is changed by both {owners[path]} and "
                f"{member_id}; make them one measure"
            )
        owners[path] = member_id
        merged.setdefault(path, {}).update(periods)


def _same_periods(left: dict, right: dict) -> bool:
    return set(left) == set(right) and all(
        _same(left[period], right[period]) for period in left
    )


def merged_changes(measures: list[Reform], config: DataConfig) -> dict:
    """Each side's merged parameter changes and ordered modifiers.

    A member without a baseline of its own uses the configured baseline, as
    it does when run alone.
    """
    sides = {
        "baseline": {"parameter_changes": {}, "modifiers": []},
        "reform": {"parameter_changes": {}, "modifiers": []},
    }
    owners: dict = {"baseline": {}, "reform": {}}
    configured_merged = False
    for member in member_order(measures):
        if member.has_custom_baseline():
            baseline_changes = member.baseline_parameter_changes
            baseline_modifier = member.baseline_simulation_modifier
            baseline_owner = member.id
        elif not configured_merged:
            # The configured baseline is shared, so it is applied once.
            baseline_changes = config.baseline_parameter_changes
            baseline_modifier = None
            baseline_owner = "the configured baseline"
            configured_merged = True
        else:
            baseline_changes, baseline_modifier = None, None
            baseline_owner = "the configured baseline"
        for side, changes, modifier, owner in (
            ("baseline", baseline_changes, baseline_modifier, baseline_owner),
            (
                "reform",
                member.parameter_changes,
                member.simulation_modifier,
                member.id,
            ),
        ):
            _merge(
                sides[side]["parameter_changes"],
                owners[side],
                changes,
                owner,
                side,
            )
            # Every member's modifier runs, once per member, in member
            # order, even when two members share one.
            if modifier is not None:
                sides[side]["modifiers"].append(modifier)
    return sides


def has_early_modifiers(members):
    """Whether a combined raw closure cannot preserve the declared phases."""
    for member in members:
        for scenario in (member.to_scenario(), member.to_baseline_scenario()):
            if scenario is None:
                continue
            before, _ = scenario.parts_by_data_load()
            if before is not None and before.simulation_modifier is not None:
                return True
    return False


def _compose(
    parameter_changes: dict, modifiers: list[Callable]
) -> tuple[Optional[dict], Optional[Callable]]:
    """One side of the combined measure as (parameter changes, modifier).

    The merged parameter changes stay on the Scenario, so the engine applies
    them where it applies a member's own: before the steps that read
    parameters while a simulation is built (the Universal Credit
    rebalancing inputs, and the structural reforms that parameters switch
    on). The modifier runs each member's modifier, in member order, where
    the engine runs a member's own: after those steps.
    """
    changes = parameter_changes or None
    if not modifiers:
        return changes, None

    def apply_members(sim):
        for modifier in modifiers:
            modifier(sim)
        return sim

    return changes, apply_members


class _PhasedCombination(Reform):
    """Keep native phases for ordinary builders as well as receipted runs.

    Receipt producers bind trusted member leaves through the genuine API;
    these native sums are never offered as source-bindable leaf callables.
    """

    _reform_scenario: Any = PrivateAttr(default=None)
    _baseline_scenario: Any = PrivateAttr(default=None)
    _declared_fields: Any = PrivateAttr(default=None)

    def _check_definition(self):
        from uk_budget_data.publication.receipt import (
            _encoded_parameters,
            _same_metadata,
        )

        changes, baseline, modifier, baseline_modifier = self._declared_fields
        if (
            not _same_metadata(
                _encoded_parameters(self.parameter_changes),
                _encoded_parameters(changes),
            )
            or not _same_metadata(
                _encoded_parameters(self.baseline_parameter_changes),
                _encoded_parameters(baseline),
            )
            or self.simulation_modifier is not modifier
            or self.baseline_simulation_modifier is not baseline_modifier
            or self.applied_before_data_load
            or self.baseline_applied_before_data_load
        ):
            raise CombineInconsistent(
                "A phased combination changed; rebuild it from its members"
            )

    def to_scenario(self):
        self._check_definition()
        return self._reform_scenario

    def to_baseline_scenario(self):
        self._check_definition()
        return self._baseline_scenario


def combine_measures(measures: list[Reform], config: DataConfig) -> Reform:
    """One measure that applies every member, in member order.

    Raises CombineConflict if two members set one parameter differently.
    """
    ordered = member_order(measures)
    if not ordered:
        raise CombineConflict("nothing to combine")
    sides = merged_changes(ordered, config)
    baseline_changes, baseline_modifier = _compose(
        sides["baseline"]["parameter_changes"], sides["baseline"]["modifiers"]
    )
    reform_changes, reform_modifier = _compose(
        sides["reform"]["parameter_changes"], sides["reform"]["modifiers"]
    )
    result = (_PhasedCombination if has_early_modifiers(ordered) else Reform)(
        id=combined_key([member.id for member in ordered]),
        name="Combined: " + ", ".join(member.name for member in ordered),
        description="One simulation of: "
        + ", ".join(member.id for member in ordered),
        parameter_changes=reform_changes,
        simulation_modifier=reform_modifier,
        baseline_parameter_changes=baseline_changes,
        baseline_simulation_modifier=baseline_modifier,
    )
    if isinstance(result, _PhasedCombination):
        from policyengine_uk.utils.scenario import Scenario

        baseline_sources = []
        configured = False
        for member in ordered:
            if member.has_custom_baseline():
                baseline_sources.append(member.to_baseline_scenario())
            elif not configured:
                baseline_sources.append(config.get_baseline_scenario())
                configured = True

        def joined(sources):
            values = [source for source in sources if source is not None]
            if not values:
                return None
            value = Scenario()
            for source in values:
                value = value + source
            return value

        result._reform_scenario = joined(
            [member.to_scenario() for member in ordered]
        )
        result._baseline_scenario = joined(baseline_sources)
        result._declared_fields = (
            copy.deepcopy(result.parameter_changes),
            copy.deepcopy(result.baseline_parameter_changes),
            result.simulation_modifier,
            result.baseline_simulation_modifier,
        )
    return result


def sample_instants(years: list[int]) -> list[str]:
    """Dates at which parameters are compared: around each fiscal year."""
    instants = []
    for year in sorted(years):
        instants += [
            f"{year}-01-01",
            f"{year}-04-06",
            f"{year}-04-30",
            f"{year}-12-31",
        ]
    return instants


def parameter_snapshot(scenario, instants: list[str], label: str) -> dict:
    """Every parameter's value at each instant under a scenario.

    Raises CombineInconsistent if the scenario cannot be applied to a
    household simulation, since then it cannot be checked.
    """
    from policyengine_uk import Simulation

    try:
        from uk_budget_data.forecast import with_forecast

        simulation = Simulation(
            situation=_SITUATION, scenario=with_forecast(scenario)
        )
    except Exception as error:  # noqa: BLE001 - reported, not swallowed
        raise CombineInconsistent(
            f"{label} could not be applied to a household simulation, so it "
            f"cannot be checked: {type(error).__name__}: {error}"
        ) from error
    snapshot = {}
    root = simulation.tax_benefit_system.parameters
    for name, child in root.children.items():
        # process_parameters keeps a clone of the tree under "baseline" for
        # the engine's own comparisons; its nodes share names with the live
        # ones, and it is not what a simulation reads.
        if name == ENGINE_BASELINE_COPY:
            continue
        for path, leaf in _leaves(child, name):
            snapshot[path] = tuple(leaf(instant) for instant in instants)
    return snapshot


def _leaves(node, path: str):
    """Yield (path, parameter) for every leaf under a parameter node."""
    from policyengine_core.parameters import Parameter, ParameterScale

    if isinstance(node, Parameter):
        yield path, node
    elif isinstance(node, ParameterScale):
        for index, bracket in enumerate(node.brackets):
            for name, child in bracket.children.items():
                yield from _leaves(child, f"{path}[{index}].{name}")
    elif hasattr(node, "children"):
        for name, child in node.children.items():
            yield from _leaves(child, f"{path}.{name}")


def _changed(snapshot: dict, plain: dict) -> dict:
    """Points where a snapshot differs from current law."""
    changed = {}
    for name, values in snapshot.items():
        reference = plain.get(name)
        for index, value in enumerate(values):
            before = reference[index] if reference is not None else None
            if not _same(value, before):
                changed[(name, index)] = value
    return changed


def check_consistency(
    combined: Reform,
    members: list[Reform],
    config: DataConfig,
    years: list[int],
    max_reported: int = 12,
    *,
    revision=None,
    member_revisions=None,
) -> None:
    """Prove the combined scenario is exactly its members' changes.

    On each side (baseline and reform), every parameter value a member
    changes when run alone must hold in the combination, and the combination
    must change nothing that no member changes. Raises CombineInconsistent
    listing the differences.
    """
    instants = sample_instants(years)
    plain = parameter_snapshot(None, instants, "current law")
    problems = []

    combined_uses_config = any(
        not member.has_custom_baseline() for member in members
    )

    def effective_baseline(measure: Reform):
        uses_config = (
            combined_uses_config
            if measure is combined
            else not measure.has_custom_baseline()
        )
        return measure.baseline_scenario_for(config, uses_config)

    # Legacy all-after helpers have the same order as their raw closure.
    # Explicit early modifiers must instead be checked through the exact
    # genuine adapter the published run executes; never flatten phases.
    phased = has_early_modifiers(members)
    if phased:
        from uk_budget_data.publication import phase_recipe
        from uk_budget_data.publication.receipt import code_revision

        revision = revision or code_revision()

    for side, scenario_of in (
        ("baseline", effective_baseline),
        ("reform", lambda measure: measure.to_scenario()),
    ):
        together_scenario = scenario_of(combined)
        if phased:
            configured_included = False
            sources = []
            for member in member_order(members):
                if side == "baseline":
                    bound = (
                        member.has_custom_baseline() or not configured_included
                    )
                    if not bound:
                        continue
                    configured_included |= not member.has_custom_baseline()
                sources.append(
                    (
                        scenario_of(member),
                        (member_revisions or {}).get(member.id, revision),
                    )
                )
            together_scenario = phase_recipe.bind_comparison(
                sources, name=f"consistency combined {side}"
            )
        together = _changed(
            parameter_snapshot(
                together_scenario, instants, f"the combined {side}"
            ),
            plain,
        )
        explained = set()
        for member in member_order(members):
            alone_scenario = scenario_of(member)
            if phased:
                alone_scenario = phase_recipe.bind_comparison(
                    [
                        (
                            alone_scenario,
                            (member_revisions or {}).get(member.id, revision),
                        )
                    ],
                    name=f"consistency {member.id} {side}",
                )
            alone = _changed(
                parameter_snapshot(
                    alone_scenario, instants, f"{member.id} {side}"
                ),
                plain,
            )
            for (name, index), value in alone.items():
                explained.add((name, index))
                actual = together.get(
                    (name, index),
                    plain.get(name, (None,) * len(instants))[index],
                )
                if not _same(actual, value):
                    problems.append(
                        f"{side}: {name} at {instants[index]} is {value!r} "
                        f"under {member.id} alone but {actual!r} combined"
                    )
        for (name, index), value in together.items():
            if (name, index) not in explained:
                problems.append(
                    f"{side}: the combination sets {name} at "
                    f"{instants[index]} to {value!r}, which no member does"
                )
    if problems:
        shown = problems[:max_reported]
        more = len(problems) - len(shown)
        raise CombineInconsistent(
            "; ".join(shown) + (f"; and {more} more" if more else "")
        )
