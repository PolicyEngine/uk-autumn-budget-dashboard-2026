"""Measures the certified data cannot cost.

Some parameters act only through a quantity the survey data do not hold.
A measure that changes one of them scores nothing, or something wrong, and
a £0 can pass for a plausible costing. Such a measure is published as not
computable on current data, with the reason, and never as a figure.

Each limit names the parameters it covers, the input the data lack and why.
A measure touches a limit when its reform and its baseline differ anywhere
under one of those parameters, however the difference was made: parameter
changes or a simulation modifier, on either side.

A limit lifts when certified data carry the input:
``tests/test_certified_data.py`` fails once they do, so the limit is removed
in the bundle-adoption PR that brings them.
"""

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
            "Not computable on current data: the survey data record no "
            "purchases of additional dwellings, only the property households "
            "already own, so the higher rates cannot be costed. From "
            "policyengine-uk's fix for issue #2238 they apply to nothing; "
            "before it, to a buyer's whole stock of other property. The "
            "purchase imputation (policyengine-uk-data #573) would lift this."
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
            "Not computable on current data: the survey data record no "
            "purchases of non-residential property, only the property "
            "households already own, so the non-residential purchase rates "
            "cannot be costed. From policyengine-uk's fix for issue #2238 "
            "they apply to nothing; before it, to a buyer's whole stock of "
            "non-residential property. The purchase imputation "
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
    changes: the paths where they differ. A simulation modifier is
    invisible here; :func:`limits_touched` sees it on built simulations."""
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


def merge(*record_lists: list[dict]) -> list[dict]:
    """One record per limit, in registry order, with every parameter any
    of the lists named."""
    named: dict[str, set] = {}
    for records in record_lists:
        for item in records:
            named.setdefault(item["key"], set()).update(item["parameters"])
    return [
        record(limit, named[limit.key])
        for limit in DATA_LIMITS
        if limit.key in named
    ]


def _leaves(parameters, prefix: str) -> dict[str, list]:
    """Every leaf parameter at or under ``prefix``, with its values."""
    try:
        node = parameters.get_child(prefix)
    except Exception:  # noqa: BLE001 - absent in this model version
        return {}
    nodes = [node]
    if hasattr(node, "get_descendants"):
        nodes += list(node.get_descendants())
    return {
        leaf.name: [(v.instant_str, v.value) for v in leaf.values_list]
        for leaf in nodes
        if hasattr(leaf, "values_list")
    }


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The limits a measure touches, as recorded in its receipt.

    Compares every leaf under each limit's parameters in the two built
    simulations, so parameter changes and simulation modifiers on either
    side are both seen. Each record names the limit, its reason and the
    leaves that differ.
    """
    base = sim_baseline.tax_benefit_system.parameters
    reform = sim_reform.tax_benefit_system.parameters
    touched = []
    for limit in DATA_LIMITS:
        differing = []
        for prefix in limit.parameters:
            before, after = _leaves(base, prefix), _leaves(reform, prefix)
            differing += sorted(
                name
                for name in before.keys() | after.keys()
                if before.get(name) != after.get(name)
            )
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
            or limits_for_paths(paths) != [limit]
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
