"""One household's net income in one year before and after the Budget,
on the policyengine-uk version policyengine.py pins.

``household_impact`` builds the household as policyengine.py's household
calculation does and runs each side (the selected measures' pre-Budget
sides, their Budget sides, each measure switched on alone, and an earnings
sweep) as a ``policyengine_uk.Simulation`` with the side's ``Scenario``:
its parameter changes and its measures' simulation modifiers.

The parity tests compare each result with the national route's household
simulations (``personal_impact.household_simulations``), which build
policyengine-uk's ``Scenario`` from the same measures, modifiers included.
The hand checks recompute the main changes from the parameters.
"""

import dataclasses
import json
from pathlib import Path

import policyengine as pe
import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data import household_impact, personal_impact
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    CombineConflict,
    combine_measures,
)
from uk_budget_data.reforms import get_reform
from uk_budget_data.runtime_identity import runtime_identity

YEAR = 2029
Child = household_impact.Child


@pytest.fixture(autouse=True)
def _fresh_runs():
    """Each test starts with no runs kept (household_impact._RUNS), so a
    stand-in engine is really asked."""
    household_impact.clear_runs()
    yield
    household_impact.clear_runs()


PARAMETERS = system.parameters


def Answers(**values):
    """Answers with salaries entered for the year calculated, so no
    earnings growth applies unless a test asks for it."""
    values.setdefault("salary_year", YEAR)
    return household_impact.HouseholdAnswers(**values)


