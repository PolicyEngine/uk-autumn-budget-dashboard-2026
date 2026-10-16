"""Measures the certified data cannot cost.

Some parameters act only through a quantity the survey data do not hold.
A measure that changes one of them scores nothing, or something wrong, and
a £0 can pass for a plausible costing. Such a measure is published as not
computable on current data, with the reason, and never as a figure.

Each limit names the parameters it covers, the input the data lack and why.
A measure touches a limit when its reform and its baseline differ anywhere
under one of those parameters, however the difference was made: parameter
changes or a simulation modifier, on either side; or when a variable's
formula differs between them and either version reads the input the data
lack (a structural measure, through a template's formula helper or
``update_variable``). On built simulations two
things are compared: what formulas read under those parameters at the start
of each year (the system's cached views, which a modifier can change
without touching the stored parameters), and the stored trees by position
and effective value, so a reordered, replaced, re-typed or added parameter
shows, and a redundant breakpoint or a label does not.

A limit lifts when certified data carry the input:
``tests/test_certified_data.py`` fails once they do, so the limit is removed
in the bundle-adoption PR that brings them.
"""

import hashlib
import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable, Mapping

import numpy


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


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry (a limit added since, say) is
# refused until it is regenerated, by the gate and by the page.
REGISTRY_SHA256 = hashlib.sha256(
    json.dumps(
        [
            [
                limit.key,
                list(limit.parameters),
                limit.missing_input,
                limit.reason,
            ]
            for limit in DATA_LIMITS
        ],
        separators=(",", ":"),
    ).encode()
).hexdigest()


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


def _equal(a, b) -> bool:
    """Equality for what detection compares: numbers by value (40000 equals
    40000.0; NaN equals NaN), sequences and mappings item by item, methods
    by identity, anything else by ==."""
    if callable(a) or callable(b):
        return a is b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_equal(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b))
    numbers = (int, float, numpy.number)
    if isinstance(a, numbers) and isinstance(b, numbers):
        return bool(a == b) or bool(a != a and b != b)
    if isinstance(a, numpy.ndarray) or isinstance(b, numpy.ndarray):
        return numpy.array_equal(
            numpy.asarray(a), numpy.asarray(b), equal_nan=True
        )
    try:
        return bool(a == b)
    except Exception:  # noqa: BLE001 - incomparable means different
        return False


def _flatten(view):
    """A view of the parameters at one instant, as plain data, read the way
    formulas read it: a scale by its class (module and name), any method
    set on the instance, and its arrays; a node by its children, reached
    by attribute as formulas reach them; a leaf by its value."""
    if view is None:
        return None
    if hasattr(view, "thresholds"):
        kind = type(view)
        return {
            "scale": f"{kind.__module__}.{kind.__qualname__}",
            "own_methods": {
                name: value
                for name, value in vars(view).items()
                if callable(value)
            },
            **{
                name: list(getattr(view, name))
                for name in ("thresholds", "rates", "amounts")
                if hasattr(view, name)
            },
        }
    children = getattr(view, "_children", None)
    if children is not None:
        return {key: _flatten(getattr(view, key)) for key in sorted(children)}
    return view


def _caches(system) -> list:
    """Every at-instant cache formulas can read through: the system's own,
    and each parameter node's (a new view reuses its children's)."""
    found = []
    own = getattr(system, "_parameters_at_instant_cache", None)
    if isinstance(own, dict):
        found.append(own)
    stack = [system.parameters]
    while stack:
        node = stack.pop()
        cache = getattr(node, "_at_instant_cache", None)
        if isinstance(cache, dict):
            found.append(cache)
        stack.extend(getattr(node, "brackets", None) or [])
        children = getattr(node, "children", None)
        if isinstance(children, dict):
            stack.extend(children.values())
    return found


@contextmanager
def _caches_left_as_found(system):
    """Remove whatever the block adds to the system's caches, so detection
    never leaves a view that formulas later read."""
    caches = _caches(system)
    keys = [set(cache) for cache in caches]
    try:
        yield
    finally:
        for cache, before in zip(caches, keys):
            for key in set(cache) - before:
                del cache[key]


