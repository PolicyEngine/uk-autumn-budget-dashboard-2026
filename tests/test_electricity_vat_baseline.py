"""The 5% that the zero rate of VAT on domestic electricity is scored against.

Current law zero-rates Great Britain's domestic electricity from 1 October
2026 to 31 March 2027 (SI 2026/987). policyengine-uk 2.153.5 and later
charge it so, at a rate of its own for domestic electricity: 2.165.1 gives
Great Britain 0.05 x 183 / 365 for 2026-27. The Budget 2026 document scores
the whole zero rate, from October 2026, against 5% (Table 6.1 row 2). So
the measure's pre-Budget side holds electricity at 5%, and its Budget side
takes the zero-rated months off that 5%, never off the engine's lower rate.

Invariants, for every bill, nation and engine rate:

- the baseline charges the baseline rate on the bill net of the VAT its
  prices include;
- the reformed scenario charges the baseline rate plus the change, which is
  never below zero;
- ``vat`` less ``baseline_vat`` is the measure's change alone, so the
  months current law zero-rates are counted once.

``ENGINE_HAS_OWN_RATE`` says which engine is installed. On one without the
rate (2.151.0) nothing is held, the bill has no VAT line of its own, and
the measure's change is all the template adds; each test says what it
expects there. Household simulations only: no microsimulation.
"""

from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data import measure_templates
from uk_budget_data.budget_measures.pre_budget_vat_on_domestic_electricity import (
    pre_budget_vat_on_domestic_electricity,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    SPRING_SHARE,
    WINTER_SHARE,
    zero_vat_on_domestic_electricity,
)
from uk_budget_data.forecast import with_forecast
from uk_budget_data.measure_templates import apply_vat_base_change
from uk_budget_data.models import DataConfig
from uk_budget_data.policy_table import constants
from uk_budget_data.publication.combine import merged_changes
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    ELECTRICITY_VAT_ID,
    get_all_reforms,
    get_reform,
)

OWN_RATE = "gov.hmrc.vat.domestic_electricity_rate"
PRICE_BASIS = "gov.simulation.vat.energy_input_price_basis_rate"
ENGINE_HAS_OWN_RATE = measure_templates._has_parameter(
    system.parameters, OWN_RATE
)
# £1,050 a year including 5% VAT: £1,000 of electricity and £50 of VAT.
BILL = 1_050
VAT_AT_5_PERCENT = 50
PENNY = 0.01
SHARES = {2026: WINTER_SHARE, 2027: SPRING_SHARE}


def household(year, region="LONDON", electricity=BILL):
    return {
        "people": {
            "adult": {
                "age": {year: 45},
                "employment_income": {year: 20_000},
            }
        },
        "benunits": {"benunit": {"members": ["adult"]}},
        "households": {
            "household": {
                "members": ["adult"],
                "region": {year: region},
                "electricity_consumption": {year: electricity},
            }
        },
    }


def baseline(year, region="LONDON", electricity=BILL):
    """The measure's pre-Budget side, on the forecast, as every run."""
    measure = get_reform(ELECTRICITY_VAT_ID)
    return Simulation(
        situation=household(year, region, electricity),
        scenario=with_forecast(measure.to_baseline_scenario()),
    )


def reformed(year, region="LONDON", electricity=BILL):
    """The measure's Budget side, on the forecast, as every run."""
    measure = get_reform(ELECTRICITY_VAT_ID)
    return Simulation(
        situation=household(year, region, electricity),
        scenario=with_forecast(measure.to_scenario()),
    )


def value(simulation, variable, year):
    return float(simulation.calculate(variable, year).sum())


# --- The two sides are one measure ------------------------------------------


def test_the_measure_applies_its_pre_budget_side():
    measure = get_reform(ELECTRICITY_VAT_ID)
    assert measure.simulation_modifier is zero_vat_on_domestic_electricity
    assert (
        measure.baseline_simulation_modifier
        is pre_budget_vat_on_domestic_electricity
    )