# Probe households, each moved by at least one measure in 2029-30
PROBES = {
    "petrol_30k": Answers(employment_income=30_000, petrol_spending=1_500),
    "employee_60k": Answers(employment_income=60_000),
    "uc_family": Answers(
        employment_income=15_000,
        children=(Child(3), Child(7), Child(9)),
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
    "graduate_35k": Answers(
        employment_income=35_000, student_loan_plan="PLAN_2"
    ),
}

# One household that most measures move, for every measure together
EVERYTHING = Answers(
    employment_income=60_000,
    student_loan_plan="PLAN_2",
    has_partner=True,
    partner_employment_income=20_000,
    children=(Child(3), Child(7), Child(9)),
    dividend_income=20_000,
    savings_interest_income=5_000,
    property_income=10_000,
    petrol_spending=1_500,
    salary_sacrifice_pension_contributions=6_000,
)

# The probe each parameter-change measure moves, and a year it does. The
# measures with formula modifiers have their own hand checks and parity
# tests (tests/test_household_impact_all_measures.py). The Business Asset
# Disposal Relief measure has no probe: the form takes no capital gains.
MOVED_BY = {
    "threshold_freeze_2031_32": ("employee_60k", 2031),
    "plan_2_threshold_unfreeze": ("graduate_35k", YEAR),
}


def probe(name, year):
    """A probe household, its salary entered for ``year``."""
    return dataclasses.replace(PROBES[name], salary_year=year)


def situation(answers, year):
    """The same household as a policyengine-uk situation, for the national
    route's simulations."""
    people, benunit, household = household_impact.household_entities(
        answers, year
    )
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


def calculate(answers, measures, year=YEAR, include=(), **kwargs):
    return household_impact.calculate_household_impact(
        answers, measures, year, include=include, **kwargs
    )


def changes_by_measure(result):
    return {
        measure["id"]: measure for measure in result["by_policy"]["measures"]
    }


def programme(result, id_):
    for row in result["programmes"]:
        if row["id"] == id_:
            return row
        for child in row.get("children", []):
            if child["id"] == id_:
                return child
    raise KeyError(id_)


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


def test_every_measure_is_included_and_none_is_not_modelled():
    sides = household_impact.measure_sides(household_impact.measure_ids())
    assert sorted(sides.included) == sorted(household_impact.measure_ids())
    assert sides.not_modelled == []


def test_a_modifier_that_isnt_module_level_is_refused():
    with pytest.raises(ValueError, match="module-level"):
        household_impact.modifier_name(lambda sim: sim)
    name = household_impact.modifier_name(
        get_reform("road_fuel_vat_cut").simulation_modifier
    )
    assert name == "uk_budget_data.budget_measures:road_fuel_vat_cut"
    assert household_impact.resolve_modifier(name) is (
        get_reform("road_fuel_vat_cut").simulation_modifier
    )


def test_before_is_current_law_and_after_holds_the_budget_changes():
    freeze = get_reform("threshold_freeze_2031_32")
    sides = household_impact.measure_sides(["threshold_freeze_2031_32"])
    # The candidates are measured against current law
    assert sides.before == {"parameter_changes": {}, "modifiers": []}
    assert household_impact.side_scenario(sides.before) is None
    assert sides.after == {
        "parameter_changes": freeze.parameter_changes,
        "modifiers": [],
    }
    # One measure: its single is the combined run
    assert sides.singles == {"threshold_freeze_2031_32": sides.after}


def test_a_single_holds_every_other_measure_at_current_law():
    sides = household_impact.measure_sides(
        [
            "threshold_freeze_2031_32",
            "road_fuel_vat_cut",
            "plan_2_threshold_unfreeze",
        ]
    )
    freeze = get_reform("threshold_freeze_2031_32")
    plan_2 = get_reform("plan_2_threshold_unfreeze")
    student_loans = household_impact.modifier_name(
        plan_2.baseline_simulation_modifier
    )
    # The Plan 2 measure's pre-Budget side has its own modifier
    assert sides.before["modifiers"] == [student_loans]
    assert sides.singles["threshold_freeze_2031_32"] == {
        "parameter_changes": freeze.parameter_changes,
        "modifiers": [student_loans],
    }
    assert sides.singles["road_fuel_vat_cut"] == {
        "parameter_changes": {},
        "modifiers": [
            student_loans,
            "uk_budget_data.budget_measures:road_fuel_vat_cut",
        ],
    }


def test_a_single_refuses_a_budget_side_another_measure_reverts():
    path = "gov.hmrc.income_tax.rates.savings.basic"
    one = Reform(
        id="a",
        name="a",
        description="a",
        baseline_parameter_changes={},
        parameter_changes={path: {"2029": 0.3}},
    )
    other = Reform(
        id="b",
        name="b",
        description="b",
        baseline_parameter_changes={path: {"2029": 0.2}},
    )
    with pytest.raises(CombineConflict):
        household_impact._single_changes(one, [other], DataConfig())


@pytest.mark.parametrize(
    "measures", [["no_such_measure"], ["autumn_budget_2026_combined"], []]
)
def test_unknown_measures_and_no_measures_are_refused(measures):
    with pytest.raises(ValueError):
        household_impact.measure_sides(measures)


# --- the household's inputs -------------------------------------------------


def test_head_and_partner_are_claimant_and_partner_and_children_are_not():
    people, _, _ = household_impact.household_entities(
        Answers(has_partner=True, children=(Child(4), Child(19)))
    )
    assert [p["is_claimant_or_partner"] for p in people] == [
        True,
        True,
        False,
        False,
    ]


def test_a_young_persons_education_is_passed_as_entered():
    inputs = household_impact.child_inputs
    assert inputs(Child(19, in_education=True))["current_education"] == (
        "POST_SECONDARY"
    )
    assert (
        inputs(Child(19, in_education=True))[
            "age_started_or_accepted_current_education_or_training"
        ]
        < 19
    )
    assert inputs(Child(17, in_education=False))["current_education"] == (
        "NOT_IN_EDUCATION"
    )
    # Left out, or under 16, policyengine-uk decides from age
    assert "current_education" not in inputs(Child(17))
    assert "current_education" not in inputs(Child(10, in_education=False))


def test_childcare_goes_on_the_first_child_a_year():
    people, _, _ = household_impact.household_entities(
        Answers(children=(Child(2), Child(5)), monthly_childcare=500)
    )
    assert people[1]["childcare_expenses"] == 6_000
    assert "childcare_expenses" not in people[2]


def test_the_brma_and_council_tax_are_passed_only_when_entered():
    _, _, household = household_impact.household_entities(Answers())
    assert "brma" not in household
    assert household["local_authority"] == "SOUTHWARK"
    _, _, household = household_impact.household_entities(
        Answers(brma="CAMBRIDGE", local_authority="CAMBRIDGE", council_tax=2e3)
    )
    assert household["brma"] == "CAMBRIDGE"
    assert household["local_authority"] == "CAMBRIDGE"
    assert household["council_tax"] == 2_000


def test_salaries_grow_with_the_obr_average_earnings_index():
    index = PARAMETERS.gov.economic_assumptions.indices.obr.average_earnings
    growth = index("2029-01-01") / index("2026-01-01")
    answers = household_impact.HouseholdAnswers(
        employment_income=30_000,
        has_partner=True,
        partner_employment_income=10_000,
        salary_year=2026,
    )
    salary, partner = household_impact.salaries_in(answers, 2029)
    assert salary == pytest.approx(30_000 * growth)
    assert partner == pytest.approx(10_000 * growth)
    assert growth > 1
    assert household_impact.salaries_in(answers, 2026) == (30_000, 10_000)


def test_the_household_situation_builds_in_policyengine_uk():
    """The entities are valid policyengine-uk inputs (names and entities)."""
    for answers in [*PROBES.values(), EVERYTHING]:
        Simulation(situation=situation(answers, YEAR)).calculate(
            "household_net_income", YEAR
        )


# The households the reconciliation checks: between them every programme
# row the form can move
RECONCILED = {
    **{name: PROBES[name] for name in ("uc_family", "salary_sacrifice_60k")},
    "everything": EVERYTHING,
    "pensioner": Answers(
        age=72,
        employment_income=0,
        tenure="OWNED_OUTRIGHT",
        savings_interest_income=2_000,
    ),
    "scotland_uc_toddler": Answers(
        employment_income=12_000,
        children=(Child(1), Child(3)),
        region="SCOTLAND",
        claims_universal_credit=True,
        tenure="RENT_FROM_COUNCIL",
        monthly_rent=500,
        monthly_childcare=200,
    ),
}


@pytest.mark.parametrize("name", sorted(RECONCILED))
def test_the_programme_table_adds_up_to_net_income(name):
    """Income plus benefits less taxes (and pension contributions) is net
    income, before and after, so the table matches the tiles; and no
    "other" row is needed for the answers the form takes (a non-zero one
    names a missing programme row)."""
    result = calculate(RECONCILED[name], household_impact.measure_ids())
    sign = {"tax": -1, "benefit": 1, "income": 1}
    for side in ("baseline", "reform"):
        table = sum(
            sign[row["group"]] * row[side] for row in result["programmes"]
        )
        assert table == pytest.approx(
            result["net_income"][side], abs=0.05
        ), side
        others = {
            row["id"]: row[side]
            for row in result["programmes"]
            if row["id"].startswith("other_")
        }
        assert all(abs(value) < 1 for value in others.values()), others


# --- the calculation, mocked --------------------------------------------------


def test_the_runs_it_asks_for(monkeypatch):
    """Headline: two runs. By policy: one more per measure. Sweep: two
    runs with axes over the head's employment income."""
    calls = []

    def run_scenario(
        people, benunit, household, year, side, axes=None, only=False
    ):
        calls.append({"year": year, "side": side, "axes": axes})
        net = 40_000.0 + 100 * len(calls)
        if axes is not None:
            return {"household_net_income": [net] * axes[0]["count"]}
        if only:
            return {"household_net_income": net}
        return {
            "household_net_income": net,
            "rows": {row.id: 0.0 for row in household_impact._all_rows()},
            "dependants": [
                {v: True for v in household_impact.DEPENDANT_VARIABLES}
            ],
            "brma": "X",
            "local_authority": "Y",
        }

    monkeypatch.setattr(household_impact, "run_scenario", run_scenario)
    measures = ["threshold_freeze_2031_32", "road_fuel_vat_cut"]
    sides = household_impact.measure_sides(measures)

    calculate(Answers(), measures)
    assert [call["side"] for call in calls] == [sides.before, sides.after]
    assert all(call["year"] == YEAR for call in calls)

    calls.clear()
    # Every measure run (skip_unaffected=False); the skips have their own
    # test below
    result = calculate(
        Answers(),
        measures,
        include=("by_policy", "sweep"),
        skip_unaffected=False,
    )
    # The headline's two runs are reused (household_impact._RUNS): only the
    # singles and the sweep are asked for
    assert len(calls) == 4
    assert [call["side"] for call in calls[0:2]] == [
        sides.singles[id_] for id_ in sides.included
    ]
    assert calls[2]["axes"][0]["name"] == "employment_income"
    assert calls[2]["side"] == sides.before
    assert result["net_income"] == {
        "baseline": 40_100.0,
        "reform": 40_200.0,
        "change": 100.0,
    }

    household_impact.clear_runs()
    calls.clear()
    calculate(
        Answers(),
        measures,
        include=("by_policy", "sweep"),
        skip_unaffected=False,
    )
    assert len(calls) == 6
    assert result["engine"] == runtime_identity()["packages"]


def test_parameter_change_measures_match_policyengine_py_household_calc():
    """For a measure of parameter changes alone, the route's simulation
    gives what policyengine.py's household calculation gives, given the
    changes as dated intervals (``py_reform_dict``)."""
    measure = "threshold_freeze_2031_32"
    answers = probe("employee_60k", 2031)
    result = calculate(answers, [measure], 2031)
    people, benunit, household = household_impact.household_entities(
        answers, 2031
    )
    py = pe.uk.calculate_household(
        people=people,
        benunit=benunit,
        household=household,
        year=2031,
        reform=household_impact.py_reform_dict(
            get_reform(measure).parameter_changes
        ),
    )
    assert result["net_income"]["reform"] == pytest.approx(
        py.household.household_net_income, abs=0.01
    )


# --- the calculation, parity with the national route ------------------------


@pytest.mark.parametrize("measure", sorted(MOVED_BY))
def test_each_measure_matches_the_national_route(measure):
    """Differential: the route gives the national route's net incomes to
    the penny, and the measure really moves this household."""
    name, year = MOVED_BY[measure]
    answers = probe(name, year)
    result = calculate(answers, [measure], year)
    before, after = national_route(answers, [measure], year)
    assert result["net_income"]["baseline"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=0.01)
    assert abs(result["net_income"]["change"]) > 1


@pytest.mark.parametrize("year", [2028, 2031])
def test_every_modelled_measure_together_matches_the_national_route(year):
    """Differential: the measures merged into one pair of sides give the
    national route's combined run, interactions included."""
    measures = sorted([*MOVED_BY, "badr_lifetime_limit_cut"])
    answers = dataclasses.replace(EVERYTHING, salary_year=year)
    result = calculate(answers, measures, year)
    before, after = national_route(answers, measures, year)
    assert result["net_income"]["baseline"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=0.01)
    assert abs(result["net_income"]["change"]) > 1


# --- hand checks --------------------------------------------------------------

SINGLE_RENTER = Answers(
    employment_income=30_000,
    tenure="RENT_PRIVATELY",
    monthly_rent=900,
    region="NORTH_WEST",
    salary_year=2028,
)


def test_a_30k_single_renter_in_2028():
    """£30,000, single, renting, 2028-29:

    - threshold freeze to 2031-32: nothing in 2028, exactly £0.
    - Business Asset Disposal Relief: no gains, exactly £0.
    """
    measures = ["threshold_freeze_2031_32", "badr_lifetime_limit_cut"]
    result = calculate(SINGLE_RENTER, measures, 2028, include=("by_policy",))
    by_measure = changes_by_measure(result)
    for measure in measures:
        change = by_measure[measure]
        assert change["change"] == 0 and change["status"] == "not_affected"
    assert result["net_income"]["change"] == 0
    split = result["by_policy"]
    assert split["residual"] == pytest.approx(0, abs=0.01)
    assert result["net_income"]["change"] == split["combined"]


def test_a_graduate_on_35k_under_the_plan_2_unfreeze():
    """£35,000 on Plan 2 in 2029-30: the threshold is £32,016 (RPI from
    £29,385) instead of £29,385, so 9% of £2,631 less is repaid:
    £236.79 more net income."""
    measure = get_reform("plan_2_threshold_unfreeze")
    unfrozen = measure.parameter_changes[
        "gov.hmrc.student_loans.thresholds.plan_2"
    ]["2029"]
    assert unfrozen == 32_016
    result = calculate(
        probe("graduate_35k", YEAR),
        ["plan_2_threshold_unfreeze"],
        include=("by_policy",),
    )
    assert result["net_income"]["change"] == pytest.approx(
        0.09 * (32_016 - 29_385), abs=0.01
    )
    [change] = result["by_policy"]["measures"]
    assert change["status"] == "affected"


def test_the_2031_measures_work():
    """2031-32: the freeze holds the allowance at £12,570 against the
    current-law £12,830: £260 more taxed at 20%. In 2031 policyengine-uk's
    National Insurance primary threshold follows the allowance, so 8% of
    the same £260 too (to the penny, give or take the weekly rounding of
    the threshold)."""
    answers = Answers(
        employment_income=30_000,
        salary_year=2031,
        tenure="RENT_PRIVATELY",
        monthly_rent=900,
        region="NORTH_WEST",
    )
    result = calculate(
        answers, household_impact.measure_ids(), 2031, include=("by_policy",)
    )
    freeze = changes_by_measure(result)["threshold_freeze_2031_32"]
    assert freeze["change"] == pytest.approx(-(0.20 + 0.08) * 260, abs=0.05)
    assert result["year"] == 2031 and result["fiscal_year"] == "2031-32"
    assert result["not_modelled"] == []


# --- dependants ---------------------------------------------------------------


def test_a_19_year_old_is_never_the_partner():
    """Left to presume relationships from ages, policyengine-uk reads a
    19-year-old with a 30-year-old parent as the partner (#97's bug)."""
    answers = Answers(
        age=30,
        employment_income=15_000,
        children=(Child(17), Child(19, in_education=True)),
        claims_universal_credit=True,
    )
    result = calculate(answers, ["plan_2_threshold_unfreeze"])
    seventeen, nineteen = result["dependants"]
    assert not seventeen["claimant_or_partner"]
    assert not nineteen["claimant_or_partner"]
    assert seventeen["counts_for_child_benefit"]
    assert seventeen["counts_for_universal_credit"]
    # In school at 19: Child Benefit until 20, Universal Credit not past the
    # 1 September after their 19th birthday
    assert nineteen["counts_for_child_benefit"]
    assert not nineteen["counts_for_universal_credit"]
    assert "19th birthday" in result["dependants_note"]


def test_a_19_year_old_at_university_is_not_a_dependant():
    result = calculate(
        Answers(age=45, children=(Child(19, in_education=False),)),
        ["plan_2_threshold_unfreeze"],
    )
    [nineteen] = result["dependants"]
    assert not nineteen["counts_for_child_benefit"]
    assert not nineteen["counts_for_universal_credit"]
    assert programme(result, "child_benefit")["baseline"] == 0


# --- rent area ----------------------------------------------------------------


def test_rent_support_uses_the_entered_brma_or_the_regions_default():
    answers = Answers(
        employment_income=10_000,
        tenure="RENT_PRIVATELY",
        monthly_rent=2_000,
        claims_universal_credit=True,
        region="EAST_OF_ENGLAND",
    )
    default = calculate(answers, ["plan_2_threshold_unfreeze"])
    assert (
        default["area"]["brma"]
        == household_impact.DEFAULT_BRMA["EAST_OF_ENGLAND"]
    )
    assert default["area"]["brma_source"] == "region default"
    cambridge = calculate(
        Answers(**{**vars(answers), "brma": "CAMBRIDGE"}),
        ["plan_2_threshold_unfreeze"],
    )
    assert cambridge["area"] == {
        **default["area"],
        "brma": "CAMBRIDGE",
        "brma_source": "entered",
    }
    # A capped rent: the area's Local Housing Allowance sets the support
    housing = "uc_housing_costs_element"
    assert (
        programme(cambridge, housing)["baseline"]
        != programme(default, housing)["baseline"]
    )


# The working-age Council Tax Reduction schemes policyengine-uk chooses by
# local authority (council_tax_reduction/config.py)
LOCAL_AUTHORITY_SCHEMES = {
    "KINGSTON_UPON_THAMES",
    "MERTON",
    "NEWHAM",
    "OXFORD",
    "WESTMINSTER",
}


def test_every_region_defaults_to_a_local_authority_in_its_default_brma():
    """Not policyengine-uk's Maidstone for every region: a local authority
    of the region's default BRMA, and never one whose own Council Tax
    Reduction scheme the model simulates."""
    defaults = household_impact.DEFAULT_LOCAL_AUTHORITY
    assert set(defaults) == set(household_impact.REGIONS)
    assert set(defaults.values()) <= set(household_impact.LOCAL_AUTHORITIES)
    assert not set(defaults.values()) & LOCAL_AUTHORITY_SCHEMES
    assert defaults["NORTH_WEST"] == "MANCHESTER"
    assert household_impact.DEFAULT_BRMA["NORTH_WEST"] == (
        "CENTRAL_GREATER_MANCHESTER"
    )
    for region, authority in defaults.items():
        _, _, household = household_impact.household_entities(
            Answers(region=region)
        )
        assert household["local_authority"] == authority


@pytest.mark.parametrize("council_tax", [0, 2_000])
def test_the_default_local_authority_changes_no_result(council_tax):
    """A working-age renter on Universal Credit, the household a local
    scheme could reach: the same answer under the region's default local
    authority as under policyengine-uk's own default, Maidstone."""
    answers = Answers(
        employment_income=12_000,
        tenure="RENT_PRIVATELY",
        monthly_rent=800,
        claims_universal_credit=True,
        region="NORTH_WEST",
        council_tax=council_tax,
    )
    default = calculate(answers, ["plan_2_threshold_unfreeze"])
    maidstone = calculate(
        Answers(**{**vars(answers), "local_authority": "MAIDSTONE"}),
        ["plan_2_threshold_unfreeze"],
    )
    assert default["area"]["local_authority"] == "MANCHESTER"
    assert default["area"]["local_authority_source"] == "region default"
    assert maidstone["area"]["local_authority_source"] == "entered"
    assert default["net_income"] == maidstone["net_income"]
    assert default["programmes"] == maidstone["programmes"]


# --- the State Pension -------------------------------------------------------

NEW_STATE_PENSION = "gov.dwp.state_pension.new_state_pension.amount"
STATE_PENSION_JSON = (
    Path(household_impact.__file__).parent / "state_pension.json"
)


def test_the_full_new_state_pension_is_the_models_parameter():
    weekly = PARAMETERS.get_child(NEW_STATE_PENSION)
    for year in POLICY_YEARS:
        assert household_impact.full_new_state_pension(year) == (
            pytest.approx(weekly(f"{year}-01-01") * 52)
        )


@pytest.mark.parametrize("year", POLICY_YEARS)
def test_state_pension_age_is_the_models(year):
    age = household_impact.state_pension_age(year)

    def over(person_age):
        return bool(
            Simulation(
                situation={
                    "people": {"p": {"age": {year: person_age}}},
                    "benunits": {"b": {"members": ["p"]}},
                    "households": {"h": {"members": ["p"]}},
                }
            ).calculate("is_SP_age", year)[0]
        )

    assert over(age) and not over(age - 1)


def test_the_pages_state_pension_table_is_the_models():
    """The wizard's copy (state_pension.json) of the age and the rate."""
    table = json.loads(STATE_PENSION_JSON.read_text())["years"]
    assert sorted(int(year) for year in table) == list(POLICY_YEARS)
    for year in POLICY_YEARS:
        row = table[str(year)]
        assert row["state_pension_age"] == household_impact.state_pension_age(
            year
        )
        assert row["full_new_state_pension"] == round(
            household_impact.full_new_state_pension(year), 2
        )


def test_the_state_pension_is_entered_only_at_state_pension_age():
    age = household_impact.state_pension_age(YEAR)
    full = household_impact.full_new_state_pension(YEAR)
    people, _, _ = household_impact.household_entities(
        Answers(age=age, has_partner=True, partner_age=age - 1), YEAR
    )
    assert people[0]["state_pension_reported"] == pytest.approx(full)
    assert "state_pension_reported" not in people[1]
    people, _, _ = household_impact.household_entities(
        Answers(
            age=75,
            state_pension=9_000,
            has_partner=True,
            partner_age=80,
            partner_state_pension=None,
        ),
        YEAR,
    )
    assert people[0]["state_pension_reported"] == 9_000
    assert people[1]["state_pension_reported"] == pytest.approx(full)
    # A single pensioner is one person: the partner's answers stay unused
    people, _, _ = household_impact.household_entities(Answers(age=72), YEAR)
    assert len(people) == 1
    # An amount entered under State Pension age is not used
    people, _, _ = household_impact.household_entities(
        Answers(age=40, state_pension=9_000), YEAR
    )
    assert "state_pension_reported" not in people[0]


def test_a_pensioner_gets_the_full_new_state_pension_not_pension_credit():
    """A 72-year-old with £2,000 savings interest and £1,000 dividends:
    before, with no State Pension entered, policyengine-uk paid £13,172 of
    Pension Credit instead. Now the full new State Pension, and too much
    income for Pension Credit."""
    answers = Answers(
        age=72,
        employment_income=0,
        region="SOUTH_WEST",
        tenure="OWNED_OUTRIGHT",
        savings_interest_income=2_000,
        dividend_income=1_000,
    )
    result = calculate(answers, ["badr_lifetime_limit_cut"])
    full = household_impact.full_new_state_pension(YEAR)
    assert programme(result, "state_pension")["baseline"] == pytest.approx(
        full, abs=0.01
    )
    assert programme(result, "pension_credit")["baseline"] == 0
    used = result["state_pension_used"]
    assert used["state_pension"] == pytest.approx(full, abs=0.01)
    assert used["partner_state_pension"] is None
    assert used["state_pension_age"] == household_impact.state_pension_age(
        YEAR
    )
    # Dividends over the £500 allowance are taxed: the State Pension uses
    # the Personal Allowance, and savings interest is in the starting rate
    assert programme(result, "income_tax")["baseline"] > 0
    entered = calculate(
        Answers(**{**vars(answers), "state_pension": 9_000}),
        ["badr_lifetime_limit_cut"],
    )
    assert programme(entered, "state_pension")["baseline"] == (
        pytest.approx(9_000, abs=0.01)
    )


# --- the earnings sweep ---------------------------------------------------------


def test_the_sweep_runs_from_zero_past_the_heads_income():
    answers = Answers(employment_income=100_000)
    result = calculate(
        answers, ["threshold_freeze_2031_32"], include=("sweep",)
    )
    sweep = result["sweep"]
    points = sweep["points"]
    assert len(points) == household_impact.SWEEP_POINTS
    assert points[0]["employment_income"] == 0
    assert points[-1]["employment_income"] == 200_000
    assert len(sweep["marginal_rates"]) == len(points) - 1
    own = sweep["own_point"]
    assert own["employment_income"] == 100_000
    assert own["baseline"] == result["net_income"]["baseline"]
    # £100k-£125k: the allowance taper makes the marginal rate 60%, plus
    # 2% National Insurance
    taper = [
        rate
        for rate in sweep["marginal_rates"]
        if rate["from"] >= 101_000 and rate["to"] <= 124_000
    ]
    assert taper and all(
        rate["baseline"] == pytest.approx(0.62, abs=0.005) for rate in taper
    )
    assert result["by_policy"] is None


def test_salary_in_the_chosen_year_is_returned():
    answers = household_impact.HouseholdAnswers(employment_income=30_000)
    result = calculate(answers, ["threshold_freeze_2031_32"])
    salary = result["salary_used"]
    assert salary["salary_year"] == 2026
    assert salary["employment_income"] == pytest.approx(
        30_000 * household_impact.earnings_growth(2026, YEAR), abs=0.01
    )
    assert salary["employment_income"] > 30_000
    with pytest.raises(ValueError):
        calculate(
            household_impact.HouseholdAnswers(salary_year=2030),
            ["threshold_freeze_2031_32"],
        )


def test_the_education_stage_by_age_is_policyengine_uks():
    """``education_by_age`` mirrors ``current_education``'s formula, used
    when one person's stage is entered and the engine stops computing it
    for the rest."""
    ages = list(range(0, 31))
    people = [{"age": age} for age in ages]
    result = pe.uk.calculate_household(
        people=people, year=YEAR, extra_variables=["current_education"]
    )
    assert [person["current_education"] for person in result.person] == [
        household_impact.education_by_age(age) for age in ages
    ]


def test_one_entered_stage_leaves_the_others_as_the_engine_derives_them():
    people, _, _ = household_impact.household_entities(
        Answers(children=(Child(17), Child(19, in_education=True)))
    )
    assert [p["current_education"] for p in people] == [
        "NOT_IN_EDUCATION",
        "POST_SECONDARY",
        "POST_SECONDARY",
    ]


# --- QA fixes: private pension, benefit cap, Council Tax, education --------


def _programme(result, id_):
    for row in result["programmes"]:
        if row["id"] == id_:
            return row
        for child in row.get("children", []):
            if child["id"] == id_:
                return child
    raise KeyError(id_)


def _rows_add_up(result):
    """Each group's top rows add up to what policyengine-uk counts, so the
    rows make net income on both sides."""
    for side in ("baseline", "reform"):
        totals = {"tax": 0.0, "benefit": 0.0, "income": 0.0}
        for row in result["programmes"]:
            totals[row["group"]] += row[side]
        net = totals["income"] + totals["benefit"] - totals["tax"]
        assert net == pytest.approx(result["net_income"][side], abs=0.05)


def test_a_private_pension_is_income_the_qa_pensioner_couple():
    """The QA's pensioner couple (70 and 68, the full new State Pension
    each) with a £10,000 private pension: £10,000 less £2,000 basic-rate
    tax on top of their £25,907.11, as an independent policyengine-uk run
    and the public API give: £33,907.11."""
    answers = household_impact.HouseholdAnswers(
        age=70,
        employment_income=0,
        has_partner=True,
        partner_age=68,
        private_pension_income=10_000,
        region="NORTH_WEST",
        tenure="OWNED_OUTRIGHT",
        council_tax=0,
        salary_year=2027,
    )
    result = household_impact.calculate_household_impact(
        answers, household_impact.measure_ids(), 2027, include=()
    )
    assert result["net_income"]["baseline"] == pytest.approx(33_907.11)
    assert _programme(result, "private_pension_income")["baseline"] == 10_000
    assert _programme(result, "other_income")["baseline"] == 0
    _rows_add_up(result)
    people, _, _ = household_impact.household_entities(
        Answers(
            has_partner=True,
            private_pension_income=1_000,
            partner_private_pension_income=2_000,
        )
    )
    assert [p["private_pension_income"] for p in people] == [1_000, 2_000]


# The two-child limit's repeal, measured against the limit of two: no
# candidate measure raises a benefit, so the benefit cap tests register this
# one for themselves.
TWO_CHILD_LIMIT = Reform(
    id="two_child_limit",
    name="2 child limit repeal",
    baseline_parameter_changes={
        path: {str(year): 2 for year in POLICY_YEARS}
        for path in (
            "gov.dwp.tax_credits.child_tax_credit.limit.child_count",
            "gov.dwp.universal_credit.elements.child.limit.child_count",
        )
    },
    parameter_changes={},
)


@pytest.fixture
def two_child_limit(monkeypatch):
    registered = household_impact.get_autumn_budget_2026_reforms()
    monkeypatch.setattr(
        household_impact,
        "get_autumn_budget_2026_reforms",
        lambda: [*registered, TWO_CHILD_LIMIT],
    )
    get_registered = household_impact.get_reform
    monkeypatch.setattr(
        household_impact,
        "get_reform",
        lambda id_: (
            TWO_CHILD_LIMIT
            if id_ == TWO_CHILD_LIMIT.id
            else get_registered(id_)
        ),
    )
    return TWO_CHILD_LIMIT.id


def test_the_benefit_cap_is_its_own_row_so_a_capped_family_reconciles(
    two_child_limit,
):
    """The QA's E3b: a London couple with no earnings and six children,
    capped. Lifting the two-child limit raises the child element by four
    children's, the benefit cap takes it all back, and every row adds up."""
    answers = Answers(
        age=35,
        employment_income=0,
        has_partner=True,
        partner_age=35,
        children=tuple(Child(age) for age in (14, 12, 10, 8, 6, 4)),
        region="LONDON",
        tenure="RENT_PRIVATELY",
        monthly_rent=2_500,
        claims_universal_credit=True,
        council_tax=0,
    )
    result = calculate(answers, [two_child_limit])
    child = _programme(result, "uc_child_element")["change"]
    cap = _programme(result, "benefit_cap")
    assert child > 10_000
    assert cap["change"] == pytest.approx(-child, abs=0.02)
    # Each row is rounded to the penny on its own
    assert _programme(result, "universal_credit")["change"] == pytest.approx(
        child, abs=0.02
    )
    assert result["net_income"]["change"] == pytest.approx(0, abs=0.01)
    assert cap["baseline"] < 0
    _rows_add_up(result)


def test_an_uncapped_family_has_no_benefit_cap(two_child_limit):
    result = calculate(PROBES["uc_family"], [two_child_limit])
    assert _programme(result, "benefit_cap")["baseline"] == 0
    assert _programme(result, "benefit_cap")["reform"] == 0
    _rows_add_up(result)


def test_council_tax_is_estimated_from_the_band_and_region():
    # 2026-27: the region's average Band D times the band's ratio
    nw = household_impact.COUNCIL_TAX_BAND_D["NORTH_WEST"]
    assert household_impact.estimated_council_tax(
        "NORTH_WEST", "D", 2026
    ) == pytest.approx(nw, abs=0.01)
    assert household_impact.estimated_council_tax(
        "NORTH_WEST", "A", 2026
    ) == pytest.approx(nw * 6 / 9, abs=0.01)
    assert household_impact.estimated_council_tax(
        "NORTH_WEST", "H", 2026
    ) == pytest.approx(nw * 2, abs=0.01)
    # Scotland's upper bands since 2017
    scot = household_impact.COUNCIL_TAX_BAND_D["SCOTLAND"]
    assert household_impact.estimated_council_tax(
        "SCOTLAND", "H", 2026
    ) == pytest.approx(scot * 882 / 360, abs=0.01)
    # Band I is Welsh only
    wales = household_impact.COUNCIL_TAX_BAND_D["WALES"]
    assert household_impact.estimated_council_tax(
        "WALES", "I", 2026
    ) == pytest.approx(wales * 21 / 9, abs=0.01)
    # Northern Ireland: domestic rates, no Council Tax
    assert (
        household_impact.estimated_council_tax("NORTHERN_IRELAND", "D", 2029)
        == 0
    )
    # Grown with policyengine-uk's own Council Tax series
    growth = PARAMETERS.gov.economic_assumptions.yoy_growth.obr.council_tax
    factor = (1 + growth.england("2027-01-01")) * (
        1 + growth.england("2028-01-01")
    )
    assert household_impact.estimated_council_tax(
        "NORTH_WEST", "D", 2028
    ) == pytest.approx(nw * factor, abs=0.01)


def test_the_estimated_council_tax_is_taken_off_net_income():
    estimated = calculate(
        Answers(region="NORTH_WEST"), ["threshold_freeze_2031_32"]
    )
    none = calculate(
        Answers(region="NORTH_WEST", council_tax=0),
        ["threshold_freeze_2031_32"],
    )
    tax = _programme(estimated, "council_tax")["baseline"]
    assert tax == pytest.approx(
        household_impact.estimated_council_tax("NORTH_WEST", "D", YEAR)
    )
    assert estimated["council_tax_used"]["source"] == "estimated"
    assert none["council_tax_used"]["source"] == "entered"
    assert estimated["net_income"]["baseline"] == pytest.approx(
        none["net_income"]["baseline"] - tax, abs=0.01
    )
    _rows_add_up(estimated)


def test_a_young_person_in_school_counts_as_a_child():
    """The QA's E4: a £20,000 renter with an 18-year-old. In school or
    college the child counts for Child Benefit and Universal Credit; left
    to policyengine-uk's default (university) they do not."""
    base = dict(
        employment_income=20_000,
        tenure="RENT_PRIVATELY",
        monthly_rent=750,
        claims_universal_credit=True,
        council_tax=0,
    )
    school = calculate(
        Answers(**base, children=(Child(18, in_education=True),)),
        ["threshold_freeze_2031_32"],
    )
    default = calculate(
        Answers(**base, children=(Child(18),)), ["threshold_freeze_2031_32"]
    )
    assert school["dependants"][0]["counts_for_child_benefit"]
    assert school["dependants"][0]["counts_for_universal_credit"]
    assert not default["dependants"][0]["counts_for_child_benefit"]
    assert school["net_income"]["baseline"] > (
        default["net_income"]["baseline"] + 5_000
    )


def test_modal_runner_sends_every_run_to_fan_out_and_keeps_their_order(
    monkeypatch,
):
    """HOUSEHOLD_RUNNER=modal: _run_all hands the runs it has no answer for
    to modal_household.fan_out, in order, and puts the answers back where
    each run was asked for (the module's fan-out stands in here)."""
    import sys
    import types

    household_impact.clear_runs()
    sent = []

    def fan_out(jobs):
        sent.append(list(jobs))
        return [{"household_net_income": float(i)} for i in range(len(jobs))]

    monkeypatch.setenv("HOUSEHOLD_RUNNER", "modal")
    monkeypatch.setitem(
        sys.modules,
        "uk_budget_data.modal_household",
        types.SimpleNamespace(fan_out=fan_out),
    )
    jobs = [("job", i) for i in range(5)]
    results = household_impact._run_all(jobs, workers=8)
    assert sent == [jobs]
    assert [r["household_net_income"] for r in results] == [0, 1, 2, 3, 4]
    # Kept like any other run: asked again, nothing is sent
    assert household_impact._run_all(jobs[:2], workers=8) == results[:2]
    assert sent == [jobs]
    household_impact.clear_runs()


def test_runs_that_cannot_change_the_household_are_not_asked_for(monkeypatch):
    """By policy: a measure provably_unaffected for this household and year
    is not run, and shows exactly as its run would (£0, not affected)."""
    calls = []

    def run_scenario(
        people, benunit, household, year, side, axes=None, only=False
    ):
        calls.append(side)
        net = 40_000.0 + 100 * len(calls)
        if only:
            return {"household_net_income": net}
        return {
            "household_net_income": net,
            "rows": {row.id: 0.0 for row in household_impact._all_rows()},
            "dependants": [
                {v: True for v in household_impact.DEPENDANT_VARIABLES}
            ],
            "brma": "X",
            "local_authority": "Y",
        }

    household_impact.clear_runs()
    monkeypatch.setattr(household_impact, "run_scenario", run_scenario)
    # In 2029 the freeze (from 2031-32) and the employer NI relief (an
    # employer cost) cannot move the household; Plan 2 can, for a Plan 2
    # borrower.
    measures = [
        "threshold_freeze_2031_32",
        "employer_ni_relief_under_25s",
        "plan_2_threshold_unfreeze",
    ]
    sides = household_impact.measure_sides(measures)
    answers = Answers(student_loan_plan="PLAN_2")
    result = calculate(answers, measures, include=("by_policy",))
    assert calls == [
        sides.before,
        sides.after,
        sides.singles["plan_2_threshold_unfreeze"],
    ]
    by_id = changes_by_measure(result)
    for id_ in ("threshold_freeze_2031_32", "employer_ni_relief_under_25s"):
        assert by_id[id_]["change"] == 0
        assert by_id[id_]["status"] == "not_affected"
    assert by_id["plan_2_threshold_unfreeze"]["status"] == "affected"
    household_impact.clear_runs()


@pytest.mark.parametrize(
    "measure, answers, year, expected",
    [
        ("employer_ni_relief_under_25s", {}, 2027, True),
        ("warm_home_discount_top_up", {}, 2026, False),
        ("warm_home_discount_top_up", {}, 2027, True),
        ("threshold_freeze_2031_32", {}, 2030, True),
        ("threshold_freeze_2031_32", {}, 2031, False),
        ("plan_2_threshold_unfreeze", {}, 2027, True),
        (
            "plan_2_threshold_unfreeze",
            {"student_loan_plan": "PLAN_2"},
            2027,
            False,
        ),
        (
            "plan_2_threshold_unfreeze",
            {"has_partner": True, "partner_student_loan_plan": "PLAN_2"},
            2027,
            False,
        ),
        ("state_pension_income_tax_protection", {"age": 40}, 2027, True),
        ("state_pension_income_tax_protection", {"age": 70}, 2027, False),
        (
            "state_pension_income_tax_protection",
            {"has_partner": True, "partner_age": 70},
            2027,
            False,
        ),
        ("badr_lifetime_limit_cut", {}, 2027, True),
        ("fuel_duty_rise_deferral", {}, 2027, True),
        ("fuel_duty_rise_deferral", {"petrol_spending": 600}, 2030, False),
        ("road_fuel_vat_cut", {"diesel_spending": 400}, 2027, False),
        ("road_fuel_vat_cut", {"diesel_spending": 400}, 2028, True),
        ("domestic_electricity_zero_vat", {}, 2027, False),
        (
            "domestic_electricity_zero_vat",
            {"electricity_spending": 0},
            2027,
            True,
        ),
        ("domestic_electricity_zero_vat", {}, 2028, True),
        ("some_future_measure", {}, 2027, False),
    ],
)
def test_provably_unaffected_rules(measure, answers, year, expected):
    assert (
        household_impact.provably_unaffected(measure, Answers(**answers), year)
        is expected
    )


@pytest.mark.slow
@pytest.mark.parametrize("year", [2027, 2029, 2031])
def test_skips_give_the_same_answer_as_running_every_measure(year):
    """With the engine: the split by policy with skips is identical to the
    one running every measure, for households the rules treat differently
    (scratchpad verification ran 40 generated households x every year)."""
    households = [
        Answers(),
        Answers(
            age=70,
            private_pension_income=12_000,
            petrol_spending=600,
            electricity_spending=0,
        ),
        Answers(
            age=24,
            employment_income=32_000,
            student_loan_plan="PLAN_2",
            has_partner=True,
            partner_age=67,
            diesel_spending=400,
        ),
    ]
    measures = household_impact.measure_ids()
    for answers in households:
        household_impact.clear_runs()
        full = calculate(
            answers, measures, year, ("by_policy",), skip_unaffected=False
        )
        household_impact.clear_runs()
        fast = calculate(answers, measures, year, ("by_policy",))
        assert fast == full
    household_impact.clear_runs()
