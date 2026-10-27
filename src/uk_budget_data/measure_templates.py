"""Reusable, registered building blocks for announced Budget measures.

Parameter builders return content-bound dictionaries for ``Reform``. Runtime
helpers must be called from module-level modifiers with finite JSON defaults:
execution receipts cannot bind closure factories or partially applied helpers.

There is no ``monthly_schedule`` helper: monthly policies must be expressed
as fiscal-year values, with the team choosing the aggregation methodology.

The household calculator builds its simulations with the national run's
``Scenario``, so a built change moves a household as it moves the national
figure, whichever dates its formulas read the parameter on: monthly (fuel
duty), while the simulation is built (the Universal Credit health
element), or on statutory dates (the alcohol duties)
(``tests/test_household_route_parity.py``).
Parameter builders key every value by its bare fiscal year, in ASCII
digits, and refuse any other key: a lone date changes one day, and the
builders take one value a year, so a measure that needs an interval is
written and reviewed as one (``tests/test_measure_keys.py``).

After a change bounded to some years, the engine returns an uprated
amount (a parameter with ``uprating`` metadata: the State Pension, benefit
rates, the LEL and the like) to its old projected path, rather than
uprating from the changed amount (policyengine-uk #2430). So a measure on
one gives it a value for every scored year from its first changed year.
The builders cannot know the scored years, so their callers supply them;
generation refuses a measure that leaves one out
(``uk_budget_data.scored_years``).

Runtime helpers wrap a variable's formula, so they must be applied after
the data is loaded (a modifier's default phase): they refuse a variable
that already holds stored values, and values loaded after a wrapper was
installed would hide it for their periods.

A parameter the certified data cannot cost (``uk_budget_data.data_limits``,
such as the SDLT higher rates) still builds, with a ``DataLimitedWarning``:
the measure is published as not computable, never as a figure. A parameter
the installed model mis-costs (``uk_budget_data.model_limits``, such as the
Pension Credit minimum guarantee from 2027) builds with a
``ModelLimitedWarning``: the measure is held at provisional, never approved.
So does a runtime helper that changes a variable such a limit covers (the
VAT base template was one, until policyengine-uk #2187).
"""

import math
import re
import types
import warnings
from collections.abc import Mapping
from decimal import (
    ROUND_CEILING,
    ROUND_FLOOR,
    ROUND_HALF_UP,
    Decimal,
    InvalidOperation,
    localcontext,
)

import numpy as np
from policyengine_core.periods import YEAR
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import Variable
from policyengine_uk.utils.data_source import built_from_data
from policyengine_uk.utils.scenario import _apply_reform_class
from policyengine_uk.utils.stochastic import splitmix64_uniform


class DataLimitedWarning(UserWarning):
    """A change built on a parameter the certified data cannot cost."""


def _warn_if_data_limited(path: str) -> None:
    from uk_budget_data.data_limits import limits_for_paths

    for limit in limits_for_paths([path]):
        warnings.warn(
            f"{path}: {limit.reason} A measure built on it is published as "
            "not computable on current data, never as a figure.",
            DataLimitedWarning,
            # The builder's caller: rate_change and the like call
            # _validate_parameter_path, which calls this.
            stacklevel=4,
        )


class ModelLimitedWarning(UserWarning):
    """A change built on a parameter, or a variable, the installed model
    mis-costs."""


def _warn_if_model_limited(path: str) -> None:
    from uk_budget_data.model_limits import limits_for_paths

    for limit in limits_for_paths([path]):
        if not limit.installed_fixed():
            warnings.warn(
                f"{path}: {limit.reason} A measure built on it is held at "
                "provisional, never approved.",
                ModelLimitedWarning,
                # The builder's caller, as for _warn_if_data_limited.
                stacklevel=4,
            )


def _warn_if_variable_model_limited(name: str) -> None:
    """Warn when a runtime helper changes a variable the installed model
    mis-costs: one a model limit covers, without its fix installed."""
    from uk_budget_data.model_limits import limits_for_paths, variable_path

    for limit in limits_for_paths([variable_path(name)]):
        if not limit.installed_fixed():
            warnings.warn(
                f"{name}: {limit.reason} A measure built on it is held at "
                "provisional, never approved.",
                ModelLimitedWarning,
                # The helper, not the measure's modifier: a warning leaves a
                # __warningregistry__ in the module it is attributed to, and
                # a receipt can't bind a measure module that carries one.
                stacklevel=2,
            )


