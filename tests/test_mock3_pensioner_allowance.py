"""MOCK drill 3 measure 4: Pensioner Allowance, hand-computed households.

MOCK DATA: rehearsal Budget for PolicyEngine drill 3. Not a real Budget.

Engine values (policyengine-uk 2.125.1), model year 2027 = FY 2027-28:
  Personal Allowance  PA  = £12,570
  full new State Pension  = £250.711/week x 52 = £13,036.97 a year
  Pensioner Allowance     = ceil(13,036.97) = £13,037 (no taper below £30k)
  excess over PA          = 13,037 - 12,570 = £467

State Pension is entered directly as the ``state_pension`` input so the
household's pension is exactly the full new State Pension.
"""

import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data import mock_drill3_pensioner_allowance as mock3

YEAR = 2027
PARAMS = system.parameters
PA_2027 = PARAMS.gov.hmrc.income_tax.allowances.personal_allowance.amount(
    f"{YEAR}-01-01"
)
FULL_NSP_2027 = 250.70 * 52  # Annex A, pinned in both scenarios: 13,036.40
REFORM = mock3._create_mock3_pensioner_allowance()


def _person(age, state_pension=0.0, private_pension=0.0, employment=0.0,
            region="LONDON", year=YEAR):
    return {
        "people": {
            "p": {
                "age": {year: age},
                "state_pension": {year: state_pension},
                "private_pension_income": {year: private_pension},
                "employment_income": {year: employment},
            }
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"], "region": {year: region}}},
    }


def _run(situation, year=YEAR):
    variables = [
        "personal_allowance",
        "income_tax",
        "adjusted_net_income",
        "household_net_income",
    ]
    out = {}
    for label, scenario in (
        ("baseline", REFORM.to_drill_scenario(baseline=True)),
        ("reform", REFORM.to_drill_scenario()),
    ):
        sim = Simulation(situation=situation, scenario=scenario)
        out[label] = {v: float(sim.calculate(v, year)[0]) for v in variables}
    return out


def test_engine_values():
    assert PA_2027 == 12_570
    assert FULL_NSP_2027 == pytest.approx(13_036.40, abs=0.01)
    assert FULL_NSP_2027 > PA_2027


def test_reform_definition():
    assert REFORM.id == "mock3_pensioner_allowance"
    assert REFORM.description.startswith("MOCK.")
    assert REFORM.parameter_changes == REFORM.baseline_parameter_changes
    assert REFORM.parameter_changes[mock3.NEW_SP_PATH]["2027"] == 250.70
    assert REFORM.parameter_changes[mock3.NEW_SP_PATH]["2031"] == 285.15
    assert REFORM.parameter_changes[mock3.PA_PATH] == {"2031": 12_830}
    assert mock3.TAPER_RATE == 0.5
    assert mock3.PENSIONER_ALLOWANCE_TAPER_THRESHOLD == 30_000


def test_a_state_pension_only_pays_no_income_tax():
    # Baseline tax = 20% x (13,036.40 - 12,570) = £93.28.
    # Reform allowance = 13,036.40 rounded up to next £10 = 13,040, so tax = £0;
    # net income rises by the whole baseline tax.
    r = _run(_person(70, state_pension=FULL_NSP_2027))
    assert r["baseline"]["personal_allowance"] == 12_570
    assert r["baseline"]["income_tax"] == pytest.approx(93.28, abs=0.01)
    assert r["reform"]["personal_allowance"] == 13_040
    assert r["reform"]["income_tax"] == 0
    assert r["reform"]["household_net_income"] - r["baseline"][
        "household_net_income"
    ] == pytest.approx(r["baseline"]["income_tax"], abs=0.01)


def test_b_state_pension_plus_10k_private_pension():
    # ANI = 13,036.40 + 10,000 = 23,036.40 < 30,000: no withdrawal.
    # Allowance 13,040; tax falls by 20% x (13,040 - 12,570) = £94.00.
    r = _run(_person(70, state_pension=FULL_NSP_2027, private_pension=10_000))
    assert r["reform"]["adjusted_net_income"] == pytest.approx(23_036.40, 0.01)
    assert r["reform"]["personal_allowance"] == 13_040
    cut = r["baseline"]["income_tax"] - r["reform"]["income_tax"]
    assert cut == pytest.approx(94.00, abs=0.01)


def test_c_income_34000_excess_fully_withdrawn():
    # ANI 34,000: withdrawal = (34,000 - 30,000) / 2 = 2,000 > excess
    # 470, so the extra allowance is gone; allowance = native 12,570
    # (never below it). No change in tax.
    r = _run(
        _person(
            70,
            state_pension=FULL_NSP_2027,
            private_pension=34_000 - FULL_NSP_2027,
        )
    )
    assert r["reform"]["adjusted_net_income"] == pytest.approx(34_000)
    assert r["reform"]["personal_allowance"] == 12_570
    assert r["reform"]["income_tax"] == r["baseline"]["income_tax"]


def test_c2_income_30500_excess_partly_withdrawn():
    # ANI 30,500: withdrawal = (30,500 - 30,000) / 2 = 250.
    # Allowance = 12,570 + (13,040 - 12,570) - 250 = 12,790.
    # Tax cut = 20% x (12,790 - 12,570) = 20% x 220 = £44.00.
    r = _run(
        _person(
            70,
            state_pension=FULL_NSP_2027,
            private_pension=30_500 - FULL_NSP_2027,
        )
    )
    assert r["reform"]["personal_allowance"] == 12_790
    assert r["baseline"]["income_tax"] - r["reform"]["income_tax"] == (
        pytest.approx(44.00, abs=0.01)
    )


def test_d_non_pensioner_aged_40_unchanged():
    r = _run(_person(40, employment=30_000))
    assert r["reform"]["personal_allowance"] == 12_570
    assert r["reform"]["income_tax"] == r["baseline"]["income_tax"]
    assert r["reform"]["household_net_income"] == pytest.approx(
        r["baseline"]["household_net_income"]
    )


def test_under_state_pension_age_with_state_pension_unchanged():
    # Eligibility is is_SP_age: a 60-year-old with State Pension recorded
    # (data noise) does not get the allowance.
    r = _run(_person(60, state_pension=FULL_NSP_2027))
    assert r["reform"]["personal_allowance"] == 12_570
    assert r["reform"]["income_tax"] == r["baseline"]["income_tax"]


def test_scotland_gets_the_same_allowance():
    # The allowance is reserved: a Scottish pensioner with SP + £10,000 gets
    # 13,040; ANI 23,036.40 sits in the Scottish 20% basic band at the
    # margin, so the cut is again 20% x 470 = £94.00.
    r = _run(
        _person(
            70,
            state_pension=FULL_NSP_2027,
            private_pension=10_000,
            region="SCOTLAND",
        )
    )
    assert r["reform"]["personal_allowance"] == 13_040
    assert r["baseline"]["income_tax"] - r["reform"]["income_tax"] == (
        pytest.approx(94.00, abs=0.01)
    )


def test_no_effect_before_april_2027():
    r = _run(_person(70, state_pension=13_000, year=2026), year=2026)
    assert r["reform"]["personal_allowance"] == r["baseline"][
        "personal_allowance"
    ]
    assert r["reform"]["income_tax"] == r["baseline"]["income_tax"]


def test_2031_full_new_sp_annex_a_pa():
    # SP 285.15 x 52 = 14,827.80; allowance rounds up to 14,830.
    # Baseline PA pinned to Annex A 12,830: tax = 20% x (14,827.80 - 12,830)
    # = £399.56 -> £0 under reform.
    year = 2031
    r = _run(_person(75, state_pension=285.15 * 52, year=year), year=year)
    assert r["baseline"]["personal_allowance"] == 12_830
    assert r["baseline"]["income_tax"] == pytest.approx(399.56, abs=0.01)
    assert r["reform"]["personal_allowance"] == 14_830
    assert r["reform"]["income_tax"] == 0