def test_the_package_baseline_holds_the_same_5_percent():
    """The package is scored against the same baseline as the measure: its
    pre-Budget side runs the electricity measure's."""
    assert ELECTRICITY_VAT_ID in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    members = [
        get_reform(id_) for id_ in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    ]
    sides = merged_changes(members, DataConfig())
    assert (
        pre_budget_vat_on_domestic_electricity
        in sides["baseline"]["modifiers"]
    )
    assert zero_vat_on_domestic_electricity in sides["reform"]["modifiers"]
    assert (
        zero_vat_on_domestic_electricity not in sides["baseline"]["modifiers"]
    )


def test_both_sides_hold_one_baseline_for_the_same_years():
    """The modules' defaults are literals (a receipt binds them), so this
    ties them: one baseline rate, one engine rate, and the pre-Budget side
    holds exactly the years the Budget side changes."""
    before = constants(pre_budget_vat_on_domestic_electricity)
    after = constants(zero_vat_on_domestic_electricity)
    assert before["baseline_rate"] == after["baseline_rate"] == 0.05
    assert before["own_rate_parameter"] == after["own_rate_parameter"]
    assert before["own_rate_parameter"] == OWN_RATE
    assert OWN_RATE in measure_templates._OWN_VAT_RATES
    assert measure_templates._OWN_VAT_RATES[OWN_RATE] == PRICE_BASIS
    changed = {
        int(name.rsplit("_", 1)[1])
        for name in after
        if name.startswith("rate_change_")
    }
    held = set(range(before["first_year"], before["last_year"] + 1))
    assert held == changed == set(SHARES)
    # Neither leg can take the rate below zero
    for year in changed:
        assert after["baseline_rate"] + after[f"rate_change_{year}"] >= 0


def test_no_measure_changes_the_engines_electricity_rate_by_parameter():
    """The hold reads the simulation's own rate for ``vat`` and for
    ``baseline_vat``. A measure that also changed that rate by parameter
    would move one and not the other."""
    for reform in get_all_reforms():
        for changes in (
            reform.parameter_changes,
            reform.baseline_parameter_changes,
        ):
            for path in changes or {}:
                assert not path.startswith(OWN_RATE), (reform.id, path)


# --- The arithmetic of the hold, for every input ----------------------------


class _Nations:
    """A household's ``country``, as the template compares it."""

    possible_values = SimpleNamespace(NORTHERN_IRELAND="NORTHERN_IRELAND")

    def __init__(self, names):
        self.names = np.array(names)

    def __eq__(self, other):
        return self.names == other

    def __ne__(self, other):
        return self.names != other


def _engine(great_britain, northern_ireland, priced):
    """Parameters at a period, with the two paths the hold reads."""
    return lambda period: SimpleNamespace(
        gov=SimpleNamespace(
            hmrc=SimpleNamespace(
                vat=SimpleNamespace(
                    domestic_electricity_rate=SimpleNamespace(
                        great_britain=great_britain,
                        northern_ireland=northern_ireland,
                    )
                )
            ),
            simulation=SimpleNamespace(
                vat=SimpleNamespace(energy_input_price_basis_rate=priced)
            ),
        )
    )


RATES = st.floats(min_value=0, max_value=0.25, allow_nan=False)


