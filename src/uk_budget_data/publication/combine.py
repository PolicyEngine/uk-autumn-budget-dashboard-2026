"""Combine measures into one simulation, and prove the combination.

Every combined statistic on the dashboard comes from one simulation of
exactly the selected measures, never from adding standalone results. This
module builds that combined measure and checks it before it is simulated.

**Order.** Members are applied in order of measure id. The combined
scenario applies the members' merged parameter changes first and then each
member's modifier in that order. This is deliberate: policyengine-uk runs a
scenario's ``simulation_modifier`` before its ``parameter_changes``, and
applying parameter changes reloads the parameter tree
(``Simulation.apply_parameter_changes`` calls ``reset_parameters``), so a
modifier that sets parameters would be wiped if the combination were handed
to the engine as one modifier plus parameter changes. The receipt binds the
members in the same order.

**Conflicts.** Two members that set the same parameter for the same period
to different values cannot be combined.

**Consistency.** Before simulating, ``check_consistency`` builds household
simulations of each member alone and of the combination and compares every
parameter at sampled dates: each value a member changes must hold in the
combination, and the combination must change nothing that no member
changes.
"""

import hashlib
import json
from typing import Any, Callable, Optional

from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.artifacts import COMBINED_PREFIX

MAX_KEY_LENGTH = 120
ENGINE_BASELINE_COPY = "baseline"

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
    parameter merge depends on their form.
    """
    for path, periods in (changes or {}).items():
        if path in owners and owners[path] != member_id:
            raise CombineConflict(
                f"{side}: {path} is changed by both {owners[path]} and "
                f"{member_id}; make them one measure"
            )
        owners[path] = member_id
        merged.setdefault(path, {}).update(periods)


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


def _compose(
    parameter_changes: dict, modifiers: list[Callable]
) -> tuple[Optional[dict], Optional[Callable]]:
    """One side of the combined measure as (parameter changes, modifier)."""
    if not modifiers:
        return (parameter_changes or None), None

    def apply_members(sim):
        # Parameters first: the engine's own mechanism reloads the tree, so
        # it must run before any modifier that sets parameters.
        if parameter_changes:
            sim.apply_parameter_changes(parameter_changes)
        for modifier in modifiers:
            modifier(sim)
        return sim

    return None, apply_members


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
    return Reform(
        id=combined_key([member.id for member in ordered]),
        name="Combined: " + ", ".join(member.name for member in ordered),
        description="One simulation of: "
        + ", ".join(member.id for member in ordered),
        parameter_changes=reform_changes,
        simulation_modifier=reform_modifier,
        baseline_parameter_changes=baseline_changes,
        baseline_simulation_modifier=baseline_modifier,
    )


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
        if scenario is None:
            simulation = Simulation(situation=_SITUATION)
        else:
            simulation = Simulation(situation=_SITUATION, scenario=scenario)
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

    def effective_baseline(measure: Reform):
        return measure.to_baseline_scenario() or config.get_baseline_scenario()

    for side, scenario_of in (
        ("baseline", effective_baseline),
        ("reform", lambda measure: measure.to_scenario()),
    ):
        together = _changed(
            parameter_snapshot(
                scenario_of(combined), instants, f"the combined {side}"
            ),
            plain,
        )
        explained = set()
        for member in member_order(members):
            alone = _changed(
                parameter_snapshot(
                    scenario_of(member), instants, f"{member.id} {side}"
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