def _view_at(parameters, prefix: str, instant: str):
    """What a formula reads under ``prefix`` at ``instant``. Formulas call
    the tree's root, and a new view of a node is built from its children's
    cached views, so the first cached view on the way down from the root
    is what they read; with none, the view built at ``prefix`` itself."""
    parts = prefix.split(".")
    levels, node = [parameters], parameters
    for part in parts:
        children = getattr(node, "children", None)
        if not isinstance(children, dict) or part not in children:
            return None
        node = children[part]
        levels.append(node)
    for depth, level in enumerate(levels):
        cache = getattr(level, "_at_instant_cache", None)
        view = cache.get(instant) if isinstance(cache, dict) else None
        if view is not None:
            try:
                for part in parts[depth:]:
                    view = getattr(view, part)
            except AttributeError:
                return None
            return view
    return node.get_at_instant(instant)


def _views(system, prefix: str) -> list:
    """What formulas read under ``prefix`` at the start of each year. Run
    inside :func:`_caches_left_as_found`: building a view caches it."""
    return [
        _flatten(_view_at(system.parameters, prefix, f"{year}-01-01"))
        for year in VIEW_YEARS
    ]


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
    every breakpoint of either side."""
    if before is None or after is None:
        return before is after
    instants = sorted(
        {v.instant_str for v in before.values_list}
        | {v.instant_str for v in after.values_list}
    )
    return all(_equal(before(i), after(i)) for i in instants)


def _fingerprint(code):
    """A formula's code by content, not identity: the model compiles its
    formulas afresh for each system, so the same formula is a different
    object in each."""
    return (
        code.co_code,
        code.co_names,
        tuple(
            _fingerprint(c) if hasattr(c, "co_code") else repr(c)
            for c in code.co_consts
        ),
    )


def _formulas(variable) -> tuple:
    if variable is None:
        return ()
    return tuple(
        (
            str(start),
            _fingerprint(f.__code__) if hasattr(f, "__code__") else repr(f),
        )
        for start, f in sorted(
            (getattr(variable, "formulas", None) or {}).items(),
            key=lambda item: str(item[0]),
        )
    )


def _code_names(code) -> set:
    """The names and string constants a code object, and any code nested in
    it, uses: how a formula names the variables it reads."""
    found = set(code.co_names)
    for const in code.co_consts:
        if isinstance(const, str):
            found.add(const)
        elif hasattr(const, "co_consts"):
            found |= _code_names(const)
    return found


def _formulas_touched(base_system, reform_system) -> dict:
    """For each limit's key, the variables whose formulas differ between the
    two systems (replaced, added or removed, by a modifier or a reform
    class) where either side's own code names the limit's missing input:
    their difference can depend on what the data lack."""
    base, reform = base_system.variables, reform_system.variables
    found: dict = {}
    for name in sorted(base.keys() | reform.keys()):
        before, after = base.get(name), reform.get(name)
        if _formulas(before) == _formulas(after):
            continue
        names = set()
        for variable in (before, after):
            for formula in (
                getattr(variable, "formulas", None) or {}
            ).values():
                if hasattr(formula, "__code__"):
                    names |= _code_names(formula.__code__)
        for limit in DATA_LIMITS:
            if limit.missing_input in names:
                found.setdefault(limit.key, []).append(f"formula:{name}")
    return found


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The limits a measure touches, as recorded in its receipt.

    A limit is touched when, in the two built simulations:

    - the stored parameters under it differ, by position and effective
      value (parameter changes or modifiers, on either side; a reordered,
      replaced, re-typed or added parameter; not a redundant breakpoint, a
      label or 40000 against 40000.0);
    - or only what formulas read under it differs (a modifier that edited
      cached views, or a parameter class that changes between breakpoints),
      recorded as the limit's own prefix;
    - or a variable's formula differs and either side's code names the
      limit's missing input, recorded as ``formula:<variable>``.
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    base, reform = base_system.parameters, reform_system.parameters
    formulas = _formulas_touched(base_system, reform_system)
    touched = []
    with (
        _caches_left_as_found(base_system),
        _caches_left_as_found(reform_system),
    ):
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
                if not found and not _equal(
                    _views(base_system, prefix), _views(reform_system, prefix)
                ):
                    found = [prefix]
                differing += found
            differing += formulas.get(limit.key, [])
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


def _formula_path(path) -> bool:
    """A recorded ``formula:<variable>`` path (see :func:`limits_touched`)."""
    return (
        isinstance(path, str)
        and path.startswith("formula:")
        and path[len("formula:") :].isidentifier()
    )


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
            or any(
                limits_for_paths([path]) != [limit] and not _formula_path(path)
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
