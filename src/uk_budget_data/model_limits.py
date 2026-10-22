"""Measures the installed model mis-costs until a known fix lands.

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

import ast
import hashlib
import json
import math
import types
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
    # Compare effective values only from this fiscal year, if specified.
    from_year: int | None = None


# policyengine-uk #2336 makes additional_state_pension rise by this index.
_CPI_ADD_ON = "september_cpi_uprating"
_ADD_ON_FILE = "variables/gov/dwp/additional_state_pension.py"


def _reads(code: types.CodeType) -> bool:
    """Whether compiled code, or code nested in it, looks the index up by
    name. A comment, docstring or string literal mentioning it does not
    count: only names the code reads are in ``co_names``."""
    stack = [code]
    while stack:
        current = stack.pop()
        if _CPI_ADD_ON in current.co_names:
            return True
        stack.extend(
            const
            for const in current.co_consts
            if isinstance(const, types.CodeType)
        )
    return False


def _cpi_add_on(system) -> bool:
    """Whether the system's additional State Pension rises by September CPI
    (policyengine-uk #2336): every formula it has reads the index."""
    variable = getattr(system, "variables", {}).get("additional_state_pension")
    formulas = list((getattr(variable, "formulas", None) or {}).values())
    codes = [getattr(formula, "__code__", None) for formula in formulas]
    return bool(codes) and all(
        isinstance(code, types.CodeType) and _reads(code) for code in codes
    )


def _installed_cpi_add_on() -> bool:
    """The same test on the installed policyengine-uk's source file: every
    formula of its ``additional_state_pension`` class reads the index as an
    attribute (parsed, so a comment or string mentioning it doesn't count)."""
    try:
        source = (
            files("policyengine_uk")
            .joinpath(_ADD_ON_FILE)
            .read_text(encoding="utf-8")
        )
        tree = ast.parse(source)
    except (OSError, ModuleNotFoundError, SyntaxError, ValueError):
        return False
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.ClassDef)
            and node.name == "additional_state_pension"
        ):
            formulas = [
                item
                for item in node.body
                if isinstance(item, ast.FunctionDef)
                and item.name.startswith("formula")
            ]
            return bool(formulas) and all(
                any(
                    isinstance(read, ast.Attribute)
                    and read.attr == _CPI_ADD_ON
                    for read in ast.walk(formula)
                )
                for formula in formulas
            )
    return False


# Both installed models fill unpublished statutory inputs with forecasts.
# Read the raw input as well as behaviour, or a forecast would count as an
# outturn. The benefit index is rounded to five decimal places by the engine.
_BENEFIT_INDEX = "gov.benefit_uprating_cpi"
_SEPTEMBER_CPI_INPUT = (
    "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"
)
_SEPTEMBER_CPI_INDEX = (
    "gov.economic_assumptions.indices.september_cpi_uprating"
)


def _benefit_september_cpi(system) -> bool:
    """Whether both steps of #2533 are present, including actual uprating.

    The raw September 2026 input must be published, and the benefit index
    must follow September CPI in metadata and in its April 2027 step. A
    forecast filled into a null input, or repointing metadata without
    rebuilding the index, is insufficient. A reform to an individual
    benefit amount does not change whether its model has the fix.
    """
    if not hasattr(system, "parameters"):
        return False
    try:
        raw = getattr(system, "_raw_parameters", None)
        if raw is None:
            from policyengine_uk.tax_benefit_system import statutory_parameters

            raw = statutory_parameters()
        published = raw.get_child(_SEPTEMBER_CPI_INPUT)("2026-09-01")
        if published is None:
            return False
        index = system.parameters.get_child(_BENEFIT_INDEX)
        if index.metadata.get("uprating") != _SEPTEMBER_CPI_INDEX:
            return False
        september = system.parameters.get_child(_SEPTEMBER_CPI_INDEX)
        outturn = system.parameters.get_child(_SEPTEMBER_CPI_INPUT)(
            "2026-09-01"
        )
        growth = index("2027-04-30") / index("2026-04-30")
        september_growth = september("2027-04-30") / september("2026-04-30")
        return math.isclose(
            growth, september_growth, rel_tol=0, abs_tol=1e-5
        ) and math.isclose(growth, 1 + outturn, rel_tol=0, abs_tol=1e-5)
    except (
        AttributeError,
        KeyError,
        TypeError,
        ValueError,
        ZeroDivisionError,
    ):
        return False


