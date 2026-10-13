"""Registered measures key their parameter changes by bare fiscal year.

Two routes apply a measure's ``parameter_changes``, and they read period
keys differently:

- the national run hands them to policyengine-uk, which on 2.126.12 reads a
  bare year as that fiscal year, ``"start.stop"`` as that interval and a
  lone date as that one day (``policyengine_uk.utils.dated_reforms``);
- the household calculator, ``personal_impact.create_simulation``, applies
  a change only where the key is the year itself.

A bare year is the only key both read as that year. Any other key moves
the national figure and not the household calculator's, or moves neither.
(``Reform`` already refuses a key that is not a string, and a value with
no period.)
"""

import re

import pytest
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.personal_impact import create_simulation
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

BARE_YEAR = re.compile(r"[1-9]\d{3}")
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
    """A key the household calculator does not read would leave it showing
    no change for a measure the national run scores (see the module
    docstring). List every year the change applies: ``{"2027": x,
    "2028": x}``."""
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
            }
        },
        baseline_parameter_changes={ALLOWANCE: {"year:2027:2": 1}},
    )
    assert other_keys(reform) == [
        ("reform", ALLOWANCE, "2029-04-06"),
        ("reform", ALLOWANCE, "2030-04-06.2100-12-31"),
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
    assert _result(national, 2027)[0] == 20_000
    assert _result(national, 2027) != current_law[2027]
    assert _result(national, 2028) == current_law[2028]
    assert _result(_household(changes, 2028), 2028) == current_law[2028]


@pytest.mark.parametrize(
    "key, national_reads_it",
    [("2027-04-06.2100-12-31", True), ("2027-04-06", False)],
    ids=["interval", "lone date"],
)
def test_the_household_calculator_reads_no_other_key(
    key, national_reads_it, current_law
):
    """Why the rule is a bare year and nothing else. The national route
    reads an interval and the household calculator does not; a lone date
    changes one day, which moves neither.

    If this fails because the household calculator has come to read these
    keys as the national route does, the rule above can be relaxed, and
    the templates can accept what both read."""
    changes = {ALLOWANCE: {key: 20_000}}
    assert _result(_household(changes, 2027), 2027) == current_law[2027]
    moved = _result(_national(changes), 2027) != current_law[2027]
    assert moved == national_reads_it
