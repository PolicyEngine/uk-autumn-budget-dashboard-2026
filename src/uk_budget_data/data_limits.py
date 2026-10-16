"""Measures the certified data cannot cost.

Some parameters act only through a quantity the survey data do not hold.
A measure that changes one of them scores nothing, or something wrong, and
a £0 can pass for a plausible costing. Such a measure is published as not
computable on current data, with the reason, and never as a figure.

Each limit names the parameters it covers, the input the data lack and why.
A measure touches a limit when its reform and its baseline differ anywhere
under one of those parameters, however the difference was made: parameter
changes or a simulation modifier, on either side. On built simulations two
things are compared: what formulas read under those parameters at the start
of each year (the system's cached views, which a modifier can change
without touching the stored parameters), and the stored trees by position
and effective value, so a reordered, replaced, re-typed or added parameter
shows, and a redundant breakpoint or a label does not.

A limit lifts when certified data carry the input:
``tests/test_certified_data.py`` fails once they do, so the limit is removed
in the bundle-adoption PR that brings them.
"""

import json
from dataclasses import dataclass
from typing import Iterable, Mapping


@dataclass(frozen=True)
class DataLimit:
    """Parameters whose effect the certified data cannot show."""

    key: str
    parameters: tuple[str, ...]
    missing_input: str
    reason: str


DATA_LIMITS = (
    DataLimit(
        key="additional_dwelling_purchases",
        parameters=(
            # SDLT higher rates for additional dwellings (FA 2003 Sch. 4ZA).
            "gov.hmrc.stamp_duty.residential.purchase.additional",
            # LBTT additional dwelling supplement.
            "gov.revenue_scotland.lbtt.residential.additional_residence_surcharge",
            # LTT higher residential rates.
            "gov.wra.land_transaction_tax.residential.higher_rate",
        ),
        missing_input="additional_residential_property_purchased",
        reason=(
            "The survey data record no purchases of additional dwellings, "
            "only the property households already own, so the higher rates "
            "cannot be costed. From policyengine-uk's fix for issue #2238 "
            "they apply to nothing; before it, to a buyer's whole stock of "
            "other property. The purchase imputation (policyengine-uk-data "
            "#573) would lift this."
        ),
    ),
    DataLimit(
        key="non_residential_purchases",
        parameters=(
            "gov.hmrc.stamp_duty.non_residential.purchase",
            "gov.revenue_scotland.lbtt.non_residential",
            "gov.wra.land_transaction_tax.non_residential",
        ),
        missing_input="non_residential_property_purchased",
        reason=(
            "The survey data record no purchases of non-residential property, "
            "only the property households already own, so the non-residential "
            "purchase rates cannot be costed. From policyengine-uk's fix for "
            "issue #2238 they apply to nothing; before it, to a buyer's whole "
            "stock of non-residential property. The purchase imputation "
            "(policyengine-uk-data #573) would lift this."
        ),
    ),
)


def _under(path: str, prefix: str) -> bool:
    """Whether a parameter path is ``prefix`` or lies below it."""
    return path == prefix or path.startswith((prefix + ".", prefix + "["))


def limits_for_paths(paths: Iterable[str]) -> list[DataLimit]:
    """The limits any of these parameter paths fall under, in registry
    order."""
    paths = list(paths)
    return [
        limit
        for limit in DATA_LIMITS
        if any(_under(p, prefix) for p in paths for prefix in limit.parameters)
    ]


def limits_for_scenarios(baseline_scenario, reform_scenario) -> list[dict]:
    """The limits a measure touches, read from its two scenarios' parameter
    changes: the paths where they differ. Only for simulations with no
    parameter tree to compare (stand-ins): a simulation modifier is
    invisible here, and a declared change can be undone or respelled, so
    :func:`limits_touched` decides wherever the trees exist."""
    base = _changes(baseline_scenario)
    reform = _changes(reform_scenario)
    differing = [
        p for p in base.keys() | reform.keys() if base.get(p) != reform.get(p)
    ]
    return [
        record(
            limit,
            [
                path
                for path in differing
                if any(_under(path, prefix) for prefix in limit.parameters)
            ],
        )
        for limit in limits_for_paths(differing)
    ]


def _changes(scenario) -> Mapping[str, object]:
    return (
        (getattr(scenario, "parameter_changes", None) or {})
        if scenario
        else {}
    )


