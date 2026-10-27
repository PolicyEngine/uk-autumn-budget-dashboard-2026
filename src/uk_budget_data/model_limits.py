"""Measures the installed model mis-costs until a known fix lands.

Some parameters reach more of the model than the law gives them, until a
known fix is in the installed model. A measure that changes one of them
gets a figure, but not one to approve: it is staged provisional at most,
with the reason, and never approved (``publication.publish``).

Each limit names the parameters it covers, any variables it covers, the
fix and a test of the model for it. A measure touches a limit when the
model either simulation runs lacks the fix and its two built simulations
differ under one of those parameters, compared as
``uk_budget_data.data_limits`` compares them (the stored trees by position
and effective value, and what formulas read at each year's start), or in
one of those variables: its formulas or what decides how they run, or the
values stored for it (recorded as ``variable:<name>``). A limit expires on
its own: once the model has the fix, nothing is recorded, and its tripwire
test fails so the limit is removed.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Callable, Iterable

import numpy

from uk_budget_data import data_limits


@dataclass(frozen=True)
class ModelLimit:
    """Parameters, and variables, the installed model mis-costs until
    ``fixed_by`` lands."""

    key: str
    parameters: tuple[str, ...]
    fixed_by: str
    reason: str
    # Whether a tax-benefit system has the fix, and whether the installed
    # model does (read from its source, for the templates and stand-ins).
    fixed: Callable[[object], bool]
    installed_fixed: Callable[[], bool]
    # Compare effective values only from this fiscal year, if specified.
    from_year: int | None = None
    # Variables a measure can change the limit through without changing a
    # covered parameter: a replaced formula, or a value stored on one side.
    variables: tuple[str, ...] = ()


# How a receipt records a covered variable that differs.
VARIABLE_PATH = "variable:"


def variable_path(name: str) -> str:
    """A covered variable as a limit's record names it."""
    return f"{VARIABLE_PATH}{name}"


# The benefit uprating index, which the minimum guarantee's check refuses as
# an earnings rule.
_BENEFIT_INDEX = "gov.benefit_uprating_cpi"


_MINIMUM_GUARANTEE = (
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee"
)
_EARNINGS_INPUT = (
    "gov.economic_assumptions.statutory_uprating_inputs.awe_total_pay_may_july"
)
# Indices are stored to five decimal places.
_INDEX_TOLERANCE = 1e-5


def _unreformed(parameters):
    """The tree as the model built it, before any reform: policyengine-core
    keeps it as the ``baseline`` child of every built tree."""
    children = getattr(parameters, "children", None)
    baseline = children.get("baseline") if isinstance(children, dict) else None
    return baseline if baseline is not None else parameters


def _uprating_index(node):
    """The index a parameter's uprating metadata names, or None."""
    rule = (getattr(node, "metadata", None) or {}).get("uprating")
    if isinstance(rule, dict):
        rule = rule.get("parameter")
    return rule if isinstance(rule, str) else None


def _minimum_guarantee_earnings(system) -> bool:
    """Whether the standard minimum guarantee is uprated with earnings.

    Social Security Administration Act 1992 s. 150A(2) requires each
    April's rise to be at least the May to July earnings growth before it.
    The check reads the uprating rule, from the tree as the model built it,
    not the amounts, so a measure that sets the guarantee can't make its
    own simulation count as fixed, and 2027-28 rates typed in over a CPI
    rule don't count either. Both rates must be uprated by an index other
    than the benefit index, whose April 2026 to April 2027 step reaches the
    May to July 2026 earnings growth. That figure is read from the raw
    input, so a forecast can't count. The pension-age Housing Benefit
    allowances and the savings credit threshold, which the same fix covers,
    have no statutory floor to test, so the guarantee stands for them.

    A modifier that reloads and reprocesses the parameters builds the tree
    it is read from, so one that repoints the rule on both sides counts as
    installing the fix: review it as a change to the model, not a measure.
    """
    if not hasattr(system, "parameters"):
        return False
    try:
        raw = getattr(system, "_raw_parameters", None)
        if raw is None:
            from policyengine_uk.tax_benefit_system import statutory_parameters

            raw = statutory_parameters()
        earnings = raw.get_child(_EARNINGS_INPUT)("2026-07-01")
        if earnings is None:
            return False
        tree = _unreformed(system.parameters)
        guarantee = tree.get_child(_MINIMUM_GUARANTEE)
        for name in ("SINGLE", "COUPLE"):
            path = _uprating_index(guarantee.get_child(name))
            if path is None or path == _BENEFIT_INDEX:
                return False
            index = tree.get_child(path)
            step = index("2027-04-30") / index("2026-04-30")
            if step < 1 + earnings - _INDEX_TOLERANCE:
                return False
        return True
    except (
        AttributeError,
        KeyError,
        TypeError,
        ValueError,
        ZeroDivisionError,
    ):
        return False


