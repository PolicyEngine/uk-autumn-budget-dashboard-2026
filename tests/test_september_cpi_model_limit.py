"""A limit that covers parameters only from 2027: 2027 benefit measures
were held until both parts of policyengine-uk #2533 landed.

That limit expired at 2.151.0 (PR 238). Its tests of the year filter, and
of how it overlaps the State Pension and minimum guarantee limits, run on
its stand-in (tests/model_limit_stand_ins.py), whose fix is a marker a test
installs; the tests of its check for the fix went with it. The year filter
is in force for the minimum guarantee's limit (also from 2027).
"""

import pytest
from policyengine_core.periods import instant

from tests.model_limit_stand_ins import with_fix
from tests.test_model_limits import (
    INCOME_TAX,
    fixed,
    limit_by_key,
    scenario,
    simulation,
)
from uk_budget_data.model_limits import (
    limits_for_scenarios,
    limits_touched,
    record,
)

pytestmark = pytest.mark.usefixtures("stand_in_model_limits")

STATE_PENSION_LIMIT = limit_by_key("state_pension_add_on_uprating")
LIMIT = limit_by_key("benefit_uprating_september_cpi")
PENSION_CREDIT_LIMIT = limit_by_key("pc_minimum_guarantee_uprating")
SEPTEMBER_INDEX = "gov.economic_assumptions.indices.september_cpi_uprating"
CPI_INPUT = "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"
PROTECTED_HEALTH = (
    "gov.dwp.universal_credit.rebalancing.protected_health_element"
)
PIP = "gov.dwp.pip.daily_living.standard"
TRIPLE_LOCK = "gov.dwp.state_pension.triple_lock"
TRIPLE_LOCK_INDEX = "gov.economic_assumptions.indices.triple_lock"
NEW_PENSION = "gov.dwp.state_pension.new_state_pension.amount"
UC = "gov.dwp.universal_credit.standard_allowance.amount.SINGLE_OLD"
PENSION_CREDIT = (
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE"
)


def _update(parameters, path, date, value):
    parameters.get_child(path).update(start=instant(date), value=value)


def with_both_fix_steps():
    """A model with this limit's fix (its stand-in's marker), not the State
    Pension limit's."""
    return simulation(modifier=with_fix(LIMIT.key))


def test_a_2027_protected_health_element_measure_records_the_limit():
    """Its 2027 amount is the s. 4 floor, which reads the September 2026
    input, so a measure on it from 2027 is held (review of #85)."""
    assert limits_touched(
        simulation(), simulation({PROTECTED_HEALTH: {"2027": 450.0}})
    ) == [record(LIMIT, [PROTECTED_HEALTH])]


@pytest.mark.parametrize("parameter", [PIP, UC])
def test_a_2027_benefit_measure_records_the_limit(parameter):
    assert limits_touched(
        simulation(), simulation({parameter: {"2027": 900.0}})
    ) == [record(LIMIT, [parameter])]


def test_a_2027_minimum_guarantee_measure_records_both_its_limits():
    """The guarantee is on the benefit index and must rise with earnings,
    so it stays held after #2533's fix until the earnings fix lands."""
    assert limits_touched(
        simulation(), simulation({PENSION_CREDIT: {"2027": 900.0}})
    ) == [
        record(LIMIT, [PENSION_CREDIT]),
        record(PENSION_CREDIT_LIMIT, [PENSION_CREDIT]),
    ]


def test_a_2027_september_cpi_change_records_the_limit():
    """Without #2336 the State Pension limit holds it as well. From
    policyengine-uk 2.151.0 the benefit uprating index follows the
    September CPI index (#2557), so the benefit amounts on it move with it
    and are recorded beside it."""
    touched = limits_touched(
        simulation(), simulation({SEPTEMBER_INDEX: {"2027": 1.7}})
    )
    assert [item["key"] for item in touched] == [
        STATE_PENSION_LIMIT.key,
        LIMIT.key,
    ]
    assert touched[0] == record(STATE_PENSION_LIMIT, [SEPTEMBER_INDEX])
    assert {SEPTEMBER_INDEX, PIP} <= set(touched[1]["parameters"])


