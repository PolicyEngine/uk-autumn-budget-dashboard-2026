"""One household's net income in one year before and after the Budget,
through policyengine.py.

``household_impact`` asks policyengine.py (``pe.uk.calculate_household``)
for the household's net income under the selected measures' pre-Budget
sides and under their Budget sides, under each measure switched on alone,
and across an earnings sweep. policyengine.py takes parameter changes
only, keyed by dates, so each measure's changes are read as the national
run reads them (policyengine-uk's ``read_parameter_changes``) and written
as inclusive date intervals.

The parity tests compare each result with the national route's household
simulations (``personal_impact.household_simulations``), which build
policyengine-uk's ``Scenario`` from the same measures, modifiers included.
The hand checks recompute the main changes from the parameters.
"""

import dataclasses
import json
from pathlib import Path
from types import SimpleNamespace

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

# The probe each measure the household calculation models moves, and a
# year it does. The other six candidates apply simulation modifiers, which
# the household calculation can't, and are reported as not modelled. The
# Business Asset Disposal Relief measure has no probe: the form takes no
# capital gains.
MOVED_BY = {
    "threshold_freeze_2031_32": ("employee_60k", 2031),
    "salary_sacrifice_cap_2028": ("salary_sacrifice_60k", 2028),
    "plan_2_threshold_unfreeze": ("graduate_35k", YEAR),
}
NOT_MODELLED_IDS = [
    "domestic_electricity_zero_vat",
    "employer_ni_relief_under_25s",
    "fuel_duty_rise_deferral",
    "road_fuel_vat_cut",
    "state_pension_income_tax_protection",
    "warm_home_discount_top_up",
]


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


