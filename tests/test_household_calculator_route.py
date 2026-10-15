"""The household calculator applies a measure as the national run does.

The national run applies a measure's ``parameter_changes`` through
policyengine-uk's ``Scenario``, before fiscal-year conversion and the
parameters derived from them. ``personal_impact.create_simulation`` used
to write each value on 1 January of the year afterwards, and a formula
reads a period's parameters on its first day (policyengine-core
``get_parameters_at_instant``), so:

- monthly ``fuel_duty`` saw the change in January only: the registered
  fuel_duty_freeze showed exactly 1/12 of its national effect for every
  household, in every year 2026-2030;
- a duty kept on its statutory dates (``preserve_calendar_dates``: the
  alcohol duties) saw none;
- a parameter derived from the changed one (the NIC thresholds from the
  personal allowance, once the freeze ends) was not recomputed.

It now builds the simulation with ``Scenario(parameter_changes=...)``, as
the national run does, so these tests compare the two routes directly.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import personal_impact
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
    # Dividends in the basic-rate band, which the dividend measure changes
    # (the investor's all sit in the unchanged additional-rate band).
    "dividends_30k": personal_impact.HouseholdInput(
        employment_income=30_000, dividend_income=20_000
    ),
}


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


def _measure(changes):
    from uk_budget_data.models import Reform

    return Reform(id="probe", name="Probe", parameter_changes=changes)


@pytest.mark.parametrize(
    "reform",
    [
        pytest.param(reform, id=reform.id)
        for reform in get_autumn_budget_2026_reforms()
        if reform.id in personal_impact.POLICY_IDS
        # Its modifier shares a fixed Treasury cost over whoever is
        # simulated, so it is checked one household at a time below.
        and reform.id != "rail_fares_freeze"
    ],
)
def test_each_measure_the_calculator_shows_moves_households_alike(reform):
    """Differential: a household's impact from the household calculator
    equals the national route's, for every measure it shows (the fuel duty
    freeze was 1/12 of it before), and some probe household is affected,
    so the comparison is not of two zeros."""
    household = household_route(reform, YEAR)
    assert same(household, national_route(reform, YEAR))
    assert any(abs(change) > 1 for change in household)


def test_the_rail_fares_freeze_moves_a_rail_user_alike():
    reform = next(
        r
        for r in get_autumn_budget_2026_reforms()
        if r.id == "rail_fares_freeze"
    )
    probe = {
        "people": {
            "p": {"age": {2027: 40}, "employment_income": {2027: 30_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "rail_usage": {2027: 2_000},
                "household_weight": {2027: 1},
            }
        },
    }
    household = _impact(
        lambda changes, modifier: personal_impact.create_simulation(
            probe,
            2027,
            reform_param_changes=changes,
            simulation_modifier=modifier,
        ),
        reform,
        2027,
    )
    national = _impact(
        lambda changes, modifier: _national(probe, changes, modifier),
        reform,
        2027,
    )
    assert same(household, national)
    assert household[0] > 1


def _national(probe, changes, modifier):
    from uk_budget_data.models import Reform

    scenario = Reform(
        id="n",
        name="N",
        parameter_changes=changes,
        simulation_modifier=modifier,
    ).to_scenario()
    return Simulation(situation=probe, scenario=scenario)


def _impact(build, reform, year, variable="household_net_income"):
    if reform.has_custom_baseline():
        baseline = build(
            reform.baseline_parameter_changes,
            reform.baseline_simulation_modifier,
        )
    else:
        baseline = build(None, None)
    reformed = build(reform.parameter_changes, reform.simulation_modifier)
    return [
        r - b
        for r, b in zip(
            _net(reformed, year, variable), _net(baseline, year, variable)
        )
    ]


# Review round 9 of #23: more parameters the 1 January write missed.
LCWRA_CLAIMANT = {
    "people": {
        "p": {
            "age": {2027: 40},
            "employment_income": {2027: 0},
            "uc_limited_capability_for_WRA": {2027: True},
        }
    },
    "benunits": {
        "b": {
            "members": ["p"],
            "uc_receives_new_claimant_health_element": {2027: True},
        }
    },
    "households": {"h": {"members": ["p"]}},
}
PROTECTED_CLAIMANT = {
    "people": {
        "p": {
            "age": {year: 40 + year - 2025 for year in range(2025, 2030)},
            "employment_income": {year: 0 for year in range(2025, 2030)},
            "uc_limited_capability_for_WRA": {
                year: True for year in range(2025, 2030)
            },
        }
    },
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}


@pytest.mark.parametrize(
    "probe, path, value, variable",
    [
        # Monthly: child_benefit_respective_amount reads each month.
        (None, "gov.hmrc.child_benefit.amount.eldest", 50, "child_benefit"),
        # Monthly: employee Class 1 NICs.
        (
            None,
            "gov.hmrc.national_insurance.class_1.rates.employee.main",
            0.10,
            "national_insurance",
        ),
        # Read while the simulation is built (UC rebalancing stores the
        # health element), before any later write.
        (
            LCWRA_CLAIMANT,
            "gov.dwp.universal_credit.rebalancing.new_claimant_health_element",
            500,
            "uc_LCWRA_element",
        ),
        # The protected floor considers every standard allowance amount.
        (
            PROTECTED_CLAIMANT,
            "gov.dwp.universal_credit.standard_allowance.amount.SINGLE_YOUNG",
            0,
            "uc_LCWRA_element",
        ),
    ],
    ids=[
        "child benefit",
        "employee NICs",
        "UC new-claimant health element",
        "UC protected floor",
    ],
)
def test_benefits_read_monthly_or_while_built_move_alike(
    probe, path, value, variable
):
    measure = _measure({path: {"2027": value}})
    probe = probe or situation(2027)
    household = _impact(
        lambda changes, modifier: personal_impact.create_simulation(
            probe,
            2027,
            reform_param_changes=changes,
            simulation_modifier=modifier,
        ),
        measure,
        2027,
        variable,
    )
    national = _impact(
        lambda changes, modifier: _national(probe, changes, modifier),
        measure,
        2027,
        variable,
    )
    assert same(household, national)
    assert any(abs(change) > 1 for change in household)


@pytest.mark.parametrize(
    "path, value, year, variable",
    [
        # Monthly: fuel_duty reads the 1st of each month.
        ("gov.hmrc.fuel_duty.petrol_and_diesel", 0.90, 2027, None),
        # Read on 1 January of the model year: agreed before, still does.
        (
            "gov.hmrc.income_tax.allowances.personal_allowance.amount",
            20_000,
            2027,
            None,
        ),
        # Derived: the NIC thresholds follow the allowance after the freeze.
        (
            "gov.hmrc.income_tax.allowances.personal_allowance.amount",
            20_000,
            2031,
            "national_insurance",
        ),
    ],
    ids=["monthly fuel duty", "yearly allowance", "post-freeze NICs"],
)
def test_a_change_moves_households_as_it_moves_the_national_figure(
    path, value, year, variable
):
    measure = _measure({path: {str(year): value}})
    variable = variable or "household_net_income"
    household = household_route(measure, year, variable)
    assert same(household, national_route(measure, year, variable))
    assert any(abs(change) > 1 for change in household)


def test_a_duty_kept_on_its_statutory_dates_reaches_households():
    """Beer duty keeps its statutory dates; written on 1 January only, a
    household drinking beer saw no change at all."""
    probe = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "beer_litres": {2027: 100},
                "beer_abv": {2027: 0.05},
                "beer_draught_share": {2027: 0},
            }
        },
    }
    changes = {"gov.hmrc.alcohol_duty.rates.beer": {"2027": 30}}
    reformed = personal_impact.create_simulation(
        probe, 2027, reform_param_changes=changes
    )
    national = Simulation(
        situation=probe, scenario=Scenario(parameter_changes=changes)
    )
    duty = float(reformed.calculate("beer_duty", 2027)[0])
    assert duty == pytest.approx(
        float(national.calculate("beer_duty", 2027)[0]), abs=0.01
    )
    # 100 litres at 5% ABV and GBP 30 a litre of alcohol.
    assert duty == pytest.approx(150, abs=0.01)


def test_no_change_builds_the_plain_simulation():
    probe = situation(2027)
    plain = Simulation(situation=probe)
    built = personal_impact.create_simulation(probe, 2027)
    assert _net(built, 2027) == _net(plain, 2027)


# Review round 10 of #23: the household calculator chose its own baseline
# (current law unless the measure had one) and took a modifier's return as
# the simulation. The national pipeline takes the baseline from
# Reform.baseline_scenario_for(config), and the engine runs a modifier
# itself, ignoring its return.
ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
PENSIONER = {
    "people": {
        "p": {"age": {2027: 75}, "private_pension_income": {2027: 30_000}}
    },
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}


def _allowance(amount, years=(2027,)):
    return {ALLOWANCE: {str(year): amount for year in years}}


def _does_nothing(sim):
    """A baseline modifier with no effect, which returns nothing."""


@pytest.mark.parametrize(
    "own_baseline, configured, baseline_tax",
    [
        # No baseline of its own: the configured one. £30,000 of pension
        # less a £20,000 allowance, at 20%.
        ({}, _allowance(20_000), 2_000),
        # Its own baseline wins over the configured one.
        (
            {"baseline_parameter_changes": _allowance(18_000)},
            _allowance(20_000),
            2_400,
        ),
        # An explicit empty baseline is its own: current law, not the
        # configured one (£30,000 less £12,570, at 20%).
        ({"baseline_parameter_changes": {}}, _allowance(20_000), 3_486),
        # So is a baseline that is a modifier alone.
        (
            {"baseline_simulation_modifier": _does_nothing},
            _allowance(20_000),
            3_486,
        ),
        # Nothing configured, nothing of its own: current law.
        ({}, None, 3_486),
    ],
    ids=[
        "configured",
        "own over configured",
        "explicit empty",
        "modifier only",
        "current law",
    ],
)
def test_a_household_baseline_is_the_national_runs(
    own_baseline, configured, baseline_tax
):
    from uk_budget_data.models import DataConfig, Reform

    reform = Reform(
        id="probe",
        name="Probe",
        parameter_changes=_allowance(15_000),
        **own_baseline,
    )
    config = DataConfig(baseline_parameter_changes=configured)
    baseline, reformed = personal_impact.household_simulations(
        PENSIONER, reform, config
    )
    national = Simulation(
        situation=PENSIONER, scenario=reform.baseline_scenario_for(config)
    )
    assert float(baseline.calculate("income_tax", 2027)[0]) == baseline_tax
    assert float(national.calculate("income_tax", 2027)[0]) == baseline_tax
    # £30,000 less a £15,000 allowance, at 20%.
    assert float(reformed.calculate("income_tax", 2027)[0]) == 3_000


def test_the_calculator_compares_against_the_configured_baseline():
    """Through the calculator itself: a measure with no baseline of its own
    is compared with the configured baseline, which the calculator also
    reports as the year's baseline."""
    from uk_budget_data.models import DataConfig, Reform

    years = personal_impact.YEARS
    calculator = personal_impact.PersonalImpactCalculator(
        config=DataConfig(baseline_parameter_changes=_allowance(20_000, years))
    )
    # One measure, under an id the calculator shows.
    measure_id = personal_impact.POLICY_IDS[0]
    calculator.reforms = {
        measure_id: Reform(
            id=measure_id,
            name="Probe",
            parameter_changes=_allowance(15_000, years),
        )
    }
    results = calculator.calculate(
        personal_impact.HouseholdInput(employment_income=30_000)
    )
    # Income tax rises from £2,000 to £3,000; against current law (£3,486)
    # it would have fallen.
    assert results["policies"][measure_id]["years"][2027][
        "net_income_change"
    ] == pytest.approx(-1_000, abs=0.01)
    assert results["years"][2027]["baseline"]["income_tax"] == (
        pytest.approx(2_000, abs=0.01)
    )


