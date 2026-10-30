"""The household calculator's caring answers: whether the head looks after
someone, unpaid, and for how many hours a week (policyengine-uk's
``care_hours``).

A household that is not a carer is built, run and answered exactly as
before the form asked; a carer of 35 hours or more gets Carer's Allowance
under its earnings limit and the Universal Credit carer element, and the
Carer's Allowance taper is no longer skipped for them from 2030-31.
Household simulations only, no dataset.
"""

import dataclasses

import pytest

from uk_budget_data import api, household_impact
from uk_budget_data.api import HouseholdAnswersRequest

TAPER = "carers_allowance_earnings_taper"


def Answers(**values):
    return household_impact.HouseholdAnswers(**values)


# A single carer on Universal Credit, renting, with part-time pay entered
# for 2026 and grown with average earnings: under the £212 weekly
# earnings limit in 2027-28 (about £197 a week of net earnings)
CARER = dict(
    age=50,
    employment_income=10_000,
    region="NORTH_WEST",
    tenure="RENT_PRIVATELY",
    monthly_rent=975,
    claims_universal_credit=True,
    is_carer=True,
    care_hours_per_week=35,
)


@pytest.fixture(autouse=True)
def _fresh_runs():
    household_impact.clear_runs()
    yield
    household_impact.clear_runs()


def test_not_a_carer_by_default_in_the_answers_and_the_request():
    assert Answers().is_carer is False
    request = HouseholdAnswersRequest()
    assert request.is_carer is False
    assert request.answers() == Answers()


def test_a_non_carer_household_is_built_exactly_as_before():
    """No care_hours input at all (not even 0): the situation, and so every
    run's key and answer, is the one built before the form asked. Hours
    entered without saying yes to caring are not read."""
    for values in (
        {},
        {"care_hours_per_week": 50},
        {"has_partner": True, "children": (household_impact.Child(4),)},
    ):
        answers = Answers(**values)
        for year in (None, 2027, 2031):
            people, benunit, household = household_impact.household_entities(
                answers, year
            )
            assert all("care_hours" not in person for person in people)
            assert (people, benunit, household) == (
                household_impact.household_entities(
                    dataclasses.replace(answers, care_hours_per_week=35),
                    year,
                )
            )


def test_a_carer_gives_the_head_their_hours_of_care():
    people, _, _ = household_impact.household_entities(
        Answers(is_carer=True, care_hours_per_week=40, has_partner=True), 2027
    )
    assert people[0]["care_hours"] == 40
    # The partner is not asked
    assert "care_hours" not in people[1]


def test_the_request_takes_the_caring_answers():
    answers = HouseholdAnswersRequest(
        is_carer=True, care_hours_per_week=20
    ).answers()
    assert answers.is_carer is True
    assert answers.care_hours_per_week == 20
    # A carer who gives no hours is taken to care for 35, the minimum
    assert HouseholdAnswersRequest(is_carer=True).answers() == Answers(
        is_carer=True, care_hours_per_week=35
    )


@pytest.mark.parametrize("hours", [-1, 169])
def test_hours_of_care_outside_a_week_are_refused_naming_the_field(hours):
    from fastapi.testclient import TestClient

    response = TestClient(api.app).post(
        "/api/household-impact",
        json={
            "year": 2031,
            "policies": [TAPER],
            "household": {"is_carer": True, "care_hours_per_week": hours},
            "include": [],
        },
    )
    assert response.status_code == 422
    assert ["body", "household", "care_hours_per_week"] in [
        error["loc"] for error in response.json()["detail"]
    ]


@pytest.mark.parametrize(
    "answers, year, expected",
    [
        ({}, 2030, True),
        ({}, 2031, True),
        # Hours entered but not a carer: not read
        ({"care_hours_per_week": 40}, 2031, True),
        ({"is_carer": True}, 2027, True),
        ({"is_carer": True}, 2029, True),
        ({"is_carer": True}, 2030, False),
        ({"is_carer": True}, 2031, False),
        (CARER, 2031, False),
    ],
)
def test_the_taper_is_skipped_only_where_it_cannot_move_the_household(
    answers, year, expected
):
    assert (
        household_impact.provably_unaffected(TAPER, Answers(**answers), year)
        is expected
    )


def test_the_taper_starts_in_its_modifiers_own_start_year():
    assert household_impact.CARERS_ALLOWANCE_TAPER_START == 2030


def _rows(result):
    rows = {}
    for row in result["programmes"]:
        rows[row["id"]] = row
        for child in row.get("children", []):
            rows[child["id"]] = child
    return rows


def test_a_non_carers_answer_has_no_carer_rows():
    result = household_impact.calculate_household_impact(
        Answers(**{**CARER, "is_carer": False}),
        [TAPER],
        2031,
        include=("by_policy",),
    )
    rows = _rows(result)
    assert not household_impact.CARER_ROWS & set(rows)
    (measure,) = result["by_policy"]["measures"]
    assert measure["status"] == "not_affected"
    assert result["net_income"]["change"] == 0