# The engine's two wealth-tax scales, and the base each is applied to.
# total_wealth adds property, corporate, private pension and savings wealth
# and nets no debts (variables/household/wealth/total_wealth.py).
# non_primary_residence_wealth_tax applies its scale to total_wealth less
# main_residence_value (variables/contrib/cec/
# non_primary_residence_wealth_tax.py). Until policyengine-uk 2.151.0,
# wealth_tax applied its scale to total_wealth too (the UK hub's S4); from
# it, to net_wealth, which subtracts mortgage_debt, consumer_debt and
# student loan balances (variables/contrib/ubi_center/wealth_tax.py,
# variables/household/wealth/net_wealth.py). Both debts are inputs, nil
# unless the data set them, and no check here yet shows that the certified
# data do, so that scale stays refused too. Both count in household_tax and
# gov_tax.
WEALTH_TAX = "gov.contrib.ubi_center.wealth_tax"
NON_PRIMARY_RESIDENCE_WEALTH_TAX = (
    "gov.contrib.cec.non_primary_residence_wealth_tax"
)
_GROSS = (
    "gross wealth (property, corporate, private pension and savings) with "
    "no debts netted"
)
WEALTH_TAX_SCALES = {
    WEALTH_TAX: (
        "the engine's wealth_tax applies to net_wealth: total_wealth less "
        "mortgage, consumer and student loan debt, where no check yet shows "
        "the certified data carry the first two, which are nil without them"
    ),
    NON_PRIMARY_RESIDENCE_WEALTH_TAX: (
        "the engine's non_primary_residence_wealth_tax applies to "
        f"total_wealth less main_residence_value: {_GROSS}, less the main "
        "home's full value rather than its equity"
    ),
}


def _wealth_tax_scale(path):
    """The wealth-tax scale ``path`` is or is a part of, or None."""
    if not isinstance(path, str):
        return None
    for scale in WEALTH_TAX_SCALES:
        if path == scale or path.startswith((scale + ".", scale + "[")):
            return scale
    return None


def is_wealth_tax_path(path) -> bool:
    """Whether ``path`` is one of the engine's wealth-tax scales or a part
    of one."""
    return _wealth_tax_scale(path) is not None


def wealth_tax_paths(*scenarios) -> list:
    """The paths under a wealth-tax scale that ``scenarios`` (either may be
    None) change in their ``parameter_changes``, sorted."""
    return sorted(
        {
            path
            for scenario in scenarios
            for path in (getattr(scenario, "parameter_changes", None) or {})
            if is_wealth_tax_path(path)
        }
    )


def wealth_tax_paths_differing(sim_baseline, sim_reform) -> list:
    """The paths under a wealth-tax scale where two built simulations'
    parameters differ, compared as model limits compare theirs: a modifier
    that edits a scale with no ``parameter_changes`` shows here."""
    from uk_budget_data.model_limits import parameters_differing

    return parameters_differing(sim_baseline, sim_reform, WEALTH_TAX_SCALES)


def wealth_tax_refusal(*paths: str) -> str:
    """Why a change to ``paths``, each under a wealth-tax scale, is refused.

    The templates refuse such a path. Generation refuses a measure that
    changes one, in its ``parameter_changes`` or in what its built
    simulations run."""
    by_scale: dict = {}
    for path in paths:
        by_scale.setdefault(_wealth_tax_scale(path), []).append(path)
    return " ".join(
        [
            f"{', '.join(found)} {'is' if len(found) == 1 else 'are'} under "
            f"{scale}, which {WEALTH_TAX_SCALES[scale]}."
            for scale, found in by_scale.items()
        ]
        + [
            "A wealth tax on net assets would be scored on the wrong base, "
            "or on one not yet checked against the data (the UK hub's "
            "budget-triage/JUDGED.md, S4)."
        ]
    )


def _refuse_wealth_tax(path: str) -> None:
    """Refuse the engine's wealth-tax scales: for a wealth tax announced on
    net assets, one taxes the wrong base and the other one not yet checked
    against the data (the UK hub's Budget triage, S4)."""
    if is_wealth_tax_path(path):
        raise ValueError(wealth_tax_refusal(path))


def _validate_parameter_path(path: str) -> None:
    """Require a leaf in the installed engine's native parameter tree,
    refuse the wealth-tax scale, and warn when the certified data cannot
    cost the change or the installed model mis-costs it."""
    from policyengine_core.parameters import Parameter
    from policyengine_uk.system import system

    if not isinstance(path, str) or not path:
        raise ValueError("A nonempty parameter path is required")
    _refuse_wealth_tax(path)
    try:
        parameter = system.parameters.get_child(path)
    except (KeyError, AttributeError, IndexError, ValueError) as exc:
        raise ValueError(f"Unknown parameter path: {path}") from exc
    if not isinstance(parameter, Parameter):
        raise ValueError(f"Parameter path must identify a leaf: {path}")
    _warn_if_data_limited(path)
    _warn_if_model_limited(path)


# Universal Credit's health (LCWRA) element. In the years the engine's UC
# rebalancing runs (policyengine_uk/scenarios/uc_reform.py,
# add_universal_credit_reform, while rebalancing is active; the engine
# exports them as REBALANCING_YEARS in policyengine-uk 2.145.0), it
# overwrites each claimant's element after the formula: pre-2026
# claimants get rebalancing.protected_health_element (or the UC Act 2025
# s. 4 floor where that is null), new claimants
# rebalancing.new_claimant_health_element. Both are monthly amounts.
UC_LCWRA_AMOUNT = "gov.dwp.universal_credit.elements.disabled.amount"
UC_PROTECTED_HEALTH = (
    "gov.dwp.universal_credit.rebalancing.protected_health_element"
)
UC_NEW_CLAIMANT_HEALTH = (
    "gov.dwp.universal_credit.rebalancing.new_claimant_health_element"
)
UC_REBALANCING_ACTIVE = "gov.dwp.universal_credit.rebalancing.active"