@given(
    bills=st.lists(
        st.tuples(
            st.floats(min_value=0, max_value=50_000, allow_nan=False),
            st.sampled_from(["ENGLAND", "SCOTLAND", "NORTHERN_IRELAND"]),
        ),
        min_size=1,
        max_size=6,
    ),
    great_britain=RATES,
    northern_ireland=RATES,
    priced=RATES,
    held_rate=RATES,
    cut_share=st.floats(min_value=0, max_value=1, allow_nan=False),
)
def test_the_hold_charges_the_baseline_rate_whatever_the_engine_charges(
    bills, great_britain, northern_ireland, priced, held_rate, cut_share
):
    spending = np.array([bill for bill, _ in bills], dtype=float)
    nations = _Nations([nation for _, nation in bills])
    net, held = measure_templates._held_vat_baseline(
        lambda name, period: nations,
        None,
        _engine(great_britain, northern_ireland, priced),
        spending,
        held_rate,
        (OWN_RATE, PRICE_BASIS),
    )
    engine_rate = np.where(
        nations == "NORTHERN_IRELAND", northern_ireland, great_britain
    )
    # What the engine charges: the net bill at its own rate
    engine_vat = spending / (1 + priced) * engine_rate
    tolerance = 1e-9 * (1 + spending)
    assert np.all(np.abs(net - spending / (1 + priced)) <= tolerance)
    # The baseline: the net bill at the held rate, in every nation
    assert np.all(np.abs(engine_vat + held - net * held_rate) <= tolerance)
    # A cut of any share of the held rate never takes the charge below zero
    change = -held_rate * cut_share
    reformed_vat = engine_vat + held + net * change
    assert np.all(reformed_vat >= -tolerance)
    assert np.all(
        np.abs(reformed_vat - net * (held_rate + change)) <= tolerance
    )
    # vat less baseline_vat is the change alone: the hold is in both
    assert np.all(
        np.abs((reformed_vat - (engine_vat + held)) - net * change)
        <= tolerance
    )


# --- The measure on the installed engine ------------------------------------


def test_the_installed_engines_own_rate_is_the_law_the_hold_was_read_on():
    """policyengine-uk 2.165.1: Great Britain 0.05 x 183 / 365 in 2026-27
    (182 days at zero, 1 October 2026 to 31 March 2027) and 5% in 2027-28;
    Northern Ireland 5% throughout; bills priced including 5% VAT.

    No figure rests on these values: the hold gives the 5% baseline
    whatever the engine charges. If this fails, the engine's law for
    domestic electricity has moved (later releases carry the Budget's own
    extension to June 2027). Then read the measure's comments, its card
    ("October 2026 to March 2027 was already 0% in law before the Budget")
    and the Methodology page's baseline line against the new law, and
    update the values here.
    """
    if not ENGINE_HAS_OWN_RATE:
        pytest.skip(
            "the installed policyengine-uk has no rate of its own for "
            "domestic electricity (before 2.153.5), and no zero rate"
        )
    rates = system.parameters.get_child(OWN_RATE)
    assert rates.great_britain("2026-04-06") == pytest.approx(0.05 * 183 / 365)
    assert rates.great_britain("2027-04-06") == pytest.approx(0.05)
    for year in SHARES:
        assert rates.northern_ireland(f"{year}-04-06") == pytest.approx(0.05)
        assert system.parameters.get_child(PRICE_BASIS)(
            f"{year}-04-06"
        ) == pytest.approx(0.05)


@pytest.mark.parametrize(
    "year, region",
    [
        (2026, "LONDON"),
        (2026, "SCOTLAND"),
        (2026, "NORTHERN_IRELAND"),
        (2027, "LONDON"),
        (2027, "NORTHERN_IRELAND"),
    ],
)
def test_the_baseline_charges_5_percent_in_every_month(year, region):
    """Before the Budget's measure, the £1,050 bill carries its full £50 of
    VAT, in Great Britain as in Northern Ireland, in 2026-27 as in 2027-28:
    current law's zero rate for October 2026 to March 2027 is not in the
    baseline. An engine without a rate of its own gives the bill no VAT
    line (its VAT is in the engine's reduced-rate base), so nothing shows.
    """
    with_bill = value(baseline(year, region), "vat", year)
    without = value(baseline(year, region, electricity=0), "vat", year)
    expected = VAT_AT_5_PERCENT if ENGINE_HAS_OWN_RATE else 0
    assert with_bill - without == pytest.approx(expected, abs=PENNY)