def _installed_benefit_september_cpi() -> bool:
    """Read the installed engine with the same behavioural check."""
    from policyengine_uk.system import system

    return _benefit_september_cpi(system)


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
    rule don't count either: both rates
    must be uprated by an index other than the benefit index, whose April
    2026 to April 2027 step reaches the May to July 2026 earnings growth.
    That figure is read from the raw input, so a forecast can't count. The
    pension-age Housing Benefit allowances and the savings credit
    threshold, which the same fix covers, have no statutory floor to test,
    so the guarantee stands for them.
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
# pension-age allowance in two (aged, and aged_from_cutoff, six in all);
# test_pension_credit_model_limit.py fails until every one is listed here.
# The earnings input is covered too: without the fix the guarantee ignores
# it, so a change to it misses them, as a change to September CPI misses
# the State Pension add-on without #2336.
_PENSION_AGE_EARNINGS_PARAMETERS = (
    _MINIMUM_GUARANTEE,
    "gov.dwp.pension_credit.savings_credit.threshold",
    "gov.dwp.housing_benefit.allowances.couple.aged",
    "gov.dwp.housing_benefit.allowances.lone_parent.aged",
    "gov.dwp.housing_benefit.allowances.single.aged",
    _EARNINGS_INPUT,
)


# Topmost prefixes whose uprating metadata names gov.benefit_uprating_cpi,
# including the UC standard allowance's parent (which propagates to all
# four leaves). Kept static for reproducible receipts; metadata drift in
# either installed engine fails test_september_cpi_model_limit.py.
_BENEFIT_CPI_PARAMETERS = (
    "gov.dfe.childcare_funding_rate",
    "gov.dwp.JSA.income.amount_18_24",
    "gov.dwp.JSA.income.amount_over_25",
    "gov.dwp.JSA.income.couple",
    "gov.dwp.attendance_allowance.higher",
    "gov.dwp.attendance_allowance.lower",
    "gov.dwp.carer_premium.single",
    "gov.dwp.carers_allowance.rate",
    "gov.dwp.constant_attendance_allowance.exceptional_rate",
    "gov.dwp.constant_attendance_allowance.full_day_rate",
    "gov.dwp.constant_attendance_allowance.intermediate_rate",
    "gov.dwp.constant_attendance_allowance.part_day_rate",
    "gov.dwp.disability_premia.disability_couple",
    "gov.dwp.disability_premia.disability_single",
    "gov.dwp.disability_premia.enhanced_couple",
    "gov.dwp.disability_premia.enhanced_single",
    "gov.dwp.disability_premia.severe_couple",
    "gov.dwp.disability_premia.severe_single",
    "gov.dwp.dla.mobility.higher",
    "gov.dwp.dla.mobility.lower",
    "gov.dwp.dla.self_care.higher",
    "gov.dwp.dla.self_care.lower",
    "gov.dwp.dla.self_care.middle",
    "gov.dwp.housing_benefit.allowances.couple.aged",
    "gov.dwp.housing_benefit.allowances.couple.older",
    "gov.dwp.housing_benefit.allowances.couple.younger",
    "gov.dwp.housing_benefit.allowances.lone_parent.aged",
    "gov.dwp.housing_benefit.allowances.lone_parent.older",
    "gov.dwp.housing_benefit.allowances.lone_parent.younger",
    "gov.dwp.housing_benefit.allowances.single.aged",
    "gov.dwp.housing_benefit.allowances.single.older",
    "gov.dwp.housing_benefit.allowances.single.younger",
    "gov.dwp.housing_benefit.non_dep_deduction.amount",
    "gov.dwp.income_support.amounts.amount_16_24",
    "gov.dwp.income_support.amounts.amount_couples_16_17",
    "gov.dwp.income_support.amounts.amount_couples_age_gap",
    "gov.dwp.income_support.amounts.amount_couples_over_18",
    "gov.dwp.income_support.amounts.amount_lone_16_17",
    "gov.dwp.income_support.amounts.amount_lone_over_18",
    "gov.dwp.income_support.amounts.amount_over_25",
    "gov.dwp.pension_credit.guarantee_credit.carer.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.disability.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.disability.severe.addition",
    "gov.dwp.pension_credit.guarantee_credit.child.first.addition",
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.COUPLE",
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE",
    "gov.dwp.pension_credit.guarantee_credit.severe_disability.addition",
    "gov.dwp.pension_credit.savings_credit.threshold",
    "gov.dwp.pip.daily_living.enhanced",
    "gov.dwp.pip.daily_living.standard",
    "gov.dwp.pip.mobility.enhanced",
    "gov.dwp.pip.mobility.standard",
    "gov.dwp.sda.maximum",
    "gov.dwp.tax_credits.child_tax_credit.elements.child_element",
    "gov.dwp.tax_credits.child_tax_credit.elements.dis_child_element",
    "gov.dwp.tax_credits.child_tax_credit.elements.severe_dis_child_element",
    "gov.dwp.tax_credits.means_test.income_threshold",
    "gov.dwp.tax_credits.means_test.income_threshold_CTC_only",
    "gov.dwp.tax_credits.working_tax_credit.elements.basic",
    "gov.dwp.tax_credits.working_tax_credit.elements.couple",
    "gov.dwp.tax_credits.working_tax_credit.elements.disabled",
    "gov.dwp.tax_credits.working_tax_credit.elements.lone_parent",
    "gov.dwp.tax_credits.working_tax_credit.elements.severely_disabled",
    "gov.dwp.tax_credits.working_tax_credit.elements.worker",
    "gov.dwp.universal_credit.elements.carer.amount",
    "gov.dwp.universal_credit.elements.child.amount",
    "gov.dwp.universal_credit.elements.child.disabled.amount",
    "gov.dwp.universal_credit.elements.child.first.higher_amount",
    "gov.dwp.universal_credit.elements.child.severely_disabled.amount",
    "gov.dwp.universal_credit.elements.childcare.cap",
    "gov.dwp.universal_credit.elements.disabled.amount",
    "gov.dwp.universal_credit.elements.housing.non_dep_deduction.amount",
    "gov.dwp.universal_credit.means_test.work_allowance",
    "gov.dwp.universal_credit.standard_allowance.amount",
    "gov.hmrc.child_benefit.amount.additional",
    "gov.hmrc.child_benefit.amount.eldest",
    "gov.hmrc.council_tax.high_value_surcharge.amount",
    "gov.social_security_scotland.carer_support_payment.rate",
)