def test_a_carer_under_the_earnings_limit_gets_carers_allowance_and_the_element():
    """2027-28: about £197 a week of net earnings, under the £212 limit, so
    the allowance in full (52 weeks at the year's rate) before and after;
    the taper has not started, so nothing changes."""
    result = household_impact.calculate_household_impact(
        Answers(**CARER), [TAPER], 2027, include=("by_policy",)
    )
    rows = _rows(result)
    allowance = rows["carers_allowance"]
    assert allowance["baseline"] > 4_000
    assert allowance["reform"] == allowance["baseline"]
    assert rows["uc_carer_element"]["baseline"] > 2_000
    assert rows["universal_credit"]["baseline"] > 0
    assert result["net_income"]["change"] == 0
    # "Other benefits" takes none of it: the rows add up as before
    assert rows["other_benefits"]["baseline"] == 0


def test_a_carer_over_the_earnings_limit_gets_part_of_the_allowance_from_the_taper():
    """2031-32, with £13,000 entered for 2026: about £272 a week of net
    earnings, over current law's £204 limit (no allowance) and over the
    taper's own limit (16 hours at the National Living Wage, grown with
    average earnings) by less than the weekly rate, so the taper pays the
    rate less the excess. Universal Credit counts the allowance pound for
    pound, and the allowance is taxable, so net income moves by less
    than it."""
    result = household_impact.calculate_household_impact(
        Answers(**{**CARER, "employment_income": 13_000}),
        [TAPER],
        2031,
        include=("by_policy",),
    )
    rows = _rows(result)
    allowance = rows["carers_allowance"]
    assert allowance["baseline"] == 0
    assert allowance["reform"] > 1_000
    # The carer element does not apply the earnings limit
    assert rows["uc_carer_element"]["baseline"] > 2_000
    assert (
        rows["uc_carer_element"]["reform"]
        == rows["uc_carer_element"]["baseline"]
    )
    assert rows["universal_credit"]["change"] == pytest.approx(
        -allowance["change"], abs=1
    )
    (measure,) = result["by_policy"]["measures"]
    assert measure["status"] == "affected"
    assert measure["change"] == result["net_income"]["change"] != 0
    assert abs(measure["change"]) < allowance["change"]


# A carer who owns their home and claims no Universal Credit, so the
# allowance alone moves: pay entered for 2026, grown to 2030-31
OWNER_CARER = dict(
    age=40,
    region="NORTH_WEST",
    tenure="OWNED_WITH_MORTGAGE",
    claims_universal_credit=False,
    is_carer=True,
    care_hours_per_week=35,
)


def _allowance_in_2030(pay_2026):
    result = household_impact.calculate_household_impact(
        Answers(**OWNER_CARER, employment_income=pay_2026),
        [TAPER],
        2030,
        include=("by_policy",),
    )
    return _rows(result)["carers_allowance"], result["net_income"]["change"]


def test_a_carer_under_the_years_earnings_limit_keeps_the_allowance():
    """2030-31: the limit is 16 hours at April 2030's National Living Wage,
    £228 a week, under current law and the taper alike. A carer on about
    £215 a week of net earnings (£10,218 entered for 2026) is under it, so
    gets the allowance in full before and after: the taper changes nothing
    for them. One on about £235 a week (£11,169) is over it, so gets none
    under current law and the rate less the excess from the taper. The
    lower earner never gets less (household QA, 30 October 2026: with the
    engine's £204 limit the £215 carer got nothing either way)."""
    under, under_change = _allowance_in_2030(10_218)
    over, over_change = _allowance_in_2030(11_169)
    assert under["baseline"] > 4_500
    assert under["reform"] == under["baseline"]
    assert under_change == 0
    assert over["baseline"] == 0
    assert 0 < over["reform"] < under["reform"]
    assert over_change > 0


def _allowance(pay_2026, year):
    result = household_impact.calculate_household_impact(
        Answers(**OWNER_CARER, employment_income=pay_2026),
        [TAPER],
        year,
        include=("by_policy",),
    )
    return _rows(result)["carers_allowance"]


def test_the_limit_is_read_for_the_right_year():
    """About £225 a week of net earnings lies between 2029-30's limit (£222)
    and 2030-31's (£228), so it pins the year (María, #371): in 2030-31 a
    carer on it keeps the allowance in full, and in 2029-30 one on it is
    over the limit and gets none (the taper starts in 2030-31). £10,693
    entered for 2026 is about £225 a week in 2030-31; £10,950 is about £225
    a week in 2029-30."""
    in_2030 = _allowance(10_693, 2030)
    assert in_2030["baseline"] > 4_500
    assert in_2030["reform"] == in_2030["baseline"]
    in_2029 = _allowance(10_950, 2029)
    assert in_2029["baseline"] == 0
    assert in_2029["reform"] == 0