def calculate(answers, measures, year=YEAR, include=()):
    return household_impact.calculate_household_impact(
        answers, measures, year, include=include
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


def test_a_measure_with_a_modifier_is_not_modelled_and_says_why():
    sides = household_impact.measure_sides(
        ["warm_home_discount_top_up", "threshold_freeze_2031_32"]
    )
    assert sides.included == ["threshold_freeze_2031_32"]
    [payment] = sides.not_modelled
    assert payment["id"] == "warm_home_discount_top_up"
    assert payment["reason"] == (
        household_impact.NOT_MODELLED_REASONS["warm_home_discount_top_up"]
    )
    assert "can't apply" in payment["reason"]


def test_each_measure_not_modelled_has_its_own_reason():
    sides = household_impact.measure_sides(household_impact.measure_ids())
    assert sorted(household_impact.NOT_MODELLED_REASONS) == NOT_MODELLED_IDS
    for measure in sides.not_modelled:
        assert measure["reason"] == (
            household_impact.NOT_MODELLED_REASONS[measure["id"]]
        )


def test_six_candidates_are_not_modelled_for_a_household():
    sides = household_impact.measure_sides(household_impact.measure_ids())
    assert [m["id"] for m in sides.not_modelled] == NOT_MODELLED_IDS
    assert sorted(sides.included) == sorted(
        [*MOVED_BY, "badr_lifetime_limit_cut"]
    )


def test_the_plan_2_measure_is_modelled():
    """Its modifier only replaces dataset values, which a household has
    none of (parity below proves the result is the same)."""
    measure = get_reform("plan_2_threshold_unfreeze")
    assert measure.simulation_modifier is not None
    assert household_impact.household_modelled(measure)
    sides = household_impact.measure_sides(["plan_2_threshold_unfreeze"])
    assert sides.included == ["plan_2_threshold_unfreeze"]
    assert sides.not_modelled == []


def test_any_other_modifier_is_not_modelled():
    measure = Reform(
        id="x", name="x", description="x", simulation_modifier=lambda s: s
    )
    assert not household_impact.household_modelled(measure)


def test_before_is_current_law_and_after_holds_the_budget_changes():
    freeze = get_reform("threshold_freeze_2031_32")
    sides = household_impact.measure_sides(["threshold_freeze_2031_32"])
    # The candidates are measured against current law
    assert sides.before == {}
    assert sides.after == household_impact.py_reform_dict(
        freeze.parameter_changes
    )
    # One measure: its single is the combined run
    assert sides.singles == {"threshold_freeze_2031_32": sides.after}


def test_a_single_holds_every_other_measure_at_current_law():
    sides = household_impact.measure_sides(
        ["threshold_freeze_2031_32", "badr_lifetime_limit_cut"]
    )
    freeze = get_reform("threshold_freeze_2031_32")
    badr = get_reform("badr_lifetime_limit_cut")
    assert sides.singles["threshold_freeze_2031_32"] == (
        household_impact.py_reform_dict(freeze.parameter_changes)
    )
    assert sides.singles["badr_lifetime_limit_cut"] == (
        household_impact.py_reform_dict(badr.parameter_changes)
    )


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


def _row_variables():
    for row in household_impact._all_rows():
        if row.variable:
            yield row.variable
        for pair in row.difference or ():
            yield from pair


def _stub(net):
    member = SimpleNamespace(**{name: 0.0 for name in _row_variables()})
    return SimpleNamespace(
        household=SimpleNamespace(
            household_net_income=net,
            brma="X",
            local_authority="Y",
            **{
                row.variable: 0.0
                for row in household_impact._all_rows()
                if row.entity == "household" and row.variable
            },
            **{
                name: 0.0
                for names in household_impact.GROUP_TOTALS.values()
                for name in names
            },
        ),
        benunit={name: 0.0 for name in _row_variables()},
        person=[
            {
                **vars(member),
                **{v: True for v in household_impact.DEPENDANT_VARIABLES},
            }
        ],
    )


class _Result(SimpleNamespace):
    def __getitem__(self, key):
        return getattr(self, key)


def test_the_runs_it_asks_policyengine_py_for(monkeypatch):
    """Headline: two runs. By policy: one more per measure. Sweep: two
    runs with axes over the head's employment income."""
    calls = []

    def calculate_household(**kwargs):
        calls.append(kwargs)
        net = 40_000.0 + 100 * len(calls)
        if kwargs["axes"] is not None:
            count = kwargs["axes"][0]["count"]
            return SimpleNamespace(
                household=SimpleNamespace(household_net_income=[net] * count)
            )
        stub = _stub(net)
        stub.household = _Result(**vars(stub.household))
        return stub

    monkeypatch.setattr(pe.uk, "calculate_household", calculate_household)
    measures = ["threshold_freeze_2031_32", "badr_lifetime_limit_cut"]
    sides = household_impact.measure_sides(measures)

    calculate(Answers(), measures)
    # Current law has no changes, so the baseline run takes no reform
    assert [call["reform"] for call in calls] == [None, sides.after]
    assert all(call["year"] == YEAR for call in calls)

    calls.clear()
    result = calculate(Answers(), measures, include=("by_policy", "sweep"))
    # The headline's two runs are reused (household_impact._RUNS): only the
    # singles and the sweep are asked for
    assert len(calls) == 4
    assert [call["reform"] for call in calls[0:2]] == [
        sides.singles[id_] for id_ in sides.included
    ]
    assert calls[2]["axes"][0]["name"] == "employment_income"
    # The sweep's baseline is the before side: current law, so no reform
    assert sides.before == {}
    assert calls[2]["reform"] is None
    assert result["net_income"] == {
        "baseline": 40_100.0,
        "reform": 40_200.0,
        "change": 100.0,
    }

    household_impact.clear_runs()
    calls.clear()
    calculate(Answers(), measures, include=("by_policy", "sweep"))
    assert len(calls) == 6
    assert result["engine"] == runtime_identity()["packages"]


# --- the calculation, parity with the national route ------------------------


@pytest.mark.parametrize("measure", sorted(MOVED_BY))
def test_each_measure_matches_the_national_route(measure):
    """Differential: .py's household calculation, given the measure's
    changes as dated intervals, gives the national route's net incomes to
    the penny (the national route applies the measure's modifiers), and
    the measure really moves this household."""
    name, year = MOVED_BY[measure]
    answers = probe(name, year)
    result = calculate(answers, [measure], year)
    before, after = national_route(answers, [measure], year)
    assert result["net_income"]["baseline"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=0.01)
    assert abs(result["net_income"]["change"]) > 1


@pytest.mark.parametrize("year", [2028, 2031])
def test_every_modelled_measure_together_matches_the_national_route(year):
    """Differential: the measures merged into one pair of reform dicts give
    the national route's combined run, interactions included."""
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

    - salary sacrifice cap from 2028: the household uses none, but the
      broad-base haircut cuts every employee's pay by 0.16%: £48 less pay,
      of which 20% income tax and 8% National Insurance would have gone,
      so £48 x 0.72 = £34.56 less net income. Reported as affected.
    - threshold freeze to 2031-32: nothing in 2028, exactly £0.
    - Business Asset Disposal Relief: no gains, exactly £0.
    """
    measures = [
        "salary_sacrifice_cap_2028",
        "threshold_freeze_2031_32",
        "badr_lifetime_limit_cut",
    ]
    result = calculate(SINGLE_RENTER, measures, 2028, include=("by_policy",))
    by_measure = changes_by_measure(result)

    haircut_rate = PARAMETERS.gov.contrib.behavioral_responses.salary_sacrifice_broad_base_haircut_rate(  # noqa: E501
        "2028-04-06"
    )
    haircut = 30_000 * haircut_rate
    assert haircut == pytest.approx(48)
    cap = by_measure["salary_sacrifice_cap_2028"]
    assert cap["change"] == pytest.approx(
        -haircut * (1 - 0.20 - 0.08), abs=0.01
    )
    assert cap["status"] == "affected"
    for measure in ("threshold_freeze_2031_32", "badr_lifetime_limit_cut"):
        change = by_measure[measure]
        assert change["change"] == 0 and change["status"] == "not_affected"

    # The programmes say where the change lands
    assert programme(result, "salary_sacrifice_haircut")["change"] == -48
    assert programme(result, "income_tax")["change"] == pytest.approx(
        -0.20 * haircut, abs=0.01
    )
    assert programme(result, "national_insurance")["change"] == pytest.approx(
        -0.08 * haircut, abs=0.01
    )
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
    assert [m["id"] for m in result["not_modelled"]] == NOT_MODELLED_IDS


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
