"""Each household skip rule against the full run, many households at a time.

``household_impact.rule_says_unaffected`` says a measure is exactly £0 for a
household and year. This runs the measure and compares: for every household
the rule covers, net income with the measure switched on must equal net
income without it, to the last bit, because the page's "not affected" status
compares the unrounded change with 0.

One ``policyengine_uk.Simulation`` can hold many households, and most of its
cost goes on building the system, not on the calculation, so
``net_incomes`` runs a whole batch of households through one side for about
the cost of one household. That makes every policy year affordable in CI.
``tests/test_household_skips.py`` holds the batch to each household run alone,
and to the calculator's own runs. It has to, because a simulation treats an
input anyone has as an input for everyone: a person without it gets the
variable's default, not its formula. ``merged_situation`` deals with the one
input where the two differ.

A rule has to hold whichever measures a reader selects, and the selection
changes a measure's own run: the run holds every other selected measure at
its pre-Budget side. So each measure with a pre-Budget side of its own (the
planned cash ISA limit) gives ``selections`` a second selection without it.
A measure the registry no longer has is run alone (``own_sides``).

Used by ``scripts/verify_household_skips.py`` (the recheck) and the tests.
"""

import json
import random
from dataclasses import dataclass, field, replace
from typing import Optional

import numpy as np

