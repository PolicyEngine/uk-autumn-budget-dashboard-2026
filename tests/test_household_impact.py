"""One household's net income before and after the Budget, through
policyengine.py.

``household_impact`` asks policyengine.py (``pe.uk.calculate_household``)
for the household's net income twice: once under the selected measures'
pre-Budget sides, once under their Budget sides. policyengine.py takes
parameter changes only, keyed by dates, so each measure's changes are read
as the national run reads them (policyengine-uk's ``read_parameter_changes``)
and written as inclusive date intervals. A measure that needs a simulation
modifier can't be expressed that way and is reported as not modelled.

The parity tests compare each result with the national route's household
simulations (``personal_impact.household_simulations``), which build
policyengine-uk's ``Scenario`` from the same measures.
"""

from types import SimpleNamespace

import policyengine as pe
import pytest
from fastapi.testclient import TestClient
from policyengine_uk import Simulation
from uk_budget_data.household_impact_api import create_app

from uk_budget_data import household_impact, personal_impact
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.combine import combine_measures
from uk_budget_data.reforms import get_reform
from uk_budget_data.runtime_identity import runtime_identity

YEAR = 2029
Answers = household_impact.HouseholdAnswers

# Probe households, each moved by at least one measure in 2029-30
PROBES = {
    "petrol_30k": Answers(employment_income=30_000, petrol_spending=1_500),
    "employee_60k": Answers(employment_income=60_000),
    "uc_family": Answers(
        employment_income=15_000,
        children_ages=(3, 7, 9),
        claims_universal_credit=True,
        tenure="RENT_PRIVATELY",
        monthly_rent=900,
    ),
    "investor_150k": Answers(
        employment_income=150_000,
        dividend_income=20_000,
        savings_interest_income=5_000,
        property_income=10_000,
    ),
    # Dividends in the basic-rate band, which the dividend measure changes
    "dividends_30k": Answers(employment_income=30_000, dividend_income=20_000),
    "salary_sacrifice_60k": Answers(
        employment_income=60_000, salary_sacrifice_pension_contributions=6_000
    ),
}

# One household that most measures move, for every measure together
EVERYTHING = Answers(
    employment_income=60_000,
    has_partner=True,
    partner_employment_income=20_000,
    children_ages=(3, 7, 9),
    dividend_income=20_000,
    savings_interest_income=5_000,
    property_income=10_000,
    petrol_spending=1_500,
    salary_sacrifice_pension_contributions=6_000,
)

# The probe each modelled measure moves
MOVED_BY = {
    "two_child_limit": "uc_family",
    "fuel_duty_freeze": "petrol_30k",
    "threshold_freeze_extension": "employee_60k",
    "dividend_tax_increase_2pp": "dividends_30k",
    "savings_tax_increase_2pp": "investor_150k",
    "property_tax_increase_2pp": "investor_150k",
    "salary_sacrifice_cap": "salary_sacrifice_60k",
}


def situation(answers, year):
    """The same household as a policyengine-uk situation, for the national
    route's simulations."""
    people, benunit, household = household_impact.household_entities(answers)
    names = [f"person_{index}" for index in range(len(people))]

    def by_year(values):
        return {name: {year: value} for name, value in values.items()}

    return {
        "people": {
            name: by_year(person) for name, person in zip(names, people)
        },
        "benunits": {"benunit": {"members": names, **by_year(benunit)}},
        "households": {"household": {"members": names, **by_year(household)}},
    }


def national_route(answers, measures, year):
    """Net income before and after under the national route's household
    simulations, for the measures combined."""
    config = DataConfig()
    reforms = [get_reform(measure) for measure in measures]
    if len(reforms) == 1:
        reform, uses_config = reforms[0], None
    else:
        reform = combine_measures(reforms, config)
        uses_config = any(
            not member.has_custom_baseline() for member in reforms
        )
    baseline, reformed = personal_impact.household_simulations(
        situation(answers, year), reform, config, uses_config
    )
    return (
        float(baseline.calculate("household_net_income", year)[0]),
        float(reformed.calculate("household_net_income", year)[0]),
    )