@pytest.mark.parametrize(
    "changes",
    [
        {SEPTEMBER_INDEX: {"2027": 1.7}},
        # The published outturn is 3.5%, so a measure moves it elsewhere.
        {CPI_INPUT: {"2026-09-01.2027-08-31": 0.05}},
    ],
    ids=["the index", "the September 2026 input"],
)
def test_with_2336_but_not_2533_the_add_on_is_held_by_this_limit(changes):
    """A pair with #2336 but without #2557 raises additional State Pension
    by the September CPI index, whose April 2027 step is still a forecast.
    The State Pension limit lifts with #2336; this one holds a measure
    that moves the index until #2533's fix (coordinator, 22 October). From
    2.151.0 the benefit amounts move with the index too."""
    touched = limits_touched(fixed(), fixed(changes))
    assert [item["key"] for item in touched] == [LIMIT.key]
    assert {SEPTEMBER_INDEX, PIP} <= set(touched[0]["parameters"])


@pytest.mark.parametrize(
    "rule, value",
    [("include_earnings", False), ("minimum_rate", 0.05)],
    ids=["a double lock", "a higher minimum"],
)
def test_with_2336_but_not_2533_a_triple_lock_measure_is_held(rule, value):
    """The triple lock's April 2027 CPI leg reads the same forecast, so a
    measure on its rule is mis-costed first-hand: dropping the earnings
    leg gives max(2.1% forecast, 2.5%) against max(3.5%, 2.5%) with the
    outturn. The State Pension limit lifts with #2336; this one holds it
    until #2533's fix (review of #90)."""
    path = f"{TRIPLE_LOCK}.{rule}"
    assert limits_touched(fixed(), fixed({path: {"2027": value}})) == [
        record(LIMIT, [path, TRIPLE_LOCK_INDEX])
    ]


def test_with_2336_a_full_rate_measure_is_not_held():
    """After #2336 the full rates don't move the add-on, so a measure on
    them alone isn't held; its second-hand error through means tests is a
    disclosure, not a hold (coordinator on #90, 22 October)."""
    assert limits_touched(fixed(), fixed({NEW_PENSION: {"2027": 260.0}})) == []


def test_a_measure_confined_to_2026_does_not_record_the_limit():
    """The 2026-27 legislated rates are unaffected by the missing outturn."""
    assert (
        limits_touched(simulation(), simulation({PIP: {"2026": 900.0}})) == []
    )


def test_an_earlier_change_still_in_effect_in_2027_is_held():
    baseline, reformed = simulation(), simulation()
    _update(reformed.tax_benefit_system.parameters, PIP, "2026-01-01", 900.0)
    assert limits_touched(baseline, reformed) == [record(LIMIT, [PIP])]


@pytest.mark.parametrize("year, held", [(2026, False), (2027, True)])
def test_the_year_filter_also_applies_to_cached_formula_views(year, held):
    baseline, reformed = simulation(), simulation()
    view = reformed.tax_benefit_system.parameters(f"{year}-01-01")
    view.gov.dwp.pip.daily_living.standard = 900.0
    assert limits_touched(baseline, reformed) == (
        [record(LIMIT, [PIP])] if held else []
    )


@pytest.mark.parametrize("year, held", [(2026, False), (2027, True)])
@pytest.mark.parametrize("as_integer", [False, True])
def test_scenario_stand_ins_filter_unambiguous_bare_years(
    year, held, as_integer
):
    year = year if as_integer else str(year)
    assert limits_for_scenarios(None, scenario({PIP: {year: 900.0}})) == (
        [record(LIMIT, [PIP])] if held else []
    )


def test_unknown_scenario_period_syntax_is_held_conservatively():
    assert limits_for_scenarios(
        None, scenario({PIP: {"year:2026:2": 900.0}})
    ) == [record(LIMIT, [PIP])]


def test_a_benefit_measure_records_nothing_with_both_fix_steps():
    baseline, reformed = with_both_fix_steps(), with_both_fix_steps()
    _update(reformed.tax_benefit_system.parameters, PIP, "2027-01-01", 900.0)
    assert limits_touched(baseline, reformed) == []


@pytest.mark.parametrize("fixed_baseline", [False, True])
def test_the_fix_is_needed_on_both_sides(fixed_baseline):
    baseline = with_both_fix_steps() if fixed_baseline else simulation()
    reformed = simulation() if fixed_baseline else with_both_fix_steps()
    _update(reformed.tax_benefit_system.parameters, PIP, "2027-01-01", 900.0)
    assert limits_touched(baseline, reformed) == [record(LIMIT, [PIP])]


def test_a_measure_off_the_covered_parameters_records_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.21}}))
        == []
    )
