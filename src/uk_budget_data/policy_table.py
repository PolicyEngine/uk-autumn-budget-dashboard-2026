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
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from uk_budget_data.budget_measures.employer_ni_relief_ages_21_to_24 import (
    employer_ni_relief_ages_21_to_24,
)
from uk_budget_data.budget_measures.road_fuel_vat_cut import (
    ROAD_FUEL_VAT_RATE,
    road_fuel_vat_cut,
)
from uk_budget_data.budget_measures.state_pension_income_tax_allowance import (
    state_pension_income_tax_allowance,
)
from uk_budget_data.budget_measures.warm_home_discount_top_up import (
    warm_home_discount_top_up,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data import reforms as registry

SCHEMA = "uk-budget-dashboard/policy-parameters/v1"
OUTPUT_FILE = "policy_parameters.json"

PERCENT = "percent"
POUNDS = "gbp"
PENCE_A_LITRE = "pence_per_litre"

MONTHS = (
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
)


# --- Reading the model ------------------------------------------------------


def _parameters():
    from policyengine_uk.system import system

    return system.parameters


def engine_value(path: str, year: int) -> float:
    """A policyengine-uk parameter at the start of fiscal year ``year``
    (6 April, as ``reforms.plan_2_unfrozen_thresholds`` reads it)."""
    node = _parameters()
    for part in path.split("."):
        match = re.fullmatch(r"([a-z0-9_]+)(?:\[(\d+)\])?", part)
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
    label, unit, points, source, *, primary=True, note=None, unit_words=None
) -> dict:
    row = {
        "label": label,
        "unit": unit,
        "unit_words": unit_words if unit_words is not None else UNIT_WORDS[unit],
        "primary": primary,
        "points": points,
        "source": source,
    }
    if note:
        row["note"] = note
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
# in force (fiscal years from 1 April, as their comments count them). The
# dates come from each measure's description; the rate while in force is
# each year's constant divided by its share of days, and every year must
# give the same rate, so the dates are checked against the constants.

VAT_WINDOWS = {
    registry.ELECTRICITY_VAT_ID: (date(2026, 10, 1), date(2028, 3, 31)),
    registry.FUEL_VAT_ID: (date(2026, 12, 1), date(2027, 5, 31)),
}


def _days_in_force(year: int, first: date, last: date) -> tuple[int, int]:
    start, end = date(year, 4, 1), date(year + 1, 4, 1)
    low, high = max(first, start), min(last + timedelta(days=1), end)
    return max((high - low).days, 0), (end - start).days


def in_force_rate_change(
    measure_id: str, changes: dict[int, float]
) -> float:
    """The rate change while in force, from the day-weighted constants."""
    first, last = VAT_WINDOWS[measure_id]
    rates = []
    for year, change in changes.items():
        days, length = _days_in_force(year, first, last)
        if days:
            rates.append(change * length / days)
    if not rates or max(rates) - min(rates) > 1e-9:
        raise ValueError(
            f"{measure_id}: the in-force dates do not fit the modifier's "
            f"day-weighted constants ({rates})"
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
) -> list[dict]:
    first, last = VAT_WINDOWS[measure_id]
    cut = in_force_rate_change(measure_id, changes)
    period = f"{_month_label(first)} to {_month_label(last)}"
    derived = {
        "kind": "modifier_constant",
        "where": (
            f"{_modifier_source(modifier, names)['where']}, each divided by "
            f"its share of the fiscal year's days in force, {period} (the "
            "dates in the measure's description)"
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
            note="As modelled: the cut weighted by the days it is in force "
            "in each fiscal year",
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
    first, last = date(POLICY_YEARS[0], 4, 1), date(POLICY_YEARS[-1] + 1, 3, 31)
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


def _state_pension_allowance(reform) -> list[dict]:
    path = registry.PERSONAL_ALLOWANCE
    values = constants(state_pension_income_tax_allowance)
    allowance = {}
    for name, value in values.items():
        if name.startswith("allowance_"):
            allowance.update({int(k): v for k, v in value.items()})
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
                _modifier_source(
                    state_pension_income_tax_allowance, "allowance_2027 to 2031"
                ),
            ),
            note="With the measure, withdrawn £"
            f"{values['taper_rate']:g} for each £1 of income above it, down "
            "to the personal allowance",
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


def _electricity_vat(reform) -> list[dict]:
    values = constants(zero_vat_on_domestic_electricity)
    changes = {
        int(name.rsplit("_", 1)[1]): value
        for name, value in values.items()
        if name.startswith("rate_change_")
    }
    path = "gov.hmrc.vat.reduced_rate"
    return _vat_rows(
        registry.ELECTRICITY_VAT_ID,
        zero_vat_on_domestic_electricity,
        engine_value(path, POLICY_YEARS[0]),
        _engine_source(path),
        "VAT on domestic electricity in Great Britain",
        changes,
        "rate_change_2026, rate_change_2027",
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
        raise ValueError("the modifier's road fuel VAT rate is not the engine's")
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
                lambda year: 0.0
                if year >= start and year in limits
                else engine_value(path, year),
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
            _source(_engine_source(allowance), _change_source(allowance, function)),
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
                lambda y: engine_value(path, y), _engine_or_change(reform, path)
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
                lambda y: engine_value(path, y), _engine_or_change(reform, path)
            ),
            _source(
                _engine_source(path),
                _change_source(path, "plan_2_unfrozen_thresholds()"),
            ),
            note="Current law freezes it at £29,385 to April 2030, then "
            "uprates it; with the measure it rises with RPI from April 2027",
        )
    ]


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
}


def build() -> dict:
    """Every candidate measure's table, in the registry's order."""
    measures = {}
    for measure_id in registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS:
        reform = registry.get_reform(measure_id)
        measures[measure_id] = {
            "description": reform.description,
            "rows": BUILDERS[measure_id](reform),
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
    }


def render(document: dict) -> str:
    """The file's exact text: stable, so its review can bind its bytes."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def write(output_dir: Path) -> Path:
    path = Path(output_dir) / OUTPUT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(build()), encoding="utf-8")
    return path
