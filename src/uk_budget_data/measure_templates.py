"""Reusable, unregistered building blocks for announced Budget measures.

Parameter builders return content-bound dictionaries for ``Reform``. Runtime
helpers must be called from module-level modifiers with finite JSON defaults:
execution receipts cannot bind closure factories or partially applied helpers.
"""

import calendar
import math
import re
from collections.abc import Mapping
from datetime import date
from decimal import (
    ROUND_CEILING,
    ROUND_FLOOR,
    ROUND_HALF_UP,
    Decimal,
    InvalidOperation,
    localcontext,
)

import numpy as np
from policyengine_core.reforms import Reform as CoreReform
from policyengine_uk.model_api import Variable
from policyengine_uk.utils.scenario import _apply_reform_class


def _validate_parameter_path(path: str) -> None:
    """Require a leaf in the installed engine's native parameter tree."""
    from policyengine_core.parameters import Parameter
    from policyengine_uk.system import system

    if not isinstance(path, str) or not path:
        raise ValueError("A nonempty parameter path is required")
    try:
        parameter = system.parameters.get_child(path)
    except (KeyError, AttributeError, IndexError, ValueError) as exc:
        raise ValueError(f"Unknown parameter path: {path}") from exc
    if not isinstance(parameter, Parameter):
        raise ValueError(f"Parameter path must identify a leaf: {path}")


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


def _annual_values(values: Mapping) -> dict[str, float]:
    """Normalize explicit annual keys without inventing intervening values."""
    if not isinstance(values, Mapping) or not values:
        raise ValueError("Supply at least one explicit annual value")
    result = {}
    for year, value in values.items():
        if isinstance(year, bool) or not re.fullmatch(
            r"[1-9]\d{3}", str(year)
        ):
            raise ValueError(
                "Use four-digit annual keys; a lone ISO date changes one day"
            )
        key = str(year)
        if key in result:
            raise ValueError(f"Duplicate annual value for {key}")
        result[key] = float(_finite_decimal(value, f"Value for {key}"))
    return dict(sorted(result.items()))


def rate_change(path: str, values: Mapping) -> dict[str, dict[str, float]]:
    """Build explicit annual rates; the caller supplies the parameter's units.

    ISO dates are deliberately refused: ``2029-04-01`` denotes one day,
    not a rate that continues until the next change.
    """
    _validate_parameter_path(path)
    return {path: _annual_values(values)}


def threshold_change(
    path: str, values: Mapping
) -> dict[str, dict[str, float]]:
    """Build explicit annual thresholds on an existing native parameter."""
    _validate_parameter_path(path)
    return {path: _annual_values(values)}


def _full_months(values: Mapping, label: str) -> dict[str, float]:
    if not isinstance(values, Mapping) or not values:
        raise ValueError(f"{label} must cover all 12 months of each year")
    result = {}
    covered = {}
    for period, value in values.items():
        if not isinstance(period, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}\.\d{4}-\d{2}-\d{2}", period
        ):
            raise ValueError(f"{label} requires explicit full-month ranges")
        try:
            start, end = (
                date.fromisoformat(part) for part in period.split(".")
            )
        except ValueError as exc:
            raise ValueError(f"Invalid full-month range: {period}") from exc
        expected_end = date(
            start.year,
            start.month,
            calendar.monthrange(start.year, start.month)[1],
        )
        if start.day != 1 or end != expected_end:
            raise ValueError(
                f"Range must cover exactly one full month: {period}"
            )
        months = covered.setdefault(start.year, set())
        if start.month in months:
            raise ValueError(f"Overlapping month in {label}: {period}")
        months.add(start.month)
        result[period] = float(_finite_decimal(value, f"Value for {period}"))
    if any(months != set(range(1, 13)) for months in covered.values()):
        raise ValueError(f"{label} must cover all 12 months without gaps")
    years = sorted(covered)
    if years != list(range(years[0], years[-1] + 1)):
        raise ValueError(f"{label} must cover consecutive years without gaps")
    return dict(sorted(result.items()))