def _installed_minimum_guarantee_earnings() -> bool:
    """Read the installed engine with the same behavioural check."""
    from policyengine_uk.system import system

    return _minimum_guarantee_earnings(system)


# What the UK hub's earnings fix for the guarantee covers (coordinator, 22
# October): the guarantee, the pension-age Housing Benefit allowances and
# the savings credit threshold. policyengine-uk after 2.132.6 splits each
# pension-age allowance in two (aged, and aged_from_cutoff, six in all; at
# 2.151.0 aged_from_cutoff equals the guarantee and rises by lagged CPI as
# it does); test_pension_credit_model_limit.py fails until every one is
# listed here. The earnings input is covered too: without the fix the
# guarantee ignores it, so a change to it misses them.
_PENSION_AGE_EARNINGS_PARAMETERS = (
    _MINIMUM_GUARANTEE,
    "gov.dwp.pension_credit.savings_credit.threshold",
    "gov.dwp.housing_benefit.allowances.couple.aged",
    "gov.dwp.housing_benefit.allowances.couple.aged_from_cutoff",
    "gov.dwp.housing_benefit.allowances.lone_parent.aged",
    "gov.dwp.housing_benefit.allowances.lone_parent.aged_from_cutoff",
    "gov.dwp.housing_benefit.allowances.single.aged",
    "gov.dwp.housing_benefit.allowances.single.aged_from_cutoff",
    _EARNINGS_INPUT,
)


# policyengine-uk 2.151.0 (6.11.1's adoption, PR 238) has the fixes for
# three limits, so they expired: the State Pension add-on and protected
# payments rise by September CPI (#2336), benefits rise by the published
# September outturn (#2533), and household VAT is grossed up by survey
# coverage and the household share of receipts (#2187). Their checks for
# the fix went with them; tests/model_limit_stand_ins.py keeps them as
# stand-ins for the tests of the machinery. The VAT limit was the only one
# covering variables: the field and its comparison stay for the next.
MODEL_LIMITS = (
    ModelLimit(
        key="pc_minimum_guarantee_uprating",
        parameters=_PENSION_AGE_EARNINGS_PARAMETERS,
        fixed_by=(
            "the UK hub's earnings uprating of the minimum guarantee, "
            "stacked on policyengine-uk #2557"
        ),
        reason=(
            "The installed model raises the Pension Credit standard minimum "
            "guarantee by lagged calendar-year CPI, 2.3% in April 2027, but "
            "the law requires at least the growth in earnings, 3.9% in May "
            "to July 2026 (Social Security Administration Act 1992 s. "
            "150A(2)). So the guarantee is too low from 2027, and so are "
            "the pension-age Housing Benefit allowances and the savings "
            "credit threshold, which the same fix covers; a change to the "
            "earnings input misses them. policyengine-uk #2557, the fix for "
            "#2533, keeps the guarantee on lagged CPI. Until a fix that "
            "uprates it by earnings is in the model, measures touching these "
            "from 2027 are held at provisional."
        ),
        fixed=_minimum_guarantee_earnings,
        installed_fixed=_installed_minimum_guarantee_earnings,
        from_year=2027,
    ),
)


