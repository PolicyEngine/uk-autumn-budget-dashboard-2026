"""Hold 2027 pension-age measures until the minimum guarantee follows
earnings.

The law requires the Pension Credit standard minimum guarantee to rise at
least with earnings (Social Security Administration Act 1992 s. 150A(2)):
3.9% for April 2027. The installed model raises it by lagged CPI, and
policyengine-uk #2557, #2533's fix, deliberately keeps it there. The UK
hub's earnings fix, stacked on #2557, also covers the pension-age Housing
Benefit allowances and the savings credit threshold (coordinator, 22
October).
"""

import copy
from importlib import import_module
from types import SimpleNamespace

import pytest
from policyengine_core.periods import instant
from policyengine_uk import Simulation
from policyengine_uk.system import system as installed_system
from policyengine_uk.tax_benefit_system import statutory_parameters

from tests.test_model_limits import simulation
from uk_budget_data import data_limits
from uk_budget_data.measure_templates import ModelLimitedWarning, rate_change
from uk_budget_data.model_limits import (
    MODEL_LIMITS,
    limits_touched,
    record,
)

BENEFIT_LIMIT = MODEL_LIMITS[1]
LIMIT = MODEL_LIMITS[2]
GUARANTEE = "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee"
SINGLE = f"{GUARANTEE}.SINGLE"
COUPLE = f"{GUARANTEE}.COUPLE"
EARNINGS = (
    "gov.economic_assumptions.statutory_uprating_inputs.awe_total_pay_may_july"
)
HOUSING_BENEFIT = "gov.dwp.housing_benefit.allowances.single.aged"
SAVINGS_CREDIT = "gov.dwp.pension_credit.savings_credit.threshold.SINGLE"
ALLOWANCES = "gov.dwp.housing_benefit.allowances"
EARNINGS_2026 = 0.039


def test_the_limit_is_registered_with_its_key():
    assert LIMIT.key == "pc_minimum_guarantee_uprating"
    assert LIMIT.from_year == 2027


def test_every_pension_age_housing_benefit_allowance_is_covered():
    """Adoption tripwire: later policyengine-uk releases split each
    pension-age allowance in two (``aged`` and ``aged_from_cutoff``). When
    the adopted model has more of them, this fails until each is listed."""
    allowances = installed_system.parameters.get_child(ALLOWANCES)
    pension_age = {
        f"{ALLOWANCES}.{group}.{name}"
        for group, node in allowances.children.items()
        for name in getattr(node, "children", {})
        if name.startswith("aged")
    }
    assert pension_age
    assert pension_age <= set(LIMIT.parameters)


def _update(parameters, path, date, value):
    parameters.get_child(path).update(start=instant(date), value=value)


def stand_in(
    *,
    published=True,
    rise=1 + EARNINGS_2026,
    short_by=0.0,
    rates=(SINGLE, COUPLE),
):
    """A processed tree whose guarantee rises by ``rise`` in April 2027,
    less ``short_by`` pounds a week.

    The raw tree records whether May to July 2026 earnings are published,
    separately from the processed input, which a forecast can fill.
    """
    system = copy.copy(installed_system)
    system.parameters = installed_system.parameters.clone()
    system._parameters_at_instant_cache = {}
    system._raw_parameters = statutory_parameters()
    if not published:
        _update(system._raw_parameters, EARNINGS, "2026-07-01", None)
    for path in rates:
        amount = system.parameters.get_child(path)
        uprated = amount("2026-04-30") * rise - short_by
        _update(system.parameters, path, "2027-04-01", uprated)
    return SimpleNamespace(tax_benefit_system=system)


def test_the_installed_model_publishes_the_2026_earnings_input():
    """The check reads this input; if a release unpublishes it, the limit
    could never lift, so say so here rather than in the tripwire."""
    raw = statutory_parameters().get_child(EARNINGS)("2026-07-01")
    assert raw == pytest.approx(EARNINGS_2026)


@pytest.mark.parametrize(
    "kwargs, fixed",
    [
        ({}, True),
        ({"rise": 1.0399}, True),
        # Rounded down to the 5p step below the floor still counts.
        ({"short_by": 0.04}, True),
        ({"short_by": 0.06}, False),
        ({"rise": 1.023}, False),
        ({"rise": 1.035}, False),
        ({"published": False}, False),
        ({"rates": (SINGLE,)}, False),
        ({"rates": (COUPLE,)}, False),
    ],
    ids=[
        "earnings",
        "above earnings",
        "within a 5p step",
        "beyond a 5p step",
        "lagged CPI",
        "September CPI",
        "earnings unpublished",
        "single only",
        "couple only",
    ],
)
def test_the_fix_needs_both_rates_to_reach_published_earnings(kwargs, fixed):
    assert LIMIT.fixed(stand_in(**kwargs).tax_benefit_system) is fixed


