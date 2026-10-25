"""Measures the certified data cannot cost.

Some parameters act only through a quantity the survey data do not hold.
A measure that changes one of them scores nothing, or something wrong, and
a £0 can pass for a plausible costing. Such a measure is published as not
computable on current data, with the reason, and never as a figure.

Each limit names the parameters it covers, the input the data lack and why.
A measure touches a limit when its reform and its baseline differ anywhere
under one of those parameters, however the difference was made: parameter
changes or a simulation modifier, on either side; or when a variable
behaves differently between them and the code that differs read what the
limit covers while the run made the figures (a structural measure, through
a template's formula helper, ``update_variable`` or
``neutralize_variable``). What that code reads is watched as the
simulations calculate (:func:`observing`), not inferred from its source.
Variables are compared with the metadata core reads during calculation,
including formula end dates and conditions, and with their abolition
parameters. Stored inputs are also compared, for each missing input and
every model formula directly reading it or its limited parameters.

On built simulations two things are compared for parameters: what formulas
read under those parameters at the start of each year (the system's cached
views, which a modifier can change without touching the stored
parameters), and the stored trees by position and effective value, so a
reordered, replaced, re-typed or added parameter shows, and a redundant
breakpoint or a label does not.

A limit lifts when certified data carry the input:
``tests/test_certified_data.py`` fails once they do, so the limit is removed
in the bundle-adoption PR that brings them.
"""

import dis
import enum
import functools
import hashlib
import inspect
import itertools
import json
import sys
import sysconfig
import threading
import types
import warnings
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterable, Mapping

import numpy

from uk_budget_data.budget_years import HOUSEHOLD_YEARS


@dataclass(frozen=True)
class DataLimit:
    """Parameters whose effect the certified data cannot show."""

    key: str
    parameters: tuple[str, ...]
    missing_input: str
    reason: str