@pytest.mark.parametrize(
    "year, region, share",
    [
        (2026, "LONDON", WINTER_SHARE),
        (2026, "WALES", WINTER_SHARE),
        # Great Britain only until April 2027
        (2026, "NORTHERN_IRELAND", 0.0),
        (2027, "LONDON", SPRING_SHARE),
        (2027, "NORTHERN_IRELAND", SPRING_SHARE),
    ],
)
def test_the_measure_takes_the_zero_rated_months_off_once(year, region, share):
    """The Budget side less the pre-Budget side is 5% of the net bill for
    the zero-rated share of the year's use, on any engine: £28.34 in
    2026-27 and £11.15 in 2027-28. The months current law already
    zero-rates are in that figure once, not twice."""
    before, after = baseline(year, region), reformed(year, region)
    cut = VAT_AT_5_PERCENT * share
    assert value(after, "vat", year) - value(
        before, "vat", year
    ) == pytest.approx(-cut, abs=PENNY)
    # Household tax counts only vat_change: none before the Budget
    assert value(before, "vat_change", year) == pytest.approx(0, abs=PENNY)
    assert value(after, "vat_change", year) == pytest.approx(-cut, abs=PENNY)
    assert value(after, "household_net_income", year) - value(
        before, "household_net_income", year
    ) == pytest.approx(cut, abs=PENNY)


@pytest.mark.parametrize("year, region", [(2026, "LONDON"), (2027, "LONDON")])
def test_the_reformed_scenario_never_charges_a_negative_rate(year, region):
    """The reformed bill keeps 5% for the months outside the zero rate:
    £50 x (1 - the zero-rated share of use), £21.66 in 2026-27. On
    policyengine-uk 2.165.1 the measure used to take its share off the
    engine's own 2.5%, which left less than nothing. An engine without a
    rate of its own shows the cut alone."""
    with_bill = value(reformed(year, region), "vat", year)
    without = value(reformed(year, region, electricity=0), "vat", year)
    cut = VAT_AT_5_PERCENT * SHARES[year]
    if ENGINE_HAS_OWN_RATE:
        assert with_bill - without == pytest.approx(
            VAT_AT_5_PERCENT - cut, abs=PENNY
        )
        assert with_bill - without > 0
    else:
        assert with_bill - without == pytest.approx(-cut, abs=PENNY)


def test_a_year_the_measure_does_not_change_is_left_as_the_engine_has_it():
    """2028-29: no hold and no change on either side."""
    plain = Simulation(situation=household(2028), scenario=with_forecast(None))
    for side in (baseline(2028), reformed(2028)):
        assert value(side, "vat", 2028) == pytest.approx(
            value(plain, "vat", 2028), abs=PENNY
        )
        assert value(side, "vat_change", 2028) == pytest.approx(0, abs=PENNY)


# --- The template's own refusals --------------------------------------------


def test_one_simulation_takes_one_side_of_the_measure():
    """Both sides hold the baseline, so applying both to one simulation
    would add the hold twice: the template refuses the second."""
    if not ENGINE_HAS_OWN_RATE:
        pytest.skip("nothing is held on an engine without the rate")
    simulation = Simulation(situation=household(2026))
    pre_budget_vat_on_domestic_electricity(simulation)
    with pytest.raises(ValueError, match="already held"):
        zero_vat_on_domestic_electricity(simulation)


def test_an_engine_rate_needs_the_rate_the_measure_is_scored_against():
    simulation = Simulation(situation=household(2026))
    with pytest.raises(ValueError, match="needs baseline_rate"):
        apply_vat_base_change(
            simulation,
            spending_variable="electricity_consumption",
            rate_change=-0.01,
            start_year=2026,
            end_year=2026,
            own_rate_parameter=OWN_RATE,
        )


def test_an_engine_rate_the_template_does_not_know_is_refused():
    simulation = Simulation(situation=household(2026))
    with pytest.raises(ValueError, match="own_rate_parameter must be one of"):
        apply_vat_base_change(
            simulation,
            spending_variable="electricity_consumption",
            rate_change=-0.01,
            start_year=2026,
            end_year=2026,
            baseline_rate=0.05,
            own_rate_parameter="gov.hmrc.vat.reduced_rate",
        )


def test_a_cut_below_zero_from_the_baseline_is_refused():
    simulation = Simulation(situation=household(2026))
    with pytest.raises(ValueError, match="must be nonnegative"):
        apply_vat_base_change(
            simulation,
            spending_variable="electricity_consumption",
            rate_change=-0.06,
            start_year=2026,
            end_year=2026,
            baseline_rate=0.05,
            own_rate_parameter=OWN_RATE,
        )
