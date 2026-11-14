"""The Pension Tax Allowance as it stood before the port to the split
income_tax (dashboard cf6601f1), frozen for the differential tests, and the
invented households behind tests/fixtures/pta/before_port_2_151_0.json.

policyengine-uk 2.151.0 is the only pinned engine it runs on, so the fixture
keeps what it computed there. To rebuild the fixture on that engine:

    uv run python -m tests.pension_tax_allowance_before_port
"""

import json
from pathlib import Path

import numpy as np
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.uc_income_tax import (
    uc_income_tax_on_earnings_slice,
)

from uk_budget_data.measure_templates import _call_formula, _replace_formula

FIXTURE = (
    Path(__file__).parent / "fixtures" / "pta" / "before_port_2_151_0.json"
)
YEARS = (2027, 2028, 2029)
REGIONS = ("LONDON", "SCOTLAND")
# Over State Pension age, and well short of it in every year: nobody here
# reaches it in the tax year, where the port is meant to differ.
AGES = (70, 60)
INCOME_VARIABLES = (
    "state_pension",
    "private_pension_income",
    "employment_income",
)


def pension_tax_allowance_before_port(
    sim,
    first_year=2027,
    last_year=2029,
    basic_rate=0.2,
    taper_divisor=3,
    weekly_rounding=0.05,
):
    """Verbatim from budget_measures/pension_tax_allowance.py at cf6601f1,
    without its docstring."""
    native = sim.tax_benefit_system.get_variable("income_tax")
    native_uc_earnings = sim.tax_benefit_system.get_variable(
        "uc_income_tax_on_earnings"
    )
    native_uc_trade = sim.tax_benefit_system.get_variable(
        "uc_income_tax_on_trade"
    )

    def in_force(period):
        return first_year <= period.start.year <= last_year

    def reduction_used(person, period, parameters):
        """The PTA used: the reduction, capped at the tax otherwise due."""
        year = period.start.year
        current = _call_formula(native, person, period, parameters)
        on = parameters(f"{year}-04-06").gov
        weekly = on.dwp.state_pension.new_state_pension.amount
        steps = np.floor(weekly / weekly_rounding + 1e-9)
        full_state_pension = round(float(steps * weekly_rounding) * 52, 2)
        personal_allowance = (
            on.hmrc.income_tax.allowances.personal_allowance.amount
        )
        allowance = np.ceil(
            round(basic_rate * (full_state_pension - personal_allowance), 6)
        )
        total = person("total_income", period)
        excess = np.maximum(0, total - full_state_pension)
        reduction = np.maximum(0, allowance - excess / taper_divisor)
        reduction = np.where(person("is_SP_age", period), reduction, 0)
        return current, np.minimum(reduction, np.maximum(0, current))

    def formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(native, person, period, parameters)
        current, used = reduction_used(person, period, parameters)
        return np.maximum(0, current - used)

    def earnings_split(person, period, parameters):
        _, used = reduction_used(person, period, parameters)
        with_trade = uc_income_tax_on_earnings_slice(
            person, period, parameters
        )
        without_trade = uc_income_tax_on_earnings_slice(
            person, period, parameters, include_trade=False
        )
        employment = np.maximum(0, without_trade - used)
        left = np.maximum(0, used - without_trade)
        trade = np.maximum(0, (with_trade - without_trade) - left)
        return employment, trade

    def uc_earnings_formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(
                native_uc_earnings, person, period, parameters
            )
        employment, trade = earnings_split(person, period, parameters)
        return employment + trade

    def uc_trade_formula(person, period, parameters):
        if not in_force(period):
            return _call_formula(native_uc_trade, person, period, parameters)
        _, trade = earnings_split(person, period, parameters)
        return trade

    _replace_formula(sim, "income_tax", formula)
    _replace_formula(sim, "uc_income_tax_on_earnings", uc_earnings_formula)
    _replace_formula(sim, "uc_income_tax_on_trade", uc_trade_formula)
    return sim


def situation(rows, year):
    """One single-person household for each row of the year."""
    people, benunits, households = {}, {}, {}
    for i, row in enumerate(rows):
        people[f"p{i}"] = {
            "age": {year: row["age"]},
            **{
                variable: {year: row[variable]}
                for variable in INCOME_VARIABLES
            },
        }
        benunits[f"b{i}"] = {"members": [f"p{i}"]}
        households[f"h{i}"] = {
            "members": [f"p{i}"],
            "region": {year: row["region"]},
        }
    return {"people": people, "benunits": benunits, "households": households}


def _rows(year, full_state_pension, top):
    """A grid around the band, to the Winter Fuel Payment charge and past it,
    from pensions alone and with earnings."""
    totals = sorted(
        {
            0.0,
            11_000.0,
            12_570.0,
            12_571.0,
            full_state_pension - 1,
            full_state_pension,
            full_state_pension + 1,
            full_state_pension + 50,
            full_state_pension + 150,
            (full_state_pension + top) / 2,
            top - 1,
            top,
            top + 1,
            20_000.0,
            35_000.0,
            35_001.0,
            60_000.0,
        }
    )
    rows = []
    for region in REGIONS:
        for age in AGES:
            for total in totals:
                total = round(total, 2)
                state_pension = min(total, 11_973.0)
                for split in ("private_pension_income", "employment_income"):
                    rows.append(
                        {
                            "year": year,
                            "region": region,
                            "age": age,
                            "state_pension": state_pension,
                            "private_pension_income": round(
                                (total - state_pension)
                                * (split == "private_pension_income"),
                                2,
                            ),
                            "employment_income": round(
                                (total - state_pension)
                                * (split == "employment_income"),
                                2,
                            ),
                        }
                    )
    return rows


def main():
    rows, weekly_rates = [], {}
    for year in YEARS:
        on = system.parameters(f"{year}-04-06").gov
        weekly = float(on.dwp.state_pension.new_state_pension.amount)
        weekly_rates[str(year)] = weekly
        steps = np.floor(weekly / 0.05 + 1e-9)
        full_state_pension = round(float(steps * 0.05) * 52, 2)
        personal_allowance = (
            on.hmrc.income_tax.allowances.personal_allowance.amount
        )
        allowance = np.ceil(
            round(0.2 * (full_state_pension - personal_allowance), 6)
        )
        year_rows = _rows(
            year, full_state_pension, full_state_pension + 3 * allowance
        )
        baseline = Simulation(situation=situation(year_rows, year))
        reformed = Simulation(situation=situation(year_rows, year))
        pension_tax_allowance_before_port(reformed)
        without = baseline.calculate("income_tax", year)
        with_allowance = reformed.calculate("income_tax", year)
        for row, before, after in zip(year_rows, without, with_allowance):
            row["income_tax_without_allowance"] = round(float(before), 2)
            row["income_tax_with_allowance"] = round(float(after), 2)
        rows += year_rows
    FIXTURE.write_text(
        json.dumps({"weekly_rates": weekly_rates, "rows": rows}, indent=0)
        + "\n"
    )


if __name__ == "__main__":
    main()