# Parameters outside the benefit index whose 2027 amount is still computed
# from the September 2026 CPI input. The UC protected health element is null
# from April 2027, so policyengine-uk's uc_reform takes the UC Act 2025 s. 4
# floor, which reads statutory_uprating_inputs.cpi_september for the
# previous September (review of #85). The September CPI index is built from
# the same input, and from policyengine-uk #2336 additional State Pension and
# new State Pension protected payments rise by it, so a pair with #2336 but
# without #2533's fix gives them a forecast for their April 2027 rise
# (coordinator, 22 October). Any route that moves the index (the input, a
# CPI growth path or its forecast gap) changes its stored values. The
# triple lock reads the same input for its April 2027 CPI leg, so a
# measure on its rule, or anything that moves the index it builds, is held
# too: the State Pension limit no longer holds it once #2336 is in (review
# of #90). A measure on the full rates alone is not held.
_SEPTEMBER_INPUT_READERS = (
    "gov.dwp.universal_credit.rebalancing.protected_health_element",
    _SEPTEMBER_CPI_INDEX,
    "gov.dwp.state_pension.triple_lock",
    "gov.economic_assumptions.indices.triple_lock",
)


MODEL_LIMITS = (
    ModelLimit(
        key="state_pension_add_on_uprating",
        parameters=(
            "gov.dwp.state_pension.basic_state_pension.amount",
            "gov.dwp.state_pension.new_state_pension.amount",
            "gov.dwp.state_pension.triple_lock",
            # Without the fix the add-on ignores September CPI, so a change
            # that moves the index but not the full rates misses it.
            "gov.economic_assumptions.indices.september_cpi_uprating",
        ),
        fixed_by="policyengine-uk #2336",
        reason=(
            "The installed model raises additional State Pension and new "
            "State Pension protected payments with the full rates, not with "
            "prices, so anything that moves the full rates moves them too, "
            "and a change to September CPI misses them. They rise by prices: "
            "the statutory floor, which the Up-rating Orders give as "
            "September CPI (SI 2026/148 articles 4(3)(a) and 6(3)(b)). So "
            "this measure is mis-costed: on uk-data 1.58.1, a 10% rise in "
            "the full rates overstates its net cost by about £0.85bn to "
            "£1.06bn a year over 2026-27 to 2030-31. policyengine-uk #2336 "
            "fixes it; it is not in this model. Held at provisional."
        ),
        fixed=_cpi_add_on,
        installed_fixed=_installed_cpi_add_on,
    ),
    ModelLimit(
        key="benefit_uprating_september_cpi",
        parameters=_BENEFIT_CPI_PARAMETERS + _SEPTEMBER_INPUT_READERS,
        fixed_by="policyengine-uk #2533",
        reason=(
            "The installed benefit uprating index follows lagged calendar-year "
            "CPI: the parameters uprated by it, the UC standard allowance "
            "among them, step by 2.3% in April 2027 against September 2026 "
            "CPI of 3.5% (ONS D7G7, published 21 October 2026). The UC "
            "protected health element's 2027 amount also reads the "
            "September 2026 input, which is still a forecast, and so do the "
            "triple lock's CPI leg and the September CPI index, by which "
            "additional State Pension and new State Pension protected "
            "payments rise once policyengine-uk #2336 is in the model. The "
            "2026-27 rates are hard-coded and unaffected. policyengine-uk #2533 must both enter the September "
            "outturn and repoint the benefit index to September CPI. Until "
            "both steps are in the model, measures "
            "touching these benefit levels from 2027 are held at "
            "provisional."
        ),
        fixed=_benefit_september_cpi,
        installed_fixed=_installed_benefit_september_cpi,
        from_year=2027,
    ),
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


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry is refused until it is regenerated.
REGISTRY_SHA256 = hashlib.sha256(
    json.dumps(
        [
            [
                limit.key,
                list(limit.parameters),
                limit.fixed_by,
                limit.reason,
                limit.from_year,
            ]
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
    there differs, or a node on the way is not the one formulas reach by
    attribute (a node rebound by assignment; recorded as the limit's own
    prefix, failing closed). A dated limit ignores earlier effective
    values, but retains earlier changes still in force from its first year.
    Rebound nodes fail closed even if their dates cannot be established.
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
                if _rebound(base_system, prefix) or _rebound(
                    reform_system, prefix
                ):
                    differing.append(prefix)
                    continue
                before = data_limits._structure(base_system.parameters, prefix)
                after = data_limits._structure(
                    reform_system.parameters, prefix
                )
                found = [
                    path
                    for path in before.keys() | after.keys()
                    if not data_limits._same_effect(
                        before.get(path),
                        after.get(path),
                        from_year=limit.from_year,
                    )
                ]
                if not found and not data_limits._equal(
                    data_limits._views(
                        base_system,
                        prefix,
                        behaviour,
                        from_year=limit.from_year,
                    ),
                    data_limits._views(
                        reform_system,
                        prefix,
                        behaviour,
                        from_year=limit.from_year,
                    ),
                ):
                    found = [prefix]
                differing += found
            if differing:
                touched.append(record(limit, differing))
    return touched


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
