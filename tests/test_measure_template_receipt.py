"""Restrict payment selectors to benefits with verified receipt gates."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data.budget_measures import warm_home_discount_top_up
from uk_budget_data.measure_templates import apply_benefit_receipt_payment


def _pensioner(*, claim, income=5000, age=75):
    return {
        "people": {
            "p": {
                "age": {2027: age},
                "private_pension_income": {2027: income},
            }
        },
        "benunits": {"b": {"members": ["p"], "would_claim_pc": {2027: claim}}},
        "households": {"h": {"members": ["p"], "region": {2027: "LONDON"}}},
    }


def _payment(sim, selector):
    return apply_benefit_receipt_payment(
        sim,
        amount=120,
        eligible_benefits=[selector],
        geography="GB",
        channel="cost_of_living_support_payment",
        year=2027,
    )


@pytest.mark.parametrize(
    "selector", ["pension_credit_entitlement", "pension_credit"]
)
def test_payment_refuses_unreviewed_pension_credit_selectors(selector):
    sim = Simulation(situation=_pensioner(claim=False))
    assert sim.calculate("pension_credit_entitlement", 2027)[0] > 0
    assert sim.calculate("pension_credit", 2027)[0] == 0
    with pytest.raises(
        ValueError, match=f"Unsupported receipt selector: {selector}"
    ):
        _payment(sim, selector)


@pytest.mark.parametrize("claim", [False, True])
def test_payment_guarantee_credit_selector_requires_actual_receipt(claim):
    sim = Simulation(situation=_pensioner(claim=claim))
    # The component is positive even for nonclaimants.
    assert sim.calculate("guarantee_credit", 2027)[0] > 0
    assert bool(sim.calculate("in_receipt_of_guarantee_credit", 2027)[0]) is (
        claim
    )
    native = sim.calculate("cost_of_living_support_payment", 2027)[0]
    _payment(sim, "guarantee_credit")
    assert sim.calculate("cost_of_living_support_payment", 2027)[0] == (
        native + (120 if claim else 0)
    )


@pytest.mark.parametrize("claim", [False, True])
def test_payment_savings_credit_selector_requires_actual_receipt(claim):
    sim = Simulation(situation=_pensioner(claim=claim, income=14_000, age=85))
    assert sim.calculate("savings_credit", 2027)[0] > 0
    assert bool(sim.calculate("pension_credit", 2027)[0] > 0) is claim
    native = sim.calculate("cost_of_living_support_payment", 2027)[0]
    _payment(sim, "savings_credit")
    assert sim.calculate("cost_of_living_support_payment", 2027)[0] == (
        native + (120 if claim else 0)
    )


@pytest.mark.parametrize("claim", [False, True])
def test_payment_universal_credit_selector_requires_actual_receipt(claim):
    situation = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"], "would_claim_uc": {2027: claim}}},
        "households": {"h": {"members": ["p"], "region": {2027: "LONDON"}}},
    }
    sim = Simulation(situation=situation)
    assert bool(sim.calculate("universal_credit", 2027)[0] > 0) is claim
    native = sim.calculate("cost_of_living_support_payment", 2027)[0]
    _payment(sim, "universal_credit")
    assert sim.calculate("cost_of_living_support_payment", 2027)[0] == (
        native + (120 if claim else 0)
    )


def _legacy_household(*, claim_hb, esa=None, income=14000, age=75):
    benunit = {
        "members": ["p"],
        "would_claim_pc": {2026: False},
        "would_claim_uc": {2026: False},
        "would_claim_housing_benefit": {2026: claim_hb},
    }
    if esa is not None:
        benunit["esa_income"] = {2026: esa}
    return {
        "people": {
            "p": {
                "age": {2026: age},
                "private_pension_income": {2026: income},
            }
        },
        "benunits": {"b": benunit},
        "households": {
            "h": {
                "members": ["p"],
                "region": {2026: "LONDON"},
                "rent": {2026: 9600},
                "tenure_type": {2026: "RENT_PRIVATELY"},
            }
        },
    }


@pytest.mark.parametrize("claim", [False, True])
def test_warm_home_discount_top_up_reaches_housing_benefit_alone(claim):
    # A pensioner renting in London on £14,000 of private pension: above
    # Pension Credit, but Housing Benefit of £9,338.70 when claimed.
    sim = Simulation(situation=_legacy_household(claim_hb=claim))
    assert sim.calculate("pension_credit", 2026)[0] == 0
    assert sim.calculate("universal_credit", 2026)[0] == 0
    assert bool(sim.calculate("housing_benefit", 2026)[0] > 0) is claim
    native = sim.calculate("cost_of_living_support_payment", 2026)[0]
    warm_home_discount_top_up(sim)
    assert sim.calculate("cost_of_living_support_payment", 2026)[0] == (
        native + (100 if claim else 0)
    )


@pytest.mark.parametrize("award", [0, 3000])
def test_warm_home_discount_top_up_reaches_income_related_esa_alone(award):
    sim = Simulation(
        situation=_legacy_household(
            claim_hb=False, esa=award, income=0, age=40
        )
    )
    assert sim.calculate("universal_credit", 2026)[0] == 0
    assert sim.calculate("housing_benefit", 2026)[0] == 0
    native = sim.calculate("cost_of_living_support_payment", 2026)[0]
    warm_home_discount_top_up(sim)
    assert sim.calculate("cost_of_living_support_payment", 2026)[0] == (
        native + (100 if award else 0)
    )