# Older engines (policyengine-uk 2.130.1, 2.132.6) loop over these years
# in add_universal_credit_reform and export none.
UC_REBALANCED_YEARS_BEFORE_EXPORT = range(2026, 2030)


def _uc_rebalanced_years() -> range:
    """The years the installed engine's UC rebalancing runs.

    Its export where it has one (policyengine-uk 2.145.0 runs the
    rebalancing to 2032-33), else the years older engines loop over.
    ``tests/test_uc_health_template.py`` checks either against the awards
    the installed engine pays, so an engine that changes the years without
    exporting them fails there rather than taking the fallback.
    """
    from policyengine_uk.scenarios import uc_reform

    exported = getattr(uc_reform, "REBALANCING_YEARS", None)
    if exported is None:
        return UC_REBALANCED_YEARS_BEFORE_EXPORT
    years = sorted(int(year) for year in exported)
    if not years or years != list(range(years[0], years[-1] + 1)):
        raise ValueError(
            "policyengine_uk.scenarios.uc_reform.REBALANCING_YEARS must be "
            f"consecutive years; got {exported!r}"
        )
    return range(years[0], years[-1] + 1)


UC_REBALANCED_YEARS = _uc_rebalanced_years()
UC_HEALTH_ADVICE = (
    "build a UC health measure with uc_health_element_change(), which sets "
    f"{UC_PROTECTED_HEALTH} (pre-2026 claimants) and {UC_NEW_CLAIMANT_HEALTH} "
    "(new claimants)"
)


def _refuse_uc_health_traps(path: str, years) -> None:
    """Refuse the Universal Credit health changes that score nothing or
    the wrong thing.

    The LCWRA element's amount in the rebalanced years: the rebalancing
    overwrites every claimant's element, so a change to it moves no award.
    Outside them a change to it scores: after them the installed engine's
    rebalancing no longer runs, so every claimant, protected or not, gets
    the element's amount (policyengine-uk issue #2282).
    tests/test_uc_health_template.py pins both edges to the engine, so an
    engine that changes the rebalanced years without exporting them fails
    there. Switching rebalancing off is not the
    law before the Universal Credit Act 2025 either: the 2026 element
    amount is already the new claimants' rate, so everyone would get it.
    """
    rebalanced = [str(y) for y in years if int(y) in UC_REBALANCED_YEARS]
    if path == UC_LCWRA_AMOUNT and rebalanced:
        raise ValueError(
            f"{UC_LCWRA_AMOUNT} in {', '.join(rebalanced)} is not what UC "
            "health awards pay: in "
            f"{UC_REBALANCED_YEARS.start}-{UC_REBALANCED_YEARS.stop - 1} "
            "the engine's UC rebalancing overwrites each claimant's "
            "element, so a change to it scores nothing; " + UC_HEALTH_ADVICE
        )
    if path == UC_REBALANCING_ACTIVE:
        raise ValueError(
            f"{UC_REBALANCING_ACTIVE} switched off is not the law before the "
            "Universal Credit Act 2025: the 2026 element amount is already "
            "the new claimants' rate, so every claimant would get it; "
            + UC_HEALTH_ADVICE
        )


