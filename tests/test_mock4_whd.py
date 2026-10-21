"""MOCK drill 4: Warm Home Discount top-up (mock4_whd_topup).

Hand-computed expectations (winter 2026-27 = model year 2026 only):
- English or Welsh household on UC / HB / income ESA / income JSA: +£125.
- English household on Pension Credit only: +£75.
- Household on both (pensioner renting: HB + Pension Credit): one payment,
  the higher £125 (not £125 + £75 = £200).
- Scottish household on UC: £0 (England and Wales only).
- Household on no qualifying benefit: £0.
- 2027 (winter 2027-28): £0 for everyone.
The change to household net income equals the change to government spending
(paid by the taxpayer through cost_of_living_support_payment).
"""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.reforms import get_autumn_budget_2026_reforms, get_reform

YEARS = (2026, 2027)


def household(country, age, employment_income, rent, tenure):
    return {
        "people": {
            "p": {
                "age": {y: age + (y - 2026) for y in YEARS},
                "employment_income": {y: employment_income for y in YEARS},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "country": {y: country for y in YEARS},
                "rent": {y: rent for y in YEARS},
                "tenure_type": {y: tenure for y in YEARS},
            }
        },
    }


UC_RENTER = dict(
    age=30, employment_income=5_000, rent=6_000, tenure="RENT_PRIVATELY"
)
PC_OWNER = dict(age=75, employment_income=0, rent=0, tenure="OWNED_OUTRIGHT")
PC_RENTER = dict(
    age=75, employment_income=0, rent=6_000, tenure="RENT_PRIVATELY"
)
HIGH_EARNER = dict(
    age=30, employment_income=80_000, rent=6_000, tenure="RENT_PRIVATELY"
)


def gain(country, case, year):
    situation = household(country, **case)
    reform = get_reform("mock4_whd_topup")
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation, scenario=reform.to_scenario())
    d_net = float(
        reformed.calculate("household_net_income", year).sum()
        - baseline.calculate("household_net_income", year).sum()
    )
    d_spend = float(
        reformed.calculate("gov_spending", year).sum()
        - baseline.calculate("gov_spending", year).sum()
    )
    return baseline, d_net, d_spend


def receives(sim, variable, year):
    return float(sim.calculate(variable, year, map_to="household").sum()) > 0


def test_registered_in_autumn_budget_reforms():
    ids = [r.id for r in get_autumn_budget_2026_reforms()]
    assert "mock4_whd_topup" in ids
    reform = get_reform("mock4_whd_topup")
    assert reform.simulation_modifier is not None
    assert reform.parameter_changes is None


@pytest.mark.parametrize("country", ["ENGLAND", "WALES"])
def test_uc_claimant_in_england_and_wales_gets_125_in_2026(country):
    baseline, d_net, d_spend = gain(country, UC_RENTER, 2026)
    assert receives(baseline, "universal_credit", 2026)
    assert d_net == pytest.approx(125)
    assert d_spend == pytest.approx(125)


def test_uc_claimant_gets_nothing_in_2027():
    _, d_net, d_spend = gain("ENGLAND", UC_RENTER, 2027)
    assert d_net == pytest.approx(0)
    assert d_spend == pytest.approx(0)


def test_scottish_uc_claimant_gets_nothing():
    baseline, d_net, _ = gain("SCOTLAND", UC_RENTER, 2026)
    assert receives(baseline, "universal_credit", 2026)
    assert d_net == pytest.approx(0)


def test_pension_credit_only_household_gets_75():
    baseline, d_net, d_spend = gain("ENGLAND", PC_OWNER, 2026)
    assert receives(baseline, "pension_credit", 2026)
    for core in (
        "universal_credit",
        "housing_benefit",
        "esa_income",
        "jsa_income",
    ):
        assert not receives(baseline, core, 2026)
    assert d_net == pytest.approx(75)
    assert d_spend == pytest.approx(75)


def test_household_qualifying_both_ways_gets_one_payment_of_125():
    baseline, d_net, _ = gain("ENGLAND", PC_RENTER, 2026)
    assert receives(baseline, "pension_credit", 2026)
    assert receives(baseline, "housing_benefit", 2026)
    assert d_net == pytest.approx(125)


def test_household_on_no_qualifying_benefit_gets_nothing():
    _, d_net, _ = gain("ENGLAND", HIGH_EARNER, 2026)
    assert d_net == pytest.approx(0)