def monthly_schedule(
    path: str, baseline_months: Mapping, reform_months: Mapping
) -> dict[str, dict[str, dict[str, float]]]:
    """Return ``Reform`` kwargs with complete monthly schedules on both sides.

    Each key is an inclusive ``YYYY-MM-01.YYYY-MM-<last>`` range. Both sides
    must cover the same years, each with all twelve months. This avoids a
    dated reform being compared with a different, implicit annual baseline.

    The installed UK engine's direct ``parameter_changes`` route does not
    parse these bounded ranges. Consumption requires the publication-core
    dated scenario adapter; this builder neither patches a processed tree
    nor substitutes an annual average for the supplied chronology.
    """
    _validate_parameter_path(path)
    baseline = _full_months(baseline_months, "Baseline schedule")
    reform = _full_months(reform_months, "Reform schedule")
    if {period[:4] for period in baseline} != {
        period[:4] for period in reform
    }:
        raise ValueError(
            "Baseline and reform schedules must cover the same years"
        )
    return {
        "baseline_parameter_changes": {path: baseline},
        "parameter_changes": {path: reform},
    }


def allowance_uprating(
    path: str,
    base_value: float,
    growth_by_year: Mapping,
    rounding: float = 10,
    rounding_mode: str = "up",
    taper_after_rounding: bool = True,
) -> dict[str, dict[str, float]]:
    """Chain each year's growth from the previous rounded allowance.

    ``base_value`` is the allowance before the first supplied year's growth.
    Include a zero growth in the initial year to publish that base explicitly.
    Years must be consecutive; growth values are fractional changes, so 0.01
    means 1%. ``up``, ``down`` and ``nearest`` are explicit rounding policies.

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
    growths = _annual_values(growth_by_year)
    years = [int(year) for year in growths]
    if years != list(range(years[0], years[-1] + 1)):
        raise ValueError("Supply growth for consecutive years without gaps")
    values = {}
    for year, growth in growths.items():
        factor = 1 + _finite_decimal(growth, f"Growth for {year}")
        if factor < 0:
            raise ValueError("Growth cannot be below -100%")
        units = amount * factor / increment
        # Growth computed from float ratios can sit just above an exact
        # multiple. Retain the nine-decimal guard before policy rounding.
        with localcontext() as context:
            context.prec = max(28, units.adjusted() + 12)
            units = units.quantize(Decimal("0.000000001"))
        amount = (
            units.to_integral_value(rounding=modes[rounding_mode]) * increment
        )
        values[year] = float(_finite_decimal(amount, f"Allowance for {year}"))
    return {path: values}


def nearest_5p_weekly(amount: float) -> float:
    """Round a weekly amount to the nearest 5p, with halfway values rounded up.

    This is an explicit policy rule, not a claim that the engine rounds its
    State Pension parameters. Apply independently to basic and new pensions.
    """
    value = _finite_decimal(amount, "Weekly amount")
    if value < 0:
        raise ValueError("Weekly amount must be nonnegative")
    return float(
        (value / Decimal("0.05")).to_integral_value(rounding=ROUND_HALF_UP)
        * Decimal("0.05")
    )


def pension_uprating(
    amount: float, growth: float, *, round_to_5p: bool = False
) -> float:
    """Uprate one pension rate, conditionally applying the stated 5p rule.

    Opt in for every affected pension independently; deriving basic pension
    from an already rounded new-pension ratio misses basic pension rounding.
    """
    raw = _finite_decimal(amount, "Weekly amount") * (
        1 + _finite_decimal(growth, "Pension growth")
    )
    if raw < 0:
        raise ValueError("Uprated weekly amount must be nonnegative")
    value = float(_finite_decimal(raw, "Uprated weekly amount"))
    return nearest_5p_weekly(value) if round_to_5p else value


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
):
    """Pass a signed VAT rate change through VAT-inclusive eligible spending.

    ``rate_change`` is new rate minus old rate. Strip the baseline VAT from
    the bill before multiplying by that change; by default the installed
    reduced rate is the baseline. Supply ``baseline_rate`` for another base.
    Annual bounds are inclusive, with no implicit fiscal/calendar proration.
    Wrap the current ``vat`` formula: the engine derives ``vat_change`` and
    resources from it. Missing spending defaults to the variable's native
    value (zero for spending inputs). Repeated calls add their adjustments.
    Call from a module-level modifier with finite JSON default arguments.
    """
    years = _annual_years(start_year, end_year)
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
        previous = native.get_formula(period)
        current = (
            previous(household, period, parameters)
            if previous is not None
            else household.empty_array()
        )
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
        return current + spending * delta / (1 + old_rate)

    _replace_formula(sim, "vat", formula)
    return sim


def _replace_formula(sim, name, formula):
    """Replace on this simulation only, preserving native variable metadata."""
    _ensure_not_stored(sim, name)
    replacement = type(
        name, (Variable,), {"formula": formula, "__module__": __name__}
    )

    class FormulaReform(CoreReform):
        def apply(self):
            self.update_variable(replacement)

    _apply_reform_class(FormulaReform, sim)


def apply_benefit_receipt_payment(
    sim, *, amount, eligible_benefits, geography, channel, year
):
    """Add a lump sum once per household, based on actual annual receipt.

    Receipt on a payment date is approximated by annual receipt. Benefits
    are read on their native person, benefit-unit or household entity before
    household ``any`` projection. For guarantee credit, the engine's receipt
    indicator also enforces age eligibility and Pension Credit take-up.
    Savings credit is gated by actual Pension Credit receipt too.
    ``geography`` is ``GB`` (excludes Northern Ireland) or ``UK``.
    Choose an existing household income/benefit channel with a formula and
    the appropriate tax/means-test treatment, e.g. the cost-of-living channel.
    Its native payment is preserved in every year.
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
    benefits = {}
    for name in eligible_benefits:
        variable = sim.tax_benefit_system.get_variable(
            name, check_existence=True
        )
        if variable.entity.key not in ("person", "benunit", "household"):
            raise ValueError(
                f"Unsupported benefit entity: {variable.entity.key}"
            )
        benefits[name] = variable.entity.key

    def formula(household, period, parameters):
        native_formula = native.get_formula(period)
        current = (
            native_formula(household, period, parameters)
            if native_formula is not None
            else household.empty_array()
        )
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
                if name == "guarantee_credit":
                    received &= household.members.benunit(
                        "in_receipt_of_guarantee_credit", period
                    )
                if name == "savings_credit":
                    received &= (
                        household.members.benunit("pension_credit", period) > 0
                    )
                positive = household.any(received)
            eligible |= positive
        country = household("country", period)
        if geography == "GB":
            eligible &= country != country.possible_values.NORTHERN_IRELAND
        return current + eligible * amount

    _replace_formula(sim, channel, formula)
    return sim


