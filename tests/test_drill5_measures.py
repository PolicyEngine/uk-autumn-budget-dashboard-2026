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
    assert set(changes[reforms.CGT_ADDITIONAL_RATE].values()) == {0.26}


def test_cgt_rise_reaches_gains_above_the_higher_rate_limit(drill5):
    """A £1m gain on a £50,000 salary: £270 falls in the basic rate band,
    the rest above it, most of that above the higher rate limit, where the
    engine charges the additional rate. Every pound of gain above the
    £3,000 exemption pays 2 points more: 2% of £997,000 is £19,940
    (£1,754 with the higher rate alone)."""
    year = 2027
    situation = {
        "people": {
            "p": {
                "age": {year: 55},
                "employment_income": {year: 50_000},
                "capital_gains": {year: 1_000_000},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }
    current_law = Simulation(situation=situation)
    reformed = Simulation(
        situation=situation,
        scenario=drill5[reforms.CGT_RATES_ID].to_scenario(),
    )
    assert reformed.calculate("capital_gains_tax", year)[
        0
    ] - current_law.calculate("capital_gains_tax", year)[0] == pytest.approx(
        19_940, abs=1
    )


RESPONSES = "gov.simulation.capital_gains_responses"
# The measures that move capital gains tax: its rates, the relief's limit,
# the basic rate band and the State Pension allowances (taxable income).
CGT_PINNED = (
    reforms.CGT_RATES_ID,
    reforms.BADR_ID,
    reforms.THRESHOLD_FREEZE_ID,
    reforms.STATE_PENSION_ALLOWANCE_ID,
    reforms.STATE_PENSION_EXTENDED_ID,
)
STATIC_PIN = {
    reforms.CGT_RESPONSE_ELASTICITY: {str(y): 0.0 for y in POLICY_YEARS}
}


def _responses(changes):
    return {
        path: periods
        for path, periods in (changes or {}).items()
        if path.startswith(RESPONSES)
    }


def test_exactly_the_capital_gains_measures_are_static(drill5):
    for measure_id, measure in drill5.items():
        expected = STATIC_PIN if measure_id in CGT_PINNED else {}
        assert _responses(measure.parameter_changes) == expected, measure_id
        assert _responses(measure.baseline_parameter_changes) == {}


def test_drill5_combined_run_shares_the_static_pin(monkeypatch):
    """Several members set the pin, to the same values; the combined run
    builds, with the pin set once (it raised CombineConflict before)."""
    monkeypatch.setenv("UK_BUDGET_MEASURE_SET", "drill5")
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", None)
    monkeypatch.setattr(reforms, "_REFORM_LOOKUP_CACHE", None)
    combined = reforms.get_reform(reforms.AUTUMN_BUDGET_2026_COMBINED_ID)
    assert _responses(combined.parameter_changes) == STATIC_PIN
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", None)
    monkeypatch.setattr(reforms, "_REFORM_LOOKUP_CACHE", None)


def test_drill5_package_by_area_is_the_combined_runs_members(monkeypatch):
    """Results by area check the combined reform as a package of the same
    members the combined run simulates: the drill's 14, not main's 9."""
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
    reforms.list_reform_ids()
    components = reforms.combined_components()
    assert len(components) == 14
    assert sorted(components) == sorted(seen["ids"])
    assert all(reforms.get_reform(c) is not None for c in components)
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", None)
    monkeypatch.setattr(reforms, "_REFORM_LOOKUP_CACHE", None)


def test_main_package_by_area_is_the_nine_candidates(monkeypatch):
    monkeypatch.delenv("UK_BUDGET_MEASURE_SET", raising=False)
    assert (
        reforms.combined_components()
        == reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    )


def test_cgt_main_rates_are_static_on_the_installed_engine(drill5):
    """The engine's default main elasticity is 1 (from policyengine-uk
    2.134.0); the measure's pin sets it to 0 in its own simulation, so
    realised gains stay as they are (£50,000 on a £100,000 salary)."""
    year = 2027
    situation = {
        "people": {
            "p": {
                "age": {year: 50},
                "employment_income": {year: 100_000},
                "capital_gains": {year: 50_000},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: "LONDON"}}},
    }
    current_law = Simulation(situation=situation)
    assert current_law.calculate("capital_gains_elasticity", year)[0] == 1
    reformed = Simulation(
        situation=situation,
        scenario=drill5[reforms.CGT_RATES_ID].to_scenario(),
    )
    assert reformed.calculate("capital_gains_elasticity", year)[0] == 0
    assert reformed.calculate("capital_gains", year)[0] == 50_000


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
