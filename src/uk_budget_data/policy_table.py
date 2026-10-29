"""What each candidate measure changes, before and after, from the model.

Writes ``public/data/policy_parameters.json``, which the Policies tab reads
for each card's "What changes" table: for each measure, the policy
parameters it changes, current law beside the measure, by year (or by date,
or for the period it is in force). Nothing here is typed by hand for the
page: every value is read from

- the engine's parameters (``engine_parameter``: policyengine-uk's value at
  the start of the fiscal year, 6 April, the instant ``reforms.py`` reads);
- a measure's own parameter changes in ``reforms.py``
  (``measure_parameter_change``), or a dated schedule there
  (``measure_schedule``);
- a modifier's documented constants, its default arguments in
  ``budget_measures`` (``modifier_constant``), read by ``inspect``, never
  by editing the module (receipts bind its bytes); or
- for the few figures in neither, the measure's published description
  (``documented``), said so in the row's source.

Only parameter lookups: no dataset and no microsimulation, so it runs in
seconds on any machine.

Each measure carries the description it was built from. The page shows a
measure's table only while the published measure has that description,
so a measure changed since (on Budget day, say) never shows figures that
may no longer describe it (as ``policyDetails.js``'s ``writtenFor``).
"""

from __future__ import annotations

import importlib.metadata
import inspect
import json
import math
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from uk_budget_data import reforms as registry
from uk_budget_data.budget_measures import (
    zero_vat_on_domestic_electricity as _electricity,
)
from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    CAP_FROM as BUS_FARE_CAP_FROM,
)
from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    CAP_TO as BUS_FARE_CAP_TO,
)
from uk_budget_data.budget_measures.bus_fare_cap_2027 import (
    bus_fare_cap_2027,
)
from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
    carers_allowance_earnings_taper,
)
from uk_budget_data.budget_measures.employer_ni_relief_ages_21_to_24 import (
    employer_ni_relief_ages_21_to_24,
)
from uk_budget_data.budget_measures.household_energy_payment_2026 import (
    household_energy_payment_2026,
)
from uk_budget_data.budget_measures.pension_tax_allowance import (
    pension_tax_allowance,
)
from uk_budget_data.budget_measures.road_fuel_vat_cut import (
    ROAD_FUEL_VAT_RATE,
    road_fuel_vat_cut,
)
from uk_budget_data.budget_measures.state_pension_income_tax_allowance import (
    state_pension_income_tax_allowance,
)
from uk_budget_data.budget_measures.state_pension_only_income_tax_allowance import (
    state_pension_only_income_tax_allowance,
)
from uk_budget_data.budget_measures.warm_home_discount_top_up import (
    warm_home_discount_top_up,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    SPRING_SHARE,
    WINTER_SHARE,
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.budget_years import POLICY_YEARS

SCHEMA = "uk-budget-dashboard/policy-parameters/v1"
OUTPUT_FILE = "policy_parameters.json"

PERCENT = "percent"
POUNDS = "gbp"
PENCE_A_LITRE = "pence_per_litre"

MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


# --- Reading the model ------------------------------------------------------


def _parameters():
    """Current law on the OBR October 2026 forecast, as every run builds
    it (``uk_budget_data.forecast``)."""
    from uk_budget_data.forecast import forecast_parameters

    return forecast_parameters()


def engine_value(path: str, year: int) -> float:
    """A policyengine-uk parameter at the start of fiscal year ``year``
    (6 April, as ``reforms.plan_2_unfrozen_thresholds`` reads it)."""
    node = _parameters()
    for part in path.split("."):
        match = re.fullmatch(r"([A-Za-z0-9_]+)(?:\[(\d+)\])?", part)
        node = getattr(node, match.group(1))
        if match.group(2) is not None:
            node = node.brackets[int(match.group(2))]
    return float(node(f"{year}-04-06"))


def constants(modifier: Callable) -> dict[str, Any]:
    """A modifier's documented constants: its default arguments."""
    return {
        name: parameter.default
        for name, parameter in inspect.signature(modifier).parameters.items()
        if parameter.default is not inspect.Parameter.empty
    }


def _fiscal_label(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


def _day_label(day: date) -> str:
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


def _month_label(day: date) -> str:
    return f"{MONTHS[day.month - 1]} {day.year}"


def _fiscal_year_of(day: date) -> int:
    """The year of the page's timeline (April to March) a date falls in."""
    return day.year if day.month >= 4 else day.year - 1


def _clean(value: Optional[float]) -> Optional[float]:
    """Round off float noise (0.15000000000000002) without losing pence."""
    return None if value is None else round(float(value), 6)


def _point(key, label, year, before, after) -> dict:
    return {
        "key": str(key),
        "label": label,
        "year": year,
        "before": _clean(before),
        "after": _clean(after),
    }


def _yearly(
    before: Callable[[int], Optional[float]],
    after: Callable[[int], Optional[float]],
) -> list[dict]:
    return [
        _point(year, _fiscal_label(year), year, before(year), after(year))
        for year in POLICY_YEARS
    ]


# A row's unit in plain words, for the page: what one of its values is
UNIT_WORDS = {
    PERCENT: None,  # a rate reads as itself: "15% → 0%"
    PENCE_A_LITRE: "pence a litre",
    POUNDS: "£ a year",
}


def _row(
    label,
    unit,
    points,
    source,
    *,
    primary=True,
    note=None,
    unit_words=None,
    figures=None,
) -> dict:
    """One parameter's points. ``note`` qualifies the row where the page
    lists it; ``figures``, the figures a card's visual draws that are not
    the row's points, by name and then fiscal year. A card's words are
    src/utils/policyDetails.js's summary and points, not a row's."""
    row = {
        "label": label,
        "unit": unit,
        "unit_words": (
            unit_words if unit_words is not None else UNIT_WORDS[unit]
        ),
        "primary": primary,
        "points": points,
        "source": source,
    }
    if note:
        row["note"] = note
    if figures:
        row["figures"] = figures
    return row


def _changed(reform, path: str) -> dict[str, float]:
    return (reform.parameter_changes or {}).get(path, {})


def _engine_or_change(reform, path: str) -> Callable[[int], float]:
    change = _changed(reform, path)
    return lambda year: change.get(str(year), engine_value(path, year))


def _source(before: dict, after: dict) -> dict:
    return {"before": before, "after": after}


def _engine_source(path: str) -> dict:
    return {
        "kind": "engine_parameter",
        "where": f"policyengine-uk {path}, at 6 April of each year",
    }


def _change_source(path: str, function: str) -> dict:
    return {
        "kind": "measure_parameter_change",
        "where": f"reforms.py {function}: {path}; current law elsewhere",
    }


def _modifier_source(modifier: Callable, names: str) -> dict:
    return {
        "kind": "modifier_constant",
        "where": (
            f"budget_measures/{modifier.__module__.rsplit('.', 1)[-1]}.py "
            f"{modifier.__name__}({names})"
        ),
    }


# --- In-force windows of the VAT measures -----------------------------------
#
# The VAT modifiers hold one rate change a fiscal year, weighted by the days
# in force (fiscal years from 1 April, as their comments count them), except
# a year in YEAR_WEIGHTS. The dates come from each measure's description;
# the rate while in force is each year's constant divided by its weight, and
# every year must give the same rate, so the dates and weights are checked
# against the constants.

VAT_WINDOWS = {
    registry.ELECTRICITY_VAT_ID: (
        (
            date(2026, 10, 1)
            if _electricity.PRE_BUDGET_ZERO_RATE_IN_MEASURE
            else date(2027, 4, 1)
        ),
        date.fromisoformat(_electricity.ZERO_RATE_EXTENDED_TO),
    ),
    registry.FUEL_VAT_ID: (date(2026, 12, 1), date(2027, 5, 31)),
}

# A year a modifier weights by something other than its days in force:
# electricity's 2026-27 carries the October to March share of a year's use
# (WINTER_SHARE in its module), not 182 of 365 days, as the zero-rated
# months are the higher-use half of the year; its 2027-28 the April to June
# share (SPRING_SHARE), not 91 of 366 days.
YEAR_WEIGHTS = (
    {registry.ELECTRICITY_VAT_ID: {2026: WINTER_SHARE, 2027: SPRING_SHARE}}
    if _electricity.PRE_BUDGET_ZERO_RATE_IN_MEASURE
    else {}
)

# How a VAT measure's table says its constants are weighted, unless the
# measure says otherwise (a year in YEAR_WEIGHTS)
DAYS_DIVIDED = "each divided by its share of the fiscal year's days in force"
DAYS_NOTE = (
    "As modelled: the cut weighted by the days it is in force in each "
    "fiscal year"
)


def _days_in_force(year: int, first: date, last: date) -> tuple[int, int]:
    start, end = date(year, 4, 1), date(year + 1, 4, 1)
    low, high = max(first, start), min(last + timedelta(days=1), end)
    return max((high - low).days, 0), (end - start).days


def in_force_rate_change(measure_id: str, changes: dict[int, float]) -> float:
    """The rate change while in force, from the weighted constants."""
    first, last = VAT_WINDOWS[measure_id]
    weights = YEAR_WEIGHTS.get(measure_id, {})
    rates = []
    for year, change in changes.items():
        days, length = _days_in_force(year, first, last)
        if year in weights:
            if not days:
                raise ValueError(
                    f"{measure_id}: {year} has a weight but is not in force"
                )
            rates.append(change / weights[year])
        elif days:
            rates.append(change * length / days)
    if not rates or max(rates) - min(rates) > 1e-9:
        raise ValueError(
            f"{measure_id}: the in-force dates do not fit the modifier's "
            f"weighted constants ({rates})"
        )
    return rates[0]


def _vat_rows(
    measure_id: str,
    modifier: Callable,
    base_rate: float,
    base_source: dict,
    label: str,
    changes: dict[int, float],
    names: str,
    divided: str = DAYS_DIVIDED,
    note: str = DAYS_NOTE,
) -> list[dict]:
    first, last = VAT_WINDOWS[measure_id]
    cut = in_force_rate_change(measure_id, changes)
    period = f"{_month_label(first)} to {_month_label(last)}"
    derived = {
        "kind": "modifier_constant",
        "where": (
            f"{_modifier_source(modifier, names)['where']}, {divided}, "
            f"{period} (the dates in the measure's description)"
        ),
    }
    return [
        _row(
            label,
            PERCENT,
            [
                _point(
                    f"{first.isoformat()}/{last.isoformat()}",
                    period,
                    _fiscal_year_of(first),
                    base_rate,
                    base_rate + cut,
                )
            ],
            _source(base_source, derived),
        ),
        _row(
            f"{label}, averaged over the year",
            PERCENT,
            _yearly(
                lambda year: base_rate,
                lambda year: base_rate + changes.get(year, 0.0),
            ),
            _source(base_source, _modifier_source(modifier, names)),
            primary=False,
            note=note,
        ),
    ]


# --- One builder per measure ------------------------------------------------


def _fuel_duty(reform) -> list[dict]:
    path = registry.FUEL_DUTY
    current = [
        (date.fromisoformat(day), rate)
        for day, rate in registry.FUEL_DUTY_CURRENT_LAW
    ]
    deferred = [
        (date.fromisoformat(day), rate)
        for day, rate in registry.fuel_duty_deferral_schedule()
    ]

    def on(schedule, day):
        return [rate for start, rate in schedule if start <= day][-1]

    # The dates on the page's timeline, April 2026 to March 2032
    first, last = date(POLICY_YEARS[0], 4, 1), date(
        POLICY_YEARS[-1] + 1, 3, 31
    )
    # The rates in force on the timeline's first day, then each change
    days = sorted(
        {first} | {d for d, _ in current + deferred if first <= d <= last}
    )
    dated = [
        _point(
            day.isoformat(),
            _day_label(day),
            _fiscal_year_of(day),
            on(current, day) * 100,
            on(deferred, day) * 100,
        )
        for day in days
    ]
    return [
        _row(
            "Fuel duty",
            PENCE_A_LITRE,
            dated,
            _source(
                {
                    "kind": "measure_schedule",
                    "where": "reforms.py FUEL_DUTY_CURRENT_LAW: current law "
                    "in policyengine-uk's petrol_and_diesel.yaml, by date",
                },
                {
                    "kind": "measure_schedule",
                    "where": "reforms.py fuel_duty_deferral_schedule()",
                },
            ),
        ),
        _row(
            "Fuel duty, averaged over the year",
            PENCE_A_LITRE,
            _yearly(
                lambda year: engine_value(path, year) * 100,
                lambda year: _engine_or_change(reform, path)(year) * 100,
            ),
            _source(
                _engine_source(path),
                _change_source(path, "fuel_duty_deferral_rates()"),
            ),
            primary=False,
            note="As modelled: each fiscal year's rates weighted by their "
            "days, as the simulation applies them",
        ),
    ]


def _pension_tax_allowance(reform) -> list[dict]:
    values = constants(pension_tax_allowance)
    weekly_path = "gov.dwp.state_pension.new_state_pension.amount"
    allowance_path = registry.PERSONAL_ALLOWANCE
    step = values["weekly_rounding"]

    def largest(year):
        if not values["first_year"] <= year <= values["last_year"]:
            return 0
        weekly = (
            math.floor(engine_value(weekly_path, year) / step + 1e-9) * step
        )
        full = round(weekly * 52, 2)
        return math.ceil(
            round(
                values["basic_rate"]
                * (full - engine_value(allowance_path, year)),
                6,
            )
        )

    return [
        _row(
            "Pension Tax Allowance, the largest tax reduction",
            POUNDS,
            _yearly(lambda year: 0, largest),
            _source(
                {
                    "kind": "documented",
                    "where": "no such reduction under current law",
                },
                {
                    "kind": "modifier_constant",
                    "where": "20% of the full new State Pension "
                    f"(policyengine-uk {weekly_path} x 52, rounded down to "
                    f"5p a week) above the personal allowance "
                    f"({allowance_path}), rounded up; "
                    + _modifier_source(
                        pension_tax_allowance, "first_year, last_year"
                    )["where"],
                },
            ),
            unit_words="£ of income tax a year",
            note="For people over State Pension age; reduced by £1 for "
            f"every £{values['taper_divisor']} of total income above the "
            "full new State Pension",
        )
    ]


def _state_pension_allowance(reform) -> list[dict]:
    path = registry.PERSONAL_ALLOWANCE
    modifier = reform.simulation_modifier
    if modifier is pension_tax_allowance:
        return _pension_tax_allowance(reform)
    if modifier not in (
        state_pension_income_tax_allowance,
        state_pension_only_income_tax_allowance,
    ):
        raise ValueError(
            "The State Pension allowance table knows the total-income and "
            f"tapered designs only, not {modifier.__name__}"
        )
    values = constants(modifier)
    allowance = {}
    for name, value in values.items():
        if not name.startswith("allowance_"):
            continue
        if isinstance(value, dict):
            allowance.update({int(k): v for k, v in value.items()})
        else:
            allowance[int(name.removeprefix("allowance_"))] = value
    # The allowance's last year, where the modifier has one
    last = values.get("last_year")
    if last is not None:
        allowance = {y: v for y, v in allowance.items() if y <= last}
    if modifier is state_pension_only_income_tax_allowance:
        tests = []
        if values["total_income_at_most_allowance"]:
            tests.append(
                "whose total income, State Pension included"
                + (
                    " (savings interest aside)"
                    if values["disregard_savings_interest"]
                    else ""
                )
                + ", is at or below it"
            )
        if values["other_income_limit"] is not None:
            tests.append(
                "whose other income is at most "
                f"£{values['other_income_limit']:,.0f}"
            )
        note = (
            "With the measure, only for people "
            + " and ".join(tests or ["with a State Pension"])
            + "; £1 more takes it all away"
        )
    else:
        note = (
            f"With the measure, withdrawn £{values['taper_rate']:g} for "
            "each £1 of income above it, down to the personal allowance"
        )
    return [
        _row(
            "Income tax allowance over State Pension age",
            POUNDS,
            _yearly(
                lambda year: engine_value(path, year),
                lambda year: allowance.get(year, engine_value(path, year)),
            ),
            _source(
                _engine_source(path),
                _modifier_source(modifier, "allowance_2027 to 2031"),
            ),
            note=note,
        )
    ]


def _warm_home_discount(reform) -> list[dict]:
    values = constants(warm_home_discount_top_up)
    # The scheme's £150 is not in policyengine-uk 2.132.6, which has no
    # Warm Home Discount; it comes from the measure's description.
    standard = _documented_amount(reform.description, "from £", " to £")
    year = values["year"]
    return [
        _row(
            "Warm Home Discount",
            POUNDS,
            [
                _point(
                    year,
                    f"Winter {_fiscal_label(year)}",
                    year,
                    standard,
                    standard + values["amount"],
                )
            ],
            _source(
                {
                    "kind": "documented",
                    "where": "the measure's description (£150); "
                    "policyengine-uk 2.132.6 has no Warm Home Discount",
                },
                {
                    "kind": "modifier_constant",
                    "where": "£150 plus "
                    + _modifier_source(warm_home_discount_top_up, "amount")[
                        "where"
                    ],
                },
            ),
            unit_words="£ a household, once",
            note=f"Paid to {values['pension_credit_receipt_rate']:.0%} of "
            "eligible Pension Credit households and "
            f"{values['other_receipt_rate']:.0%} of other eligible "
            "households, as modelled",
        )
    ]


def _documented_amount(text: str, before: str, after: str) -> float:
    match = re.search(re.escape(before) + r"([\d,]+)" + re.escape(after), text)
    if not match:
        raise ValueError(f"no amount after {before!r} in the description")
    return float(match.group(1).replace(",", ""))


def _check_electricity_where(values: dict) -> None:
    """Where the zero rate applies, from the modifier's geographies (#290,
    Max, 19:32): Great Britain from October 2026, and Northern Ireland from
    April 2027 only as the Budget expects (RB 6.210), while HMRC's VAT
    Notice 701/19 keeps it at 5% there. The card says so in its points and
    visual (src/utils/policyDetails.js), so a measure applied elsewhere
    stops the table being written until they are checked."""
    if (values["geography"], values["geography_2027"]) != ("GB", "UK"):
        raise ValueError(
            "the electricity card knows Great Britain, then the UK from "
            "April 2027, only"
        )


def _electricity_vat(reform) -> list[dict]:
    values = constants(zero_vat_on_domestic_electricity)
    changes = {
        int(name.rsplit("_", 1)[1]): value
        for name, value in values.items()
        if name.startswith("rate_change_")
    }
    path = "gov.hmrc.vat.reduced_rate"
    # While the pre-Budget zero rate is in the measure (SI 2026/987), the
    # 5% is the scoring baseline, as Table 6.1 scores it (#290, Max); the
    # card's visual marks those months as law before the Budget
    _check_electricity_where(values)
    return _vat_rows(
        registry.ELECTRICITY_VAT_ID,
        zero_vat_on_domestic_electricity,
        engine_value(path, POLICY_YEARS[0]),
        _engine_source(path),
        "VAT on domestic electricity",
        changes,
        "rate_change_2026, rate_change_2027",
        # 2026-27 by its share of a year's use (YEAR_WEIGHTS), while the
        # pre-Budget zero rate is in the measure; else by days
        **(
            dict(
                divided=(
                    "rate_change_2026 divided by that module's WINTER_SHARE "
                    "(the October to March share of a year's electricity "
                    "use) and rate_change_2027 by its SPRING_SHARE (the "
                    "April to June share)"
                ),
                note=(
                    "As modelled: the cut weighted in 2026-27 by the "
                    "October to March share of a year's electricity use "
                    "and in 2027-28 by the April to June share, not by "
                    "their days in force"
                ),
            )
            if _electricity.PRE_BUDGET_ZERO_RATE_IN_MEASURE
            else {}
        ),
    )


def _road_fuel_vat(reform) -> list[dict]:
    values = constants(road_fuel_vat_cut)
    changes = {
        int(name.rsplit("_", 1)[1]): value
        for name, value in values.items()
        if name.startswith("rate_change_")
    }
    path = "gov.hmrc.vat.standard_rate"
    base = engine_value(path, POLICY_YEARS[0])
    if base != ROAD_FUEL_VAT_RATE:
        raise ValueError(
            "the modifier's road fuel VAT rate is not the engine's"
        )
    return _vat_rows(
        registry.FUEL_VAT_ID,
        road_fuel_vat_cut,
        base,
        _engine_source(path),
        "VAT on petrol and diesel",
        changes,
        "rate_change_2026, rate_change_2027",
    )


def _employer_ni(reform) -> list[dict]:
    values = constants(employer_ni_relief_ages_21_to_24)
    start = values["start_year"]
    limits = {
        int(name.rsplit("_", 1)[1]): value
        for name, value in values.items()
        if name.startswith("upper_secondary_threshold_")
    }
    path = "gov.hmrc.national_insurance.class_1.rates.employer"
    ages = f"{values['lowest_age']} to {values['age_limit'] - 1}"
    modifier = _modifier_source(
        employer_ni_relief_ages_21_to_24,
        "start_year, lowest_age, age_limit",
    )
    return [
        _row(
            f"Employer National Insurance rate, employees aged {ages}",
            PERCENT,
            _yearly(
                lambda year: engine_value(path, year),
                lambda year: (
                    0.0
                    if year >= start and year in limits
                    else engine_value(path, year)
                ),
            ),
            _source(_engine_source(path), modifier),
            note="On earnings from the secondary threshold up to the limit "
            "below; above it, the full rate",
        ),
        _row(
            f"Earnings relieved for ages {ages}, up to",
            POUNDS,
            _yearly(lambda year: None, lambda year: limits.get(year)),
            _source(
                {
                    "kind": "engine_parameter",
                    "where": "none: current law relieves no earnings at these "
                    "ages in policyengine-uk 2.132.6",
                },
                _modifier_source(
                    employer_ni_relief_ages_21_to_24,
                    "upper_secondary_threshold_2027 to 2031",
                ),
            ),
            primary=False,
        ),
    ]


def _threshold_freeze(reform) -> list[dict]:
    allowance, band = registry.PERSONAL_ALLOWANCE, registry.BASIC_RATE_BAND
    function = "_create_threshold_freeze_2031_32()"
    after_allowance = _engine_or_change(reform, allowance)
    after_band = _engine_or_change(reform, band)
    return [
        _row(
            "Personal allowance",
            POUNDS,
            _yearly(lambda y: engine_value(allowance, y), after_allowance),
            _source(
                _engine_source(allowance), _change_source(allowance, function)
            ),
        ),
        _row(
            "Higher rate threshold",
            POUNDS,
            _yearly(
                lambda y: engine_value(allowance, y) + engine_value(band, y),
                lambda y: after_allowance(y) + after_band(y),
            ),
            _source(
                {
                    "kind": "engine_parameter",
                    "where": f"personal allowance plus basic rate band "
                    f"({allowance} + {band})",
                },
                _change_source(f"{allowance} + {band}", function),
            ),
            note="The personal allowance plus the basic rate band",
        ),
        _row(
            "Basic rate band",
            POUNDS,
            _yearly(lambda y: engine_value(band, y), after_band),
            _source(_engine_source(band), _change_source(band, function)),
            primary=False,
        ),
    ]


def _badr(reform) -> list[dict]:
    path = registry.BADR_LIFETIME_LIMIT
    return [
        _row(
            "Business Asset Disposal Relief lifetime limit",
            POUNDS,
            _yearly(
                lambda y: engine_value(path, y),
                _engine_or_change(reform, path),
            ),
            _source(
                _engine_source(path),
                _change_source(path, "_create_badr_lifetime_limit_cut()"),
            ),
            unit_words="£ of gains over a lifetime",
        )
    ]


def _plan_2(reform) -> list[dict]:
    path = registry.PLAN_2_THRESHOLD
    return [
        _row(
            "Plan 2 repayment threshold",
            POUNDS,
            _yearly(
                lambda y: engine_value(path, y),
                _engine_or_change(reform, path),
            ),
            _source(
                _engine_source(path),
                _change_source(path, "plan_2_unfrozen_thresholds()"),
            ),
            note="Current law freezes it at £29,385 to April 2030, then "
            "uprates it; with the measure it rises with RPI from April 2027",
        )
    ]


def carers_allowance_limit(year: int) -> float:
    """The measure's Weekly Earnings Limit, £ a week, as the modifier
    computes it: 16 hours at the OBR's National Living Wage for that April
    (``national_living_wage_by_april``), else £13.21 from April 2027 moved
    on with average earnings, rounded up to the pound."""
    values = constants(carers_allowance_earnings_taper)
    wages = dict(values["national_living_wage_by_april"])
    if year in wages:
        wage = wages[year]
    else:
        earnings = "gov.economic_assumptions.indices.obr.average_earnings"
        wage = (
            values["national_living_wage_2027"]
            * engine_value(earnings, year)
            / engine_value(earnings, 2027)
        )
    return float(math.ceil(round(values["limit_hours"] * wage, 6)))


def _carers_allowance_taper(reform) -> list[dict]:
    """The cliff the measure removes (#290, Anthony, 19:20): the allowance
    £1 a week over the earnings limit, nothing under current law and the
    weekly rate less £1 with the taper. The measure does not move the limit
    itself, so no row shows it as a change; the row's figures give the limit
    and where the tapered allowance runs out."""
    values = constants(carers_allowance_earnings_taper)
    start, taper = values["start_year"], values["taper_rate"]
    if values["earnings_limit"] is not None:
        raise ValueError("the table reads the measure's own earnings limit")
    rate = "gov.dwp.carers_allowance.rate"
    modifier = _modifier_source(
        carers_allowance_earnings_taper,
        "start_year, taper_rate, limit_hours, national_living_wage_by_april",
    )

    def over_by_a_pound(y):
        if y < start:
            return 0.0
        return round(max(engine_value(rate, y) - taper * 1, 0.0), 2)

    def runs_out(y):
        return carers_allowance_limit(y) + engine_value(rate, y) / taper

    shown = [y for y in POLICY_YEARS if y >= start]

    def by_year(amount):
        return {_fiscal_label(y): round(amount(y)) for y in shown}

    return [
        _row(
            "Carer's Allowance at £1 a week over the earnings limit",
            POUNDS,
            _yearly(lambda y: 0.0, over_by_a_pound),
            _source(
                {
                    "kind": "documented",
                    "where": "current law pays no Carer's Allowance above "
                    "the earnings limit (gov.dwp.carers_allowance."
                    "earnings_limit)",
                },
                {
                    "kind": "modifier_constant",
                    "where": f"the weekly rate ({rate}) less taper_rate x "
                    "£1; " + modifier["where"],
                },
            ),
            unit_words="£ a week",
            # The visual draws the limit and where the allowance runs out,
            # from ``figures`` (src/utils/policyVisuals.js carersTaperView)
            figures={
                "earnings_limit": by_year(carers_allowance_limit),
                "runs_out": by_year(runs_out),
            },
        ),
    ]


def _lha_unfreeze(reform) -> list[dict]:
    path = "gov.dwp.LHA.freeze"
    percentile = "gov.dwp.LHA.percentile"
    after = _engine_or_change(reform, path)

    def reset(frozen):
        return lambda y: None if frozen(y) else engine_value(percentile, y)

    return [
        _row(
            "Local rents the LHA rates are re-set to each April, percentile",
            PERCENT,
            _yearly(reset(lambda y: engine_value(path, y)), reset(after)),
            _source(
                {
                    "kind": "engine_parameter",
                    "where": f"policyengine-uk {path} (frozen: none) and "
                    f"{percentile}, at 6 April of each year",
                },
                _change_source(path, "_create_lha_unfreeze_2027()"),
            ),
            note="Current law freezes the rates at their April 2024 level; "
            "with the measure they are re-set each April from 2027",
        )
    ]


def _employer_ni_threshold(reform) -> list[dict]:
    path = registry.SECONDARY_THRESHOLD
    after = _engine_or_change(reform, path)
    return [
        _row(
            "Employer National Insurance threshold",
            POUNDS,
            _yearly(
                lambda y: round(engine_value(path, y) * 52, 2),
                lambda y: round(after(y) * 52, 2),
            ),
            _source(
                {
                    "kind": "engine_parameter",
                    "where": f"policyengine-uk {path}, at 6 April of each "
                    "year, x 52 (stored weekly)",
                },
                _change_source(path, "secondary_threshold_raised()"),
            ),
            unit_words="£ of earnings a year",
            note="Employers pay 15% on earnings above it",
        )
    ]


def _household_energy_payment(reform) -> list[dict]:
    values = constants(household_energy_payment_2026)
    year = values["year"]
    bands = ", ".join(values["bands"])
    where = "England" if values["country"] == "ENGLAND" else values["country"]
    return [
        _row(
            "Household energy payment",
            POUNDS,
            [
                _point(
                    year,
                    f"Winter {_fiscal_label(year)}",
                    year,
                    0,
                    values["amount"],
                )
            ],
            _source(
                {
                    "kind": "documented",
                    "where": "no such payment under current law",
                },
                _modifier_source(household_energy_payment_2026, "amount"),
            ),
            unit_words="£ a household, once",
            note=f"Paid to households in {where} in council tax bands "
            f"{bands}",
        )
    ]


# The cap, as announced (Budget 2026 Table 6.1 row 4; GOV.UK, 22 July
# 2026): £2 from 1 January to 31 December 2027, where it would be £3. The
# modifier does not model the fare itself: it shares out the Treasury's
# costing by bus fare spending (its ``fall``), which the row's note gives.
BUS_FARE_CAP_BEFORE = 3
BUS_FARE_CAP_AFTER = 2


def _bus_fare_cap(reform) -> list[dict]:
    fall = constants(bus_fare_cap_2027)["fall"]
    window = (
        f"{BUS_FARE_CAP_FROM}/{BUS_FARE_CAP_TO}",
        "January to December 2027",
        2026,
    )
    announced = {
        "kind": "documented",
        "where": "Budget 2026 Table 6.1 row 4; GOV.UK, 22 July 2026",
    }
    return [
        _row(
            "Single bus fare cap",
            POUNDS,
            [_point(*window, BUS_FARE_CAP_BEFORE, BUS_FARE_CAP_AFTER)],
            _source(announced, announced),
            unit_words="£ a single fare",
            note="Participating services in England outside London. "
            "Modelled as the Treasury's costing (Table 6.1) shared out "
            "across households by their bus fare spending in England "
            f"outside London: {fall:.1%} of spending at £3 fares while "
            "the cap runs (budget_measures/bus_fare_cap_2027.py "
            "bus_fare_cap_2027(fall)); London residents get £0",
        ),
    ]


def _trading_allowance(reform) -> list[dict]:
    path = registry.TRADING_ALLOWANCE
    return [
        _row(
            "Trading allowance",
            POUNDS,
            _yearly(
                lambda y: engine_value(path, y),
                _engine_or_change(reform, path),
            ),
            _source(
                _engine_source(path),
                _change_source(path, "_create_trading_allowance_raise()"),
            ),
            unit_words="£ of trading receipts a year",
            note="Relieves trading receipts in place of actual expenses",
        )
    ]


_RATE_LABELS = {
    "savings.basic": "Savings basic rate",
    "savings.higher": "Savings higher rate",
    "savings.additional": "Savings additional rate",
    "property.basic": "Property basic rate",
    "property.higher": "Property higher rate",
    "property.additional": "Property additional rate",
}


def _income_rates(reform, kinds, function, primary) -> list[dict]:
    """The rates of each income in ``kinds``, the ``primary`` one first."""
    rows = []
    for suffix, label in _RATE_LABELS.items():
        if suffix.split(".")[0] not in kinds:
            continue
        path = f"{registry.INCOME_TAX_RATES}.{suffix}"
        rows.append(
            _row(
                label,
                PERCENT,
                _yearly(
                    lambda y, path=path: engine_value(path, y),
                    _engine_or_change(reform, path),
                ),
                _source(_engine_source(path), _change_source(path, function)),
                primary=suffix == primary,
            )
        )
    return rows


def _property_income_rates(reform) -> list[dict]:
    return _income_rates(
        reform, ("property",), "property_income_rates_up()", "property.basic"
    )


def _savings_income_rates(reform) -> list[dict]:
    return _income_rates(
        reform, ("savings",), "savings_income_rates_up()", "savings.basic"
    )


def _unearned_income_rates(reform) -> list[dict]:
    # Withdrawn (split into the two above); its builder still reads it
    return _income_rates(
        reform,
        ("savings", "property"),
        "unearned_income_rates_up()",
        "savings.basic",
    )


BUILDERS = {
    registry.FUEL_DUTY_DEFERRAL_ID: _fuel_duty,
    registry.STATE_PENSION_ALLOWANCE_ID: _state_pension_allowance,
    registry.WARM_HOME_DISCOUNT_ID: _warm_home_discount,
    registry.ELECTRICITY_VAT_ID: _electricity_vat,
    registry.EMPLOYER_NI_ID: _employer_ni,
    registry.THRESHOLD_FREEZE_ID: _threshold_freeze,
    registry.BADR_ID: _badr,
    registry.FUEL_VAT_ID: _road_fuel_vat,
    registry.PLAN_2_ID: _plan_2,
    registry.CARERS_ALLOWANCE_TAPER_ID: _carers_allowance_taper,
    registry.LHA_UNFREEZE_ID: _lha_unfreeze,
    registry.EMPLOYER_NI_THRESHOLD_ID: _employer_ni_threshold,
    registry.UNEARNED_INCOME_RATES_ID: _unearned_income_rates,
    registry.PROPERTY_INCOME_RATES_ID: _property_income_rates,
    registry.SAVINGS_INCOME_RATES_ID: _savings_income_rates,
    registry.HOUSEHOLD_ENERGY_PAYMENT_ID: _household_energy_payment,
    registry.TRADING_ALLOWANCE_ID: _trading_allowance,
    registry.BUS_FARE_CAP_ID: _bus_fare_cap,
}


# --- How the page shows each measure ---------------------------------------
#
# Chosen from the shape of the data, so a measure changed on Budget day gets
# the display its new shape needs:
# - "switch": one value for a window or a single period, then back (a VAT
#   rate for some months, a one-winter payment): drawn on the card's own
#   timeline, the in-force span labelled with the change;
# - "schedule": rates that change on dates within years: a step plot on a
#   true time axis, the yearly averages behind a toggle;
# - "table": several parameters that change together in one year: a short
#   table for that year;
# - "before-after": one permanent change from a date on, current law
#   constant: the two values and the change;
# - "path": values that part from current law over the years: a step plot
#   with the gap shaded.
SWITCH, SCHEDULE, TABLE, BEFORE_AFTER, PATH = (
    "switch",
    "schedule",
    "table",
    "before-after",
    "path",
)
# A measure whose shape reads better another way, by id: the LHA freeze
# has no value in its frozen years ("none"), so its change is shown as a
# before and after (display_for's shape tests need numbers).
DISPLAY_OVERRIDES: dict[str, str] = {
    registry.LHA_UNFREEZE_ID: BEFORE_AFTER,
}


def _differs(point: dict) -> bool:
    before, after = point["before"], point["after"]
    if before is None or after is None:
        return before is not after
    return abs(before - after) > 1e-9


def display_for(rows: list[dict]) -> str:
    """The display a measure's rows call for (see above)."""
    main = next(row for row in rows if row["primary"])
    points = main["points"]
    if len(points) == 1:
        return SWITCH
    if all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", p["key"]) for p in points):
        return SCHEDULE
    changed = [row for row in rows if any(_differs(p) for p in row["points"])]
    years = {
        p["year"] for row in changed for p in row["points"] if _differs(p)
    }
    if len(changed) >= 3 and len(years) == 1:
        return TABLE
    moved = [p for p in points if _differs(p)]
    first = points.index(moved[0])
    if all(
        abs(p["before"] - points[0]["before"]) < 1e-9 for p in points
    ) and all(
        _differs(p) and abs(p["after"] - moved[0]["after"]) < 1e-9
        for p in points[first:]
    ):
        return BEFORE_AFTER
    return PATH


def current_law() -> dict:
    """Thresholds under current law alone, whatever the package holds: the
    Living standards "Frozen thresholds against pay" card reads them. Each
    row's points carry the engine's value as both before and after."""
    allowance, band = registry.PERSONAL_ALLOWANCE, registry.BASIC_RATE_BAND
    plan_2 = registry.PLAN_2_THRESHOLD

    def unchanged(value: Callable[[int], float]) -> list[dict]:
        return _yearly(value, value)

    def source(where: dict) -> dict:
        return _source(where, where)

    return {
        "rows": [
            _row(
                "Personal allowance",
                POUNDS,
                unchanged(lambda y: engine_value(allowance, y)),
                source(_engine_source(allowance)),
            ),
            _row(
                "Higher rate threshold",
                POUNDS,
                unchanged(
                    lambda y: engine_value(allowance, y)
                    + engine_value(band, y)
                ),
                source(
                    {
                        "kind": "engine_parameter",
                        "where": f"personal allowance plus basic rate band "
                        f"({allowance} + {band})",
                    }
                ),
                primary=False,
                note="The personal allowance plus the basic rate band",
            ),
            _row(
                "Plan 2 repayment threshold",
                POUNDS,
                unchanged(lambda y: engine_value(plan_2, y)),
                source(_engine_source(plan_2)),
                primary=False,
            ),
        ]
    }


def build() -> dict:
    """Every candidate measure's table, in the registry's order, and the
    current-law thresholds (``current_law``)."""
    measures = {}
    for measure_id in registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS:
        reform = registry.get_reform(measure_id)
        rows = BUILDERS[measure_id](reform)
        measures[measure_id] = {
            "description": reform.description,
            "display": (
                DISPLAY_OVERRIDES[measure_id]
                if measure_id in DISPLAY_OVERRIDES
                else display_for(rows)
            ),
            "rows": rows,
        }
    return {
        "schema": SCHEMA,
        "generator": "uk-budget-data policy-table",
        "engine": {
            "policyengine": importlib.metadata.version("policyengine"),
            "policyengine_uk": importlib.metadata.version("policyengine-uk"),
        },
        "years": list(POLICY_YEARS),
        "measures": measures,
        "current_law": current_law(),
    }


def render(document: dict) -> str:
    """The file's exact text: stable, so its review can bind its bytes."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def write(output_dir: Path) -> Path:
    path = Path(output_dir) / OUTPUT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(build()), encoding="utf-8")
    return path