# The means tests' lists of the capital they count. They name share-like
# capital, which counts corporate wealth whole unless itemised holdings are
# given, so the split acts through no parameter but these: a measure that
# names holdings in them, to count some and not others.
SHARE_CAPITAL_SOURCES = (
    "gov.dwp.universal_credit.means_test.capital.sources",
    "gov.dwp.housing_benefit.means_test.capital.sources",
    "gov.dwp.pension_credit.income.capital.sources",
    "gov.dwp.income_support.means_test.capital.sources",
    "gov.dwp.JSA.income.capital.sources",
    "gov.dwp.ESA.income.capital.sources",
)

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
    # The 13 inputs the a133 cut (policyengine-uk 2.147.2) newly leaves at
    # their defaults (NEWLY_MISSING_INPUTS), each keyed on the parameters
    # whose effect runs through it, read from the formulas at 2.147.2 that
    # read it (tests/test_data_limits_cuts.py pins those readers).
    DataLimit(
        key="pip_daily_living_points",
        parameters=("gov.dwp.pip.daily_living.points_thresholds",),
        missing_input="pip_dl_points",
        reason=(
            "The certified data record each claimant's PIP daily living "
            "award, not the assessment points behind it, so the model leaves "
            "everyone's points at its default of -1 (not assessed) and keeps "
            "the recorded award. A change to the points needed for the "
            "standard or enhanced rate therefore moves no one. Changes to "
            "the rates themselves are not affected. A measure that changes "
            "the recorded awards cannot be costed either: the model carries "
            "a recorded award into later years that have none, unless newer "
            "points replace it."
        ),
    ),
    DataLimit(
        key="pip_mobility_points",
        parameters=("gov.dwp.pip.mobility.points_thresholds",),
        missing_input="pip_m_points",
        reason=(
            "The certified data record each claimant's PIP mobility award, "
            "not the assessment points behind it, so the model leaves "
            "everyone's points at its default of -1 (not assessed) and keeps "
            "the recorded award. A change to the points needed for the "
            "standard or enhanced rate therefore moves no one. Changes to "
            "the rates themselves are not affected. A measure that changes "
            "the recorded awards cannot be costed either: the model carries "
            "a recorded award into later years that have none, unless newer "
            "points replace it."
        ),
    ),
    DataLimit(
        key="bus_uncapped_single_fares",
        parameters=(
            "gov.dft.bus.fares",
            "gov.dft.bus.reference_fares",
            # The table that stands in for the missing fares.
            "gov.dft.bus.uncapped_single_fares",
            # The share of boardings bought as single tickets, where the
            # data carry none: it acts only by scaling the cap's change to
            # single fares, priced from that table.
            "gov.dft.bus.default_single_fare_share",
        ),
        missing_input="local_bus_uncapped_single_fare",
        reason=(
            "The certified data do not record what each passenger's single "
            "bus tickets would cost without the fare cap, so the model's "
            "default prices a change to the single-fare cap, for single "
            "tickets in England outside London, from its own table of "
            "uncapped single fares in three bands, not from each "
            "passenger's fares."
        ),
    ),
    DataLimit(
        key="salary_sacrifice_returned_to_income",
        # No parameter acts through it: it is only added to employment
        # income and employee pension contributions. The limit watches a
        # measure that sets it, or changes a formula that reads it.
        parameters=(),
        missing_input="salary_sacrifice_returned_to_income",
        reason=(
            "The certified data record no salary sacrifice returned to "
            "ordinary pay, and the model's default is none. A measure that "
            "returns sacrificed pay to income, or changes how the model "
            "counts it, cannot be costed, nor can one that changes recorded "
            "employment income or employee pension contributions, to both "
            "of which the model adds it. The pension salary sacrifice cap "
            "does not act through it in this model."
        ),
    ),
    DataLimit(
        key="pre_2015_salary_sacrifice",
        parameters=("gov.hmrc.income_tax.allowances.annual_allowance",),
        missing_input="pension_contributions_via_salary_sacrifice_pre_2015",
        reason=(
            "The certified data do not record when salary sacrifice "
            "arrangements were made, so the model's default treats all of "
            "it as made on or after 9 July 2015 and adds it all back to "
            "threshold income for the tapered annual allowance. A change to "
            "the annual allowance or its taper cannot be costed for people "
            "with earlier arrangements."
        ),
    ),
    DataLimit(
        key="annual_allowance_death_benefits",
        parameters=("gov.hmrc.income_tax.allowances.annual_allowance",),
        missing_input=(
            "pension_annual_allowance_taxable_lump_sum_death_benefits"
        ),
        reason=(
            "The certified data do not identify taxable lump-sum pension "
            "death benefits, so with the model's default of none nothing is "
            "deducted for them from threshold and adjusted income for the "
            "tapered annual allowance, which exclude them. A change to the "
            "annual allowance or its taper cannot be costed for people who "
            "received them."
        ),
    ),
    DataLimit(
        key="defined_benefit_pension_share",
        parameters=(
            "gov.hmrc.income_tax.allowances.annual_allowance",
            # Acts only through the defined-benefit share, so with the
            # default share of nil a change to it moves nothing.
            "gov.simulation.pensions.defined_benefit_input_per_contribution",
        ),
        missing_input="defined_benefit_pension_share",
        reason=(
            "The certified data do not record which workplace pension "
            "contributions go to defined-benefit schemes, so the model's "
            "default treats every contribution as money purchase and counts "
            "contributions, not the growth in defined-benefit rights, "
            "towards the annual allowance. A change to the annual allowance "
            "or its taper cannot be costed for defined-benefit members."
        ),
    ),
    DataLimit(
        key="non_residential_property_secured_debt",
        parameters=("gov.dwp.universal_credit.means_test.capital",),
        missing_input="non_residential_property_secured_debt",
        reason=(
            "The certified data do not record debt secured on "
            "non-residential property, so the model's default of none "
            "counts that property at its market value less sale costs in "
            "the Universal Credit capital test. A change to Universal "
            "Credit's capital rules cannot be costed for owners with such "
            "debt."
        ),
    ),
    DataLimit(
        key="other_residential_property_secured_debt",
        parameters=("gov.dwp.universal_credit.means_test.capital",),
        missing_input="other_residential_property_secured_debt",
        reason=(
            "The certified data do not record debt secured on residential "
            "property other than the home, so the model's default of none "
            "counts that property at its market value less sale costs in "
            "the Universal Credit capital test. A change to Universal "
            "Credit's capital rules cannot be costed for owners with such "
            "debt."
        ),
    ),
    DataLimit(
        key="directly_held_shares",
        parameters=SHARE_CAPITAL_SOURCES,
        missing_input="directly_held_shares",
        reason=(
            "The certified data do not split share-like wealth into directly "
            "held shares, unit and investment trusts and stocks and shares "
            "ISAs, so the model's default of none for directly held shares "
            "leaves the means tests counting only the total, corporate "
            "wealth. A change to which of those holdings the means tests "
            "count cannot be costed."
        ),
    ),
    DataLimit(
        key="unit_and_investment_trusts",
        parameters=SHARE_CAPITAL_SOURCES,
        missing_input="unit_and_investment_trusts",
        reason=(
            "The certified data do not split share-like wealth into directly "
            "held shares, unit and investment trusts and stocks and shares "
            "ISAs, so the model's default of none for unit and investment "
            "trusts leaves the means tests counting only the total, "
            "corporate wealth. A change to which of those holdings the "
            "means tests count cannot be costed."
        ),
    ),
    DataLimit(
        key="early_years_school_start_deferred",
        parameters=(
            "gov.dfe.universal_childcare_entitlement",
            "gov.dfe.extended_childcare_entitlement",
            "gov.dfe.childcare_funding_rate",
            "gov.dfe.weeks_per_year",
            "gov.dfe.compulsory_school_age",
            "gov.scottish_government.funded_early_learning_childcare",
        ),
        missing_input="early_years_school_start_deferred",
        reason=(
            "The certified data do not record which children defer starting "
            "school, so the model's default assumes none does: each child "
            "keeps funded early years hours only for the terms before the "
            "usual school start for its date of birth. A change to funded "
            "early years entitlement in England or Scotland cannot be "
            "costed for children who defer."
        ),
    ),
    DataLimit(
        key="full_year_category_a_director",
        parameters=(
            "gov.hmrc.national_insurance.class_1.directors."
            "full_year_category_a_2022_23",
        ),
        missing_input="is_full_year_category_a_director",
        reason=(
            "The certified data do not identify company directors who held "
            "office all year, and the model's default treats no one as one. "
            "That matters only for the annual calculation of directors' "
            "employee National Insurance in 2022-23, outside the Budget's "
            "years, so only a change to that rule is affected."
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


# The model inputs each certified data cut newly leaves at their defaults:
# those its predecessor's data also lacked are not listed again.
# policyengine.py's budget-inputs gate (``provenance.uk_candidate.
# budget_inputs``) records them as ``newly_missing_inputs`` in the cut's
# certification evidence (budget-inputs.json), which the bundle doesn't
# ship, so the adoption PR copies them here, keyed by the cut's build id
# (the bundle's ``data_releases.uk.build_id``). Every input listed for any
# cut needs a limit above until it is no longer missing
# (``NO_LONGER_MISSING``): a cut skipped by the dashboard lists inputs its
# successor won't. So each record also names the cut its list was taken
# against (``LISTED_AGAINST``, the previous certified pair in the same
# evidence), and the chain from the installed cut must reach
# ``RECORD_ROOT`` through recorded cuts only: a cut certified in between
# and never adopted would otherwise drop its inputs from every list.
# ``coverage_problems`` checks it, and tests/test_data_limits_cuts.py fails
# an installed cut with no record. Not part of REGISTRY_SHA256: the record
# changes no receipt.
NEWLY_MISSING_INPUTS: dict[str, tuple[str, ...]] = {
    # policyengine-uk 2.147.2 with Microcosm UK 2024-25 national, 23 Oct
    # 2026: policyengine.py#715's budget-inputs evidence, accepted on
    # condition that the dashboard holds each as a data limit
    # (policyengine.py#715#issuecomment-6381135108, dashboard #124).
    "microcosm-uk-2024-25-national-20261023T075039Z-a133f37a": (
        "defined_benefit_pension_share",
        "directly_held_shares",
        "early_years_school_start_deferred",
        "is_full_year_category_a_director",
        "local_bus_uncapped_single_fare",
        "non_residential_property_secured_debt",
        "other_residential_property_secured_debt",
        "pension_annual_allowance_taxable_lump_sum_death_benefits",
        "pension_contributions_via_salary_sacrifice_pre_2015",
        "pip_dl_points",
        "pip_m_points",
        "salary_sacrifice_returned_to_income",
        "unit_and_investment_trusts",
    ),
}

# The cut the dashboard ran when the record began (policyengine 6.10.x,
# policyengine-uk 2.132.6): the limits registered before the record cover
# what its data lack.
RECORD_ROOT = "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71"

# For each recorded cut, the cut its newly missing inputs were listed
# against. a133's budget-inputs and attribution evidence compare it with
# the 19 October cut (policyengine.py#715).
LISTED_AGAINST: dict[str, str] = {
    "microcosm-uk-2024-25-national-20261023T075039Z-a133f37a": RECORD_ROOT,
}

# Inputs a cut listed above that are no longer missing, with why: the
# certified data carry them again (the lift tripwire in
# tests/test_data_limits.py fails, and the limit is removed in the same
# adoption PR), or the installed model no longer has them as inputs. The
# certified test checks the first; tests/test_data_limits_cuts.py the
# second.
NO_LONGER_MISSING: dict[str, str] = {}


def coverage_problems(build_id: str) -> list[str]:
    """Why the limits don't cover the inputs certified cuts newly leave at
    their defaults, with ``build_id`` the installed cut: empty when they
    do.

    A problem is the installed cut having no record (unless it is
    ``RECORD_ROOT``), a break in the chain of cuts each record was listed
    against before it reaches ``RECORD_ROOT``, or an input any recorded cut
    lists having neither a limit nor a ``NO_LONGER_MISSING`` entry.
    """
    problems = []
    if build_id != RECORD_ROOT and build_id not in NEWLY_MISSING_INPUTS:
        problems.append(
            f"the installed data cut {build_id} has no record in "
            "NEWLY_MISSING_INPUTS: copy newly_missing_inputs from its "
            "certification's budget-inputs.json (an empty tuple if none)"
        )
    problems += _chain_problems(build_id)
    limited = {limit.missing_input for limit in DATA_LIMITS}
    for cut, names in NEWLY_MISSING_INPUTS.items():
        for name in sorted(set(names) - limited - set(NO_LONGER_MISSING)):
            problems.append(
                f"{name}, which {cut} newly leaves at its default, has no "
                "data limit: register one keyed on the parameters it acts "
                "through, with the default in its reason"
            )
    return problems


def _chain_problems(build_id: str) -> list[str]:
    """Why the recorded cuts don't link the installed cut back to
    ``RECORD_ROOT``, each through the cut its list was taken against."""
    cut, seen = build_id, set()
    while cut in NEWLY_MISSING_INPUTS and cut != RECORD_ROOT:
        if cut in seen:
            return [f"the cuts LISTED_AGAINST names loop at {cut}"]
        seen.add(cut)
        against = LISTED_AGAINST.get(cut)
        if against is None:
            return [
                f"{cut} has no LISTED_AGAINST entry: name the cut its "
                "budget-inputs.json compared it with (the previous pair)"
            ]
        if against != RECORD_ROOT and against not in NEWLY_MISSING_INPUTS:
            return [
                f"{cut} lists the inputs it newly leaves at their defaults "
                f"against {against}, which has no record: copy that cut's "
                "newly_missing_inputs too, or the inputs it newly left are "
                "in no list"
            ]
        cut = against
    return []


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


def _flatten(view, behaviour=None, by_item=False):
    """A view of the parameters at one instant, as plain data, read the way
    formulas read it: a scale by its class and any method set on the
    instance (both by content, see :class:`_Behaviour`), and its arrays; a
    node by its children, reached by attribute as formulas reach them (or
    by item for core's abolition lookup); a leaf by its value."""
    behaviour = behaviour or _Behaviour()
    if view is None:
        return None
    if hasattr(view, "thresholds"):
        return {
            "scale": behaviour.of(type(view)),
            "own_methods": {
                name: behaviour.of(value)
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
        return {
            key: _flatten(
                view[key] if by_item else getattr(view, key),
                behaviour,
                by_item,
            )
            for key in sorted(children)
        }
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
    complete = True
    for part in parts:
        children = getattr(node, "children", None)
        if not isinstance(children, dict) or part not in children:
            complete = False
            break
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
    if not complete:
        return None
    return node.get_at_instant(instant)


def _views(
    system, prefix: str, behaviour=None, by_item=False, *, from_year=None
) -> list:
    """What formulas read under ``prefix`` at the start of each year. Run
    inside :func:`_caches_left_as_found`: building a view caches it.
    ``by_item`` follows core's bracket-based abolition lookup."""
    behaviour = behaviour or _Behaviour()
    return [
        _flatten(
            _view_at(system.parameters, prefix, f"{year}-01-01"),
            behaviour,
            by_item,
        )
        for year in VIEW_YEARS
        if from_year is None or year >= from_year
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


def _same_effect(before, after, *, from_year=None) -> bool:
    """Whether two leaves from :func:`_structure` have the same value at
    every breakpoint of either side, optionally from a year boundary."""
    if before is None or after is None:
        return before is after
    instants = sorted(
        {v.instant_str for v in before.values_list}
        | {v.instant_str for v in after.values_list}
    )
    if from_year is not None:
        start = f"{from_year}-01-01"
        # Include the boundary: an earlier breakpoint can still be in force.
        instants = sorted({start, *(i for i in instants if i >= start)})
    # Core can't read a parameter at year 0, where policyengine-uk starts
    # some (``0000-01-01``); what is in force from then is in force at year
    # 1, since no breakpoint can fall between.
    instants = sorted({max(i, _FIRST_INSTANT) for i in instants})
    return all(_equal(before(i), after(i)) for i in instants)


_FIRST_INSTANT = "0001-01-01"


# An enum class's own record of its members, which are listed by name and
# value instead (each member's fingerprint includes its class).
_ENUM_BOOKKEEPING = frozenset(
    {
        "_member_map_",
        "_value2member_map_",
        "_member_names_",
        "_hashable_values_",
        "_unhashable_values_",
        "_unhashable_values_map_",
    }
)


# An engine object linked to no system (a parameter, an entity).
_NO_SYSTEM = object()
# What every enum member holds for the enum machinery itself.
_ENUM_MEMBER_BOOKKEEPING = frozenset(
    {"_value_", "_name_", "__objclass__", "_sort_order_"}
)


def _member_fields(member) -> dict:
    """An enum member's own state: every field set on it, private or not,
    besides the enum machinery's."""
    return {
        name: field
        for name, field in sorted(vars(member).items())
        if name not in _ENUM_MEMBER_BOOKKEEPING
    }


def _enum_entry(kind, name, member) -> bool:
    """A member of an enum class, or its record of them."""
    return issubclass(kind, enum.Enum) and (
        name in _ENUM_BOOKKEEPING or isinstance(member, kind)
    )


_MODEL_PACKAGES = ("policyengine_uk", "uk_budget_data")
_STDLIB = sysconfig.get_paths()["stdlib"]
# How deep plain objects held by a formula are read, field by field.
_OBJECT_DEPTH = 16

# Core 3.33.0 and 3.33.3 read these on the calculation path: calculate,
# _calculate, their period/formula/casting helpers, Variable.get_formula
# and Variable.default_array. Methods count too: a modifier can replace
# one on an instance without replacing any formula. set_input also affects
# the values the calculation consumes. Keep this list alongside the audit
# in docs/data-limit-detection.md when adopting another core version.
_VARIABLE_CALCULATION_ATTRIBUTES = (
    "name",
    "entity",
    "is_neutralized",
    "requires_computation_after",
    "definition_period",
    "quantity_type",
    "defined_for",
    "uprating",
    "_uprating",
    "calculate_output",
    "default_value",
    "value_type",
    "possible_values",
    "dtype",
    "adds",
    "subtracts",
    "end",
    "get_formula",
    "default_array",
    "check_defined_for_variable",
    "check_uprating_value_type",
    "exhaustive_parameter_dependencies",
    "baseline_variable",
    "_explicit_attribute_names",
    "set_input",
)


def _variable_attribute(variable, name):
    """A calculation attribute, including the entity fields core consumes.

    Held engine entities normally compare by type in formula behaviour.
    Variable metadata also needs their key and person/group distinction:
    these select the population and map formula results between entities.
    """
    value = getattr(variable, name, None)
    if name == "entity":
        return (
            type(value),
            getattr(value, "key", None),
            getattr(value, "is_person", None),
        )
    return value


def _library_path(path: str) -> bool:
    """Whether code from ``path`` is installed library code (the standard
    library, or a site package other than the model's), which is compared
    by name; the model's code, and code written for a measure, by content."""
    if path.startswith("<frozen"):
        return True
    if path.startswith("<"):
        return False
    if any(f"/{package}/" in path for package in _MODEL_PACKAGES):
        return False
    return (
        "site-packages" in path
        or "dist-packages" in path
        or path.startswith(_STDLIB)
    )


def _library_module(name) -> bool:
    top = (name or "").split(".")[0]
    if top in _MODEL_PACKAGES:
        return False
    if top in sys.stdlib_module_names:
        return True
    path = getattr(sys.modules.get(top), "__file__", None)
    return bool(path) and _library_path(path)


def _library_class(kind) -> bool:
    """A class from library code whose own methods are all library code: a
    subclass made to carry a library class's module and name, overriding a
    method, is not one."""
    return _library_module(kind.__module__) and all(
        _library_path(function.__code__.co_filename)
        for function in map(_function_of, vars(kind).values())
        if function is not None
    )


def _function_of(value):
    """The Python function behind a class member, if it has one."""
    if isinstance(value, (classmethod, staticmethod)):
        value = value.__func__
    return value if isinstance(value, types.FunctionType) else None


def _is_variable(value) -> bool:
    return (
        not isinstance(value, type)
        and hasattr(value, "formulas")
        and hasattr(value, "is_neutralized")
    )


def _cell_is_set(cell) -> bool:
    try:
        cell.cell_contents
    except ValueError:
        return False
    return True


def _fingerprint(code):
    """A code object by content: its instructions, the names it uses, its
    locals' names, its parameters' kinds, and its constants (nested code by
    content too)."""
    return (
        code.co_code,
        code.co_names,
        # Every local's name (a keyword call binds by name; locals() reads
        # them), and the parameters' counts by kind.
        code.co_varnames,
        code.co_argcount,
        code.co_posonlyargcount,
        code.co_kwonlyargcount,
        code.co_flags & (inspect.CO_VARARGS | inspect.CO_VARKEYWORDS),
        tuple(
            _fingerprint(c) if hasattr(c, "co_code") else repr(c)
            for c in code.co_consts
        ),
    )


def _global_names(code) -> set:
    """The names a code object, and any code nested in it, looks up."""
    found = set(code.co_names)
    for const in code.co_consts:
        if hasattr(const, "co_names"):
            found |= _global_names(const)
    return found


@functools.lru_cache(maxsize=None)
def _loaded_globals(code) -> frozenset:
    """The names a code object, and any code nested in it, loads as
    globals or builtins: what it can reach by name, not every name it uses
    (an attribute's name is not a global it reads)."""
    found = {
        instruction.argval
        for instruction in dis.get_instructions(code)
        if instruction.opname in ("LOAD_GLOBAL", "LOAD_NAME")
    }
    for const in code.co_consts:
        if hasattr(const, "co_code"):
            found |= _loaded_globals(const)
    return frozenset(found)


@functools.lru_cache(maxsize=None)
def _code_names(code) -> set:
    """The names and string constants a code object, and any code nested in
    it, uses: how a formula names the variables it reads. A list or tuple
    of names (``add(household, period, ["a", "b"])``) compiles to one tuple
    constant, so strings inside constant tuples and frozensets count too."""
    found = set(code.co_names)
    for const in code.co_consts:
        found |= _constant_names(const)
    return found


def _constant_names(const) -> set:
    if isinstance(const, str):
        return {const}
    if isinstance(const, (tuple, frozenset)):
        return set().union(*map(_constant_names, const))
    if hasattr(const, "co_consts"):
        return _code_names(const)
    return set()


class _Behaviour:
    """What code does, by content, so the same behaviour matches across
    systems and a different one does not.

    The model compiles its formulas afresh for each system, into modules
    with generated names, so the same formula is a different object in
    each. A function is read as its code, its default arguments, the values
    it closes over and the globals its code looks up; a variable as its
    formulas and every attribute core reads while calculating; a class as
    its own members (methods and data alike), its bases
    and any enum members; a plain object as its class and its fields, slots
    included; a mapping in its order; a container subclass with its type,
    factory and fields. Numbers compare by value (40000 matches 40000.0).
    Installed library code is read by qualified name. Results are memoised
    by object for one comparison, which keeps the objects alive.
    """

    def __init__(self, main_systems=()):
        self._memo: dict = {}
        self._kept: list = []
        self._active: set = set()
        # The systems being compared: a simulation or system a formula
        # holds matches across them only when it is one of these (its own
        # side's), never another with a policy of its own.
        self._main_systems = tuple(main_systems)
        self._main = frozenset(id(system) for system in main_systems)

    def _in_main_tree(self, value) -> bool:
        """Whether a stored parameter object is a compared system's own, at
        its own path."""
        name = getattr(value, "name", None)
        for system in self._main_systems:
            root = getattr(system, "parameters", None)
            try:
                found = root if not name else root.get_child(name)
            except Exception:  # noqa: BLE001 - not in this tree
                continue
            if found is value:
                return True
        return False

    # --- fingerprints

    def of(self, value, depth: int = 0):
        """A hashable fingerprint of ``value``'s behaviour."""
        if isinstance(value, enum.Enum):
            kind = type(value)
            fields = _member_fields(value)
            return (
                "member",
                kind.__qualname__,
                value.name,
                self.of(value.value),
                self.of(fields),
                # Its class's methods and state, unless library code.
                () if _library_class(kind) else self.of(kind),
            )
        if isinstance(value, numpy.generic):
            if (type(value).__module__ or "").split(".")[0] != "numpy":
                # A measure's subclass of a NumPy scalar: its fields too.
                return (
                    "scalar",
                    self.of(type(value)),
                    self.of(value.item()),
                    self._fields(value, depth),
                )
            return self.of(value.item(), depth)
        scalars = (bool, int, float, str, bytes, complex)
        if isinstance(value, scalars) and type(value) not in scalars:
            # A subclass of a plain value can carry fields beside it.
            plain = next(k for k in scalars if isinstance(value, k))
            return (
                "scalar",
                self.of(type(value)),
                self.of(plain(value)),
                self._fields(value, depth),
            )
        if isinstance(value, (bool, str, bytes, complex)) or value is None:
            return repr(value)
        if isinstance(value, (int, float)):
            if isinstance(value, int) and abs(value) >= 2**53:
                return repr(value)
            number = float(value)
            return "nan" if number != number else repr(number)
        if isinstance(value, types.ModuleType):
            return ("module", value.__name__)
        containers = (list, tuple, set, frozenset, dict, numpy.ndarray)
        if isinstance(value, containers):
            return self._guarded(value, self._container, depth)
        key = id(value)
        if key in self._memo:
            return self._memo[key]
        found = self._guarded(value, self._component, depth)
        if found[0] != "cycle":
            self._memo[key] = found
            self._kept.append(value)
        return found

    def _guarded(self, value, read, depth):
        key = id(value)
        if key in self._active:
            name = getattr(value, "__qualname__", type(value).__qualname__)
            return ("cycle", str(name))
        self._active.add(key)
        try:
            return read(value, depth)
        finally:
            self._active.discard(key)

    def _container(self, value, depth):
        if (
            isinstance(value, numpy.ndarray)
            and type(value) is not numpy.ndarray
        ):
            # A subclass can carry state beside its data.
            plain = numpy.asarray(value).view(numpy.ndarray)
            fields = tuple(
                (name, self.of(field, depth + 1))
                for name, field in sorted(_fields_of(value).items())
            )
            return ("array", self.of(type(value)), fields, self.of(plain))
        if isinstance(value, numpy.ndarray):
            if value.dtype.hasobject:
                items = tuple(self.of(item, depth) for item in value.ravel())
                return ("array", value.shape, items)
            # The dtype's full form: a structured dtype's fields and
            # offsets, not just its byte width.
            return ("array", repr(value.dtype), value.shape, value.tobytes())
        kind = type(value)
        extra = ()
        if kind not in (dict, list, tuple, set, frozenset):
            # A subclass can carry behaviour (a defaultdict's factory).
            extra = (
                self.of(kind),
                self.of(getattr(value, "default_factory", None)),
                self._fields(value, depth),
            )
        if isinstance(value, dict):
            # In order: a formula can read a mapping's first entry.
            pairs = tuple(
                (self.of(k, depth), self.of(v, depth))
                for k, v in value.items()
            )
            return ("map", pairs, *extra)
        if isinstance(value, (set, frozenset)):
            items = (self.of(item, depth) for item in value)
            return ("set", tuple(sorted(items, key=repr)), *extra)
        name = kind.__name__ if kind in (list, tuple) else "seq"
        return (name, tuple(self.of(item, depth) for item in value), *extra)

    def _fields(self, value, depth):
        """A plain object's state: its ``__dict__`` and its slots."""
        if _library_class(type(value)):
            return ()
        return tuple(
            (name, self.of(field, depth + 1))
            for name, field in sorted(_fields_of(value).items())
        )

    def _component(self, value, depth):
        if _is_variable(value):
            formulas = sorted(
                (value.formulas or {}).items(), key=lambda item: str(item[0])
            )
            return (
                "variable",
                tuple(
                    (name, self.of(_variable_attribute(value, name)))
                    for name in _VARIABLE_CALCULATION_ATTRIBUTES
                ),
                tuple((str(start), self.of(f)) for start, f in formulas),
            )
        if isinstance(value, types.FunctionType):
            code = value.__code__
            if _library_path(code.co_filename):
                # Library code by name, but what it closes over and carries
                # by content: a decorator's wrapper holds the user's function
                # (contextmanager, singledispatch's registry).
                return (
                    "library",
                    value.__module__,
                    value.__qualname__,
                    tuple(
                        self.of(cell.cell_contents)
                        for cell in value.__closure__ or ()
                        if _cell_is_set(cell)
                    ),
                    self.of(_function_state(value)),
                )
            closure = tuple(
                (
                    name,
                    (
                        self.of(cell.cell_contents)
                        if _cell_is_set(cell)
                        else "unset"
                    ),
                )
                for name, cell in zip(
                    code.co_freevars, value.__closure__ or ()
                )
            )
            looked_up = tuple(
                (name, self.of(value.__globals__[name]))
                for name in sorted(_global_names(code))
                if name in value.__globals__
            ) + tuple(
                (f"{name}.{attribute}", self.of(found))
                for name, attribute, found in _module_reads(value)
            )
            return (
                "function",
                _fingerprint(code),
                self.of(value.__defaults__),
                self.of(value.__kwdefaults__),
                closure,
                looked_up,
                self.of(_function_state(value)),
            )
        if isinstance(value, functools.partial):
            return (
                "partial",
                self.of(value.func),
                self.of(value.args),
                self.of(value.keywords),
            )
        if isinstance(value, types.MethodType):
            return ("method", self.of(value.__func__), self.of(value.__self__))
        if _bound_builtin(value):
            return (
                "bound",
                type(value.__self__).__qualname__,
                value.__name__,
                self.of(value.__self__),
            )
        if isinstance(value, (classmethod, staticmethod)):
            return (type(value).__name__, self.of(value.__func__))
        if isinstance(value, property):
            return (
                "property",
                self.of(value.fget),
                self.of(value.fset),
                self.of(value.fdel),
            )
        engine = _engine(value)
        if engine is not None:
            system = _NO_SYSTEM
            if engine[0] == "simulation":
                system = getattr(value, "tax_benefit_system", None)
            elif engine[0] == "system":
                system = value
            elif hasattr(value, "simulation"):
                # A population or holder: its simulation's system.
                system = getattr(value.simulation, "tax_benefit_system", None)
            elif engine[0] != "parameter" and hasattr(
                value, "_tax_benefit_system"
            ):
                # An entity: the system its variables come from.
                system = value._tax_benefit_system
            elif (
                engine[0] == "parameter"
                and self._parameter_content(value) is None
                and self._main
                and not self._in_main_tree(value)
            ):
                # A stored node or scale, read by name only, that isn't a
                # compared system's own (a cloned branch's).
                return ("opaque", id(value))
            if self._main and system is not _NO_SYSTEM:
                if id(system) not in self._main:
                    # A simulation or system with a policy of its own (a
                    # branch with a cloned system): unequal to anything.
                    return ("opaque", id(value))
            return ("engine", *engine, self._parameter_content(value))
        if isinstance(value, type):
            if _library_class(value):
                return ("library", value.__module__, value.__qualname__)
            members = tuple(
                (name, self.of(member))
                for name, member in sorted(vars(value).items())
                if name not in _CLASS_BOOKKEEPING
                and not _enum_entry(value, name, member)
            )
            enum_members = (
                tuple(
                    # Each name, aliases included, with the member it
                    # names.
                    (
                        alias,
                        m.name,
                        self.of(m.value),
                        self.of(_member_fields(m)),
                    )
                    for alias, m in value.__members__.items()
                )
                if issubclass(value, enum.Enum)
                else ()
            )
            bases = tuple(self.of(base) for base in value.__bases__)
            meta = type(value)
            kind = (
                () if meta is type or _library_class(meta) else self.of(meta)
            )
            return (
                "class",
                value.__qualname__,
                members,
                bases,
                enum_members,
                kind,
            )
        kind = type(value)
        rebuilt = _rebuilt_from(value)
        if rebuilt is not None:
            name = f"{kind.__module__}.{kind.__qualname__}"
            return ("object", name, self.of(rebuilt, depth + 1))
        wrapped = _wrapped_callable(value)
        if wrapped is not None:
            fields = tuple(
                (name, self.of(field, depth + 1))
                for name, field in sorted(_fields_of(value).items())
            )
            return ("wrapped", kind.__qualname__, self.of(wrapped), fields)
        if _library_class(kind):
            singleton = _library_singleton(value)
            if singleton is not None:
                return ("library", *singleton)
            # Its state can't be read (no singleton, nothing it wraps or is
            # rebuilt from; a text form is no proof): unequal to anything,
            # and read as able to read any input (see _reads).
            return ("opaque", id(value))
        if depth >= _OBJECT_DEPTH:
            # Deeper than is read: unequal to anything rather than cut off.
            return ("opaque", id(value))
        return ("object", self.of(kind), self._fields(value, depth))

    def _parameter_content(self, value):
        """What a held parameter object gives: a view or scale as formulas
        read it, a stored leaf by its values; a stored node by name only (its
        tree is compared under the limits directly)."""
        if hasattr(value, "thresholds") or hasattr(value, "_children"):
            return self.of(_flatten(value, self))
        if hasattr(value, "values_list"):
            return tuple(
                (item.instant_str, self.of(item.value))
                for item in value.values_list
            )
        return None

    # --- what code names and holds

    def _parts(self, value) -> tuple[set, list]:
        """A component's own names (strings its code and values carry) and
        the components it holds."""
        names, held = set(), []
        if _is_variable(value):
            for name in _VARIABLE_CALCULATION_ATTRIBUTES:
                self._collect(_variable_attribute(value, name), names, held)
            held.extend((value.formulas or {}).values())
        elif isinstance(value, types.FunctionType):
            code = value.__code__
            if _library_path(code.co_filename):
                cells = [
                    cell.cell_contents
                    for cell in value.__closure__ or ()
                    if _cell_is_set(cell)
                ]
                self._collect([*cells, _function_state(value)], names, held)
                return names, held
            names |= _code_names(code)
            self._collect(_function_state(value), names, held)
            self._collect(value.__defaults__, names, held)
            self._collect(value.__kwdefaults__, names, held)
            for cell in value.__closure__ or ():
                if _cell_is_set(cell):
                    self._collect(cell.cell_contents, names, held)
            for name in sorted(_loaded_globals(code)):
                if name in value.__globals__:
                    self._collect(value.__globals__[name], names, held)
            for _, _, found in _module_reads(value):
                self._collect(found, names, held)
        elif isinstance(value, functools.partial):
            self._collect(
                (value.func, value.args, value.keywords), names, held
            )
        elif isinstance(value, types.MethodType):
            self._collect((value.__func__, value.__self__), names, held)
        elif isinstance(value, (classmethod, staticmethod)):
            self._collect(value.__func__, names, held)
        elif isinstance(value, property):
            self._collect((value.fget, value.fset, value.fdel), names, held)
        elif isinstance(value, type):
            if not _library_class(value):
                members = [
                    member
                    for name, member in vars(value).items()
                    if name not in _CLASS_BOOKKEEPING
                ]
                meta = type(value)
                extra = [] if meta is type or _library_class(meta) else [meta]
                self._collect((members, value.__bases__, extra), names, held)
        elif not _library_class(type(value)):
            # Its class too: a method can read what the fields don't name.
            fields = list(_fields_of(value).values())
            self._collect([*fields, type(value)], names, held)
        return names, held

    def _collect(self, value, names, held, active=None):
        active = set() if active is None else active
        engine = _engine(value)
        if engine is not None:
            if engine[1]:
                names.add(engine[1])
        elif _bound_builtin(value):
            self._collect(value.__self__, names, held, active)
        elif (
            isinstance(value, numpy.generic)
            and (type(value).__module__ or "").split(".")[0] != "numpy"
        ):
            if id(value) not in active:
                active.add(id(value))
                extra = [*_fields_of(value).values(), type(value)]
                self._collect(extra, names, held, active)
        elif isinstance(value, (str, bytes, complex, int, float)) and type(
            value
        ) not in (str, bytes, complex, int, float, bool):
            # A subclass of a plain value: its text, its fields, its class.
            if isinstance(value, str):
                names.add(str(value))
            if id(value) not in active:
                active.add(id(value))
                extra = [*_fields_of(value).values(), type(value)]
                self._collect(extra, names, held, active)
        elif isinstance(value, str):
            names.add(value)
        elif isinstance(value, (list, tuple, set, frozenset, dict)):
            if id(value) in active:
                return
            active.add(id(value))
            items = value.items() if isinstance(value, dict) else value
            for item in items:
                self._collect(item, names, held, active)
            if type(value) not in (dict, list, tuple, set, frozenset):
                extra = [getattr(value, "default_factory", None)]
                if not _library_class(type(value)):
                    # Its class too: a method can read what items don't.
                    extra += [*_fields_of(value).values(), type(value)]
                self._collect(extra, names, held, active)
        elif _rebuilt_from(value) is not None:
            if id(value) not in active and len(active) < _COLLECT_DEPTH:
                active.add(id(value))
                self._collect(_rebuilt_from(value), names, held, active)
        elif _wrapped_callable(value) is not None:
            if id(value) not in active and len(active) < _COLLECT_DEPTH:
                active.add(id(value))
                self._collect(_wrapped_callable(value), names, held, active)
        elif isinstance(value, numpy.ndarray):
            if type(value) is not numpy.ndarray and id(value) not in active:
                active.add(id(value))
                extra = [*_fields_of(value).values(), type(value)]
                self._collect(extra, names, held, active)
        elif _opaque(value):
            names.add(ANY_NAME)
        elif _is_component(value):
            held.append(value)

    def walk(self, variable, stop=frozenset()) -> tuple[set, list]:
        """The names a variable's code carries (the strings its code and
        values hold, see :meth:`_parts`) and every component it holds, at
        any depth: its own formulas always followed, anything else whose
        fingerprint is in ``stop`` listed but not followed."""
        if variable is None:
            return set(), []
        names, held = self._parts(variable)
        own = {id(item) for item in held}
        found, stack, seen = [], list(held), set()
        while stack:
            value = stack.pop()
            if id(value) in seen:
                continue
            seen.add(id(value))
            found.append(value)
            if stop and id(value) not in own and self.of(value) in stop:
                continue
            more, inner = self._parts(value)
            names |= more
            stack.extend(inner)
        names.discard(ANY_NAME)
        return names, found


# How many items a rebuilt object may be filled with and still be read.
_REBUILT_ITEMS = 100_000
# How many containers and rebuilt objects one walk follows, at most.
_COLLECT_DEPTH = 500

# Class members that are bookkeeping, not behaviour (the generated module
# name differs between systems).
_CLASS_BOOKKEEPING = frozenset(
    {
        "__module__",
        "__qualname__",
        "__doc__",
        "__dict__",
        "__weakref__",
        "__annotations__",
        "__annotate__",
        "__firstlineno__",
        "__static_attributes__",
        "__orig_bases__",
        "__parameters__",
        "__slotnames__",
        "__abstractmethods__",
        "_abc_impl",
    }
)


# Read directly, never through pickling: values, containers, code.
_NOT_REBUILT = (
    bool,
    int,
    float,
    complex,
    str,
    bytes,
    bytearray,
    list,
    tuple,
    dict,
    set,
    frozenset,
    type,
    types.ModuleType,
    types.FunctionType,
    types.BuiltinFunctionType,
    enum.Enum,
)


def _rebuilt_from(value):
    """What rebuilds a library object, as pickling gives it: its constructor's
    arguments, its state, and any items it is filled with (a ``deque``'s,
    an ``OrderedDict``'s). ``None`` for anything else, or for anything too
    big to read whole."""
    kind = type(value)
    if isinstance(value, _NOT_REBUILT) or value is None:
        return None
    if not _library_class(kind) or _engine(value) is not None:
        return None
    try:
        reduced = value.__reduce_ex__(4)
    except Exception:  # noqa: BLE001 - not reducible: opaque
        return None
    if not isinstance(reduced, tuple) or len(reduced) < 2:
        return None
    filled = []
    for items in reduced[3:5]:
        if items is None:
            filled.append(None)
            continue
        listed = list(itertools.islice(items, _REBUILT_ITEMS + 1))
        if len(listed) > _REBUILT_ITEMS:
            return None
        filled.append(listed)
    return (*reduced[1:3], *filled)


# The name an object whose state can't be read contributes: it could read
# anything, so it reads what every limit covers.
ANY_NAME = "*"


def _wrapped_callable(value):
    """What a library callable wraps (``functools.cache``, ``wraps``)."""
    if isinstance(value, (types.FunctionType, type)):
        return None
    if not callable(value) or not _library_class(type(value)):
        return None
    for name in ("__wrapped__", "pyfunc"):
        wrapped = getattr(value, name, None)
        if callable(wrapped):
            return wrapped
    return None


def _library_singleton(value):
    """``(module, name)`` for a library callable its module holds under its
    own name (``numpy.where``, ``len``): the same object in every system."""
    if not callable(value):
        return None
    name = getattr(value, "__name__", None)
    if not isinstance(name, str):
        return None
    for module in (
        getattr(value, "__module__", None),
        type(value).__module__,
        "builtins",
    ):
        top = (module or "").split(".")[0]
        for holder in (module, top):
            found = getattr(sys.modules.get(holder or ""), name, None)
            if found is value:
                return (holder, name)
    return None


def _opaque(value) -> bool:
    """A library object whose state can't be read: no singleton, nothing it
    wraps or is rebuilt from (a text form is no proof of state)."""
    kind = type(value)
    if isinstance(value, (type, types.ModuleType, types.FunctionType)):
        return False
    if _engine(value) is not None or isinstance(value, _NOT_REBUILT):
        return False
    if value is None or not _library_class(kind):
        return False
    if (
        _library_singleton(value)
        or _wrapped_callable(value)
        or _rebuilt_from(value)
    ):
        return False
    return True


def _function_state(function) -> dict:
    """A function's own attributes, as a decorator leaves them
    (``__wrapped__``, singledispatch's ``registry``)."""
    return {
        name: item
        for name, item in sorted(vars(function).items())
        if name not in ("__module__", "__qualname__", "__name__", "__doc__")
    }


def _bound_builtin(value) -> bool:
    """A built-in method bound to an object (``rates.get``), not to a
    module (``len``)."""
    owner = getattr(value, "__self__", None)
    return (
        isinstance(value, types.BuiltinMethodType)
        and owner is not None
        and not isinstance(owner, types.ModuleType)
    )


def _module_reads(function) -> list:
    """What a measure's function reads from a helper module it imports
    (``helpers.surcharge``): each name its code uses that the module has.
    Library modules and the model's are read by name."""
    found = []
    code = function.__code__
    names = _global_names(code)
    for name in sorted(names):
        module = function.__globals__.get(name)
        if not isinstance(module, types.ModuleType):
            continue
        top = module.__name__.split(".")[0]
        if top == "policyengine_uk" or _library_module(module.__name__):
            continue
        for attribute in sorted(names):
            if attribute in vars(module):
                found.append((name, attribute, vars(module)[attribute]))
    return found


def _fields_of(value) -> dict:
    """An object's ``__dict__`` and slots."""
    found = dict(getattr(value, "__dict__", None) or {})
    for kind in type(value).__mro__:
        slots = kind.__dict__.get("__slots__", ())
        for name in [slots] if isinstance(slots, str) else slots:
            if name in ("__dict__", "__weakref__"):
                continue
            stored = name
            if name.startswith("__") and not name.endswith("__"):
                # Python stores a private slot under its class's name, so
                # a base's and a subclass's are two fields.
                stored = f"_{kind.__name__.lstrip('_')}{name}"
            if stored in found:
                continue
            try:
                found[stored] = getattr(value, stored)
            except AttributeError:
                pass
    return found


def _engine(value):
    """``(kind, name)`` for an engine object a formula holds, read by name
    as formulas read the engine's own: a simulation or system (its data are
    what is being costed, its variables and parameters are compared
    directly), a population or entity, or a parameter, view or scale, whose
    path is the name. ``None`` for anything else."""
    if isinstance(value, type) or _is_variable(value):
        return None
    if hasattr(value, "tax_benefit_system") and hasattr(value, "calculate"):
        return ("simulation", None)
    if all(
        hasattr(value, a) for a in ("variables", "parameters", "get_variable")
    ):
        return ("system", None)
    module = type(value).__module__ or ""
    if module.startswith(
        ("policyengine_core.parameters", "policyengine_core.taxscales")
    ):
        name = getattr(value, "name", None) or getattr(value, "_name", None)
        return ("parameter", name if isinstance(name, str) else None)
    if module.startswith(
        ("policyengine_core.populations", "policyengine_core.entities")
    ):
        return (type(value).__qualname__, None)
    if module.startswith("policyengine_core.holders"):
        variable = getattr(value, "variable", None)
        return ("holder", getattr(variable, "name", None))
    return None


def _is_component(value) -> bool:
    """Something whose code or fields can read a variable or a parameter."""
    if isinstance(
        value, (types.FunctionType, functools.partial, types.MethodType)
    ):
        return True
    if isinstance(value, (classmethod, staticmethod, property)):
        return True
    if _is_variable(value):
        return True
    if isinstance(value, type):
        return not _library_class(value)
    if isinstance(value, (enum.Enum, types.ModuleType, numpy.ndarray)):
        return False
    if _engine(value) is not None:
        return False
    # Any other object of a class from model or measure code, fields or
    # none: its class's methods are code too.
    return not _library_class(type(value))


# --- what the code that differs reads, observed while the measure runs
#
# Which inputs a formula reads is watched, not inferred from its source: a
# name built at run time, a helper imported anywhere, a value held in any
# form, all read through the engine, and the engine is watched while the
# simulations run. Each read is put down to the code that made it by the
# Python frames between the read and the variable being calculated.


def _measure_code(function) -> bool:
    """Whether a function is a measure's code (a template's or a
    modifier's), not the model's or a library's: the code whose state a
    measure can change while the simulations run."""
    code = getattr(function, "__code__", None)
    if code is None:
        return False
    return _measure_path(code.co_filename)


def _measure_path(path: str) -> bool:
    """Whether code from ``path`` is a measure's: neither a library's nor
    the model's."""
    return not _library_path(path) and "/policyengine_uk/" not in path


def _formulas(variable) -> list:
    return list((variable.formulas or {}).values()) if variable else []


@dataclass
class _Exempt:
    """For one side of a changed variable, the formulas its code may call
    for their own result (on the arguments the engine gives the variable's
    formula) without that being part of the difference: an unchanged
    variable's, the other side's, or one both sides hold, never the side's
    own. ``members`` are those functions with their fingerprints. While a
    watch runs each has a code object of its own (see
    :meth:`_Changes.deshare`), so ``codes`` maps a code object's id to the
    fingerprint of the one function that runs it (as a set) and
    ``functions`` to that function (for its defaults). ``other_side`` holds
    the other side's formulas' fingerprints: calling one of those for its
    result wraps the other side."""

    members: tuple
    fingerprints: frozenset
    other_side: frozenset
    codes: dict = field(default_factory=dict)
    functions: dict = field(default_factory=dict)


def _abolitions_changed(base_system, reform_system, behaviour) -> set:
    """Variables whose core abolition parameter differs between the sides.

    Core's ``_calculate`` reads ``gov.abolitions[variable.name]`` before
    running a formula. Both the stored leaves and cached views matter,
    just as they do for a limit's own parameters.
    """
    prefix = "gov.abolitions"
    with (
        _caches_left_as_found(base_system),
        _caches_left_as_found(reform_system),
    ):
        before = _structure(base_system.parameters, prefix)
        after = _structure(reform_system.parameters, prefix)
        changed = {
            path[len(prefix) + 1 :].split(".")[0]
            for path in before.keys() | after.keys()
            if not _same_effect(before.get(path), after.get(path))
        }
        views = [
            _views(system, prefix, behaviour, True)
            for system in (base_system, reform_system)
        ]
        for left, right in zip(*views):
            left, right = left or {}, right or {}
            changed |= {
                name
                for name in left.keys() | right.keys()
                if not _equal(left.get(name), right.get(name))
            }
    return changed


class _Changes:
    """The variables that behave differently between two systems (see
    :class:`_Behaviour`), and for each side of each what it may call for a
    result alone (:class:`_Exempt`) and the names its code carries."""

    def __init__(self, base_system, reform_system, behaviour):
        self.behaviour = behaviour
        self.systems = (base_system, reform_system)
        base, reform = base_system.variables, reform_system.variables
        abolished = _abolitions_changed(base_system, reform_system, behaviour)
        self.sides: dict = {}
        unchanged, installed = set(), []
        for name in sorted(base.keys() | reform.keys()):
            pair = (base.get(name), reform.get(name))
            formulas = [f for side in pair for f in _formulas(side)]
            installed += formulas
            if name in abolished or behaviour.of(pair[0]) != behaviour.of(
                pair[1]
            ):
                self.sides[name] = pair
            else:
                unchanged |= {behaviour.of(f) for f in formulas}
        self.exempt: dict = {}
        self._literal: dict = {}
        self._swapped: list = []
        # Unchanged variables of measure code, with their fingerprints on
        # each side at the start: state measure code holds can be changed
        # while the simulations run (a dict a wrapper edits), so these are
        # checked again (see Observation).
        self.measure_variables: dict = {
            name: (
                behaviour.of(base.get(name)),
                behaviour.of(reform.get(name)),
            )
            for name in sorted(base.keys() & reform.keys())
            if name not in self.sides
            and any(
                _measure_code(f)
                for side in (base[name], reform[name])
                for f in _formulas(side)
            )
        }
        for name, pair in self.sides.items():
            self._exempt_for(name, pair, unchanged, installed)

    def _exempt_for(self, name, pair, unchanged, installed):
        of = self.behaviour.of
        reached = [self.behaviour.walk(side)[1] for side in pair]
        functions = [
            item
            for items in reached
            for item in items
            if isinstance(item, types.FunctionType)
        ]
        # A formula: one a variable of either system has, or one a
        # variable either side holds has.
        formulas = installed + [
            f
            for items in reached
            for item in items
            if _is_variable(item)
            for f in _formulas(item)
        ]
        held = [
            {
                of(item)
                for item in items
                if isinstance(item, types.FunctionType) or _is_variable(item)
            }
            for items in reached
        ]
        common = held[0] & held[1] & {of(f) for f in formulas}
        for side in (0, 1):
            other = frozenset(of(f) for f in _formulas(pair[1 - side]))
            fingerprints = frozenset(unchanged | other | common)
            own = {id(f) for f in _formulas(pair[side])}
            members: dict = {}
            for f in formulas + functions:
                if (
                    isinstance(f, types.FunctionType)
                    and id(f) not in own
                    and of(f) in fingerprints
                ):
                    members[id(f)] = (f, of(f))
            self.exempt[(name, side)] = _Exempt(
                members=tuple(members.values()),
                fingerprints=fingerprints,
                other_side=other,
            )

    def literal_names(self, name, side) -> set:
        """The names a side's code carries: what it reads by a name written
        in it, run or not, and what it adds and subtracts. Not followed
        into what it may call for a result alone."""
        key = (name, side)
        if key not in self._literal:
            self._literal[key] = self.behaviour.walk(
                self.sides[name][side], self.exempt[key].fingerprints
            )[0]
        return self._literal[key]

    def codes(self) -> list:
        """Every code object an exempt call may run, once each."""
        found = {}
        for exempt in self.exempt.values():
            for function, _ in exempt.members:
                found[id(function.__code__)] = function.__code__
        return list(found.values())

    def deshare(self):
        """For a watch, give every exempt function a code object of its own
        (an equal copy), so the code a frame runs names the one function
        running it. A factory's functions share one, and a call of one of
        them with another's defaults would otherwise pass for a call for
        its own result. A function made from the same code while the watch
        runs keeps the shared object, so it is never exempt."""
        done: dict = {}
        for exempt in self.exempt.values():
            for function, _ in exempt.members:
                if id(function) not in done:
                    done[id(function)] = function
                    self._swapped.append((function, function.__code__))
                    function.__code__ = function.__code__.replace()
        for exempt in self.exempt.values():
            exempt.codes = {
                id(f.__code__): frozenset({fp}) for f, fp in exempt.members
            }
            exempt.functions = {
                id(f.__code__): (f,) for f, _ in exempt.members
            }

    def restore(self):
        """Give every function its own code object back (see
        :meth:`deshare`)."""
        while self._swapped:
            function, code = self._swapped.pop()
            function.__code__ = code


class _Unobservable(Exception):
    """The engine can't be watched here."""


@dataclass
class _Entry:
    """A calculation in progress: the observation watching its simulation
    (or ``None``), the side, the variable, the frame it was asked for in,
    the period, and whether the variable is one that changed. A foreign
    entry is a calculation in a simulation no watch knows (a branch with a
    cloned system), asked for inside a changed variable's: it carries that
    variable's entry, so everything it reads is that variable's."""

    observation: object
    side: object
    name: str
    frame: object
    period: object
    changed: bool
    foreign: bool = False


class _Thread(threading.local):
    def __init__(self):
        self.entries: list = []
        # By frame id: a call of an exempt formula started while a changed
        # variable was being calculated: _WRAPS if for its own result and
        # one of the other side's formulas, _OWN if for its own result,
        # 0 otherwise.
        self.own: dict = {}
        # While a wrapping is checked (see Observation._uses_result): how
        # far the limited inputs read inside wrapping calls are moved (0
        # for not at all), and what those calls returned.
        self.moving = 0
        self.returned = None
        # While the watch fingerprints state afresh (see _drifted): what
        # that reads is not a formula's.
        self.checking = False


_THREAD = _Thread()
_WATCHING: list = []
_MONITORED: dict = {}
_ENGINE: dict = {}
_HOOK_LOCK = threading.RLock()
# sys.monitoring tool ids no tool of Python's own claims.
_TOOL_IDS = (3, 4)
_EVENTS = sys.monitoring.events
# The inputs the limits name, moved when a wrapping is checked.
_MISSING_INPUTS = frozenset(limit.missing_input for limit in DATA_LIMITS)
# How far they are moved, each in turn, until the wrapping formula's result
# moves: quarter-decades from £100 to £1tn, so a result used past a
# threshold, or within a band, moves once a move takes it there. (A band
# narrower than a quarter-decade of the move can still be stepped over: the
# use is then missed and the wrapped side's reads count, which fails safe.)
_MOVES = tuple(10 ** (exponent / 4) for exponent in range(8, 49))
# Where the engine's parameter tree, scales and their tracing are read.
_PARAMETER_DIRS = tuple(
    f"/policyengine_core/{part}/"
    for part in ("parameters", "taxscales", "tracers")
)
# Own-result calls, by what they call (see _Thread.own).
_OWN, _WRAPS = 1, 2
# Every parameter path a limit covers, and each node on the way to one with
# the names it leads on by.
_LIMITED_PREFIXES = tuple(p for limit in DATA_LIMITS for p in limit.parameters)
_TOWARDS: dict = {}
for _prefix in _LIMITED_PREFIXES:
    _parts_of = _prefix.split(".")
    for _depth in range(len(_parts_of)):
        _TOWARDS.setdefault(".".join(_parts_of[:_depth]), set()).add(
            _parts_of[_depth]
        )
if _LIMITED_PREFIXES:
    del _prefix, _parts_of, _depth


def _engine_parts():
    """The engine's simulation and population classes, the methods watched,
    and the code objects of its own calculation."""
    if not _ENGINE:
        from policyengine_core.parameters.at_instant_like import (
            AtInstantLike,
        )
        from policyengine_core.parameters.parameter_node_at_instant import (
            ParameterNodeAtInstant,
        )
        from policyengine_core.populations.population import Population
        from policyengine_core.simulations.simulation import Simulation

        _ENGINE.update(
            simulation=Simulation,
            population=Population,
            calculate=Simulation.__dict__["calculate"],
            get_holder=Population.__dict__["get_holder"],
            run_formula=Simulation.__dict__["_run_formula"].__code__,
            at_instant_like=AtInstantLike,
            get_at_instant=AtInstantLike.__dict__["get_at_instant"],
            # Stored parameters, scales, brackets and nodes: their values
            # read without an instant (values_list, brackets, children).
            stored_getattribute=AtInstantLike.__dict__.get("__getattribute__"),
            node_at_instant=ParameterNodeAtInstant,
            # Inherited from object unless the class defines its own.
            node_getattribute=ParameterNodeAtInstant.__dict__.get(
                "__getattribute__"
            ),
            node_getitem=ParameterNodeAtInstant.__dict__["__getitem__"],
        )
        from policyengine_core.holders.holder import Holder

        _ENGINE["holder"] = Holder
        _ENGINE["get_array"] = Holder.__dict__["get_array"]
        _ENGINE["computing"] = frozenset(
            id(code)
            for code in (
                _ENGINE["calculate"].__code__,
                Simulation.__dict__["_calculate"].__code__,
                _ENGINE["run_formula"],
            )
        )
        _ENGINE["runners"] = (_ENGINE["run_formula"], _run_alone.__code__)
        from policyengine_core.parameters.parameter_node import ParameterNode

        _ENGINE["view_building"] = frozenset(
            {
                id(ParameterNode.__dict__["_get_at_instant"].__code__),
                id(ParameterNodeAtInstant.__dict__["__init__"].__code__),
            }
        )
    return _ENGINE


def _run_alone(population, period, parameters_at, formula):
    """Run a formula as the engine's ``_run_formula`` does, outside a
    calculation (its locals are named as the engine's are)."""
    if formula.__code__.co_argcount == 2:
        return formula(population, period)
    return formula(population, period, parameters_at)


def _watcher(sim):
    """The newest running observation watching ``sim``'s system, and the
    side it is on there."""
    system = getattr(sim, "tax_benefit_system", None)
    for observation in reversed(_WATCHING):
        side = observation.side_of(system)
        if side is not None:
            return observation, side
    return None, None


def _observed_calculate(self, variable_name, *args, **kwargs):
    entries = _THREAD.entries
    inside = 0
    top = entries[-1] if entries else None
    if top is not None and top.changed:
        inside = top.observation._read(top, variable_name, sys._getframe(1))
    observation, side = _watcher(self)
    if (
        observation is not None
        and not _THREAD.checking
        and variable_name in observation.changes.measure_variables
    ):
        observation._check_unchanged(entries, variable_name, side, self)
    foreign_key = None
    if observation is None and top is not None and top.changed:
        # A simulation no watch knows, asked from inside a changed
        # variable's calculation: what it calculates is that variable's.
        # A value it already holds was calculated unwatched, so the
        # variable is unobservable unless this watch saw it calculated.
        foreign_key = (
            id(self),
            variable_name,
            top.observation._period(self, args, kwargs),
        )
        if not _THREAD.checking and foreign_key not in (
            top.observation.foreign_calculated
        ):
            top.observation._foreign_cached(
                top, self, variable_name, args, kwargs
            )
        entry = _Entry(
            top.observation,
            top.side,
            top.name,
            top.frame,
            top.period,
            True,
            foreign=True,
        )
    else:
        changed = (
            observation is not None
            and variable_name in observation.changes.sides
        )
        period = observation._period(self, args, kwargs) if changed else None
        if changed:
            observation.requested.setdefault((variable_name, side), set()).add(
                period
            )
        entry = _Entry(
            observation, side, variable_name, sys._getframe(), period, changed
        )
    entries.append(entry)
    try:
        result = _ENGINE["calculate"](self, variable_name, *args, **kwargs)
        if foreign_key is not None:
            entry.observation.foreign_calculated.add(foreign_key)
    finally:
        entries.pop()
        if not entries:
            _THREAD.own.clear()
    if (
        inside == _WRAPS
        and _THREAD.moving
        and variable_name in _MISSING_INPUTS
    ):
        return _moved(result, _THREAD.moving)
    return result


def _moved(values, by):
    """``values`` changed everywhere: a purchase raised by ``by``, a flag
    flipped. Anything else is left as it is."""
    array = numpy.asarray(values)
    if array.dtype == bool:
        return ~array
    if numpy.issubdtype(array.dtype, numpy.number):
        return array + by
    return values


def _observed_get_holder(self, variable_name):
    entries = _THREAD.entries
    if entries and entries[-1].changed:
        frame = sys._getframe(1)
        if not _engine_internal(frame, entries[-1].frame):
            entries[-1].observation._read(entries[-1], variable_name, frame)
    return _ENGINE["get_holder"](self, variable_name)


def _observed_get_array(self, period, *args, **kwargs):
    """A holder's values read: by the engine's own calculation (not a
    read), or by a formula's code, however it came by the holder (fetched
    now, or held from before the watch). Inside a wrapping call while a
    wrapping is checked, a limited input's values read moved."""
    values = _ENGINE["get_array"](self, period, *args, **kwargs)
    entries = _THREAD.entries
    if entries and entries[-1].changed:
        frame = sys._getframe(1)
        if not _engine_internal(frame, entries[-1].frame):
            name = getattr(getattr(self, "variable", None), "name", None)
            entry = entries[-1]
            owner = getattr(self, "simulation", None)
            if (
                values is not None
                and not _THREAD.checking
                and _watcher(owner)[0] is None
                and _held_calculated(owner, name, period)
            ):
                # Values a simulation no watch knows holds: calculated
                # unwatched, whatever they read.
                entry.observation.unobservable.setdefault(
                    entry.name,
                    f"it read {name} as held by a simulation no watch knows",
                )
            inside = entry.observation._read(entry, name, frame)
            if inside == _WRAPS and _THREAD.moving and name in _MISSING_INPUTS:
                if values is None:
                    values = self.default_array()
                return _moved(values, _THREAD.moving)
    return values


def _limited_path(path) -> bool:
    return any(_under(path, prefix) for prefix in _LIMITED_PREFIXES)


def _parameter_read(path, key, frame):
    """Record, for the changed calculation in progress, a read of what the
    parameter node at ``path`` leads to by ``key``, where a limit covers
    it: the node itself, a limited child of a node on the way to one, or
    (an array of keys) every limited path below the node. Not while the
    engine builds a view of the tree: that reads every parameter, for
    whatever formula asked for the view first."""
    if not isinstance(path, str) or _building_view(frame):
        return
    if _limited_path(path):
        targets = [path]
    elif isinstance(key, str):
        child = f"{path}.{key}" if path else key
        if key not in _TOWARDS.get(path, ()) or not _limited_path(child):
            return
        targets = [child]
    elif key is not None and path in _TOWARDS:
        targets = [p for p in _LIMITED_PREFIXES if not path or _under(p, path)]
    else:
        return
    entry = _THREAD.entries[-1]
    for target in targets:
        entry.observation._read(entry, target, frame)


def _building_view(frame) -> bool:
    """Whether a parameter is read by the engine building a view of the
    tree at an instant (``ParameterNode._get_at_instant``, which every
    node's view runs), not for code that asked for it."""
    building = _ENGINE["view_building"]
    while frame is not None:
        code = frame.f_code
        if id(code) in building:
            return True
        if not any(part in code.co_filename for part in _PARAMETER_DIRS):
            return False
        frame = frame.f_back
    return False


def _node_path(node):
    for name in ("_name", "name"):
        try:
            return object.__getattribute__(node, name)
        except AttributeError:
            continue
    return None


def _observed_node_getattribute(self, name):
    entries = _THREAD.entries
    if entries and entries[-1].changed and name[:1] != "_":
        _parameter_read(_node_path(self), name, sys._getframe(1))
    original = _ENGINE["node_getattribute"] or object.__getattribute__
    return original(self, name)


def _observed_stored_getattribute(self, name):
    entries = _THREAD.entries
    if entries and entries[-1].changed and name[:1] != "_":
        _parameter_read(_node_path(self), name, sys._getframe(1))
    original = _ENGINE["stored_getattribute"] or object.__getattribute__
    return original(self, name)


def _observed_node_getitem(self, key):
    entries = _THREAD.entries
    if entries and entries[-1].changed:
        _parameter_read(_node_path(self), key, sys._getframe(1))
    return _ENGINE["node_getitem"](self, key)


def _observed_get_at_instant(self, instant):
    entries = _THREAD.entries
    if entries and entries[-1].changed:
        path = _node_path(self)
        if isinstance(path, str) and _limited_path(path):
            _parameter_read(path, None, sys._getframe(1))
    return _ENGINE["get_at_instant"](self, instant)


def _engine_internal(frame, boundary) -> bool:
    """Whether a holder is fetched by the engine's own calculation, not by
    a formula's code (directly, or through an engine helper it calls)."""
    computing = _ENGINE["computing"]
    while frame is not None and frame is not boundary:
        code = frame.f_code
        if id(code) in computing:
            return True
        if "/policyengine_core/" not in code.co_filename:
            return False
        frame = frame.f_back
    return True


def _on_start(code, offset):
    """``sys.monitoring`` PY_START for a watched code object, inside a
    changed variable's calculation: the engine starting the variable's
    formula or sums (``_run_formula``: it ran, so what is written in it
    counts), or an exempt formula starting, and whether for its own
    result."""
    thread = _THREAD
    frame = sys._getframe(1)
    entries = thread.entries
    if code is _ENGINE["run_formula"]:
        if entries and entries[-1].changed and not entries[-1].foreign:
            entry = entries[-1]
            variable = frame.f_locals.get("variable")
            if getattr(variable, "name", None) == entry.name:
                entry.observation.ran.add(
                    (entry.name, entry.side, entry.period)
                )
        return
    key = id(frame)
    if thread.checking or not entries or not entries[-1].changed:
        thread.own.pop(key, None)
        return
    entry = entries[-1]
    if entry.foreign:
        # Everything a foreign calculation does is the variable's.
        thread.own[key] = 0
        return
    try:
        exempt = entry.observation.changes.exempt[(entry.name, entry.side)]
        found = exempt.codes.get(id(code))
        own = 0
        function = exempt.functions.get(id(code), (None,))[0]
        if (
            found is not None
            and _own_result(frame, code, entry, exempt.functions[id(code)])
            and not _drifted(entry.observation, function, found)
        ):
            own = _WRAPS if found <= exempt.other_side else _OWN
        thread.own[key] = own
        if own == _WRAPS:
            entry.observation.wrapped.add(
                (entry.name, 1 - entry.side, entry.period)
            )
    except Exception as error:  # noqa: BLE001 - never break a formula
        thread.own[key] = 0
        entry.observation._failed(entry.name, error)


def _drifted(observation, function, fingerprints) -> bool:
    """Whether a measure-code function's fingerprint, taken afresh, is no
    longer one of ``fingerprints`` (the watch-start ones): state it holds
    was changed while the simulations ran. The model's own functions can't
    be changed that way by a measure (editing the model's globals is not a
    measure)."""
    if not _measure_code(function):
        return False
    return _fresh(observation, function) not in fingerprints


def _fresh(observation, value):
    """``value``'s fingerprint taken afresh, reading nothing as a
    formula's."""
    thread = _THREAD
    thread.checking = True
    try:
        behaviour = _Behaviour(main_systems=observation.changes.systems)
        return behaviour.of(value)
    finally:
        thread.checking = False


def _on_return(code, offset, value):
    """``sys.monitoring`` PY_RETURN for an exempt formula's code: while a
    wrapping is checked, what a wrapping call returned."""
    thread = _THREAD
    if (
        thread.returned is not None
        and thread.own.get(id(sys._getframe(1))) == _WRAPS
    ):
        thread.returned.append(_copied(value))


def _copied(value):
    try:
        return numpy.array(value, copy=True)
    except Exception:  # noqa: BLE001 - compared by identity instead
        return value


def _same(a, b) -> bool:
    try:
        return bool(numpy.array_equal(a, b, equal_nan=True))
    except TypeError:
        try:
            return bool(numpy.array_equal(a, b))
        except Exception:  # noqa: BLE001 - can't tell: not the same
            return False


def _own_result(frame, code, entry, functions=()) -> bool:
    """Whether ``frame``, a formula starting inside ``entry``'s
    calculation, was called as the engine calls a formula, on exactly what
    it gave that calculation's: the same population, period and parameters
    (the first two only for a formula of two parameters), every other
    parameter at its default for one of ``functions`` (the functions
    behind ``code``), and nothing in ``*args`` or ``**kwargs``."""
    count = code.co_argcount
    if count < 2:
        return False
    given_count = 2 if count == 2 else 3
    runners = _ENGINE["runners"]
    caller = run = frame.f_back
    while (
        run is not None
        and run is not entry.frame
        and run.f_code not in runners
    ):
        run = run.f_back
    if run is None or run is entry.frame or run is caller:
        # No formula of the variable running, or this is that formula.
        return False
    given, called = run.f_locals, frame.f_locals
    names = code.co_varnames
    period, want = called[names[1]], given["period"]
    if not (
        called[names[0]] is given["population"]
        and type(period) is type(want)
        and bool(period == want)
        and (given_count == 2 or called[names[2]] is given["parameters_at"])
    ):
        return False
    rest = count + code.co_kwonlyargcount
    if code.co_flags & inspect.CO_VARARGS:
        if called[names[rest]] != ():
            return False
        rest += 1
    if code.co_flags & inspect.CO_VARKEYWORDS and called[names[rest]]:
        return False
    extra = names[given_count:count]
    keywords = names[count : count + code.co_kwonlyargcount]
    if not extra and not keywords:
        return True
    return any(
        _at_defaults(function, called, given_count, extra, keywords)
        for function in functions
    )


def _at_defaults(function, called, start, extra, keywords) -> bool:
    """Whether a formula's parameters after the engine's, and its
    keyword-only ones, hold ``function``'s defaults."""
    defaults = function.__defaults__ or ()
    first = function.__code__.co_argcount - len(defaults)
    for index, name in enumerate(extra, start=start):
        if index < first or not _same_value(
            called[name], defaults[index - first]
        ):
            return False
    keyword_defaults = function.__kwdefaults__ or {}
    return all(
        name in keyword_defaults
        and _same_value(called[name], keyword_defaults[name])
        for name in keywords
    )


def _same_value(a, b) -> bool:
    """The very object, or an equal plain value of the same type (a float
    by its text, so -0.0 is not 0.0)."""
    if a is b:
        return True
    if type(a) is not type(b):
        return False
    if isinstance(a, (float, complex)):
        return repr(a) == repr(b)
    plain = (bool, int, str, bytes, type(None))
    return isinstance(a, plain) and a == b


def _start_watching(observation):
    with _HOOK_LOCK:
        engine = _engine_parts()
        if not _WATCHING:
            tool = next(
                (i for i in _TOOL_IDS if sys.monitoring.get_tool(i) is None),
                None,
            )
            if tool is None:
                raise _Unobservable("no sys.monitoring tool id is free")
            sys.monitoring.use_tool_id(tool, "uk_budget_data.data_limits")
            sys.monitoring.register_callback(tool, _EVENTS.PY_START, _on_start)
            sys.monitoring.register_callback(
                tool, _EVENTS.PY_RETURN, _on_return
            )
            _ENGINE["tool"] = tool
            engine["simulation"].calculate = _observed_calculate
            engine["population"].get_holder = _observed_get_holder
            engine["at_instant_like"].get_at_instant = _observed_get_at_instant
            engine["at_instant_like"].__getattribute__ = (
                _observed_stored_getattribute
            )
            node = engine["node_at_instant"]
            node.__getattribute__ = _observed_node_getattribute
            node.__getitem__ = _observed_node_getitem
            engine["holder"].get_array = _observed_get_array
        for code in [*observation.changes.codes(), engine["run_formula"]]:
            held = _MONITORED.setdefault(id(code), [code, 0])
            if held[1] == 0:
                sys.monitoring.set_local_events(
                    _ENGINE["tool"], code, _EVENTS.PY_START | _EVENTS.PY_RETURN
                )
            held[1] += 1
        _WATCHING.append(observation)


def _stop_watching(observation):
    with _HOOK_LOCK:
        if observation not in _WATCHING:
            return
        _WATCHING.remove(observation)
        tool = _ENGINE["tool"]
        for code in [*observation.changes.codes(), _ENGINE["run_formula"]]:
            held = _MONITORED[id(code)]
            held[1] -= 1
            if held[1] == 0:
                sys.monitoring.set_local_events(tool, code, 0)
                del _MONITORED[id(code)]
        if not _WATCHING:
            engine = _ENGINE
            engine["simulation"].calculate = engine["calculate"]
            engine["population"].get_holder = engine["get_holder"]
            engine["at_instant_like"].get_at_instant = engine["get_at_instant"]
            if engine["stored_getattribute"] is None:
                del engine["at_instant_like"].__getattribute__
            else:
                engine["at_instant_like"].__getattribute__ = engine[
                    "stored_getattribute"
                ]
            node = engine["node_at_instant"]
            if engine["node_getattribute"] is None:
                del node.__getattribute__
            else:
                node.__getattribute__ = engine["node_getattribute"]
            node.__getitem__ = engine["node_getitem"]
            engine["holder"].get_array = engine["get_array"]
            for event in (_EVENTS.PY_START, _EVENTS.PY_RETURN):
                sys.monitoring.register_callback(tool, event, None)
            sys.monitoring.free_tool_id(tool)


class Observation:
    """What the code that differs between two simulations' systems reads
    while they run (see :func:`observing`).

    A read is any variable a calculation asks the engine for, any holder
    its code fetches, or any parameter under a limit it reaches (a stored
    parameter, scale, bracket or node, or a view of the tree at an
    instant; not the engine building a view). It is put down to a changed
    variable's side when it is made while that variable is being
    calculated there (in that simulation, a branch sharing its system, or
    a simulation no watch knows that the calculation asks), unless it is
    made inside a call of an exempt formula (:class:`_Exempt`) on the
    arguments the engine gave the variable's own formula, every other
    parameter at its default: that formula's result alone, which the
    change only uses.

    A side whose formula the other side calls that way is wrapped there,
    and its reads in that period are not the change's (a template adding
    to the original) when the result is used: moving the limited inputs
    read inside those calls (``_moved``, by growing amounts) moves what the
    calls return and what the wrapping formula returns (see
    :meth:`_uses_result`). A result discarded, or one no move reaches,
    does not wrap. What is written in a side's code counts wherever the
    engine ran its formula or sums unwrapped.

    A variable is unobservable when a value the engine calculated for it is
    held when the watch begins (one set as an input is not: the formula
    never runs for it), when values may come from a cache on disk, or when
    the engine can't be watched; it is then read as able to read anything
    (``ANY_NAME``)."""

    def __init__(self, sim_baseline, sim_reform):
        self.sims = (sim_baseline, sim_reform)
        systems = (
            sim_baseline.tax_benefit_system,
            sim_reform.tax_benefit_system,
        )
        self.changes = _Changes(*systems, _Behaviour(main_systems=systems))
        self._sides = {
            id(sim.tax_benefit_system): side
            for side, sim in enumerate(self.sims)
        }
        self.reads: dict = {}
        self.requested: dict = {}
        self.ran: set = set()
        self.wrapped: set = set()
        self.unobservable: dict = {}
        # Unchanged variables found changed after the run (see
        # _drift_at_end): each read as able to read anything.
        self.drifted: dict = {}
        # What simulations no watch knows calculated under this watch, by
        # (simulation id, variable, period).
        self.foreign_calculated: set = set()
        self.watching = False
        self.finished = False

    def side_of(self, system):
        return self._sides.get(id(system))

    def _period(self, sim, args, kwargs):
        try:
            from policyengine_core import periods

            period = args[0] if args else kwargs.get("period")
            if period is not None and not isinstance(period, periods.Period):
                period = periods.period(period)
            elif period is None and sim.default_calculation_period:
                period = periods.period(sim.default_calculation_period)
            return period
        except Exception:  # noqa: BLE001 - the engine reports a bad period
            return None

    def _foreign_cached(self, entry, sim, name, args, kwargs):
        """A simulation no watch knows, asked for ``name`` inside a changed
        variable's calculation: if it already holds a calculated value
        (calculated before the watch, unseen), the variable is
        unobservable. An input it holds is no calculation."""
        thread = _THREAD
        thread.checking = True
        try:
            held = _held_calculated(sim, name, self._period(sim, args, kwargs))
        finally:
            thread.checking = False
        if held:
            self.unobservable.setdefault(
                entry.name,
                f"it read {name} as already calculated by a simulation no "
                "watch knows",
            )

    def _check_unchanged(self, entries, name, side, sim):
        """An unchanged measure-code variable asked for inside a changed
        variable's calculation: if its fingerprint, taken afresh, differs
        from the watch-start one, state it holds was changed during the run
        (by the changed code, say), so the changed variable is
        unobservable."""
        changed = next(
            (e for e in reversed(entries) if e.changed and not e.foreign),
            None,
        )
        if changed is None:
            return
        variable = sim.tax_benefit_system.variables.get(name)
        if (
            _fresh(self, variable)
            != self.changes.measure_variables[name][side]
        ):
            self.unobservable.setdefault(
                changed.name,
                f"{name}, which it reads, changed while the simulations ran",
            )

    def _drift_at_end(self):
        """After the run: an unchanged measure-code variable whose two sides
        no longer match, taken afresh, was changed while the simulations
        ran; what it read could not be watched, so it is unobservable."""
        for name, start in self.changes.measure_variables.items():
            now = tuple(
                _fresh(self, self.changes.systems[side].variables.get(name))
                for side in (0, 1)
            )
            if now[0] != now[1] or now != start:
                self.drifted.setdefault(
                    name, "it changed while the simulations ran"
                )

    def _failed(self, name, error):
        self.unobservable.setdefault(
            name, f"watching it failed: {type(error).__name__}"
        )

    def _read(self, entry, name, frame) -> int:
        """Record ``name`` as read by ``entry``'s side, unless an exempt
        formula called for its own result made the read. Returns 0 for a
        read recorded, else what the calls it was made inside called
        (``_WRAPS`` if one is a call of the other side's formula)."""
        inside = 0
        if _THREAD.checking:
            return _OWN
        try:
            own = _THREAD.own
            exempt = self.changes.exempt[(entry.name, entry.side)]
            runners = _ENGINE["runners"]
            while frame is not None and frame is not entry.frame:
                if frame.f_code in runners and not entry.foreign:
                    break
                if id(frame.f_code) in exempt.codes:
                    inside = max(inside, own.get(id(frame), 0))
                frame = frame.f_back
            if not inside:
                self.reads.setdefault(
                    (entry.name, entry.side, entry.period), set()
                ).add(str(name))
        except Exception as error:  # noqa: BLE001 - never break a formula
            self._failed(entry.name, error)
        return inside

    def _start(self):
        """Check the simulations can be watched, then watch them."""
        if not self.changes.sides:
            return
        engine = _engine_parts()
        for sim in self.sims:
            if getattr(sim, "macro_cache_read", False):
                self._all_unobservable("values may come from a disk cache")
            run_formula = getattr(type(sim), "_run_formula", None)
            if (
                getattr(run_formula, "__code__", None)
                is not engine["run_formula"]
            ):
                self._all_unobservable("the engine runs formulas its own way")
            for each in (sim, *getattr(sim, "branches", {}).values()):
                for name in self.changes.sides:
                    if _calculated_before(each, name):
                        self.unobservable.setdefault(
                            name, "calculated before it was watched"
                        )
        self.changes.deshare()
        try:
            _start_watching(self)
        except _Unobservable as error:
            self.changes.restore()
            self._all_unobservable(str(error))
        except BaseException:
            self.changes.restore()
            raise
        else:
            self.watching = True

    def _all_unobservable(self, why):
        for name in self.changes.sides:
            self.unobservable.setdefault(name, why)

    def _stop(self):
        try:
            if self.watching:
                self._confirm_wrapping()
                self._drift_at_end()
        finally:
            try:
                _stop_watching(self)
            finally:
                self.changes.restore()
                self.watching = False
                self.finished = True

    def run(self, years):
        """Calculate each changed variable in each year on both simulations,
        as a run that publishes them would."""
        for name in self.changes.sides:
            for sim in self.sims:
                if name not in sim.tax_benefit_system.variables:
                    continue
                for year in years:
                    try:
                        sim.calculate(name, year)
                    except Exception as error:  # noqa: BLE001 - recorded
                        self._failed(name, error)

    def _confirm_wrapping(self):
        """Keep a wrapping only where the wrapped side's reads would touch
        a limit and the wrapping side uses the result (see
        :meth:`_uses_result`); a wrapping that touches nothing is kept, as
        dropping it changes nothing. The parameter caches the checks fill
        are emptied again."""
        doubtful = []
        for name, side, period in self.wrapped:
            if name in self.unobservable:
                continue
            names = self.reads.get((name, side, period), set())
            names = names | self.changes.literal_names(name, side)
            if any(_reads(limit, names) for limit in DATA_LIMITS):
                doubtful.append((name, side, period))
        with (
            _caches_left_as_found(self.changes.systems[0]),
            _caches_left_as_found(self.changes.systems[1]),
        ):
            for name, side, period in doubtful:
                if not self._uses_result(name, 1 - side, period):
                    self.wrapped.discard((name, side, period))

    def _uses_result(self, name, side, period) -> bool:
        """Whether ``side``'s formula for ``name`` in ``period`` uses what
        its calls of the other side's formula return. It is run on the
        simulation as it stands, once as it is and then with the limited
        inputs those calls read moved by each of ``_MOVES`` in turn: used
        once a move moves what the calls return and what the formula
        returns."""
        variable = self.changes.sides[name][side]
        formula = variable.get_formula(period) if period else None
        if formula is None:
            return False
        sim = self.sims[side]
        still = None
        for by in (0, *_MOVES):
            outcome = self._run_moved(sim, side, name, period, formula, by)
            if outcome is None:
                return False
            if still is None:
                still = outcome
                if not still[1]:
                    return False
                continue
            calls_moved = len(outcome[1]) == len(still[1]) and not all(
                _same(a, b) for a, b in zip(still[1], outcome[1])
            )
            if calls_moved and not _same(still[0], outcome[0]):
                return True
        return False

    def _run_moved(self, sim, side, name, period, formula, by):
        """``formula``'s result, and what its wrapping calls returned, with
        the limited inputs read inside those calls moved by ``by``."""
        thread = _THREAD
        thread.moving, thread.returned = by, []
        thread.entries.append(
            _Entry(self, side, name, sys._getframe(), period, True)
        )
        try:
            result = _run_alone(
                sim.get_variable_population(name),
                period,
                sim.tax_benefit_system.parameters,
                formula,
            )
            return _copied(result), thread.returned
        except Exception:  # noqa: BLE001 - can't tell: not used
            return None
        finally:
            thread.entries.pop()
            thread.moving, thread.returned = 0, None
            if not thread.entries:
                thread.own.clear()

    def names(self, name) -> set:
        """The names a changed variable's differing code read on each side,
        in each period that side was not wrapped; and, where its formula ran
        in such a period, the names written in it."""
        if name in self.unobservable:
            return {ANY_NAME}
        names = set()
        for side, variable in enumerate(self.changes.sides[name]):
            if variable is None:
                continue
            periods = [
                period
                for period in self.requested.get((name, side), ())
                if (name, side, period) not in self.wrapped
            ]
            for period in periods:
                names |= self.reads.get((name, side, period), set())
            if any((name, side, period) in self.ran for period in periods):
                names |= self.changes.literal_names(name, side)
        return names


def _held_calculated(sim, name, period) -> bool:
    """Whether ``sim`` holds a value of ``name`` for ``period`` that its
    engine calculated, not one set as an input: in the variable's holder,
    or only in the simulation's fast cache (a variable it opts out of
    caching). True when it can't tell."""
    try:
        from policyengine_core import periods

        if period is not None and not isinstance(period, periods.Period):
            period = periods.period(period)
        holder = _ENGINE["get_holder"](sim.get_variable_population(name), name)
        branch = getattr(sim, "branch_name", "default")
        fast = getattr(sim, "_fast_cache", None) or {}
        if (
            _ENGINE["get_array"](holder, period, branch) is None
            and fast.get((name, period)) is None
        ):
            return False
        inputs = getattr(sim, "_user_input_keys", None)
        if inputs is None:
            return True
        return (name, sim.branch_name, period) not in inputs
    except Exception:  # noqa: BLE001 - can't tell: it may hold one
        return True


def _calculated_before(sim, name) -> bool:
    """Whether ``sim`` holds a value of ``name`` the engine calculated, which
    a run could use without its formula running. A value set as an input
    is not one: the formula never runs for it."""
    if name not in sim.tax_benefit_system.variables:
        return False
    try:
        known = sim.get_holder(name).get_known_branch_periods()
        fast = [
            (sim.branch_name, key[1])
            for key in getattr(sim, "_fast_cache", None) or {}
            if key[0] == name
        ]
        inputs = getattr(sim, "_user_input_keys", None)
        if inputs is None:
            return bool(known or fast)
        return any(
            (name, branch, period) not in inputs
            for branch, period in [*known, *fast]
        )
    except Exception:  # noqa: BLE001 - can't tell: it may have been
        return True


# --- the build ------------------------------------------------------------
#
# A modifier runs while its simulation is built, before any watch opens. If
# it reads a limited input there (directly, or by asking for a variable
# calculated from one), it can carry the value into the run as an input it
# sets, a value its formula holds or a template's argument, with no read
# for the watch to see (review of #51 round 17). So the build is watched
# too: every read of an input a limit names, while a simulation is built
# for publication, is recorded on the simulation and counts as touching the
# limit (``build:<input>``). Reads the model makes itself count as well,
# except while policyengine-uk constructs the simulation, by its own code:
# from policyengine-uk 2.147.2 its construction runs formulas reading inputs
# some limits name, on both sides of every measure (the Universal Credit
# rebalancing, ``add_universal_credit_reform``, which calculates the health
# element and with it the capital tests; for a situation, its conversion
# to a dataset, ``UKSingleYearDataset.from_simulation``). A read counts
# when a measure's code lies between it and the construction: a formula a
# measure replaced, or the scenario's modifier, which the constructor calls
# (told by the call, not by where its code is, so a modifier policyengine-uk
# ships counts too). A read made outside the construction (the build
# function asking for a value, say) counts too. What the construction runs
# of its own accord is excluded on purpose, as the model's: the Universal
# Credit rebalancing, and the structural reforms a parameter switches on
# (``create_structural_reforms_from_parameters``), whose parameters the
# limits name where they matter. A replacement formula written in
# policyengine-uk's own code is not told from the model's. A read is the
# holder fetched as well as its values read: policyengine-uk's
# supplied-input helpers (``supplied_input``, ``supplied_input_periods``)
# fetch the holder and read its storage without ``Holder.get_array``, and
# when nothing was supplied they read nothing more, the answer still
# depending on the input being missing. tests/test_data_limits.py checks
# that building the certified data reads nothing else.

_BUILD_ATTRIBUTE = "_data_limit_build_reads"


class _Build(threading.local):
    def __init__(self):
        self.records: list = []


_BUILD = _Build()
_BUILDING: list = []


class BuildRecord:
    """The inputs a data limit names that were read while a simulation was
    built (see :func:`building`)."""

    def __init__(self):
        self.reads: set = set()

    def attach(self, sim):
        """Record what the build read on the simulation it built, for
        :func:`limits_touched`."""
        try:
            setattr(sim, _BUILD_ATTRIBUTE, frozenset(self.reads))
        except AttributeError:  # a stand-in that takes no attributes
            pass


def _built_read(name, frame):
    if (
        _BUILD.records
        and name in _MISSING_INPUTS
        and not _model_own_read(frame)
    ):
        for record in _BUILD.records:
            record.reads.add(name)


def _built_get_array(self, *args, **kwargs):
    _built_read(
        getattr(getattr(self, "variable", None), "name", None),
        sys._getframe(1),
    )
    return _ENGINE["get_array"](self, *args, **kwargs)


def _built_get_holder(self, variable_name):
    _built_read(variable_name, sys._getframe(1))
    return _ENGINE["get_holder"](self, variable_name)


def _model_constructors() -> frozenset:
    """The code of policyengine-uk's simulation constructors: the engine's
    simulation's subclasses defined in the model, however deep."""
    found, kinds = set(), [_engine_parts()["simulation"]]
    while kinds:
        kind = kinds.pop()
        kinds.extend(kind.__subclasses__())
        code = getattr(kind.__dict__.get("__init__"), "__code__", None)
        if code is not None and "/policyengine_uk/" in code.co_filename:
            found.add(code)
    return frozenset(found)


def _code_of(function):
    """The code object a call of ``function`` runs: a function's or bound
    method's own, a partial's target's, or a callable object's ``__call__``."""
    while isinstance(function, functools.partial):
        function = function.func
    code = getattr(function, "__code__", None)
    if code is None:
        call = getattr(type(function), "__call__", None)
        code = getattr(call, "__code__", None)
    return code


def _calls_scenario_modifier(constructor, callee) -> bool:
    """Whether a policyengine-uk constructor's frame is running its
    scenario's modifier in ``callee``, the frame it called: the modifier
    of the part applied before the data load or after it."""
    if callee is None:
        return False
    for name in ("before_data_load", "after_data_load"):
        part = constructor.f_locals.get(name)
        modifier = getattr(part, "simulation_modifier", None)
        if modifier is not None and callee.f_code is _code_of(modifier):
            return True
    return False


def _model_own_read(frame) -> bool:
    """Whether a read made while a simulation is built is the model's own:
    a policyengine-uk constructor lies between it and the nearest measure's
    code outwards, and the read is not inside the scenario's modifier the
    constructor calls (see "the build" above)."""
    constructors = _model_constructors()
    constructing = False
    callee = None
    while frame is not None:
        code = frame.f_code
        if _measure_path(code.co_filename):
            return constructing
        if code in constructors:
            if not constructing and _calls_scenario_modifier(frame, callee):
                return False
            constructing = True
        callee = frame
        frame = frame.f_back
    return False


@contextmanager
def building():
    """Watch a simulation being built: yields a :class:`BuildRecord` of the
    inputs a data limit names that the build read, directly or through a
    calculation. Every read of an input's value fetches its holder
    (``Population.get_holder``), and the engine's calculation reads it
    through ``Holder.get_array``, which it looks in first; its other caches
    only hold what an earlier read returned. Both count, so a read through
    policyengine-uk's supplied-input helpers, which skip ``get_array``,
    counts too. Not while a watch runs."""
    with _HOOK_LOCK:
        if _WATCHING:
            raise RuntimeError("a simulation is built while a watch runs")
        engine = _engine_parts()
        if not _BUILDING:
            engine["holder"].get_array = _built_get_array
            engine["population"].get_holder = _built_get_holder
        record = BuildRecord()
        _BUILDING.append(record)
        _BUILD.records.append(record)
    try:
        yield record
    finally:
        with _HOOK_LOCK:
            _BUILD.records.remove(record)
            _BUILDING.remove(record)
            if not _BUILDING:
                engine["holder"].get_array = engine["get_array"]
                engine["population"].get_holder = engine["get_holder"]


def watched_build(build, *args, **kwargs):
    """``build(*args, **kwargs)``, its simulation carrying what the build
    read of the inputs a data limit names (see :func:`building`)."""
    with building() as record:
        sim = build(*args, **kwargs)
    record.attach(sim)
    return sim


def _build_reads(sim) -> frozenset:
    return getattr(sim, _BUILD_ATTRIBUTE, frozenset())


@contextmanager
def observing(sim_baseline, sim_reform):
    """Watch what the code that differs between two built simulations reads
    while the block runs them (see :class:`Observation`); for
    :func:`limits_touched` afterwards. Yields ``None`` for stand-in
    simulations with no system."""
    if not all(
        hasattr(sim, "tax_benefit_system")
        for sim in (sim_baseline, sim_reform)
    ):
        yield None
        return
    if _BUILDING:
        raise RuntimeError("a watch starts while a simulation is built")
    observation = Observation(sim_baseline, sim_reform)
    observation._start()
    try:
        yield observation
    finally:
        observation._stop()


class UnwatchedFormulaWarning(UserWarning):
    """A changed variable whose reads could not be watched, so it is read as
    touching every limit; the message says why, for whoever clears it."""


def _formulas_touched(observation) -> dict:
    """For each limit's key, the changed variables whose differing code
    read what the limit covers (see :meth:`Observation.names` and
    :func:`_reads`), as ``formula:<variable>``. An unobservable variable
    is warned about (:class:`UnwatchedFormulaWarning`)."""
    found: dict = {}
    for name, why in observation.drifted.items():
        warnings.warn(
            f"{name}: {why}, so it is read as touching every data limit",
            UnwatchedFormulaWarning,
            stacklevel=3,
        )
        for limit in DATA_LIMITS:
            found.setdefault(limit.key, []).append(f"formula:{name}")
    for name in observation.changes.sides:
        if name in observation.unobservable:
            warnings.warn(
                f"{name}: its reads could not be watched "
                f"({observation.unobservable[name]}), so it is read as "
                "touching every data limit",
                UnwatchedFormulaWarning,
                stacklevel=3,
            )
        names = observation.names(name)
        for limit in DATA_LIMITS:
            if _reads(limit, names):
                found.setdefault(limit.key, []).append(f"formula:{name}")
    return found


def _reads(limit: DataLimit, names: set) -> bool:
    """Whether code using ``names`` reads what ``limit`` covers: its missing
    input, a parameter path under it, or every segment of one (formulas
    reach parameters by attribute)."""
    if limit.missing_input in names or ANY_NAME in names:
        return True
    return any(
        set(prefix.split(".")) <= names
        or any(_under(name, prefix) for name in names)
        for prefix in limit.parameters
    )


def limit_variables(limit: DataLimit, systems=()) -> frozenset:
    """The missing input and the model variables directly reading a limit.

    Derive the purchase-tax readers from installed formula names and
    parameter paths, rather than keeping a second registry of their names.
    Include both compared systems so a newly added reader is covered too.
    The installed model keeps a replaced or ended reader covered.
    """
    from policyengine_uk.system import system as installed

    found = {limit.missing_input}
    for system in (installed, *systems):
        for name, variable in system.variables.items():
            names = set()
            for formula in _formulas(variable):
                if isinstance(formula, types.FunctionType):
                    names |= _code_names(formula.__code__)
            for attribute in ("adds", "subtracts"):
                values = getattr(variable, attribute, None)
                if isinstance(values, str):
                    names.add(values)
                elif isinstance(values, (list, tuple)):
                    names |= {
                        value for value in values if isinstance(value, str)
                    }
            if _reads(limit, names):
                found.add(name)
    return frozenset(found)


def _stored_inputs(sim, names) -> dict:
    """Every stored input period and value for these variables.

    Core marks calculated values as derived. Read each storage tier
    directly, including branch inputs, so a neutralised variable or a
    calculated memory value cannot hide a stored input. Calculations
    performed before or during a watch do not create differences and a
    zero input is distinct from no input. Copy arrays because later
    calculations can mutate them.
    """
    found = {}
    for name in sorted(names & sim.tax_benefit_system.variables.keys()):
        holder = sim.get_holder(name)
        for storage in (holder._memory_storage, holder._disk_storage):
            if storage is None:
                continue
            for branch, period in storage.get_known_branch_periods():
                if storage.is_derived(period, branch):
                    continue
                value = storage.get(period, branch)
                if value is not None:
                    values = found.setdefault((name, branch, str(period)), [])
                    if not any(_equal(value, other) for other in values):
                        values.append(_copied(value))
    return found


def _inputs_changed(sim_baseline, sim_reform, limit) -> list[str]:
    names = limit_variables(
        limit,
        (sim_baseline.tax_benefit_system, sim_reform.tax_benefit_system),
    )
    before = _stored_inputs(sim_baseline, names)
    after = _stored_inputs(sim_reform, names)
    return sorted(
        {
            f"input:{key[0]}"
            for key in before.keys() | after.keys()
            if key not in before
            or key not in after
            or not _equal(before[key], after[key])
        }
    )


def limits_touched(sim_baseline, sim_reform, observation=None) -> list[dict]:
    """The limits a measure touches, as recorded in its receipt.

    A limit is touched when, in the two built simulations:

    - the stored parameters under it differ, by position and effective
      value (parameter changes or modifiers, on either side; a reordered,
      replaced, re-typed or added parameter; not a redundant breakpoint, a
      label or 40000 against 40000.0);
    - or only what formulas read under it differs (a modifier that edited
      cached views, or a parameter class that changes between breakpoints),
      recorded as the limit's own prefix;
    - or a variable behaves differently and the code that differs read what
      the limit covers while the simulations ran (see :class:`Observation`),
      recorded as ``formula:<variable>``;
    - or either simulation's build read the input the limit names (see
      :func:`building`), recorded as ``build:<input>``.
    - or any stored input period or value differs for its missing input or
      one of its formula readers, recorded as ``input:<variable>``.

    ``observation`` is the watch (:func:`observing`) kept over the run that
    made the figures, finished. Without one, each changed variable is
    calculated here, in each of the Budget's years, under a watch.
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    base, reform = base_system.parameters, reform_system.parameters
    if observation is None:
        with (
            _caches_left_as_found(base_system),
            _caches_left_as_found(reform_system),
            observing(sim_baseline, sim_reform) as observation,
        ):
            observation.run(HOUSEHOLD_YEARS)
    elif observation.sims[0] is not sim_baseline or (
        observation.sims[1] is not sim_reform
    ):
        raise ValueError("the observation watched other simulations")
    elif not observation.finished:
        raise ValueError("the observation is still watching")
    behaviour = observation.changes.behaviour
    formulas = _formulas_touched(observation)
    built = _build_reads(sim_baseline) | _build_reads(sim_reform)
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
                    _views(base_system, prefix, behaviour),
                    _views(reform_system, prefix, behaviour),
                ):
                    found = [prefix]
                differing += found
            differing += formulas.get(limit.key, [])
            differing += _inputs_changed(sim_baseline, sim_reform, limit)
            if limit.missing_input in built:
                differing.append(f"build:{limit.missing_input}")
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


def _build_path(path, limit: DataLimit) -> bool:
    """A recorded ``build:<input>`` path: the limit's own missing input,
    read while a simulation was built (see :func:`limits_touched`)."""
    return path == f"build:{limit.missing_input}"


def _input_path(path, limit: DataLimit) -> bool:
    """A stored-input difference belonging to this limit's variables."""
    return (
        isinstance(path, str)
        and path.startswith("input:")
        and path[len("input:") :] in limit_variables(limit)
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
                # A path may fall under several limits (the annual
                # allowance, UC capital and its sources are under more
                # than one): each of them records it
                limit not in limits_for_paths([path])
                and not _formula_path(path)
                and not _build_path(path, limit)
                and not _input_path(path, limit)
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