# --- reform dicts ---------------------------------------------------------


def test_a_bare_year_becomes_the_fiscal_year_it_names():
    changes = {"gov.hmrc.income_tax.rates.savings.basic": {"2028": 0.20}}
    assert household_impact.py_reform_dict(changes) == {
        "gov.hmrc.income_tax.rates.savings.basic": {
            "2028-04-06.2029-04-05": 0.20
        }
    }


def test_a_calendar_year_series_keeps_its_calendar_year():
    path = "gov.economic_assumptions.yoy_growth.obr.consumer_price_index"
    assert household_impact.py_reform_dict({path: {"2028": 0.02}}) == {
        path: {"2028-01-01.2028-12-31": 0.02}
    }


def test_no_changes_is_no_reform():
    assert household_impact.py_reform_dict({}) == {}
    assert household_impact.py_reform_dict(None) == {}


# --- which measures, and which sides ---------------------------------------


def test_a_measure_with_a_simulation_modifier_is_not_modelled():
    sides = household_impact.measure_sides(
        ["rail_fares_freeze", "fuel_duty_freeze"]
    )
    assert sides.included == ["fuel_duty_freeze"]
    assert [item["id"] for item in sides.not_modelled] == ["rail_fares_freeze"]
    assert all(item["reason"] for item in sides.not_modelled)


def test_before_holds_the_pre_budget_changes_and_after_the_budget_changes():
    savings = get_reform("savings_tax_increase_2pp")
    sides = household_impact.measure_sides(["savings_tax_increase_2pp"])
    assert sides.before == household_impact.py_reform_dict(
        savings.baseline_parameter_changes
    )
    assert sides.after == household_impact.py_reform_dict(
        savings.parameter_changes
    )


@pytest.mark.parametrize(
    "measures", [["no_such_measure"], ["autumn_budget_2026_combined"], []]
)
def test_unknown_measures_and_no_measures_are_refused(measures):
    with pytest.raises(ValueError):
        household_impact.measure_sides(measures)


def test_a_measure_whose_inputs_are_all_zero_does_not_affect_the_household():
    measures = [
        "dividend_tax_increase_2pp",
        "fuel_duty_freeze",
        "threshold_freeze_extension",
    ]
    plain = Answers(employment_income=35_000)
    assert household_impact.not_affected(plain, measures) == [
        "dividend_tax_increase_2pp",
        "fuel_duty_freeze",
    ]
    with_dividends = Answers(employment_income=35_000, dividend_income=5_000)
    assert household_impact.not_affected(with_dividends, measures) == [
        "fuel_duty_freeze"
    ]


# --- the calculation --------------------------------------------------------


def test_it_asks_policyengine_py_twice(monkeypatch):
    calls = []

    def calculate_household(**kwargs):
        calls.append(kwargs)
        net = 40_000.0 + 100 * len(calls)
        return SimpleNamespace(
            household=SimpleNamespace(household_net_income=net)
        )

    monkeypatch.setattr(pe.uk, "calculate_household", calculate_household)
    sides = household_impact.measure_sides(["savings_tax_increase_2pp"])
    result = household_impact.calculate_household_impact(
        Answers(), ["savings_tax_increase_2pp"], YEAR
    )
    assert [call["year"] for call in calls] == [YEAR, YEAR]
    assert calls[0]["reform"] == sides.before
    assert calls[1]["reform"] == (sides.after or None)
    assert result["net_income"] == {
        "before": 40_100.0,
        "after": 40_200.0,
        "change": 100.0,
    }