def _registry_digest(limits: Iterable[ModelLimit]) -> str:
    """A digest of what a registry records and decides by: every field of
    each limit but its checks for the fix."""
    return hashlib.sha256(
        json.dumps(
            [
                [
                    limit.key,
                    list(limit.parameters),
                    list(limit.variables),
                    limit.fixed_by,
                    limit.reason,
                    limit.from_year,
                ]
                for limit in limits
            ],
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry is refused until it is regenerated.
REGISTRY_SHA256 = _registry_digest(MODEL_LIMITS)


def _covers(limit: ModelLimit, path: str) -> bool:
    """Whether a recorded path is under a limit: a parameter path under one
    of its prefixes, or ``variable:<name>`` for a variable it covers."""
    if path.startswith(VARIABLE_PATH):
        return path[len(VARIABLE_PATH) :] in limit.variables
    return any(data_limits._under(path, prefix) for prefix in limit.parameters)


def limits_for_paths(paths: Iterable[str]) -> list[ModelLimit]:
    """The limits any of these paths fall under (parameter paths, or
    ``variable:<name>``), in registry order, whether or not the installed
    model has the fix."""
    paths = list(paths)
    return [
        limit
        for limit in MODEL_LIMITS
        if any(_covers(limit, path) for path in paths)
    ]


def record(limit: ModelLimit, parameters: Iterable[str]) -> dict:
    """A limit as the receipt records it: its parameter paths and covered
    variables (``variable:<name>``) that differ, under ``parameters``."""
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
    there differs, or a node on the way is not the one formulas reach by
    attribute (a node rebound by assignment; recorded as the limit's own
    prefix, failing closed). A dated limit ignores earlier effective
    values, but retains earlier changes still in force from its first year.
    Rebound nodes fail closed even if their dates cannot be established.
    A limit is touched too when one of its variables differs between the
    two simulations (:func:`_variables_differing`), in any year.
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
                differing += _differing(
                    base_system,
                    reform_system,
                    prefix,
                    behaviour,
                    from_year=limit.from_year,
                )
            differing += _variables_differing(
                sim_baseline, sim_reform, limit.variables, behaviour
            )
            if differing:
                touched.append(record(limit, differing))
    return touched


def _differing(
    base_system, reform_system, prefix: str, behaviour, *, from_year=None
) -> list:
    """Where two built systems' parameters differ at or under ``prefix``:
    the stored leaves that differ by position and effective value; with
    none, the prefix itself if what formulas read there differs; and the
    prefix itself if a node on the way is rebound (failing closed). Run
    inside :func:`data_limits._caches_left_as_found` for both systems."""
    if _rebound(base_system, prefix) or _rebound(reform_system, prefix):
        return [prefix]
    before = data_limits._structure(base_system.parameters, prefix)
    after = data_limits._structure(reform_system.parameters, prefix)
    found = [
        path
        for path in before.keys() | after.keys()
        if not data_limits._same_effect(
            before.get(path), after.get(path), from_year=from_year
        )
    ]
    if not found and not data_limits._equal(
        data_limits._views(
            base_system, prefix, behaviour, from_year=from_year
        ),
        data_limits._views(
            reform_system, prefix, behaviour, from_year=from_year
        ),
    ):
        found = [prefix]
    return found


def parameters_differing(sim_baseline, sim_reform, prefixes) -> list:
    """Where two built simulations' parameters differ under any of
    ``prefixes``, compared as :func:`limits_touched` compares a limit's
    parameters in every year: sorted, each path once."""
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    behaviour = data_limits._Behaviour(
        main_systems=(base_system, reform_system)
    )
    with (
        data_limits._caches_left_as_found(base_system),
        data_limits._caches_left_as_found(reform_system),
    ):
        return sorted(
            {
                path
                for prefix in prefixes
                for path in _differing(
                    base_system, reform_system, prefix, behaviour
                )
            }
        )


# What, beside its formulas and what the fingerprint reads, decides how a
# variable is calculated: the date its formulas stop, the variable masking
# them, carrying an input forward, and how an input is spread over periods.
_VARIABLE_METADATA = ("end", "defined_for", "uprating", "set_input")


def _variables_differing(sim_baseline, sim_reform, names, behaviour):
    """The covered variables that differ between two simulations, as a
    record names them (``variable:<name>``).

    A variable differs when it is in one system only, or its behaviour
    differs: each dated formula by content (its code's fingerprint, as
    ``uk_budget_data.data_limits`` reads it, with its defaults, the values
    it closes over and the globals it looks up, so a template applied with
    other arguments shows), whether it is neutralised, what it adds and
    subtracts, its default and :data:`_VARIABLE_METADATA`; or when the
    values stored for it differ (:func:`_stored`). What can't be read
    counts as different.
    """
    systems = (sim_baseline.tax_benefit_system, sim_reform.tax_benefit_system)
    found = []
    for name in names:
        pair = [
            (getattr(system, "variables", None) or {}).get(name)
            for system in systems
        ]
        if pair[0] is None and pair[1] is None:
            continue
        try:
            same_values = _same_stored(
                _stored(sim_baseline, name), _stored(sim_reform, name)
            )
        except Exception:  # noqa: BLE001 - unreadable means different
            same_values = False
        if _behaves_differently(*pair, behaviour) or not same_values:
            found.append(variable_path(name))
    return found


def _behaves_differently(base, reform, behaviour) -> bool:
    if base is None or reform is None:
        return True
    try:
        return any(
            behaviour.of(getattr(base, field, None))
            != behaviour.of(getattr(reform, field, None))
            for field in _VARIABLE_METADATA
        ) or behaviour.of(base) != behaviour.of(reform)
    except Exception:  # noqa: BLE001 - unreadable means different
        return True


def _stored(sim, name):
    """What ``sim`` stores for ``name``: the values the engine records as
    inputs, and every value its holder keeps, calculated or cached, each by
    branch and period. None for a simulation without the engine's holders
    (a stand-in), which is not compared.

    Detection runs after the figures are made, so one side can hold a value
    the other never calculated: inputs are compared slot for slot, and other
    values only where both sides hold one (:func:`_same_stored`). An engine
    that records no inputs has all it holds compared as inputs.
    """
    get_holder = getattr(sim, "get_holder", None)
    if get_holder is None:
        return None
    if name not in sim.tax_benefit_system.variables:
        return {}, {}
    holder = get_holder(name)
    known = {
        (branch, str(period)): holder.get_array(period, branch)
        for branch, period in holder.get_known_branch_periods()
    }
    keys = getattr(sim, "_user_input_keys", None)
    if keys is None:
        return known, known
    inputs = {
        (branch, str(period)): holder.get_array(period, branch)
        for variable, branch, period in keys
        if variable == name
    }
    return inputs, known


def _same_stored(base, reform) -> bool:
    """Whether two simulations store the same for a variable (NaN equal to
    NaN): the same inputs in the same slots, and the same value in every
    slot both hold. True where either can't be read."""
    if base is None or reform is None:
        return True
    (base_inputs, base_known), (reform_inputs, reform_known) = base, reform
    return (
        base_inputs.keys() == reform_inputs.keys()
        and all(
            _same_array(base_inputs[slot], reform_inputs[slot])
            for slot in base_inputs
        )
        and all(
            _same_array(base_known[slot], reform_known[slot])
            for slot in base_known.keys() & reform_known.keys()
        )
    )


def _same_array(a, b) -> bool:
    if a is None or b is None:
        return a is b
    a, b = numpy.asarray(a), numpy.asarray(b)
    try:
        return bool(numpy.array_equal(a, b, equal_nan=True))
    except TypeError:  # no NaN in this dtype (text, say)
        return bool(numpy.array_equal(a, b))


def _rebound(system, prefix: str) -> bool:
    """Whether a node on the way to ``prefix`` is not the one formulas reach
    by attribute: a modifier rebound it (``node.amount = other``), so the
    stored tree that detection walks is not what formulas read."""
    node = system.parameters
    for part in prefix.split("."):
        children = getattr(node, "children", None)
        child = children.get(part) if isinstance(children, dict) else None
        if child is None:
            return False
        if getattr(node, part, None) is not child:
            return True
        node = child
    return False


def limits_for_scenarios(baseline_scenario, reform_scenario) -> list[dict]:
    """The limits a measure touches, read from its two scenarios' parameter
    changes, against the installed model. Only for simulations with no
    parameter tree to compare (stand-ins): :func:`limits_touched` decides
    wherever the trees exist."""
    touched = []
    for limit in MODEL_LIMITS:
        base = _changes_from_year(baseline_scenario, limit.from_year)
        reform = _changes_from_year(reform_scenario, limit.from_year)
        differing = [
            path
            for path in base.keys() | reform.keys()
            if base.get(path) != reform.get(path)
            and any(
                data_limits._under(path, prefix) for prefix in limit.parameters
            )
        ]
        if differing and not limit.installed_fixed():
            touched.append(record(limit, differing))
    return touched


def _changes_from_year(scenario, from_year):
    """Ignore earlier bare fiscal-year assignments in a stand-in scenario.

    Scalar changes and unrecognised dated syntax are conservatively kept;
    only the built trees can establish their effective dates reliably.
    """
    changes = data_limits._changes(scenario)
    if from_year is None:
        return changes
    found = {}
    for path, value in changes.items():
        if isinstance(value, dict):
            value = {
                key: amount
                for key, amount in value.items()
                if not (str(key).isdigit() and len(str(key)) == 4)
                or int(key) >= from_year
            }
            if not value:
                continue
        found[path] = value
    return found


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
                or limit not in limits_for_paths([path])
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
