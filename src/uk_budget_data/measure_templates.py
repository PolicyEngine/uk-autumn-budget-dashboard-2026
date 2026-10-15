"""Reusable, unregistered building blocks for announced Budget measures.

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

Runtime helpers wrap a variable's formula, so they must be applied after
the data is loaded (a modifier's default phase): they refuse a variable
that already holds stored values, and values loaded after a wrapper was
installed would hide it for their periods.
"""

import math
import re
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
    """
    _validate_parameter_path(path)
    return {path: _annual_values(values)}


def threshold_change(
    path: str, values: Mapping
) -> dict[str, dict[str, float]]:
    """Build explicit annual thresholds on an existing native parameter."""
    _validate_parameter_path(path)
    return {path: _annual_values(values)}


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
        return current + spending * delta / (1 + old_rate)

    _replace_formula(sim, "vat", formula)
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
}


def apply_benefit_receipt_payment(
    sim, *, amount, eligible_benefits, geography, channel, year
):
    """Add a lump sum once per household, based on actual annual receipt.

    Receipt on a payment date is approximated by annual receipt. Only
    ``universal_credit``, ``guarantee_credit`` and ``savings_credit`` are
    supported. Universal Credit is natively gated by ``would_claim_uc``.
    The two Pension Credit components are entitlement amounts: guarantee
    credit additionally requires ``in_receipt_of_guarantee_credit``, which
    enforces eligibility and take-up, and savings credit requires positive
    actual ``pension_credit`` receipt. All are projected from benefit units
    with household ``any``.
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
    if native.definition_period != YEAR:
        raise ValueError(
            "Payment channel must be annual: the payment is a one-off "
            "amount in the year"
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
    if native.definition_period != YEAR:
        raise ValueError(
            "Property surcharge channel must be annual: the amount is a "
            "yearly charge"
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