def _finite_decimal(value, label: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError(f"{label} must be a finite number")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not result.is_finite() or not math.isfinite(float(result)):
        raise ValueError(f"{label} must be a finite number")
    return result


def _decimal_work_precision(*values: Decimal) -> int:
    """Retain supplied digits through alignment, products and division."""
    return max(
        28,
        sum(
            len(value.as_tuple().digits) + abs(value.as_tuple().exponent)
            for value in values
        )
        + 4,
    )


def _annual_decimal_values(values: Mapping) -> dict[str, Decimal]:
    """Normalize explicit annual keys without inventing intervening values."""
    if not isinstance(values, Mapping) or not values:
        raise ValueError("Supply at least one explicit annual value")
    result = {}
    for year, value in values.items():
        # [0-9], not \d: \d also matches other scripts' digits, which the
        # national run reads as a year and the household calculator does not.
        if isinstance(year, bool) or not re.fullmatch(
            r"[1-9][0-9]{3}", str(year)
        ):
            raise ValueError(
                "Use four-digit annual keys; a lone ISO date changes one day"
            )
        key = str(year)
        if key in result:
            raise ValueError(f"Duplicate annual value for {key}")
        result[key] = _finite_decimal(value, f"Value for {key}")
    return dict(sorted(result.items()))


def _annual_values(values: Mapping) -> dict[str, float]:
    return {
        year: float(value)
        for year, value in _annual_decimal_values(values).items()
    }


def rate_change(path: str, values: Mapping) -> dict[str, dict[str, float]]:
    """Build explicit annual rates; the caller supplies the parameter's units.

    ISO dates are deliberately refused: ``2029-04-01`` denotes one day,
    not a rate that continues until the next change. Intervals are refused
    too: the builders take one value a year (see the module docstring).
    For an uprated amount, supply every scored year from the first changed
    year: a bounded change returns to the old path (policyengine-uk #2430,
    see the module docstring).
    """
    _validate_parameter_path(path)
    annual = _annual_values(values)
    _refuse_uc_health_traps(path, annual)
    return {path: annual}


def threshold_change(
    path: str, values: Mapping
) -> dict[str, dict[str, float]]:
    """Build explicit annual thresholds on an existing native parameter.

    For an uprated amount, supply every scored year from the first changed
    year: a bounded change returns to the old path (policyengine-uk #2430,
    see the module docstring).
    """
    _validate_parameter_path(path)
    annual = _annual_values(values)
    _refuse_uc_health_traps(path, annual)
    return {path: annual}


def uc_health_element_change(
    *, protected: Mapping | None = None, new_claimant: Mapping | None = None
) -> dict[str, dict[str, float]]:
    """Change Universal Credit's health (LCWRA) element as the model pays it.

    In UC_REBALANCED_YEARS the engine's UC rebalancing sets each claimant's
    element itself, so a measure on the element's own amount scores
    nothing. This builds the change on the amounts it uses instead:
    ``protected`` for pre-2026 claimants
    (rebalancing.protected_health_element) and ``new_claimant`` for those
    who claim from April 2026 (rebalancing.new_claimant_health_element).
    Values are monthly amounts, in pounds, by fiscal year, as the
    parameters are. Only the rebalanced years: in other years the
    rebalancing does not run, and the values would score nothing. After
    them every claimant gets the element's own amount: build that with
    ``rate_change(UC_LCWRA_AMOUNT, ...)``.

    The two rebalancing amounts carry no uprating metadata in the installed
    engines, so the scored-year rule (policyengine-uk #2430, see the module
    docstring) does not bind them; the element's own amount is uprated, so
    a measure on it gives every scored year from its first changed year.
    """
    changes = {}
    for path, values in (
        (UC_PROTECTED_HEALTH, protected),
        (UC_NEW_CLAIMANT_HEALTH, new_claimant),
    ):
        if values is None:
            continue
        annual = _annual_values(values)
        outside = [y for y in annual if int(y) not in UC_REBALANCED_YEARS]
        if outside:
            raise ValueError(
                f"{path} is used only in {UC_REBALANCED_YEARS.start}-"
                f"{UC_REBALANCED_YEARS.stop - 1}, while the UC rebalancing "
                f"runs; a value for {', '.join(outside)} would score nothing"
            )
        changes[path] = annual
    if not changes:
        raise ValueError("Supply protected or new_claimant amounts")
    return changes


def allowance_uprating(
    path: str,
    base_value: float | Decimal,
    growth_by_year: Mapping,
    rounding: float | Decimal = 10,
    rounding_mode: str = "up",
    taper_after_rounding: bool = True,
) -> dict[str, dict[str, float]]:
    """Chain each year's growth from the previous rounded allowance.

    ``base_value`` is the allowance before the first supplied year's growth.
    Include a zero growth in the initial year to publish that base explicitly.
    Years must be consecutive; growth values are fractional changes, so 0.01
    means 1%. ``up``, ``down`` and ``nearest`` are explicit rounding policies.
    Decimal inputs retain their exact values until the final rounding step.
    For an uprated amount, supply growth for every scored year from the
    first changed year to the last: the years must be consecutive, but
    nothing here makes them reach the last scored year (policyengine-uk
    #2430, see the module docstring).

    These are untapered amounts. The existing personal-allowance formula (or
    an age-conditioned formula) applies its income taper afterwards. A
    taper-before-rounding rule cannot be represented by this builder.
    """
    _validate_parameter_path(path)
    if taper_after_rounding is not True:
        raise ValueError("This builder requires taper_after_rounding=True")
    modes = {
        "up": ROUND_CEILING,
        "down": ROUND_FLOOR,
        "nearest": ROUND_HALF_UP,
    }
    if rounding_mode not in modes:
        raise ValueError("rounding_mode must be up, down or nearest")
    increment = _finite_decimal(rounding, "Rounding increment")
    amount = _finite_decimal(base_value, "Base allowance")
    if increment <= 0 or amount < 0:
        raise ValueError("Rounding must be positive and allowance nonnegative")
    growths = _annual_decimal_values(growth_by_year)
    years = [int(year) for year in growths]
    if years != list(range(years[0], years[-1] + 1)):
        raise ValueError("Supply growth for consecutive years without gaps")
    values = {}
    for year, growth in growths.items():
        with localcontext() as context:
            context.prec = _decimal_work_precision(amount, growth, increment)
            factor = 1 + growth
            if factor < 0:
                raise ValueError("Growth cannot be below -100%")
            units = amount * factor / increment
            amount = (
                units.to_integral_value(rounding=modes[rounding_mode])
                * increment
            )
        values[year] = float(_finite_decimal(amount, f"Allowance for {year}"))
    _refuse_uc_health_traps(path, values)
    return {path: values}


def nearest_5p_weekly(amount: float | Decimal) -> float:
    """Round a weekly amount to the nearest 5p, with halfway values rounded up.

    This is an explicit policy rule, not a claim that the engine rounds its
    State Pension parameters. Apply independently to basic and new pensions.
    """
    value = _finite_decimal(amount, "Weekly amount")
    if value < 0:
        raise ValueError("Weekly amount must be nonnegative")
    increment = Decimal("0.05")
    with localcontext() as context:
        context.prec = _decimal_work_precision(value, increment)
        rounded = (value / increment).to_integral_value(
            rounding=ROUND_HALF_UP
        ) * increment
    return float(rounded)


def pension_uprating(
    amount: float | Decimal,
    growth: float | Decimal,
    *,
    round_to_5p: bool = False,
) -> float:
    """Uprate one pension rate, conditionally applying the stated 5p rule.

    Opt in for every affected pension independently; deriving basic pension
    from an already rounded new-pension ratio misses basic pension rounding.
    The full rates are uprated amounts, so a measure writes a value for
    every scored year from its first changed year (policyengine-uk #2430,
    see the module docstring).
    """
    base = _finite_decimal(amount, "Weekly amount")
    increase = _finite_decimal(growth, "Pension growth")
    with localcontext() as context:
        context.prec = _decimal_work_precision(base, increase)
        raw = base * (1 + increase)
    if raw < 0:
        raise ValueError("Uprated weekly amount must be nonnegative")
    value = _finite_decimal(raw, "Uprated weekly amount")
    return nearest_5p_weekly(value) if round_to_5p else float(value)


def _stored_input_periods(sim, variable):
    """Read supplied-input provenance, excluding cached formula results."""
    return set(sim.get_holder(variable).get_input_periods(sim.branch_name))


def _ensure_not_stored(sim, variable):
    if _stored_input_periods(sim, variable):
        raise ValueError(
            f"{variable} is a stored input; "
            "a formula override would be bypassed"
        )


def _annual_years(start_year, end_year):
    if (
        type(start_year) is not int
        or type(end_year) is not int
        or not 1 <= start_year <= end_year <= 9999
    ):
        raise ValueError("Select increasing integer start_year/end_year")
    return range(start_year, end_year + 1)


def _finite_number(value, name):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def apply_vat_base_change(
    sim,
    *,
    spending_variable,
    rate_change,
    start_year,
    end_year,
    baseline_rate=None,
    geography="UK",
):
    """Pass a signed VAT rate change through VAT-inclusive eligible spending.

    ``rate_change`` is new rate minus old rate. Strip the baseline VAT from
    the bill before multiplying by that change; by default the installed
    reduced rate is the baseline. Supply ``baseline_rate`` for another base.
    Annual bounds are inclusive, with no implicit fiscal/calendar proration.
    Wrap the current ``vat`` formula: the engine derives ``vat_change`` and
    resources from it. Missing spending defaults to the variable's native
    value (zero for spending inputs). Repeated calls add their adjustments.
    ``geography`` is ``UK`` (every household) or ``GB`` (Northern Ireland's
    households keep the baseline VAT, as for a change that applies in Great
    Britain only, such as the temporary zero rate on domestic electricity).
    Call from a module-level modifier with finite JSON default arguments.
    """
    years = _annual_years(start_year, end_year)
    if geography not in ("GB", "UK"):
        raise ValueError("geography must be GB or UK")
    delta = _finite_number(rate_change, "rate_change")
    variable = sim.tax_benefit_system.get_variable(
        spending_variable, check_existence=True
    )
    if variable.entity.key != "household":
        raise ValueError("Eligible spending must be on the household entity")
    explicit_rate = (
        None
        if baseline_rate is None
        else _finite_number(baseline_rate, "baseline_rate")
    )
    if explicit_rate is not None and (
        explicit_rate < 0 or explicit_rate + delta < 0
    ):
        raise ValueError("Baseline and reformed VAT rates must be nonnegative")
    native = sim.tax_benefit_system.get_variable("vat")

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        if period.start.year not in years:
            return current
        old_rate = (
            parameters(period).gov.hmrc.vat.reduced_rate
            if explicit_rate is None
            else explicit_rate
        )
        old_rate = _finite_number(old_rate, "baseline_rate")
        if old_rate < 0 or old_rate + delta < 0:
            raise ValueError(
                "Baseline and reformed VAT rates must be nonnegative"
            )
        spending = np.asarray(household(spending_variable, period))
        if not np.isfinite(spending).all() or (spending < 0).any():
            raise ValueError(
                "Eligible spending must be finite and nonnegative"
            )
        adjustment = spending * delta / (1 + old_rate)
        if geography == "GB":
            country = household("country", period)
            adjustment = np.where(
                country != country.possible_values.NORTHERN_IRELAND,
                adjustment,
                0,
            )
        return current + adjustment

    _replace_formula(sim, "vat", formula)
    # Held while a model limit covers VAT (vat_consumption_coverage did,
    # until policyengine-uk #2187 grossed it by survey coverage).
    _warn_if_variable_model_limited("vat")
    return sim


def _call_formula(variable, entity, period, parameters):
    """A variable's previous value, computed as policyengine-core does.

    A period with no formula takes the variable's default value (the
    wrapped variable holds no stored input: _replace_formula refuses one);
    a two-argument formula takes no parameters.
    """
    formula = variable.get_formula(period)
    if formula is None:
        return entity.filled_array(variable.default_value)
    if formula.__code__.co_argcount == 2:
        return formula(entity, period)
    return formula(entity, period, parameters)


def _replace_formula(sim, name, formula):
    """Replace on this simulation only, preserving native variable metadata.

    The previous variable is computed by ``_call_formula``, which follows
    core for a formula or a default. It is refused instead when core would
    compute it some other way: a neutralised variable (core returns its
    default without running its formulas) or one with ``adds`` or
    ``subtracts`` (core sums them wherever no formula applies).
    """
    _ensure_not_stored(sim, name)
    current = sim.tax_benefit_system.get_variable(name)
    if getattr(current, "is_neutralized", False):
        raise ValueError(f"{name} is neutralised; a template cannot wrap it")
    if current.adds or current.subtracts:
        # Core sums them in any period without a formula, including before
        # a dated formula starts; the wrapper would take the default there.
        raise ValueError(
            f"{name} is built from adds or subtracts; a template cannot "
            "wrap it"
        )
    replacement = type(
        name, (Variable,), {"formula": formula, "__module__": __name__}
    )

    class FormulaReform(CoreReform):
        def apply(self):
            self.update_variable(replacement)

    _apply_reform_class(FormulaReform, sim)


# These selectors' receipt semantics are pinned by
# ``tests/test_measure_template_receipt.py`` on the bundle's engine. The two
# Pension Credit components are entitlement amounts, so require the native
# receipt gate alongside the selected component before awarding a payment.
_BENEFIT_RECEIPT_GATES = {
    "universal_credit": None,
    "guarantee_credit": "in_receipt_of_guarantee_credit",
    "savings_credit": "pension_credit",
    "housing_benefit": None,
    "esa_income": None,
}

# The salt of policyengine-uk's Warm Home Discount receipt draw
# (warm_home_discount_random_draw, policyengine-uk #2616), so a household
# draws the same here as it will there.
RECEIPT_DRAW_SALT = 2


def _validated_rate(value, name):
    rate = _finite_number(value, name)
    if not 0 <= rate <= 1:
        raise ValueError(f"{name} must be between 0 and 1")
    return rate


def apply_benefit_receipt_payment(
    sim,
    *,
    amount,
    eligible_benefits,
    geography,
    channel,
    year,
    pension_credit_receipt_rate=None,
    other_receipt_rate=None,
):
    """Add a lump sum once per household, based on actual annual receipt.

    Receipt on a payment date is approximated by annual receipt. Only
    ``universal_credit``, ``guarantee_credit``, ``savings_credit``,
    ``housing_benefit`` and ``esa_income`` are supported. Universal Credit is
    natively gated by ``would_claim_uc`` and Housing Benefit by
    ``would_claim_housing_benefit``; income-related ESA is a reported award.
    The two Pension Credit components are entitlement amounts: guarantee
    credit additionally requires ``in_receipt_of_guarantee_credit``, which
    enforces eligibility and take-up, and savings credit requires positive
    actual ``pension_credit`` receipt. All are projected from benefit units
    with household ``any``.
    ``geography`` is ``GB`` (excludes Northern Ireland) or ``UK``.
    Choose an existing household income/benefit channel with a formula and
    the appropriate tax/means-test treatment, e.g. the cost-of-living channel.
    Its native payment is preserved in every year.

    With ``pension_credit_receipt_rate`` and ``other_receipt_rate`` (both or
    neither), not every eligible household receives the payment, as
    policyengine-uk #2616 models the Warm Home Discount: a household where
    any benefit unit receives Pension Credit receives it when its draw is
    below the first rate, any other eligible household when its draw is
    below the second. The draw is policyengine-uk's deterministic hash of
    the household id (``splitmix64_uniform``, salt 2, stored as float32) in
    a simulation built from data, and 0 in a household situation, so a
    calculator's household receives it.
    """
    _annual_years(year, year)
    amount = _finite_number(amount, "amount")
    if amount < 0:
        raise ValueError("amount must be nonnegative")
    if geography not in ("GB", "UK"):
        raise ValueError("geography must be GB or UK")
    if (
        isinstance(eligible_benefits, str)
        or not isinstance(eligible_benefits, (list, tuple))
        or not eligible_benefits
        or any(not isinstance(name, str) for name in eligible_benefits)
    ):
        raise ValueError(
            "Select a nonempty list of eligible benefit variables"
        )
    native = sim.tax_benefit_system.get_variable(channel, check_existence=True)
    if native.entity.key != "household" or not native.formulas:
        raise ValueError("Payment channel must have a household formula")
    if native.definition_period != YEAR:
        raise ValueError(
            "Payment channel must be annual: the payment is a one-off "
            "amount in the year"
        )
    if (pension_credit_receipt_rate is None) != (other_receipt_rate is None):
        raise ValueError(
            "Give both receipt rates (Pension Credit and other) or neither"
        )
    receipt_rates = None
    if pension_credit_receipt_rate is not None:
        receipt_rates = (
            _validated_rate(
                pension_credit_receipt_rate, "pension_credit_receipt_rate"
            ),
            _validated_rate(other_receipt_rate, "other_receipt_rate"),
        )
    benefits = {}
    for name in eligible_benefits:
        if name not in _BENEFIT_RECEIPT_GATES:
            raise ValueError(
                f"Unsupported receipt selector: {name}; choose "
                + ", ".join(_BENEFIT_RECEIPT_GATES)
            )
        variable = sim.tax_benefit_system.get_variable(
            name, check_existence=True
        )
        if variable.entity.key not in ("person", "benunit", "household"):
            raise ValueError(
                f"Unsupported benefit entity: {variable.entity.key}"
            )
        benefits[name] = variable.entity.key

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        if period.start.year != year:
            return current
        eligible = np.zeros(household.count, dtype=bool)
        for name, entity in benefits.items():
            if entity == "household":
                positive = household(name, period) > 0
            elif entity == "person":
                positive = household.any(household.members(name, period) > 0)
            else:
                received = household.members.benunit(name, period) > 0
                receipt_gate = _BENEFIT_RECEIPT_GATES[name]
                if receipt_gate is not None:
                    received &= (
                        household.members.benunit(receipt_gate, period) > 0
                    )
                positive = household.any(received)
            eligible |= positive
        country = household("country", period)
        if geography == "GB":
            eligible &= country != country.possible_values.NORTHERN_IRELAND
        if receipt_rates is not None:
            eligible &= _receives(household, period, *receipt_rates)
        return current + eligible * amount

    _replace_formula(sim, channel, formula)
    return sim


def _receives(household, period, pension_credit_rate, other_rate):
    """Whether each household receives a payment with a receipt rate by
    group, as policyengine-uk #2616's would_receive_warm_home_discount."""
    if built_from_data(household.simulation):
        ids = household("household_id", period)
        draw = splitmix64_uniform(ids, salt=RECEIPT_DRAW_SALT).astype(
            np.float32
        )
    else:
        draw = np.zeros(household.count, dtype=np.float32)
    pension_credit = household.any(
        household.members.benunit("pension_credit", period) > 0
    )
    rate = np.where(pension_credit, pension_credit_rate, other_rate)
    return draw < rate


def apply_age_conditioned_allowance(
    sim,
    *,
    allowance_by_year,
    taper_threshold,
    taper_rate,
    eligibility_variable="is_SP_age",
):
    """Apply the age taper and standard floor, then the native PA taper.

    Pass the inner annual mapping returned by ``allowance_uprating``. The
    standard allowance, its high-income taper and basic-rate limit remain
    the engine's own rules. The extra allowance tapers to the untapered
    standard PA before the native high-income reduction is applied.
    Eligibility is explicit (default: State Pension age) and read per person.
    """
    threshold = _finite_number(taper_threshold, "taper_threshold")
    taper = _finite_number(taper_rate, "taper_rate")
    if threshold < 0 or taper < 0:
        raise ValueError("Taper threshold and rate must be nonnegative")
    amounts = {}
    for year, amount in _annual_values(allowance_by_year).items():
        year = int(year)
        _annual_years(year, year)
        amount = _finite_number(amount, "allowance")
        if amount < 0:
            raise ValueError("Allowance must be nonnegative")
        amounts[year] = amount
    eligible = sim.tax_benefit_system.get_variable(
        eligibility_variable, check_existence=True
    )
    if eligible.entity.key != "person" or eligible.value_type is not bool:
        raise ValueError("Allowance eligibility must be a person boolean")
    native = sim.tax_benefit_system.get_variable("personal_allowance")

    def formula(person, period, parameters):
        standard = _call_formula(native, person, period, parameters)
        if period.start.year not in amounts:
            return standard
        income = person("adjusted_net_income", period) - person(
            "gift_aid_grossed_up", period
        )
        higher = (
            amounts[period.start.year]
            - np.maximum(0, income - threshold) * taper
        )
        pa = parameters(
            period
        ).gov.hmrc.income_tax.allowances.personal_allowance
        untapered = np.maximum(pa.amount, higher)
        reduction = np.maximum(0, income - pa.maximum_ANI) * pa.reduction_rate
        age_allowance = np.maximum(0, np.ceil(untapered - reduction))
        # The previous formula is the native allowance or an earlier
        # measure's; both carry the native taper, so an eligible person
        # keeps whichever is larger and two allowance measures compose.
        return np.where(
            person(eligibility_variable, period),
            np.maximum(standard, age_allowance),
            standard,
        )

    _replace_formula(sim, "personal_allowance", formula)
    return sim


# The indices a native property surcharge uses, as the names its compiled
# code reads: up to policyengine-uk 2.139.0 the High Value Council Tax
# Surcharge deflates values by indices.obr.per_capita.gdp, and from 2.139.1
# it projects its bands by indices.obr.house_prices, in the values' stored
# precision (high_value_council_tax_surcharge.py).
_PROPERTY_INDICES = {
    "gdp_per_capita": frozenset({"indices", "per_capita", "gdp"}),
    "house_prices": frozenset({"indices", "house_prices"}),
}


def _code_names(code) -> set:
    """The names compiled code, or code nested in it, reads.

    A comment, docstring or string literal naming an index is not a read
    of it, since only names the code looks up are in ``co_names``.
    """
    names = set()
    stack = [code] if isinstance(code, types.CodeType) else []
    while stack:
        current = stack.pop()
        names.update(current.co_names)
        stack.extend(
            const
            for const in current.co_consts
            if isinstance(const, types.CodeType)
        )
    return names


def _wrapped_native(formula):
    """The native variable a band formula wraps, read from its closure.

    Read, never stored on the formula: a template stores nothing on an
    object it doesn't bind (the template guard in tests/test_data_limits.py).
    """
    code = getattr(formula, "__code__", None)
    closure = getattr(formula, "__closure__", None) or ()
    if code is None or "native" not in code.co_freevars:
        return None
    return closure[code.co_freevars.index("native")].cell_contents


def _property_band_index(native, year) -> str:
    """The index the native channel's formula for ``year`` uses.

    A band wrapped by this template earlier is followed to the formula it
    wraps: its own code names both indices, since it reads whichever that
    formula does. Refuse a formula that reads neither or both, so that a
    band never uses another index than the native bands do.
    """
    formula = native.get_formula(str(year))
    wrapped = _wrapped_native(formula)
    if wrapped is not None and any(
        getattr(formula, "__code__", None) is const
        for const in apply_property_band_surcharge.__code__.co_consts
    ):
        return _property_band_index(wrapped, year)
    names = _code_names(getattr(formula, "__code__", None))
    found = [
        index for index, reads in _PROPERTY_INDICES.items() if reads <= names
    ]
    if len(found) != 1:
        raise ValueError(
            f"Property surcharge channel {native.name} in {year} must read "
            "exactly one of the OBR GDP per capita and house price indices: "
            "a band uses the index the native formula reads, so that it "
            "meets the native bands exactly. Its "
            f"formula reads {'both' if found else 'neither'}."
        )
    return found[0]


def apply_property_band_surcharge(
    sim,
    *,
    lower_bound,
    upper_bound,
    amount,
    start_year,
    end_year,
    value_year=2026,
    geography="ENGLAND",
    channel="high_value_council_tax_surcharge",
):
    """Add a flat owner-only band [lower_bound, upper_bound), in base prices.

    Preserve existing native bands. Bounds and amount are explicit finite
    defaults on the calling module-level modifier; use a finite upper bound.
    Bounds are in ``value_year`` prices, moved to each year by the index
    the native formula reads (``_property_band_index``), so that a band
    meets the native bands exactly: values are deflated by OBR GDP per
    capita, or the bounds projected by the OBR house price index in the
    values' stored precision, as the engine does for each. A native
    formula that reads neither index, or both, is refused. The amount is
    annual cash, with no implicit uprating.
    Geography is a country enum name, or UK for every country.
    """
    years = _annual_years(start_year, end_year)
    _annual_years(value_year, value_year)
    lower = _finite_number(lower_bound, "lower_bound")
    upper = _finite_number(upper_bound, "upper_bound")
    amount = _finite_number(amount, "amount")
    if not 0 <= lower < upper or amount < 0:
        raise ValueError("Select ordered nonnegative bounds and amount")
    native = sim.tax_benefit_system.get_variable(channel, check_existence=True)
    if native.entity.key != "household" or not native.formulas:
        raise ValueError(
            "Property surcharge channel must have a household formula"
        )
    if native.definition_period != YEAR:
        raise ValueError(
            "Property surcharge channel must be annual: the amount is a "
            "yearly charge"
        )
    indices = {year: _property_band_index(native, year) for year in years}
    country_enum = sim.tax_benefit_system.get_variable(
        "country"
    ).possible_values
    tenure_enum = sim.tax_benefit_system.get_variable(
        "tenure_type"
    ).possible_values
    if geography != "UK" and geography not in country_enum.__members__:
        raise ValueError("Select a country enum name or UK")

    def formula(household, period, parameters):
        current = _call_formula(native, household, period, parameters)
        if period.start.year not in years:
            return current
        tenure = household("tenure_type", period)
        owners = (tenure == tenure_enum.OWNED_OUTRIGHT) | (
            tenure == tenure_enum.OWNED_WITH_MORTGAGE
        )
        country = household("country", period)
        in_geography = (
            np.ones(household.count, dtype=bool)
            if geography == "UK"
            else country == country_enum[geography]
        )
        obr = parameters(period).gov.economic_assumptions.indices.obr
        base = parameters(value_year).gov.economic_assumptions.indices.obr
        value = np.asarray(household("main_residence_value", period))
        if indices[period.start.year] == "gdp_per_capita":
            value = value / (obr.per_capita.gdp / base.per_capita.gdp)
            band_lower, band_upper = lower, upper
        else:
            # Project the bounds, as the engine projects its own: dividing
            # the values instead can move a value on an exact native
            # boundary into this band.
            band_lower, band_upper = np.asarray(
                [lower, upper], dtype=value.dtype
            ) * (obr.house_prices / base.house_prices)
        in_band = (
            owners
            & in_geography
            & (value >= band_lower)
            & (value < band_upper)
        )
        return current + in_band * amount

    _replace_formula(sim, channel, formula)
    return sim


# The reviewed policy builders that may prove a modifier is made purely
# from templates. Keep helper functions out of this explicit registry.
TEMPLATES = (
    "rate_change",
    "threshold_change",
    "uc_health_element_change",
    "allowance_uprating",
    "pension_uprating",
    "apply_vat_base_change",
    "apply_benefit_receipt_payment",
    "apply_age_conditioned_allowance",
    "apply_property_band_surcharge",
)