def _set_earnings(sim, amount=40_000):
    """Mutates the simulation and returns nothing."""
    sim.set_input("employment_income", 2027, [amount])


def _set_earnings_and_return(sim, amount=40_000):
    _set_earnings(sim, amount)
    return sim


@pytest.mark.parametrize("modifier", [_set_earnings, _set_earnings_and_return])
@pytest.mark.parametrize("side", ["reform", "baseline"])
def test_a_modifier_runs_as_the_engine_runs_it(modifier, side):
    """Whether or not the modifier returns the simulation, on either side,
    the household gets what the national route gets: £40,000 less the
    £12,570 allowance, at 20%."""
    from uk_budget_data.models import DataConfig, Reform

    earner = {
        "people": {
            "p": {"age": {2027: 40}, "employment_income": {2027: 30_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    built = personal_impact.create_simulation(
        earner, 2027, simulation_modifier=modifier
    )
    national = Simulation(
        situation=earner, scenario=Scenario(simulation_modifier=modifier)
    )
    assert float(built.calculate("income_tax", 2027)[0]) == 5_486
    assert float(national.calculate("income_tax", 2027)[0]) == 5_486
    key = (
        "simulation_modifier"
        if side == "reform"
        else ("baseline_simulation_modifier")
    )
    reform = Reform(id="probe", name="Probe", **{key: modifier})
    baseline, reformed = personal_impact.household_simulations(
        earner, reform, DataConfig()
    )
    moved = reformed if side == "reform" else baseline
    assert float(moved.calculate("income_tax", 2027)[0]) == 5_486


def test_a_combined_measure_keeps_its_members_baselines():
    """Review of #37: two members that each bring an explicit empty
    baseline merge into an empty one, which on its own reads as none and
    would take the configured baseline. Passed whether any member uses the
    configured baseline, as publication passes it, the household baseline
    is current law, as nationally."""
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.publication.combine import combine_measures

    config = DataConfig(
        years=[2027], baseline_parameter_changes=_allowance(20_000)
    )
    members = [
        Reform(
            id="a",
            name="A",
            baseline_parameter_changes={},
            parameter_changes=_allowance(18_000),
        ),
        Reform(
            id="b",
            name="B",
            baseline_parameter_changes={},
            parameter_changes={
                "gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.25}
            },
        ),
    ]
    combined = combine_measures(members, config)
    uses_config = any(not member.has_custom_baseline() for member in members)
    assert uses_config is False
    baseline, reformed = personal_impact.household_simulations(
        PENSIONER, combined, config, uses_config
    )
    national = Simulation(
        situation=PENSIONER,
        scenario=combined.baseline_scenario_for(config, uses_config),
    )
    # Current law: £30,000 less £12,570, at 20%.
    assert float(baseline.calculate("income_tax", 2027)[0]) == 3_486
    assert float(national.calculate("income_tax", 2027)[0]) == 3_486
    # £30,000 less £18,000, at 25%.
    assert float(reformed.calculate("income_tax", 2027)[0]) == 3_000
