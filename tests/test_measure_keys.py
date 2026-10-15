"""Registered measures key their parameter changes by bare fiscal year.

The national run and the household calculator both hand a measure's
``parameter_changes`` to policyengine-uk's ``Scenario`` (#32), so they read
every key alike: a bare year as that fiscal year, ``"start.stop"`` as that
interval, a lone date as that one day (``policyengine_uk.utils.
dated_reforms``), and other scripts' digits as the year they spell (the
differential below).

A bare year in ASCII digits is still the one form a registered measure
uses. A lone date changes one day, so it can leave the year it was meant
for untouched; the templates build bare years only
(``uk_budget_data.measure_templates``), so a registered measure reads like
one built from them; and a key in other digits is not the year a reviewer
reads. (``Reform`` already refuses a key that is not a string, and a value
with no period.)
"""

import re

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.personal_impact import create_simulation
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

# [0-9], not \d: \d also matches other scripts' digits (review r7).
BARE_YEAR = re.compile(r"[1-9][0-9]{3}")
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
def test_a_registered_measure_keys_every_change_by_a_bare_year(reform):
    """One form for every measure (see the module docstring). List every
    year the change applies: ``{"2027": x, "2028": x}``."""
    assert other_keys(reform) == []


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
