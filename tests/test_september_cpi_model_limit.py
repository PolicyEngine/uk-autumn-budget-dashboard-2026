"""Hold 2027 benefit measures until both parts of pe-uk #2533 land.

The installed September input is forecast-filled during parameter processing,
so a non-null processed value alone cannot establish that the outturn landed.
"""

import copy
from importlib import import_module
from types import SimpleNamespace

import pytest
from policyengine_core.periods import instant
from policyengine_uk.system import system as installed_system
from policyengine_uk.tax_benefit_system import statutory_parameters

from tests.test_model_limits import (
    INCOME_TAX,
    fixed,
    limit_by_key,
    scenario,
    simulation,
)
from uk_budget_data import data_limits
from uk_budget_data.model_limits import (
    limits_for_scenarios,
    limits_touched,
    record,
)

STATE_PENSION_LIMIT = limit_by_key("state_pension_add_on_uprating")
LIMIT = limit_by_key("benefit_uprating_september_cpi")
PENSION_CREDIT_LIMIT = limit_by_key("pc_minimum_guarantee_uprating")
BENEFIT_INDEX = "gov.benefit_uprating_cpi"
SEPTEMBER_INDEX = "gov.economic_assumptions.indices.september_cpi_uprating"
CPI_INPUT = "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"
REPRESENTATIVE = "gov.dwp.attendance_allowance.lower"
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


def test_the_pinned_prefixes_equal_the_installed_uprating_metadata():
    """Run under both adopted engines: metadata drift requires a new pin.

    Uprating metadata propagates into nodes and scale brackets, and the
    processed baseline repeats the names. Keep the topmost distinct names,
    including the UC standard allowance parent and all four of its amounts.

    On a later engine, don't repin to the metadata alone: amounts that move
    to indices of their own still built from the lagged benefit index (the
    UC standard allowance and LCWRA element on policyengine-uk 2.146.5)
    stay in the limit until #2533's fix (review of #90).
    """
    names = {
        parameter.name
        for parameter in installed_system.parameters.get_descendants()
        if parameter.metadata.get("uprating") == BENEFIT_INDEX
    }
    prefixes = {
        name
        for name in names
        if not any(
            other != name and data_limits._under(name, other)
            for other in names
        )
    }
    assert len(prefixes) == 79
    assert set(LIMIT.parameters) == prefixes | {
        PROTECTED_HEALTH,
        SEPTEMBER_INDEX,
        TRIPLE_LOCK,
        TRIPLE_LOCK_INDEX,
    }
    assert "gov.dwp.universal_credit.standard_allowance.amount" in prefixes
    assert PENSION_CREDIT in prefixes


def _update(parameters, path, date, value):
    parameters.get_child(path).update(start=instant(date), value=value)


def stand_in_fix(*, published=True, september_index=True):
    """A processed tree with the two independent parts of #2533.

    The raw tree records publication separately from the processed input,
    which also exists when the engine has only forecast-filled it. The
    benefit index's metadata and April growth represent the repointed index.
    """
    system = copy.copy(installed_system)
    system.parameters = installed_system.parameters.clone()
    system._parameters_at_instant_cache = {}
    system._raw_parameters = statutory_parameters()
    if published:
        _update(system._raw_parameters, CPI_INPUT, "2026-09-01", 0.035)
    _update(system.parameters, CPI_INPUT, "2026-09-01", 0.035)
    september = system.parameters.get_child(SEPTEMBER_INDEX)
    _update(
        system.parameters,
        SEPTEMBER_INDEX,
        "2027-01-01",
        september("2026-04-01") * 1.035,
    )
    if september_index:
        for parameters in (system.parameters, system._raw_parameters):
            parameters.get_child(BENEFIT_INDEX).metadata[
                "uprating"
            ] = SEPTEMBER_INDEX
        benefit = system.parameters.get_child(BENEFIT_INDEX)
        _update(
            system.parameters,
            BENEFIT_INDEX,
            "2027-01-01",
            benefit("2026-04-01") * 1.035,
        )
    return SimpleNamespace(tax_benefit_system=system)


