"""The household calculator applies a measure as the national run does.

The national run applies a measure's ``parameter_changes`` through
policyengine-uk's ``Scenario``, before fiscal-year conversion and the
threshold derivations. The household calculator
(``personal_impact.create_simulation``) writes each value on 1 January of
the year, after them. A formula reads a period's parameters on the period's
first day (policyengine-core ``get_parameters_at_instant``), so whatever
reads the parameter on another date, or a parameter derived from it, sees
the change in one route and not the other:

- a monthly variable (``fuel_duty``) reads the 1st of each month, so the
  household calculator shows 1/12 of the effect;
- a calendar-preserved duty (alcohol) reads its statutory dates, so it
  shows none (the templates refuse these parameters);
- a parameter derived from the changed one (the NIC thresholds, from the
  personal allowance once the freeze ends) is not recomputed.

Each known gap is a strict expected failure. When the household calculator
applies changes as the national run does, they pass, and ``strict=True``
turns that into a failure, so the marks get removed. #3 replaces this
calculator with one that has the same gaps (W5's note to Vahid and María,
15 October); point these tests at it when it merges.
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data import personal_impact
from uk_budget_data.measure_templates import rate_change, threshold_change
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

# The year every registered measure has an effect in (the threshold freeze
# from 2028, the savings and property rates from 2028, the salary sacrifice
# cap from 2029).
YEAR = 2029
HOUSEHOLDS = {
    "employee_30k": personal_impact.HouseholdInput(employment_income=30_000),
    "employee_60k": personal_impact.HouseholdInput(employment_income=60_000),
    "uc_family": personal_impact.HouseholdInput(
        employment_income=15_000, children_ages=[3, 7, 9]
    ),
    "investor_150k": personal_impact.HouseholdInput(
        employment_income=150_000,
        dividend_income=20_000,
        savings_income=5_000,
        property_income=10_000,
    ),
}
MONTHLY_ONLY_JANUARY = (
    "fuel_duty is monthly and the household calculator changes 1 January "
    "only, so it shows 1/12 of the effect (W5 note to Vahid and María, "
    "15 October)"
)


def situation(year: int) -> dict:
    """The probe households, built as the calculator builds them, in one
    simulation, each with some petrol."""
    people, benunits, households = {}, {}, {}
    for name, household in HOUSEHOLDS.items():
        built = personal_impact.build_situation(household, year)
        rename = {person: f"{name}_{person}" for person in built["people"]}
        for person, data in built["people"].items():
            people[rename[person]] = data
        benunits[name] = {
            "members": [
                rename[m] for m in built["benunits"]["benunit"]["members"]
            ]
        }
        entry = dict(built["households"]["household"])
        entry["members"] = [rename[m] for m in entry["members"]]
        entry["petrol_litres"] = {year: 1_200}
        households[name] = entry
    return {"people": people, "benunits": benunits, "households": households}


def _net(sim, year, variable="household_net_income"):
    return [float(v) for v in sim.calculate(variable, year)]


def household_route(reform, year, variable="household_net_income"):
    """The household calculator's impact, built as it builds it."""
    probe = situation(year)
    if reform.has_custom_baseline():
        baseline = personal_impact.create_simulation(
            probe,
            year,
            reform_param_changes=reform.baseline_parameter_changes,
            simulation_modifier=reform.baseline_simulation_modifier,
        )
    else:
        baseline = personal_impact.create_simulation(probe, year)
    reformed = personal_impact.create_simulation(
        probe,
        year,
        reform_param_changes=reform.parameter_changes,
        simulation_modifier=reform.simulation_modifier,
    )
    return [
        r - b
        for r, b in zip(
            _net(reformed, year, variable), _net(baseline, year, variable)
        )
    ]


def national_route(reform, year, variable="household_net_income"):
    """The same measure through the national run's Scenario."""
    probe = situation(year)
    base = reform.to_baseline_scenario()
    baseline = (
        Simulation(situation=probe, scenario=base)
        if base is not None
        else Simulation(situation=probe)
    )
    reformed = Simulation(situation=probe, scenario=reform.to_scenario())
    return [
        r - b
        for r, b in zip(
            _net(reformed, year, variable), _net(baseline, year, variable)
        )
    ]


def same(a, b):
    return all(x == pytest.approx(y, abs=0.01) for x, y in zip(a, b))


def _registered():
    reforms = get_autumn_budget_2026_reforms()
    return [
        pytest.param(
            reform,
            id=reform.id,
            marks=(
                pytest.mark.xfail(strict=True, reason=MONTHLY_ONLY_JANUARY)
                if reform.id == "fuel_duty_freeze"
                else ()
            ),
        )
        for reform in reforms
        if reform.id in personal_impact.POLICY_IDS
    ]


@pytest.mark.parametrize("reform", _registered())
def test_each_measure_the_calculator_shows_moves_households_alike(reform):
    """Differential: a household's impact from the household calculator
    equals the national route's, for every measure it shows."""
    assert same(household_route(reform, YEAR), national_route(reform, YEAR))


def _template(changes):
    from uk_budget_data.models import Reform

    return Reform(id="template", name="Template", parameter_changes=changes)


def test_a_yearly_allowance_template_moves_households_alike():
    """Income tax reads the allowance on 1 January of the model year, the
    one date the household calculator changes, so the routes agree."""
    reform = _template(
        threshold_change(
            "gov.hmrc.income_tax.allowances.personal_allowance.amount",
            {2027: 20_000},
        )
    )
    household = household_route(reform, 2027)
    assert same(household, national_route(reform, 2027))
    assert any(abs(change) > 100 for change in household)


@pytest.mark.xfail(strict=True, reason=MONTHLY_ONLY_JANUARY)
def test_a_fuel_duty_template_moves_households_alike():
    reform = _template(
        rate_change("gov.hmrc.fuel_duty.petrol_and_diesel", {2027: 0.90})
    )
    assert same(household_route(reform, 2027), national_route(reform, 2027))


@pytest.mark.xfail(
    strict=True,
    reason=(
        "after the freeze the national run derives the NIC thresholds from "
        "the allowance; the household calculator does not recompute them "
        "(#23 review round 8: GBP 3,108.06 against 3,251.50 in 2031)"
    ),
)
def test_a_post_freeze_allowance_template_moves_nics_alike():
    reform = _template(
        threshold_change(
            "gov.hmrc.income_tax.allowances.personal_allowance.amount",
            {2031: 20_000},
        )
    )
    assert same(
        household_route(reform, 2031, "national_insurance"),
        national_route(reform, 2031, "national_insurance"),
    )


def test_a_calendar_preserved_duty_is_refused_by_the_templates():
    """Review round 8 of #23: a beer duty template moved the national
    figure (GBP 150 against 112.90 for 100 litres at 5%) and no household's;
    the household calculator could never show it."""
    with pytest.raises(ValueError, match="statutory dates"):
        rate_change("gov.hmrc.alcohol_duty.rates.beer", {2027: 30})