def test_an_unreadable_system_counts_as_unfixed():
    assert LIMIT.fixed(object()) is False
    assert LIMIT.fixed(SimpleNamespace(parameters=None)) is False


def test_the_installed_check_sees_a_model_with_the_fix(monkeypatch):
    monkeypatch.setattr(
        import_module("policyengine_uk.system"),
        "system",
        stand_in().tax_benefit_system,
    )
    assert LIMIT.installed_fixed() is True


def test_the_installed_model_still_lacks_the_fix():
    """Adoption tripwire: remove the limit when the earnings fix is in the
    adopted pair. #2557 alone keeps the guarantee on lagged CPI, so it
    doesn't trip this."""
    assert (
        not LIMIT.installed_fixed()
    ), f"{LIMIT.fixed_by} is in the installed model: remove {LIMIT.key}"


def test_the_fix_check_agrees_with_the_guarantee_a_pensioner_gets():
    """Differential: the check reads the parameter tree; this reads the
    standard minimum guarantee the model gives a single pensioner, through
    its formulas, in 2026-27 and 2027-28."""

    def guarantee(year):
        sim = Simulation(
            situation={
                "people": {"p": {"age": {year: 70}}},
                "benunits": {"b": {"members": ["p"]}},
                "households": {"h": {"members": ["p"]}},
            }
        )
        return sim.calculate("standard_minimum_guarantee", year)[0]

    before, after = guarantee(2026), guarantee(2027)
    assert before > 0
    # Annual amounts: 52 weeks of a 5p step.
    reaches = bool(after >= before * (1 + EARNINGS_2026) - 52 * 0.05)
    assert reaches is LIMIT.fixed(installed_system)
    assert reaches is LIMIT.installed_fixed()


@pytest.mark.parametrize(
    "path, value", [(COUPLE, 400.0), (HOUSING_BENEFIT, 280.0)]
)
def test_a_2027_measure_on_a_covered_amount_records_the_limit(path, value):
    """Each is on the benefit index too, so both limits are recorded."""
    assert limits_touched(
        simulation(), simulation({path: {"2027": value}})
    ) == [
        record(BENEFIT_LIMIT, [path]),
        record(LIMIT, [path]),
    ]


def test_a_2027_savings_credit_threshold_measure_records_the_limit():
    touched = limits_touched(
        simulation(), simulation({SAVINGS_CREDIT: {"2027": 220.0}})
    )
    assert record(LIMIT, [SAVINGS_CREDIT]) in touched


@pytest.mark.parametrize(
    "key", ["2026", "2026-07-01.2027-06-30"], ids=["bare year", "range"]
)
def test_a_change_to_the_earnings_input_records_the_limit(key):
    """Without the fix the guarantee ignores earnings, so the change misses
    it. The triple lock reads the input too, so the State Pension limit is
    recorded beside it while #2336 is missing."""
    touched = limits_touched(simulation(), simulation({EARNINGS: {key: 0.1}}))
    assert record(LIMIT, [EARNINGS]) in touched


def test_a_measure_confined_to_2026_does_not_record_the_limit():
    """The 2026-27 rates are legislated and unaffected."""
    assert (
        limits_touched(simulation(), simulation({SINGLE: {"2026": 250.0}}))
        == []
    )


def test_with_the_fix_a_guarantee_measure_records_only_the_benefit_limit():
    """The limit expires on its own once the model has the fix."""

    def build(changes=None):
        sim = stand_in()
        if changes:
            sim = SimpleNamespace(
                tax_benefit_system=copy.copy(sim.tax_benefit_system)
            )
            parameters = sim.tax_benefit_system.parameters.clone()
            sim.tax_benefit_system.parameters = parameters
            sim.tax_benefit_system._parameters_at_instant_cache = {}
            for path, value in changes.items():
                _update(parameters, path, "2027-04-01", value)
        return sim

    touched = limits_touched(build(), build({SINGLE: 300.0}))
    assert [item["key"] for item in touched] == [BENEFIT_LIMIT.key]


def test_a_template_built_measure_warns():
    with pytest.warns(ModelLimitedWarning, match="minimum guarantee"):
        rate_change(SINGLE, {2027: 260.0})


def test_the_covered_paths_fall_under_this_limit():
    for path in LIMIT.parameters:
        assert any(
            data_limits._under(path, prefix) for prefix in LIMIT.parameters
        )