@pytest.mark.parametrize("published", [False, True])
@pytest.mark.parametrize("september_index", [False, True])
def test_the_fix_needs_the_published_input_and_the_repointed_index(
    published, september_index
):
    stand_in = stand_in_fix(
        published=published, september_index=september_index
    )
    assert LIMIT.fixed(stand_in.tax_benefit_system) is (
        published and september_index
    )


def test_repointed_metadata_without_the_behaviour_does_not_lift_the_limit():
    stand_in = stand_in_fix()
    parameters = stand_in.tax_benefit_system.parameters
    _update(
        parameters,
        BENEFIT_INDEX,
        "2027-01-01",
        parameters.get_child(BENEFIT_INDEX)("2026-04-01") * 1.023,
    )
    assert LIMIT.fixed(stand_in.tax_benefit_system) is False


def test_the_installed_check_sees_a_model_with_both_steps(monkeypatch):
    fixed_system = stand_in_fix().tax_benefit_system
    monkeypatch.setattr(
        import_module("policyengine_uk.system"), "system", fixed_system
    )
    assert LIMIT.installed_fixed() is True


def test_the_installed_model_still_lacks_both_steps():
    """Adoption tripwire: remove the limit when #2533 enters the pair.

    It fails only when both steps are in the installed model, not when the
    OBR's CPI forecast is refreshed or one step lands alone.
    """
    assert (
        not LIMIT.installed_fixed()
    ), f"{LIMIT.fixed_by} is in the installed model: remove {LIMIT.key}"


def test_both_fix_checks_agree_with_the_installed_benefit_uprating():
    """Differential: the checks agree with what the model does.

    The lower Attendance Allowance rate is a representative on the index.
    Its April 2027 rise equals the September 2026 outturn (3.5%) exactly
    when the model has both steps of #2533 (review of #85).
    """
    parameter = installed_system.parameters.get_child(REPRESENTATIVE)
    rise = parameter("2027-04-01") / parameter("2026-04-01") - 1
    at_outturn = rise == pytest.approx(0.035, abs=0.00001)
    assert at_outturn is LIMIT.fixed(installed_system)
    assert at_outturn is LIMIT.installed_fixed()


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
    """Without #2336 the State Pension limit holds it as well."""
    assert limits_touched(
        simulation(), simulation({SEPTEMBER_INDEX: {"2027": 1.7}})
    ) == [
        record(STATE_PENSION_LIMIT, [SEPTEMBER_INDEX]),
        record(LIMIT, [SEPTEMBER_INDEX]),
    ]


@pytest.mark.parametrize(
    "changes",
    [
        {SEPTEMBER_INDEX: {"2027": 1.7}},
        {CPI_INPUT: {"2026-09-01.2027-08-31": 0.035}},
    ],
    ids=["the index", "the September 2026 input"],
)
def test_with_2336_but_not_2533_the_add_on_is_held_by_this_limit(changes):
    """A pair with #2336 but without #2557 raises additional State Pension
    by the September CPI index, whose April 2027 step is still a forecast.
    The State Pension limit lifts with #2336; this one holds a measure
    that moves the index until #2533's fix (coordinator, 22 October)."""
    assert limits_touched(fixed(), fixed(changes)) == [
        record(LIMIT, [SEPTEMBER_INDEX])
    ]


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
    baseline, reformed = stand_in_fix(), stand_in_fix()
    _update(reformed.tax_benefit_system.parameters, PIP, "2027-01-01", 900.0)
    assert limits_touched(baseline, reformed) == []


@pytest.mark.parametrize("fixed_baseline", [False, True])
def test_the_fix_is_needed_on_both_sides(fixed_baseline):
    baseline = stand_in_fix(published=fixed_baseline)
    reformed = stand_in_fix(published=not fixed_baseline)
    _update(reformed.tax_benefit_system.parameters, PIP, "2027-01-01", 900.0)
    assert limits_touched(baseline, reformed) == [record(LIMIT, [PIP])]


def test_a_measure_off_the_covered_parameters_records_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.21}}))
        == []
    )


def test_a_missing_parameter_tree_cannot_establish_the_fix():
    assert LIMIT.fixed(object()) is False