from uk_budget_data import reforms
from uk_budget_data.household_impact import (
    CALCULATOR_INPUTS,
    COUNCIL_TAX_BANDS,
    REGIONS,
    SALARY_YEAR,
    SKIP_REASONS,
    STUDENT_LOAN_PLANS,
    TENURES,
    Child,
    HouseholdAnswers,
    _side,
    household_entities,
    household_situation,
    measure_ids,
    measure_sides,
    rule_says_unaffected,
    side_scenario,
    split_calculator_inputs,
    state_education_for_everyone,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.combine import merged_changes
from uk_budget_data.reforms import get_reform

# Households the rules treat differently, by the answers each rule reads.
NAMED_HOUSEHOLDS = {
    "default": HouseholdAnswers(),
    # Reached by every conditional rule: the rules leave out only what the
    # year rules out.
    "eligible_for_every_rule": HouseholdAnswers(
        age=45,
        employment_income=11_000,
        student_loan_plan="PLAN_2",
        has_partner=True,
        partner_age=70,
        partner_employment_income=0,
        partner_student_loan_plan="PLAN_2",
        children=(Child(4),),
        region="NORTH_WEST",
        claims_universal_credit=True,
        tenure="RENT_PRIVATELY",
        monthly_rent=800,
        dividend_income=1_000,
        savings_interest_income=2_000,
        cash_isa_subscriptions=20_000,
        property_income=5_000,
        petrol_spending=1_000,
        diesel_spending=500,
        electricity_spending=1_040,
        bus_fare_spending=500,
        higher_stake_machine_losses=1_000,
        is_carer=True,
        care_hours_per_week=40,
        self_employment_receipts=2_500,
        self_employment_expenses=100,
    ),
    # On the far side of each rule's boundary, by a step: London's bus
    # fares, 65 with £20,000 in cash ISAs, a partner a year short of State
    # Pension age from 2027-28 (67), no fuel, no electricity, dividends only.
    "at_the_edge_of_every_rule": HouseholdAnswers(
        age=65,
        employment_income=30_000,
        has_partner=True,
        partner_age=66,
        region="LONDON",
        dividend_income=4_000,
        cash_isa_subscriptions=20_000,
        electricity_spending=0,
        bus_fare_spending=500,
    ),
    # Exactly the planned £12,000, under 65: nothing is left out of the ISA
    "cash_isa_at_the_planned_limit": HouseholdAnswers(
        age=40,
        employment_income=70_000,
        cash_isa_subscriptions=12_000,
    ),
    # Paying over the planned limit, with no other savings interest
    "cash_isa_saver": HouseholdAnswers(
        age=45,
        employment_income=70_000,
        cash_isa_subscriptions=20_000,
    ),
    # A Universal Credit family renting privately, with bus fares in
    # Scotland, outside the cap
    "universal_credit_family_in_scotland": HouseholdAnswers(
        age=34,
        employment_income=15_000,
        has_partner=True,
        partner_age=33,
        children=(Child(3), Child(7), Child(9)),
        region="SCOTLAND",
        claims_universal_credit=True,
        tenure="RENT_PRIVATELY",
        monthly_rent=1_400,
        bus_fare_spending=300,
    ),
    "pensioner_petrol_no_electricity": HouseholdAnswers(
        age=70,
        employment_income=0,
        private_pension_income=12_000,
        petrol_spending=600,
        electricity_spending=0,
    ),
    "low_income_pensioner_couple": HouseholdAnswers(
        age=78,
        employment_income=0,
        has_partner=True,
        partner_age=76,
        tenure="RENT_FROM_COUNCIL",
        monthly_rent=450,
        private_pension_income=1_500,
        region="WALES",
    ),
    "plan_2_with_pensioner_partner_diesel": HouseholdAnswers(
        age=24,
        employment_income=32_000,
        student_loan_plan="PLAN_2",
        has_partner=True,
        partner_age=67,
        diesel_spending=400,
    ),
    "machine_player": HouseholdAnswers(
        employment_income=30_000,
        higher_stake_machine_losses=1_000,
    ),
    "self_employed_only": HouseholdAnswers(
        age=38,
        employment_income=0,
        self_employment_receipts=1_500,
    ),
    "carer_over_the_earnings_limit": HouseholdAnswers(
        age=50,
        employment_income=12_500,
        is_carer=True,
        care_hours_per_week=35,
    ),
    "landlord": HouseholdAnswers(
        age=55,
        employment_income=60_000,
        property_income=12_000,
    ),
    # Side by side in every batch: one household states a 17-year-old's
    # education and the other leaves it to the formula. Run together without
    # ``state_education_for_everyone``, the second loses its young person.
    "young_person_left_to_the_formula": HouseholdAnswers(
        age=34,
        employment_income=15_000,
        children=(Child(17),),
        claims_universal_credit=True,
        tenure="RENT_PRIVATELY",
        monthly_rent=800,
    ),
    "young_person_in_education": HouseholdAnswers(
        children=(Child(17, True),),
    ),
}

# The values generated households draw from, per answer: each rule's
# boundaries, by a step on either side, and the form's ordinary answers.
ANSWER_VALUES = {
    "age": (18, 23, 30, 45, 58, 64, 65, 66, 67, 68, 70, 82),
    "employment_income": (
        0,
        8_000,
        12_500,
        18_000,
        30_000,
        52_000,
        99_000,
        125_000,
        160_000,
    ),
    "student_loan_plan": STUDENT_LOAN_PLANS,
    "has_partner": (False, True),
    "partner_age": (22, 35, 60, 65, 66, 67, 68, 75),
    "partner_employment_income": (0, 15_000, 40_000),
    "partner_student_loan_plan": STUDENT_LOAN_PLANS,
    "children": (
        (),
        (),
        (Child(1),),
        (Child(4), Child(9)),
        (Child(17),),
        (Child(14), Child(17, True)),
        (Child(16, False), Child(9), Child(4)),
    ),
    "region": REGIONS,
    "claims_universal_credit": (False, True),
    "tenure": TENURES,
    "monthly_rent": (0, 700, 1_200),
    "council_tax": (None, None, 0, 2_000),
    "council_tax_band": COUNCIL_TAX_BANDS,
    "monthly_childcare": (0, 0, 400),
    "salary_year": (SALARY_YEAR,),
    "dividend_income": (0, 0, 2_000, 30_000),
    "savings_interest_income": (0, 0, 1, 1_500, 20_000),
    "cash_isa_subscriptions": (0, 0, 11_999, 12_000, 12_001, 20_000),
    "property_income": (0, 0, 1, 12_000, 60_000),
    "private_pension_income": (0, 0, 8_000, 25_000),
    "partner_private_pension_income": (0, 0, 9_000),
    "petrol_spending": (0, 0, 1, 600, 2_000),
    "diesel_spending": (0, 0, 1, 400),
    "electricity_spending": (0, 1, 1_040, 1_800),
    "gas_spending": (0, 733),
    "bus_fare_spending": (0, 0, 1, 500, 1_500),
    "higher_stake_machine_losses": (0, 0, 1, 500),
    "salary_sacrifice_pension_contributions": (0, 0, 3_000),
    "state_pension": (None, None, 0, 6_000),
    "partner_state_pension": (None, None, 0, 6_000),
    "is_carer": (False, False, True),
    "care_hours_per_week": (20, 35, 60),
    "self_employment_receipts": (0, 0, 1, 1_000, 1_500, 3_000, 30_000),
    "self_employment_expenses": (0, 0, 200, 5_000),
}
# Answers generated households leave at the form's default, and why: both
# name places, valid only with the right region (the area tests cover them),
# and no rule reads them.
ANSWERS_NOT_GENERATED = frozenset({"brma", "local_authority"})


def generated_households(count: int, seed: int) -> list[HouseholdAnswers]:
    """``count`` households drawn from ``ANSWER_VALUES``, reproducibly."""
    draw = random.Random(seed)
    return [
        HouseholdAnswers(
            **{
                name: draw.choice(values)
                for name, values in ANSWER_VALUES.items()
            }
        )
        for _ in range(count)
    ]


def merged_situation(households: list, year: int) -> tuple[dict, list]:
    """The households as one policyengine-uk situation in ``year``, and each
    household's calculator inputs with its number of people. One simulation
    holds them all, so everyone gets what ``household_entities`` gives the
    people of one household: an education stage, if anyone has one."""
    entities = [household_entities(answers, year) for answers in households]
    state_education_for_everyone(
        [person for people, _, _ in entities for person in people]
    )
    merged: dict = {"people": {}, "benunits": {}, "households": {}}
    inputs_by_household = []
    for index, (people, benunit, household) in enumerate(entities):
        people, inputs = split_calculator_inputs(people)
        inputs_by_household.append((inputs, len(people)))
        situation = household_situation(people, benunit, household, year)
        renamed = {name: f"h{index}_{name}" for name in situation["people"]}
        for name, new_name in renamed.items():
            merged["people"][new_name] = situation["people"][name]
        for plural in ("benunits", "households"):
            for name, group in situation[plural].items():
                merged[plural][f"h{index}_{name}"] = {
                    **group,
                    "members": [renamed[m] for m in group["members"]],
                }
    return merged, inputs_by_household


def net_incomes(households: list, year: int, side: dict) -> list[float]:
    """Each household's net income in ``year`` on one side, in one
    simulation: ``household_impact.run_scenario``'s calculation, on
    ``merged_situation``."""
    from policyengine_uk import Simulation

    from uk_budget_data.forecast import with_forecast

    merged, inputs_by_household = merged_situation(households, year)
    simulation = Simulation(
        situation=merged, scenario=with_forecast(side_scenario(side))
    )
    variables = simulation.tax_benefit_system.variables
    for name in CALCULATOR_INPUTS:
        if name in variables and any(
            name in inputs for inputs, _ in inputs_by_household
        ):
            simulation.set_input(
                name,
                year,
                np.concatenate(
                    [
                        np.asarray(inputs.get(name, [0.0] * size), dtype=float)
                        for inputs, size in inputs_by_household
                    ]
                ),
            )
    return [
        float(value)
        for value in simulation.calculate("household_net_income", year)
    ]


def own_sides(reform: Reform) -> tuple[dict, dict]:
    """A measure's own (pre-Budget, Budget) sides, as ``measure_sides``
    gives for it alone, whether or not the registry has it."""
    sides = merged_changes([reform], DataConfig())
    return (
        _side(
            sides["baseline"]["parameter_changes"],
            sides["baseline"]["modifiers"],
        ),
        _side(
            sides["reform"]["parameter_changes"], sides["reform"]["modifiers"]
        ),
    )


def withdrawn_measures() -> dict[str, Reform]:
    """The rules whose measure the registry no longer has, ``{id: Reform}``,
    from the factories ``reforms`` keeps. Their rules cannot fire in
    production: ``household_impact.measure_sides`` refuses the measures."""
    registered = set(measure_ids())
    return {
        id_: getattr(reforms, f"_create_{id_}")()
        for id_ in SKIP_REASONS
        if id_ not in registered and hasattr(reforms, f"_create_{id_}")
    }


def selections(ids: Optional[list[str]] = None) -> dict[str, list[str]]:
    """The selections whose before sides differ: every measure; and if any
    has a pre-Budget side of its own, every measure without those."""
    ids = measure_ids() if ids is None else ids
    without = [
        id_
        for id_ in ids
        if get_reform(id_).baseline_scenario_for(DataConfig()) is None
    ]
    return {
        "every_measure": ids,
        **({"pre_budget_law_as_it_stands": without} if without != ids else {}),
    }


# The selection the check runs a withdrawn measure in.
ALONE = "alone"


@dataclass(frozen=True)
class Effect:
    """One measure's own effect on one household in one year, in one
    selection, unrounded, and what its rule says."""

    selection: str
    measure: str
    year: int
    household: int
    change: float
    rule_says_unaffected: bool

    @property
    def breaks_the_rule(self) -> bool:
        return self.rule_says_unaffected and self.change != 0


@dataclass
class YearCheck:
    """Every measure's effect on every household in one year."""

    year: int
    households: list
    effects: list = field(default_factory=list)

    def broken(self, measures=None) -> list:
        """The effects that break their rule, among ``measures``."""
        return [
            effect
            for effect in self.effects
            if effect.breaks_the_rule
            and (measures is None or effect.measure in measures)
        ]

    def of(self, measure: str, household: int, selection: str = None):
        for effect in self.effects:
            if (
                effect.measure == measure
                and effect.household == household
                and (selection is None or effect.selection == selection)
            ):
                return effect
        raise KeyError((measure, household, selection))


def _record(check, selection, measure, base, net):
    check.effects += [
        Effect(
            selection=selection,
            measure=measure,
            year=check.year,
            household=index,
            change=after - before,
            rule_says_unaffected=rule_says_unaffected(
                measure, answers, check.year
            ),
        )
        for index, (answers, before, after) in enumerate(
            zip(check.households, base, net)
        )
    ]


def check_selection(
    households: list, year: int, name: str, ids: list[str], *, check=None
) -> YearCheck:
    """Every ruled measure's own run in one selection, against its before
    side. A measure with no rule isn't run: nothing would read it."""
    check = check or YearCheck(year, households)
    sides = measure_sides(ids)
    base = net_incomes(households, year, sides.before)
    for measure in sides.included:
        if measure in SKIP_REASONS:
            _record(
                check,
                name,
                measure,
                base,
                net_incomes(households, year, sides.singles[measure]),
            )
    return check


def check_withdrawn(
    households: list, year: int, reforms: dict, *, check=None
) -> YearCheck:
    """Measures the registry no longer has, each run alone. ``reforms``:
    ``{id: Reform}``. Their rules cannot fire in production
    (``household_impact.measure_sides`` refuses the measures) and stay off
    if one comes back, until a recheck passes."""
    check = check or YearCheck(year, households)
    bases: dict = {}
    for measure, reform in reforms.items():
        before, after = own_sides(reform)
        key = json.dumps(before, sort_keys=True, default=str)
        if key not in bases:
            bases[key] = net_incomes(households, year, before)
        _record(
            check,
            ALONE,
            measure,
            bases[key],
            net_incomes(households, year, after),
        )
    return check


def check_year(households: list, year: int) -> YearCheck:
    """Every registered rule in one year, in every selection."""
    check = YearCheck(year, households)
    for name, ids in selections().items():
        check_selection(households, year, name, ids, check=check)
    return check


def describe(answers: HouseholdAnswers) -> dict:
    """The answers that differ from the form's defaults."""
    defaults = HouseholdAnswers()
    return {
        name: getattr(answers, name)
        for name in answers.__dataclass_fields__
        if getattr(answers, name) != getattr(defaults, name)
    }


def smallest_counterexample(
    effect: Effect, households: list
) -> tuple[HouseholdAnswers, float]:
    """The broken effect's household with every answer that isn't needed
    back at the form's default, and the change it still shows: the
    counterexample to read, not the one that happened to be drawn."""
    sides = _sides_of(effect)
    answers = households[effect.household]
    change = effect.change
    shrinking = True
    while shrinking:
        shrinking = False
        for name in describe(answers):
            candidate = replace(
                answers, **{name: getattr(HouseholdAnswers(), name)}
            )
            if not rule_says_unaffected(
                effect.measure, candidate, effect.year
            ):
                continue
            before = net_incomes([candidate], effect.year, sides[0])[0]
            after = net_incomes([candidate], effect.year, sides[1])[0]
            if after != before:
                answers, change = candidate, after - before
                shrinking = True
                break
    return answers, change


def _sides_of(effect: Effect) -> tuple[dict, dict]:
    if effect.selection == ALONE:
        return own_sides(withdrawn_measures()[effect.measure])
    sides = measure_sides(selections()[effect.selection])
    return sides.before, sides.singles[effect.measure]
