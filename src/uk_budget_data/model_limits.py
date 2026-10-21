"""Measures the installed model overstates until a known fix lands.

Some parameters reach more of the model than the law gives them, until a
known fix is in the installed model. A measure that changes one of them
gets a figure, but not one to approve: it is staged provisional at most,
with the reason, and never approved (``publication.publish``).

Each limit names the parameters it covers, the fix and a test of the
model for it. A measure touches a limit when its two built simulations'
parameters differ under one of those parameters, compared as
``uk_budget_data.data_limits`` compares them (the stored trees by position
and effective value, and what formulas read at each year's start), and
the model either simulation runs lacks the fix. A limit expires on its
own: once the model has the fix, nothing is recorded, and
``tests/test_model_limits.py``'s tripwire fails so the limit is removed.
"""

import hashlib
import inspect
import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Callable, Iterable

from uk_budget_data import data_limits


@dataclass(frozen=True)
class ModelLimit:
    """Parameters the installed model mis-costs until ``fixed_by`` lands."""

    key: str
    parameters: tuple[str, ...]
    fixed_by: str
    reason: str
    # Whether a tax-benefit system has the fix, and whether the installed
    # model does (read from its source, for the templates and stand-ins).
    fixed: Callable[[object], bool]
    installed_fixed: Callable[[], bool]


# policyengine-uk #2336 makes additional_state_pension rise by this index.
_CPI_ADD_ON = "september_cpi_uprating"
_ADD_ON_FILE = "variables/gov/dwp/additional_state_pension.py"


def _cpi_add_on(system) -> bool:
    """Whether the system's additional State Pension rises by September CPI
    (policyengine-uk #2336): every formula it has reads the index."""
    variable = getattr(system, "variables", {}).get("additional_state_pension")
    formulas = list((getattr(variable, "formulas", None) or {}).values())
    try:
        sources = [inspect.getsource(formula) for formula in formulas]
    except (OSError, TypeError):
        return False
    return bool(sources) and all(_CPI_ADD_ON in s for s in sources)


def _installed_cpi_add_on() -> bool:
    """The same test, on the installed policyengine-uk's source file."""
    try:
        source = (
            files("policyengine_uk")
            .joinpath(_ADD_ON_FILE)
            .read_text(encoding="utf-8")
        )
    except (OSError, ModuleNotFoundError):
        return False
    return _CPI_ADD_ON in source


MODEL_LIMITS = (
    ModelLimit(
        key="state_pension_add_on_uprating",
        parameters=(
            "gov.dwp.state_pension.basic_state_pension.amount",
            "gov.dwp.state_pension.new_state_pension.amount",
            "gov.dwp.state_pension.triple_lock",
        ),
        fixed_by="policyengine-uk #2336",
        reason=(
            "The installed model raises additional State Pension and new "
            "State Pension protected payments with the full rates, so "
            "anything that moves the full rates moves them too. They rise "
            "by prices: the statutory floor, which the Up-rating Orders give "
            "as September CPI (SI 2026/148 articles 4(3)(a) and 6(3)(b)). "
            "So this measure is overstated: on uk-data 1.58.1, a 10% rise's "
            "net cost by about £0.85bn to £1.06bn a year over 2026-27 to "
            "2030-31. policyengine-uk #2336 fixes it; it is not in this "
            "model. Held at provisional."
        ),
        fixed=_cpi_add_on,
        installed_fixed=_installed_cpi_add_on,
    ),
)


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry is refused until it is regenerated.
REGISTRY_SHA256 = hashlib.sha256(
    json.dumps(
        [
            [limit.key, list(limit.parameters), limit.fixed_by, limit.reason]
            for limit in MODEL_LIMITS
        ],
        separators=(",", ":"),
    ).encode()
).hexdigest()


def limits_for_paths(paths: Iterable[str]) -> list[ModelLimit]:
    """The limits any of these parameter paths fall under, in registry
    order, whether or not the installed model has the fix."""
    paths = list(paths)
    return [
        limit
        for limit in MODEL_LIMITS
        if any(
            data_limits._under(path, prefix)
            for path in paths
            for prefix in limit.parameters
        )
    ]


def record(limit: ModelLimit, parameters: Iterable[str]) -> dict:
    """A limit as the receipt records it."""
    return {
        "key": limit.key,
        "reason": limit.reason,
        "parameters": sorted(set(parameters)),
    }


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The model limits a measure touches, as its receipt records them.

    A limit is touched when either simulation's model lacks its fix and,
    under one of its parameters, the two simulations' stored parameters
    differ by position and effective value, or only what formulas read
    there differs (recorded as the limit's own prefix).
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    # One reading of behaviour for both sides, as data_limits compares.
    behaviour = data_limits._Behaviour(
        main_systems=(base_system, reform_system)
    )
    touched = []
    with (
        data_limits._caches_left_as_found(base_system),
        data_limits._caches_left_as_found(reform_system),
    ):
        for limit in MODEL_LIMITS:
            if limit.fixed(base_system) and limit.fixed(reform_system):
                continue
            differing = []
            for prefix in limit.parameters:
                before = data_limits._structure(base_system.parameters, prefix)
                after = data_limits._structure(
                    reform_system.parameters, prefix
                )
                found = [
                    path
                    for path in before.keys() | after.keys()
                    if not data_limits._same_effect(
                        before.get(path), after.get(path)
                    )
                ]
                if not found and not data_limits._equal(
                    data_limits._views(base_system, prefix, behaviour),
                    data_limits._views(reform_system, prefix, behaviour),
                ):
                    found = [prefix]
                differing += found
            if differing:
                touched.append(record(limit, differing))
    return touched


def limits_for_scenarios(baseline_scenario, reform_scenario) -> list[dict]:
    """The limits a measure touches, read from its two scenarios' parameter
    changes, against the installed model. Only for simulations with no
    parameter tree to compare (stand-ins): :func:`limits_touched` decides
    wherever the trees exist."""
    base = data_limits._changes(baseline_scenario)
    reform = data_limits._changes(reform_scenario)
    differing = [
        p for p in base.keys() | reform.keys() if base.get(p) != reform.get(p)
    ]
    return [
        record(
            limit,
            [
                path
                for path in differing
                if any(
                    data_limits._under(path, prefix)
                    for prefix in limit.parameters
                )
            ],
        )
        for limit in limits_for_paths(differing)
        if not limit.installed_fixed()
    ]


def record_problems(records) -> list[str]:
    """Ways a recorded list of model limits is not one this registry
    produced."""
    if not isinstance(records, list):
        return ["model_limits must be a list"]
    known = {limit.key: limit for limit in MODEL_LIMITS}
    order = list(known)
    problems = []
    keys = [r.get("key") if isinstance(r, dict) else None for r in records]
    if (
        any(key not in known for key in keys)
        or len(set(keys)) != len(keys)
        or keys != sorted(keys, key=order.index)
    ):
        problems.append(
            "model_limits must list known limits once each, in registry order"
        )
    for item in records:
        if not isinstance(item, dict) or item.get("key") not in known:
            continue
        limit = known[item["key"]]
        if item.get("reason") != limit.reason:
            problems.append(f"{limit.key}: its reason is not the registry's")
        paths = item.get("parameters")
        if (
            not isinstance(paths, list)
            or not paths
            or paths != sorted(set(paths))
            or any(
                not isinstance(path, str)
                or limits_for_paths([path]) != [limit]
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
