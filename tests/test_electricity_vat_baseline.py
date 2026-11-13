"""Native electricity VAT against actual pre-Budget policy.

The pre-Budget reference keeps Great Britain's zero rate from 1 October
2026 through 31 March 2027 and Northern Ireland's 5% rate. Native policy
extends Great Britain's zero rate through June and adds Northern Ireland
from 1 April 2027. UK2.174.1 annualises statutory rates over 6 April to
5 April: the extension contributes five days to 2026-27 and 86 to 2027-28.
The dated source lives in parameters/gov/hmrc/vat/domestic_electricity_rate
at aa2713ecab059d674a7b5045797a2f6349add540; budget_policy.json records the
source-bound counterfactual. Household fixtures are synthetic.

The final section retains tests of the archived Treasury-reference helper
arithmetic and its refusals. Active comparisons never install those
historical modifiers.
"""

from datetime import date
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
from uk_budget_data.budget_policy import native_policy_changes
from uk_budget_data.forecast import forecast_parameters, with_forecast
from uk_budget_data.measure_templates import apply_vat_base_change
from uk_budget_data.models import DataConfig
from uk_budget_data.policy_table import constants
from uk_budget_data.publication.combine import merged_changes
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    ELECTRICITY_VAT_ID,
    get_reform,
)

OWN_RATE = "gov.hmrc.vat.domestic_electricity_rate"
PRICE_BASIS = "gov.simulation.vat.energy_input_price_basis_rate"
ENGINE_HAS_OWN_RATE = measure_templates._has_parameter(
    system.parameters, OWN_RATE
)
BILL = 1_050
VAT_AT_5_PERCENT = 50
PENNY = 0.01
SHARES = {2026: WINTER_SHARE, 2027: SPRING_SHARE}
YEARS = (2026, 2027, 2028)
REGIONS = ("LONDON", "SCOTLAND", "NORTHERN_IRELAND")


