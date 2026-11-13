"""A limit on the pension-age amounts from 2027: measures on them were
held until the minimum guarantee followed earnings.

The law requires the Pension Credit standard minimum guarantee to rise at
least with earnings (Social Security Administration Act 1992 s. 150A(2)):
3.9% for April 2027. policyengine-uk 2.151.0 raised it by lagged CPI, and
#2557, #2533's fix, deliberately kept it there. The earnings fix (#2576,
first released in 2.151.2) also covers the pension-age Housing Benefit
allowances and the savings credit threshold.

That limit expired when policyengine 6.16.2 adopted policyengine-uk 2.165.1.
Its tests of what it covers, of the 2027 filter and of what a measure
records run on its stand-in alone (tests/model_limit_stand_ins.py), whose
fix is a marker a test installs; the tests of its check for the fix went
with it. tests/test_expired_model_limits.py reads the behaviour the expiry
relies on in the installed model.
"""

import pytest

from tests import model_limit_stand_ins
from tests.model_limit_stand_ins import with_fix
from tests.test_model_limits import simulation
from uk_budget_data.measure_templates import ModelLimitedWarning, rate_change
from uk_budget_data.model_limits import (
    limits_for_paths,
    limits_touched,
    record,
)

LIMIT = model_limit_stand_ins.PC_MINIMUM_GUARANTEE
GUARANTEE = "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee"
SINGLE = f"{GUARANTEE}.SINGLE"
COUPLE = f"{GUARANTEE}.COUPLE"
EARNINGS = (
    "gov.economic_assumptions.statutory_uprating_inputs.awe_total_pay_may_july"
)
HOUSING_BENEFIT = "gov.dwp.housing_benefit.allowances.single.aged"
SAVINGS_CREDIT = "gov.dwp.pension_credit.savings_credit.threshold.SINGLE"
INCOME_TAX = "gov.hmrc.income_tax.rates.uk[0].rate"


@pytest.fixture(autouse=True)
def only_this_limit(monkeypatch):
    """The registry holds this stand-in alone, so a record here is this
    limit's: the September CPI stand-in covers the guarantee too
    (tests/test_september_cpi_model_limit.py tests the two together)."""
    model_limit_stand_ins.register(monkeypatch, (LIMIT,))


def with_the_fix(changes=None):
    """A model with this limit's fix (its stand-in's marker)."""
    return simulation(changes, with_fix(LIMIT.key))


def test_the_limit_starts_in_2027():
    assert LIMIT.from_year == 2027


@pytest.mark.parametrize(
    "path, covered",
    [
        (SINGLE, True),
        (COUPLE, True),
        (SAVINGS_CREDIT, True),
        (HOUSING_BENEFIT, True),
        ("gov.dwp.housing_benefit.allowances.couple.aged", True),
        ("gov.dwp.housing_benefit.allowances.lone_parent.aged", True),
        ("gov.dwp.housing_benefit.allowances.single.aged_from_cutoff", True),
        ("gov.dwp.housing_benefit.allowances.couple.aged_from_cutoff", True),
        (
            "gov.dwp.housing_benefit.allowances.lone_parent.aged_from_cutoff",
            True,
        ),
        (EARNINGS, True),
        ("gov.dwp.housing_benefit.allowances.single.older", False),
        ("gov.dwp.housing_benefit.allowances.single.younger", False),
        (
            "gov.economic_assumptions.statutory_uprating_inputs"
            ".cpi_september",
            False,
        ),
    ],
)
def test_the_limit_covers_the_pension_age_amounts_only(path, covered):
    assert (LIMIT in limits_for_paths([path])) is covered


def recorded(changes) -> list:
    """The paths this limit's record names for a measure, after checking
    the record is this limit's alone and passes the guard's own form."""
    touched = limits_touched(simulation(), simulation(changes))
    assert [item["key"] for item in touched] == [LIMIT.key]
    assert touched == [record(LIMIT, touched[0]["parameters"])]
    return touched[0]["parameters"]


@pytest.mark.parametrize(
    "path, value",
    [(COUPLE, 400.0), (HOUSING_BENEFIT, 280.0), (SAVINGS_CREDIT, 220.0)],
)
def test_a_2027_measure_on_a_covered_amount_records_the_limit(path, value):
    """The record names the amount the measure sets. From policyengine-uk
    2.151.2 the engine builds the savings credit threshold and the
    pension-age Housing Benefit allowances from the guarantee, so a
    guarantee measure can move those too: the record may name more than
    the one path."""
    assert path in recorded({path: {"2027": value}})


@pytest.mark.parametrize(
    "key", ["2026", "2026-07-01.2027-06-30"], ids=["bare year", "range"]
)
def test_a_change_to_the_earnings_input_records_the_limit(key):
    """The input is covered itself. Without the fix the guarantee ignored
    earnings, so the change missed it; with the engine's fix the guarantee
    follows the input, so the record may name the amounts it moves too."""
    assert EARNINGS in recorded({EARNINGS: {key: 0.1}})


def test_a_measure_confined_to_2026_does_not_record_the_limit():
    """The 2026-27 rates are legislated and unaffected."""
    assert (
        limits_touched(simulation(), simulation({SINGLE: {"2026": 250.0}}))
        == []
    )


def test_a_measure_off_the_covered_parameters_records_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.21}}))
        == []
    )


@pytest.mark.parametrize("value", [238.0, 300.0], ids=["freeze", "raise"])
def test_with_the_fix_a_guarantee_measure_records_nothing(value):
    """The limit expires on its own once the model has the fix, whatever
    the measure does to the guarantee."""
    assert (
        limits_touched(with_the_fix(), with_the_fix({SINGLE: {"2027": value}}))
        == []
    )


@pytest.mark.parametrize("fixed_baseline", [False, True])
def test_the_fix_is_needed_on_both_sides(fixed_baseline):
    changes = {SINGLE: {"2027": 250.0}}
    baseline = with_the_fix() if fixed_baseline else simulation()
    reformed = simulation(changes) if fixed_baseline else with_the_fix(changes)
    touched = limits_touched(baseline, reformed)
    assert [item["key"] for item in touched] == [LIMIT.key]
    assert SINGLE in touched[0]["parameters"]


def test_a_template_built_measure_warns():
    with pytest.warns(ModelLimitedWarning, match="minimum guarantee"):
        rate_change(SINGLE, {2027: 260.0})
