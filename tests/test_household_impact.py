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

from types import SimpleNamespace

import policyengine as pe
import pytest
from policyengine_uk import Simulation
from policyengine_uk.system import system

from uk_budget_data import household_impact, personal_impact
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import (
    CombineConflict,
    combine_measures,
)
from uk_budget_data.reforms import get_pre_autumn_budget_baseline, get_reform
from uk_budget_data.runtime_identity import runtime_identity

YEAR = 2029
Child = household_impact.Child
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

# The probe each modelled measure moves
MOVED_BY = {
    "two_child_limit": "uc_family",
    "fuel_duty_freeze": "petrol_30k",
    "threshold_freeze_extension": "employee_60k",
    "dividend_tax_increase_2pp": "dividends_30k",
    "savings_tax_increase_2pp": "investor_150k",
    "property_tax_increase_2pp": "investor_150k",
    "salary_sacrifice_cap": "salary_sacrifice_60k",
    "freeze_student_loan_thresholds": "graduate_35k",
}


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


def test_rail_is_not_modelled_and_says_why():
    sides = household_impact.measure_sides(
        ["rail_fares_freeze", "fuel_duty_freeze"]
    )
    assert sides.included == ["fuel_duty_freeze"]
    [rail] = sides.not_modelled
    assert rail["id"] == "rail_fares_freeze"
    assert "national figures only" in rail["reason"]


def test_the_student_loan_freeze_is_modelled():
    """Its modifier only replaces dataset values, which a household has
    none of (parity below proves the result is the same)."""
    measure = get_reform("freeze_student_loan_thresholds")
    assert measure.simulation_modifier is not None
    assert household_impact.household_modelled(measure)
    sides = household_impact.measure_sides(["freeze_student_loan_thresholds"])
    assert sides.included == ["freeze_student_loan_thresholds"]
    assert sides.not_modelled == []


def test_any_other_modifier_is_not_modelled():
    measure = Reform(
        id="x", name="x", description="x", simulation_modifier=lambda s: s
    )
    assert not household_impact.household_modelled(measure)


def test_before_holds_the_pre_budget_changes_and_after_the_budget_changes():
    savings = get_reform("savings_tax_increase_2pp")
    sides = household_impact.measure_sides(["savings_tax_increase_2pp"])
    assert sides.before == household_impact.py_reform_dict(
        savings.baseline_parameter_changes
    )
    assert sides.after == household_impact.py_reform_dict(
        savings.parameter_changes
    )
    # One measure: its single is the combined run
    assert sides.singles == {"savings_tax_increase_2pp": sides.after}