def household(year, region="LONDON", electricity=BILL):
    return {
        "people": {
            "adult": {"age": {year: 45}, "employment_income": {year: 20_000}}
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


def _overlap_days(start, stop, year):
    first, last = max(start, date(year, 4, 6)), min(stop, date(year + 1, 4, 6))
    return max(0, (last - first).days)


def _annual_rate(year, region, selected):
    if region == "NORTHERN_IRELAND":
        zero_days = (
            _overlap_days(date(2027, 4, 1), date(2027, 7, 1), year)
            if selected
            else 0
        )
    else:
        zero_days = _overlap_days(
            date(2026, 10, 1),
            date(2027, 7, 1) if selected else date(2027, 4, 1),
            year,
        )
    days = (date(year + 1, 4, 6) - date(year, 4, 6)).days
    return 0.05 * (days - zero_days) / days


@pytest.fixture(scope="module")
def endpoints():
    situation = {"people": {}, "benunits": {}, "households": {}}
    for i, region in enumerate(REGIONS):
        for billed in (False, True):
            key = f"p{i}_{int(billed)}"
            situation["people"][key] = {
                "age": {year: 45 for year in YEARS},
                "employment_income": {year: 20_000 for year in YEARS},
            }
            situation["benunits"][key] = {"members": [key]}
            situation["households"][key] = {
                "members": [key],
                "region": {year: region for year in YEARS},
                "electricity_consumption": {
                    year: BILL if billed else 0 for year in YEARS
                },
            }
    measure = get_reform(ELECTRICITY_VAT_ID)
    return (
        Simulation(
            situation=situation,
            scenario=with_forecast(measure.to_baseline_scenario()),
        ),
        Simulation(
            situation=situation, scenario=with_forecast(measure.to_scenario())
        ),
    )


def test_native_measure_restores_parameters_without_historical_modifiers():
    measure = get_reform(ELECTRICITY_VAT_ID)
    assert measure.parameter_changes == native_policy_changes(
        ELECTRICITY_VAT_ID
    )
    assert measure.simulation_modifier is None
    assert measure.baseline_simulation_modifier is None
    assert measure.baseline_parameter_changes is None
    assert set(measure.parameter_changes) == {
        OWN_RATE + ".great_britain",
        OWN_RATE + ".northern_ireland",
    }


def test_package_uses_the_same_native_electricity_changes_once():
    members = [
        get_reform(id_) for id_ in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    ]
    sides = merged_changes(members, DataConfig())
    assert not sides["baseline"]["modifiers"]
    assert not sides["reform"]["modifiers"]
    for path, periods in native_policy_changes(ELECTRICITY_VAT_ID).items():
        assert sides["reform"]["parameter_changes"][path] == periods


def test_the_extension_crosses_the_six_april_fiscal_boundary():
    assert [
        _overlap_days(date(2027, 4, 1), date(2027, 7, 1), year)
        for year in (2026, 2027)
    ] == [5, 86]
    assert [
        (date(year + 1, 4, 6) - date(year, 4, 6)).days for year in (2026, 2027)
    ] == [365, 366]


def test_dated_policy_keeps_existing_gb_winter_relief(endpoints):
    # parameters.baseline deliberately retains unreformed current law for
    # vat_change. The projected timelines include the scenario's statutory
    # assignments before fiscal-year annualisation.
    before, after = [
        sim.tax_benefit_system.projected_timelines for sim in endpoints
    ]
    native = forecast_parameters().baseline

    def at(timelines, path, day):
        return max(
            (item for item in timelines[path] if item.instant_str <= day),
            key=lambda item: item.instant_str,
        ).value

    for nation in ("great_britain", "northern_ireland"):
        path = f"{OWN_RATE}.{nation}"
        winter = 0.05 if nation == "northern_ireland" else 0
        assert (
            at(before, path, "2026-10-01")
            == at(after, path, "2026-10-01")
            == winter
        )
        assert (
            at(before, path, "2027-04-01"),
            at(after, path, "2027-04-01"),
        ) == (0.05, 0)
        assert (
            at(before, path, "2027-07-01")
            == at(after, path, "2027-07-01")
            == 0.05
        )
        for day in ("2026-10-01", "2027-04-01", "2027-06-30", "2027-07-01"):
            assert at(after, path, day) == native.get_child(path)(day)


@pytest.mark.parametrize("year", YEARS)
@pytest.mark.parametrize("region", REGIONS)
def test_native_annualised_rates_and_bill_tax_match_the_dated_policy(
    endpoints, year, region
):
    before, after = endpoints
    nation = (
        "northern_ireland" if region == "NORTHERN_IRELAND" else "great_britain"
    )
    index = REGIONS.index(region) * 2
    for selected, simulation in ((False, before), (True, after)):
        expected_rate = _annual_rate(year, region, selected)
        assert simulation.tax_benefit_system.parameters.get_child(
            f"{OWN_RATE}.{nation}"
        )(str(year)) == pytest.approx(expected_rate)
        tax = simulation.calculate("vat", year)
        assert float(tax[index + 1] - tax[index]) == pytest.approx(
            1_000 * expected_rate, abs=PENNY
        )
        assert float(tax[index + 1] - tax[index]) >= 0
    reduction = 1_000 * (
        _annual_rate(year, region, False) - _annual_rate(year, region, True)
    )
    # vat_change compares each endpoint with native current law. The
    # counterfactual therefore has a positive charge; native policy has 0.
    assert float(
        before.calculate("vat_change", year)[index + 1]
    ) == pytest.approx(reduction, abs=PENNY)
    assert float(
        after.calculate("vat_change", year)[index + 1]
    ) == pytest.approx(0, abs=PENNY)
    assert float(
        after.calculate("household_net_income", year)[index + 1]
        - before.calculate("household_net_income", year)[index + 1]
    ) == pytest.approx(reduction, abs=PENNY)


# --- Archived forward-helper controls (not the active policy comparison) ---


def test_archived_forward_modifiers_share_their_historical_reference():
    """The archived Treasury-reference modifiers keep literal defaults: one baseline rate, one engine rate, and the pre-Budget side
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


def test_archived_modifiers_refuse_a_double_hold():
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