def apply_age_conditioned_allowance(
    sim,
    *,
    allowance_by_year,
    taper_threshold,
    taper_rate,
    eligibility_variable="is_SP_age",
):
    """Apply a rounded allowance path, then taper, with the native PA floor.

    Pass the inner annual mapping returned by ``allowance_uprating``. The
    standard allowance, its high-income taper and basic-rate limit remain
    the engine's own rules. The extra allowance tapers to that standard PA.
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
        standard = native.get_formula(period)(person, period, parameters)
        if period.start.year not in amounts:
            return standard
        income = person("adjusted_net_income", period) - person(
            "gift_aid_grossed_up", period
        )
        higher = np.ceil(
            amounts[period.start.year]
            - np.maximum(0, income - threshold) * taper
        )
        return np.where(
            person(eligibility_variable, period),
            np.maximum(standard, higher),
            standard,
        )

    _replace_formula(sim, "personal_allowance", formula)
    return sim


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
    Property values are deflated by the native GDP-per-capita index into
    ``value_year`` prices. The amount is annual cash, with no implicit
    uprating.
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
    country_enum = sim.tax_benefit_system.get_variable(
        "country"
    ).possible_values
    tenure_enum = sim.tax_benefit_system.get_variable(
        "tenure_type"
    ).possible_values
    if geography != "UK" and geography not in country_enum.__members__:
        raise ValueError("Select a country enum name or UK")

    def formula(household, period, parameters):
        previous = native.get_formula(period)
        current = (
            previous(household, period, parameters)
            if previous is not None
            else household.empty_array()
        )
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
        index = parameters(
            period
        ).gov.economic_assumptions.indices.obr.per_capita.gdp
        base_index = parameters(
            value_year
        ).gov.economic_assumptions.indices.obr.per_capita.gdp
        value = np.asarray(household("main_residence_value", period))
        value = value / (index / base_index)
        in_band = owners & in_geography & (value >= lower) & (value < upper)
        return current + in_band * amount

    _replace_formula(sim, channel, formula)
    return sim