def test_the_answer_says_which_measures_it_includes():
    result = household_impact.calculate_household_impact(
        Answers(employment_income=60_000),
        [
            "threshold_freeze_extension",
            "rail_fares_freeze",
            "fuel_duty_freeze",
        ],
        YEAR,
    )
    assert result["year"] == YEAR
    assert result["measures"]["included"] == [
        "fuel_duty_freeze",
        "threshold_freeze_extension",
    ]
    assert result["measures"]["not_affected"] == ["fuel_duty_freeze"]
    assert [item["id"] for item in result["measures"]["not_modelled"]] == [
        "rail_fares_freeze"
    ]
    assert result["versions"] == runtime_identity()["packages"]


@pytest.mark.parametrize("measure", sorted(MOVED_BY))
def test_each_measure_matches_the_national_route(measure):
    """Differential: .py's household calculation, given the measure's
    changes as dated intervals, gives the national route's net incomes to
    the penny, and the measure really moves this household."""
    answers = PROBES[MOVED_BY[measure]]
    result = household_impact.calculate_household_impact(
        answers, [measure], YEAR
    )
    before, after = national_route(answers, [measure], YEAR)
    assert result["net_income"]["before"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["after"] == pytest.approx(after, abs=0.01)
    assert abs(result["net_income"]["change"]) > 1


def test_every_modelled_measure_together_matches_the_national_route():
    """Differential: the measures merged into one pair of reform dicts give
    the national route's combined run, interactions included."""
    measures = sorted(MOVED_BY)
    result = household_impact.calculate_household_impact(
        EVERYTHING, measures, YEAR
    )
    before, after = national_route(EVERYTHING, measures, YEAR)
    assert result["net_income"]["before"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["after"] == pytest.approx(after, abs=0.01)


def test_the_household_situation_builds_in_policyengine_uk():
    """The entities are valid policyengine-uk inputs (names and entities)."""
    for answers in [*PROBES.values(), EVERYTHING]:
        Simulation(situation=situation(answers, YEAR)).calculate(
            "household_net_income", YEAR
        )


# --- the web app (served on Modal) ------------------------------------------

client = TestClient(create_app())


def test_health_names_the_versions_it_calculates_with():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "versions": runtime_identity()["packages"],
    }


REQUEST = {
    "year": YEAR,
    "policies": ["threshold_freeze_extension"],
    "household": {"age": 40, "employment_income": 60_000},
}


def test_the_app_answers_before_after_and_change():
    response = client.post("/household-impact", json=REQUEST)
    assert response.status_code == 200, response.text
    body = response.json()
    net_income = body["net_income"]
    assert net_income["change"] == pytest.approx(
        net_income["after"] - net_income["before"], abs=0.01
    )
    # The freeze keeps thresholds lower than pre-Budget law: less net income
    assert net_income["change"] < 0
    assert body["measures"]["included"] == ["threshold_freeze_extension"]


@pytest.mark.parametrize(
    "change",
    [
        {"year": 2025},
        {"year": 2032},
        {"policies": []},
        {"policies": ["no_such_measure"]},
        {"policies": ["autumn_budget_2026_combined"]},
        {"household": {"age": 12}},
        {"household": {"employment_income": -1}},
        {"household": {"region": "ATLANTIS"}},
        {"household": {"tenure": "CASTLE"}},
        {"household": {"children_ages": [3] * 11}},
        {"household": {"children_ages": [20]}},
        {"household": {"monthly_rent": -5}},
        {"household": {"has_partner": True, "partner_age": 10}},
    ],
)
def test_the_app_refuses_answers_out_of_range(change):
    request = {**REQUEST, **change}
    if "household" in change:
        request["household"] = {**REQUEST["household"], **change["household"]}
    response = client.post("/household-impact", json=request)
    assert response.status_code == 422, response.text


def test_with_no_measures_named_the_app_uses_every_measure_it_knows(
    monkeypatch,
):
    calls = []

    def calculate(answers, policies, year):
        calls.append(policies)
        return {"year": year}

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate
    )
    response = client.post(
        "/household-impact", json={"year": YEAR, "household": {}}
    )
    assert response.status_code == 200, response.text
    assert calls == [household_impact.measure_ids()]