# The instants formulas read parameters at for yearly results: each year's
# start. Wider than the model's years, so a change just outside them shows.
VIEW_YEARS = range(2015, 2041)


def _flatten(view):
    """A view of the parameters at one instant, as plain data: a scale by its
    kind and arrays, a node by its children, a leaf by its value."""
    if view is None:
        return None
    if hasattr(view, "thresholds"):
        return {
            "scale": type(view).__name__,
            **{
                name: list(getattr(view, name))
                for name in ("thresholds", "rates", "amounts")
                if hasattr(view, name)
            },
        }
    children = getattr(view, "_children", None)
    if children is not None:
        return {
            key: _flatten(child) for key, child in sorted(children.items())
        }
    return view


def _views(system, prefix: str) -> str:
    """What formulas read under ``prefix`` at the start of each year: the
    system's views at those instants, cached ones included."""
    seen = {}
    for year in VIEW_YEARS:
        node = system.get_parameters_at_instant(f"{year}-01-01")
        try:
            for part in prefix.split("."):
                node = getattr(node, part)
        except AttributeError:
            node = None
        seen[year] = _flatten(node)
    return json.dumps(seen, sort_keys=True, default=repr)


def _structure(parameters, prefix: str) -> dict:
    """Every leaf at or under ``prefix``, keyed by its position in the tree
    (child keys and bracket indices), not by the names the objects carry."""
    try:
        node = parameters.get_child(prefix)
    except Exception:  # noqa: BLE001 - absent in this model version
        return {}
    found: dict = {}

    def walk(node, path):
        if hasattr(node, "brackets"):
            for index, bracket in enumerate(node.brackets):
                walk(bracket, f"{path}[{index}]")
        elif hasattr(node, "values_list"):
            found[path] = node
        elif hasattr(node, "children"):
            for key in sorted(node.children):
                walk(node.children[key], f"{path}.{key}")

    walk(node, prefix)
    return found


def _same_effect(before, after) -> bool:
    """Whether two leaves from :func:`_structure` have the same value at
    every breakpoint of either side (NaN equal to NaN)."""
    if before is None or after is None:
        return before is after
    instants = sorted(
        {v.instant_str for v in before.values_list}
        | {v.instant_str for v in after.values_list}
    )
    return all(
        json.dumps(before(instant), default=repr)
        == json.dumps(after(instant), default=repr)
        for instant in instants
    )


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The limits a measure touches, as recorded in its receipt.

    Compares, under each limit's parameters in the two built simulations,
    what formulas read at the start of each year (cached views included)
    and the stored trees by position and effective value. So parameter
    changes and simulation modifiers on either side are both seen, a
    structural change (a reordered, replaced, re-typed or added parameter)
    shows, and a redundant breakpoint or a label does not. Each record names
    the limit, its reason and the paths that differ (a limit's own prefix
    when only what formulas read differs).
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    base, reform = base_system.parameters, reform_system.parameters
    touched = []
    for limit in DATA_LIMITS:
        differing = []
        for prefix in limit.parameters:
            before, after = _structure(base, prefix), _structure(
                reform, prefix
            )
            found = [
                path
                for path in before.keys() | after.keys()
                if not _same_effect(before.get(path), after.get(path))
            ]
            # Only what formulas read differs: a modifier that edited the
            # cached views, or a parameter class that changes between its
            # breakpoints.
            if not found and _views(base_system, prefix) != _views(
                reform_system, prefix
            ):
                found = [prefix]
            differing += found
        if differing:
            touched.append(record(limit, differing))
    return touched


def record(limit: DataLimit, parameters: Iterable[str]) -> dict:
    """A limit as the receipt and manifest record it."""
    return {
        "key": limit.key,
        "reason": limit.reason,
        "parameters": sorted(set(parameters)),
    }


def record_problems(records) -> list[str]:
    """Ways a recorded list of limits is not one this registry produced."""
    if not isinstance(records, list):
        return ["data_limits must be a list"]
    known = {limit.key: limit for limit in DATA_LIMITS}
    order = list(known)
    problems = []
    keys = [r.get("key") if isinstance(r, dict) else None for r in records]
    if (
        any(key not in known for key in keys)
        or len(set(keys)) != len(keys)
        or keys != sorted(keys, key=order.index)
    ):
        problems.append(
            "data_limits must list known limits once each, in registry order"
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
            or any(limits_for_paths([path]) != [limit] for path in paths)
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
