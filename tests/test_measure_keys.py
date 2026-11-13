"""Registered measures use fiscal years or source-bounded statutory intervals.

The national run and the household calculator both hand a measure's
``parameter_changes`` to policyengine-uk's ``Scenario`` (#32), so they read
every key alike: a bare year as that fiscal year, ``"start.stop"`` as that
interval, a lone date as that one day (``policyengine_uk.utils.
dated_reforms``), and other scripts' digits as the year they spell (the
differential below).

Native Budget policies use dated intervals to retain changes within a fiscal
year. Each interval must fit a tracked policy's source dates. Templates can
still use bare ASCII years. Lone dates change only one day; other scripts'
digits hide which year a reviewer reads. Neither belongs in the registry.
"""

import re
from datetime import date

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.budget_policy import policy_record
from uk_budget_data.personal_impact import create_simulation
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    get_autumn_budget_2026_reforms,
)

# [0-9], not \d: \d also matches other scripts' digits (review r7).
BARE_YEAR = re.compile(r"[1-9][0-9]{3}")
DATED_INTERVAL = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{4}-[0-9]{2}-[0-9]{2}"
)
ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
YEARS = (2027, 2028)
EARNER = {
    "people": {
        "person": {
            "age": {year: 40 for year in YEARS},
            "employment_income": {year: 50_000 for year in YEARS},
        }
    },
    "benunits": {"benunit": {"members": ["person"]}},
    "households": {"household": {"members": ["person"]}},
}


def other_keys(reform) -> list[tuple]:
    """A measure's period keys that are not a bare year, on either side."""
    return [
        (side, path, key)
        for side, changes in (
            ("reform", reform.parameter_changes),
            ("baseline", reform.baseline_parameter_changes),
        )
        for path, values in (changes or {}).items()
        for key in values
        if not BARE_YEAR.fullmatch(key)
    ]


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_a_registered_measure_uses_reviewed_years_or_statutory_intervals(
    reform,
):
    members = (
        AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
        if reform.id == AUTUMN_BUDGET_2026_COMBINED_ID
        else [reform.id]
    )
    measures = policy_record()["measures"]
    paths = {
        path: spec
        for member in members
        for path, spec in measures[member]["paths"].items()
    }
    for side, path, key in other_keys(reform):
        assert DATED_INTERVAL.fullmatch(key), (side, path, key)
        start, stop = map(date.fromisoformat, key.split("."))
        assert start <= stop
        source = paths[path]
        assert date.fromisoformat(source["start"]) <= start
        assert stop <= date.fromisoformat(source["stop"])


def test_other_keys_names_every_key_that_is_not_a_bare_year():
    from uk_budget_data.models import Reform

    reform = Reform(
        id="m",
        name="M",
        parameter_changes={
            ALLOWANCE: {
                "2027": 1,
                "2029-04-06": 1,
                "2030-04-06.2100-12-31": 1,
                "202\u0667": 1,
            }
        },
        baseline_parameter_changes={ALLOWANCE: {"year:2027:2": 1}},
    )
    assert other_keys(reform) == [
        ("reform", ALLOWANCE, "2029-04-06"),
        ("reform", ALLOWANCE, "2030-04-06.2100-12-31"),
        ("reform", ALLOWANCE, "202\u0667"),
        ("baseline", ALLOWANCE, "year:2027:2"),
    ]


def _result(sim, year):
    allowance = sim.tax_benefit_system.parameters(
        f"{year}-01-01"
    ).gov.hmrc.income_tax.allowances.personal_allowance.amount
    return float(allowance), float(sim.calculate("income_tax", year).sum())


def _national(changes):
    return Simulation(
        situation=EARNER, scenario=Scenario(parameter_changes=changes)
    )


def _household(changes, year):
    return create_simulation(EARNER, year, reform_param_changes=changes)


@pytest.fixture(scope="module")
def current_law():
    sim = Simulation(situation=EARNER)
    return {year: _result(sim, year) for year in YEARS}


def test_both_routes_read_a_bare_year_as_that_year(current_law):
    """Differential: for the one key the rule allows, the national route
    and the household calculator give the same allowance and the same
    income tax, and the next year is left alone."""
    changes = {ALLOWANCE: {"2027": 20_000}}
    national = _national(changes)
    assert _result(national, 2027) == _result(_household(changes, 2027), 2027)
    # £50,000 less a £20,000 allowance, all at the 20% basic rate: the
    # tax itself must move, not only the allowance (review r7).
    assert _result(national, 2027) == (20_000, 6_000)
    assert current_law[2027][1] != 6_000
    assert _result(national, 2028) == current_law[2028]
    assert _result(_household(changes, 2028), 2028) == current_law[2028]


# The allowance and income tax a bare 2027 gives in 2027 (above).
CHANGED = (20_000, 6_000)


@pytest.mark.parametrize(
    "key, changes_2027",
    [
        ("2027-04-06.2100-12-31", True),
        # One day: the year is left as it was.
        ("2027-04-06", False),
        # Review r7: "202" and an Arabic-Indic seven, which \d matched.
        ("202\u0667", True),
    ],
    ids=["interval", "lone date", "other digits"],
)
def test_both_routes_read_every_other_key_alike(
    key, changes_2027, current_law
):
    """Differential: for a key the rule refuses, the household calculator
    still gives the allowance and income tax the national route gives, in
    2027 and 2028, so the rule is about legibility, not a key one route
    misses. The national result is pinned too, so the two routes cannot
    agree by both ignoring the key."""
    changes = {ALLOWANCE: {key: 20_000}}
    national = _national(changes)
    for year in YEARS:
        assert _result(_household(changes, year), year) == _result(
            national, year
        )
    expected = CHANGED if changes_2027 else current_law[2027]
    assert _result(national, 2027) == expected