def test_a_single_holds_every_other_measure_at_pre_budget_law():
    sides = household_impact.measure_sides(
        ["savings_tax_increase_2pp", "property_tax_increase_2pp"]
    )
    savings = get_reform("savings_tax_increase_2pp")
    property_ = get_reform("property_tax_increase_2pp")
    assert sides.singles["savings_tax_increase_2pp"] == (
        household_impact.py_reform_dict(property_.baseline_parameter_changes)
    )
    assert sides.singles["property_tax_increase_2pp"] == (
        household_impact.py_reform_dict(savings.baseline_parameter_changes)
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


def _stub(net):
    member = SimpleNamespace(
        **{
            row.variable: 0.0
            for row in household_impact._all_rows()
            if row.variable
        }
    )
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
        benunit={
            row.variable: 0.0
            for row in household_impact._all_rows()
            if row.variable
        },
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
    measures = ["savings_tax_increase_2pp", "property_tax_increase_2pp"]
    sides = household_impact.measure_sides(measures)

    calculate(Answers(), measures)
    assert [call["reform"] for call in calls] == [sides.before, None]
    assert all(call["year"] == YEAR for call in calls)

    calls.clear()
    result = calculate(Answers(), measures, include=("by_policy", "sweep"))
    assert len(calls) == 6
    assert [call["reform"] for call in calls[2:4]] == [
        sides.singles[id_] for id_ in sides.included
    ]
    assert calls[4]["axes"][0]["name"] == "employment_income"
    assert calls[4]["reform"] == sides.before
    assert result["net_income"] == {
        "baseline": 40_100.0,
        "reform": 40_200.0,
        "change": 100.0,
    }
    assert result["engine"] == runtime_identity()["packages"]


# --- the calculation, parity with the national route ------------------------


@pytest.mark.parametrize("measure", sorted(MOVED_BY))
def test_each_measure_matches_the_national_route(measure):
    """Differential: .py's household calculation, given the measure's
    changes as dated intervals, gives the national route's net incomes to
    the penny (the national route applies the measure's modifiers), and
    the measure really moves this household."""
    answers = PROBES[MOVED_BY[measure]]
    result = calculate(answers, [measure])
    before, after = national_route(answers, [measure], YEAR)
    assert result["net_income"]["baseline"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=0.01)
    assert abs(result["net_income"]["change"]) > 1


def test_every_modelled_measure_together_matches_the_national_route():
    """Differential: the measures merged into one pair of reform dicts give
    the national route's combined run, interactions included."""
    measures = sorted(MOVED_BY)
    result = calculate(EVERYTHING, measures)
    before, after = national_route(EVERYTHING, measures, YEAR)
    assert result["net_income"]["baseline"] == pytest.approx(before, abs=0.01)
    assert result["net_income"]["reform"] == pytest.approx(after, abs=0.01)


# --- hand checks --------------------------------------------------------------

SINGLE_RENTER = Answers(
    employment_income=30_000,
    tenure="RENT_PRIVATELY",
    monthly_rent=900,
    region="NORTH_WEST",
)
PA = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


def pre_budget_allowance(year):
    return get_pre_autumn_budget_baseline()[PA][str(year)]


def current_law_allowance(year):
    return PARAMETERS.get_child(PA)(f"{year}-04-06")


def test_a_30k_single_renter_in_2029():
    """£30,000, single, renting, 2029-30:

    - threshold freeze: the personal allowance stays at £12,570 instead of
      rising to its pre-Budget £13,094, so £524 more is taxed at 20%:
      £104.80 less net income. National Insurance is unchanged (its
      threshold doesn't follow the allowance in 2029).
    - salary sacrifice cap: the household uses none, but the broad-base
      haircut cuts every employee's pay by 0.16%: £48 less pay, of which
      20% income tax and 8% National Insurance would have gone, so
      £48 x 0.72 = £34.56 less net income. Reported as affected (#97 said
      not affected).
    - dividend rise: no dividends, exactly £0, not affected.
    """
    measures = [
        "threshold_freeze_extension",
        "salary_sacrifice_cap",
        "dividend_tax_increase_2pp",
    ]
    result = calculate(SINGLE_RENTER, measures, include=("by_policy",))
    by_measure = changes_by_measure(result)

    allowance_rise = pre_budget_allowance(2029) - current_law_allowance(2029)
    assert allowance_rise == 524
    freeze = by_measure["threshold_freeze_extension"]
    assert freeze["change"] == pytest.approx(-0.20 * allowance_rise, abs=0.01)
    assert freeze["status"] == "affected"

    haircut_rate = PARAMETERS.gov.contrib.behavioral_responses.salary_sacrifice_broad_base_haircut_rate(  # noqa: E501
        "2029-04-06"
    )
    haircut = 30_000 * haircut_rate
    assert haircut == pytest.approx(48)
    cap = by_measure["salary_sacrifice_cap"]
    assert cap["change"] == pytest.approx(
        -haircut * (1 - 0.20 - 0.08), abs=0.01
    )
    assert cap["status"] == "affected"

    dividend = by_measure["dividend_tax_increase_2pp"]
    assert dividend["change"] == 0 and dividend["status"] == "not_affected"

    # The programmes say where the change lands
    assert programme(result, "salary_sacrifice_haircut")["change"] == -48
    assert programme(result, "income_tax")["change"] == pytest.approx(
        0.20 * allowance_rise - 0.20 * haircut, abs=0.01
    )
    assert programme(result, "national_insurance")["change"] == pytest.approx(
        -0.08 * haircut, abs=0.01
    )
    # Two linear changes on one income: nothing left over
    split = result["by_policy"]
    assert split["residual"] == pytest.approx(0, abs=0.01)
    assert split["combined"] == pytest.approx(
        split["sum_of_singles"] + split["residual"], abs=0.01
    )
    assert result["net_income"]["change"] == split["combined"]


def test_a_couple_with_three_children_on_25k_under_the_two_child_repeal():
    """£25,000 couple, three children, renting, claiming Universal Credit,
    2029-30: repealing the two-child limit adds a child element for the
    third child, £323.49 a month in 2029: £3,881.89 a year, all through
    Universal Credit (the award stays above zero, and the earnings exempt
    the family from the benefit cap)."""
    answers = Answers(
        employment_income=25_000,
        has_partner=True,
        children=(Child(2), Child(5), Child(8)),
        claims_universal_credit=True,
        tenure="RENT_PRIVATELY",
        monthly_rent=800,
        region="WEST_MIDLANDS",
    )
    result = calculate(answers, ["two_child_limit"], include=("by_policy",))
    element = PARAMETERS.gov.dwp.universal_credit.elements.child.amount(
        "2029-01-01"
    )
    expected = 12 * element
    assert expected == pytest.approx(3_881.89, abs=0.01)
    assert programme(result, "universal_credit")["baseline"] > 0
    assert programme(result, "uc_child_element")["change"] == pytest.approx(
        expected, abs=0.02
    )
    assert programme(result, "universal_credit")["change"] == pytest.approx(
        expected, abs=0.02
    )
    assert result["net_income"]["change"] == pytest.approx(expected, abs=0.02)
    [measure] = result["by_policy"]["measures"]
    assert measure["status"] == "affected"


def test_the_2031_measures_work():
    """2031-32: the freeze ends in April 2031, so the current-law allowance
    is £12,830 against a pre-Budget £13,680: £850 more taxed at 20%. In
    2031 policyengine-uk's National Insurance primary threshold follows the
    allowance, so 8% of the same £850 too (to the penny, give or take the
    weekly rounding of the threshold)."""
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
    rise = pre_budget_allowance(2031) - current_law_allowance(2031)
    assert rise == 850
    freeze = changes_by_measure(result)["threshold_freeze_extension"]
    assert freeze["change"] == pytest.approx(-(0.20 + 0.08) * rise, abs=0.05)
    assert result["year"] == 2031 and result["fiscal_year"] == "2031-32"
    assert [m["id"] for m in result["not_modelled"]] == ["rail_fares_freeze"]


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
    result = calculate(answers, ["two_child_limit"])
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
        ["two_child_limit"],
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
    default = calculate(answers, ["two_child_limit"])
    assert (
        default["area"]["brma"]
        == household_impact.DEFAULT_BRMA["EAST_OF_ENGLAND"]
    )
    assert default["area"]["brma_source"] == "region default"
    cambridge = calculate(
        Answers(**{**vars(answers), "brma": "CAMBRIDGE"}), ["two_child_limit"]
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
    default = calculate(answers, ["two_child_limit"])
    maidstone = calculate(
        Answers(**{**vars(answers), "local_authority": "MAIDSTONE"}),
        ["two_child_limit"],
    )
    assert default["area"]["local_authority"] == "MANCHESTER"
    assert default["area"]["local_authority_source"] == "region default"
    assert maidstone["area"]["local_authority_source"] == "entered"
    assert default["net_income"] == maidstone["net_income"]
    assert default["programmes"] == maidstone["programmes"]


# --- the earnings sweep ---------------------------------------------------------


def test_the_sweep_runs_from_zero_past_the_heads_income():
    answers = Answers(employment_income=100_000)
    result = calculate(
        answers, ["threshold_freeze_extension"], include=("sweep",)
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
    result = calculate(answers, ["threshold_freeze_extension"])
    salary = result["salary_used"]
    assert salary["salary_year"] == 2026
    assert salary["employment_income"] == pytest.approx(
        30_000 * household_impact.earnings_growth(2026, YEAR), abs=0.01
    )
    assert salary["employment_income"] > 30_000
    with pytest.raises(ValueError):
        calculate(
            household_impact.HouseholdAnswers(salary_year=2030),
            ["threshold_freeze_extension"],
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
