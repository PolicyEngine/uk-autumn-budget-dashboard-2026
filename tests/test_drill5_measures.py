"""Drill 5 (MOCK, 26 October 2026): each new measure changes what it should."""

import pytest
from policyengine_uk import Simulation

from uk_budget_data import reforms
from uk_budget_data.budget_measures.state_pension_income_tax_allowance import (
    state_pension_income_tax_allowance,
)
from uk_budget_data.budget_measures.state_pension_income_tax_allowance_untapered import (
    state_pension_income_tax_allowance_untapered,
)
from uk_budget_data.budget_measures.zero_vat_on_domestic_gas import (
    zero_vat_on_domestic_gas,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.publication.receipt import CodeRevision
from uk_budget_data.publication.template_proof import pure_templates

LATER_YEARS = [str(y) for y in POLICY_YEARS if y >= 2027]


@pytest.fixture(scope="module")
def drill5():
    return {m.id: m for m in reforms.get_drill5_measures()}


def test_drill5_has_fifteen_measures_with_unique_ids(drill5):
    assert len(drill5) == 15


def test_drill5_is_not_registered_by_default():
    assert reforms.get_reform(reforms.GAS_VAT_ID) is None


def test_uc_allowance_is_one_percent_below_current_law(drill5):
    changes = drill5[reforms.UC_BELOW_CPI_ID].parameter_changes
    for claimant in reforms.UC_CLAIMANT_TYPES:
        path = f"{reforms.UC_STANDARD_ALLOWANCE}.{claimant}"
        assert list(changes[path]) == LATER_YEARS
        for year, value in changes[path].items():
            base = reforms._current_law(path, int(year))
            assert value == pytest.approx(base * 0.99, abs=0.01)


def test_secondary_threshold_rises_by_1000_a_year(drill5):
    changes = drill5[reforms.NI_SECONDARY_THRESHOLD_ID].parameter_changes
    values = changes[reforms.NI_SECONDARY_THRESHOLD]
    assert values["2027"] * 52 == pytest.approx(6000)


def test_secondary_threshold_is_scored_at_fixed_pay(drill5):
    """On the under-25s relief's basis (gross, pay fixed), not net of the
    engine's same-year pass-through to pay (review on #144, point 1)."""
    changes = drill5[reforms.NI_SECONDARY_THRESHOLD_ID].parameter_changes
    for name in reforms.EMPLOYER_NI_INCIDENCES:
        path = f"{reforms.EMPLOYER_NI_INCIDENCE}.{name}"
        assert changes[path] == {str(y): 0 for y in POLICY_YEARS}


def test_secondary_threshold_moves_no_pay():
    measure = reforms._create_employer_ni_secondary_threshold_raised()
    situation = {
        "people": {
            "p": {"age": {2027: 30}, "employment_income": {2027: 30_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2027: "LONDON"}}},
    }
    baseline = Simulation(situation=situation)
    reformed = Simulation(situation=situation, scenario=measure.to_scenario())
    assert reformed.calculate("employment_income", 2027)[0] == pytest.approx(
        baseline.calculate("employment_income", 2027)[0]
    )
    # 15% employer NI on the £1,000 the threshold rises by.
    assert baseline.calculate("ni_class_1_employer", 2027)[
        0
    ] - reformed.calculate("ni_class_1_employer", 2027)[0] == pytest.approx(
        150, abs=1
    )


def test_cgt_main_rates(drill5):
    changes = drill5[reforms.CGT_RATES_ID].parameter_changes
    assert set(changes[reforms.CGT_BASIC_RATE].values()) == {0.20}
    assert set(changes[reforms.CGT_HIGHER_RATE].values()) == {0.26}


def test_surcharge_starts_at_three_quarters_of_current_threshold(drill5):
    changes = drill5[reforms.HVCTS_ID].parameter_changes
    values = changes[reforms.HVCTS_FIRST_THRESHOLD]
    assert values["2028"] == 1_500_000
    assert "2027" not in values


def test_lha_unfrozen_for_april_2027_only(drill5):
    changes = drill5[reforms.LHA_RESET_ID].parameter_changes
    assert changes == {reforms.LHA_FREEZE: {"2027": False}}


def test_dividend_rates_one_point_higher(drill5):
    changes = drill5[reforms.DIVIDEND_RATES_ID].parameter_changes
    for path in reforms.DIVIDEND_RATES:
        for year, value in changes[path].items():
            base = reforms._current_law(path, int(year))
            assert value == pytest.approx(base + 0.01)


def test_combined_run_leaves_out_alternatives(monkeypatch):
    monkeypatch.setenv("UK_BUDGET_MEASURE_SET", "drill5")
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", None)
    monkeypatch.setattr(reforms, "_REFORM_LOOKUP_CACHE", None)
    seen = {}
    real = reforms._create_combined_autumn_budget_reform

    def capture(members):
        seen["ids"] = [m.id for m in members]
        return real(members)

    monkeypatch.setattr(
        reforms, "_create_combined_autumn_budget_reform", capture
    )
    ids = reforms.list_reform_ids()
    assert len(ids) == 16
    assert len(seen["ids"]) == 14
    assert reforms.STATE_PENSION_EXTENDED_ID not in seen["ids"]
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", None)
    monkeypatch.setattr(reforms, "_REFORM_LOOKUP_CACHE", None)


def test_drill5_modifiers_are_proved_pure_templates():
    """Ported to modules of their own, both stay template-only, so the
    drill needs no attestation beyond main's hand-written modifiers."""
    revision = CodeRevision("0" * 40, tree_clean=True)
    assert pure_templates(
        state_pension_income_tax_allowance_untapered, revision
    ) == ["apply_age_conditioned_allowance"]
    assert pure_templates(zero_vat_on_domestic_gas, revision) == [
        "apply_vat_base_change"
    ]


def _pensioner(private_pension):
    return {
        "people": {
            "p": {
                "age": {2028: 75},
                "state_pension": {2028: 12_500},
                "private_pension_income": {2028: private_pension},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {2028: "LONDON"}}},
    }


def test_extended_protection_keeps_allowance_with_other_income():
    base = Simulation(situation=_pensioner(20_000))
    state_pension_income_tax_allowance(base)
    extended = Simulation(situation=_pensioner(20_000))
    state_pension_income_tax_allowance_untapered(extended)
    assert extended.calculate("personal_allowance", 2028)[0] == 13370
    assert base.calculate("personal_allowance", 2028)[0] < 13370


def test_gas_vat_cut_lowers_vat_in_2027_only():
    situation = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "region": {2027: "LONDON", 2028: "LONDON"},
                "gas_consumption": {2027: 1_050, 2028: 1_050},
            }
        },
    }
    before = Simulation(situation=situation)
    after = Simulation(situation=situation)
    zero_vat_on_domestic_gas(after)
    assert after.calculate("household_net_income", 2027)[0] == pytest.approx(
        before.calculate("household_net_income", 2027)[0] + 50, abs=1
    )
    assert after.calculate("household_net_income", 2028)[0] == pytest.approx(
        before.calculate("household_net_income", 2028)[0], abs=0.01
    )


def test_gas_vat_cut_is_great_britain_only():
    situation = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "region": {2027: "NORTHERN_IRELAND"},
                "gas_consumption": {2027: 1_050},
            }
        },
    }
    before = Simulation(situation=situation)
    after = Simulation(situation=situation)
    zero_vat_on_domestic_gas(after)
    assert after.calculate("household_net_income", 2027)[0] == pytest.approx(
        before.calculate("household_net_income", 2027)[0], abs=0.01
    )
