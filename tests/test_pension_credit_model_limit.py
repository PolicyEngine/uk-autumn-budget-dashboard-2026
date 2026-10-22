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

from tests.test_model_limits import limit_by_key, simulation
from uk_budget_data.measure_templates import ModelLimitedWarning, rate_change
from uk_budget_data.model_limits import (
    limits_for_paths,
    limits_touched,
    record,
)

BENEFIT_LIMIT = limit_by_key("benefit_uprating_september_cpi")
LIMIT = limit_by_key("pc_minimum_guarantee_uprating")
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
BENEFIT_INDEX = "gov.benefit_uprating_cpi"
INDICES = "gov.economic_assumptions.indices"
# Stand-in indices from the installed model, by their April 2027 step: the
# triple lock's is the May to July 2026 earnings figure (3.9%), calendar-year
# OBR earnings growth's is 2.4%, and lagged CPI's is 2.3%.
AT_EARNINGS = f"{INDICES}.triple_lock"
CALENDAR_EARNINGS = f"{INDICES}.obr.average_earnings"
LAGGED_CPI = f"{INDICES}.obr.lagged_cpi"


def test_the_limit_is_registered_with_its_key():
    assert LIMIT.from_year == 2027


def test_every_pension_age_housing_benefit_allowance_is_covered():
    """Adoption tripwire: later policyengine-uk releases split each
    pension-age allowance in two (``aged`` and ``aged_from_cutoff``). When
    the adopted model has more of them, this fails until each is listed,
    here and in the September CPI limit's pinned list."""
    allowances = installed_system.parameters.get_child(ALLOWANCES)
    pension_age = {
        f"{ALLOWANCES}.{group}.{name}"
        for group, node in allowances.children.items()
        for name in getattr(node, "children", {})
        if name.startswith("aged")
    }
    assert pension_age
    assert pension_age <= set(LIMIT.parameters)


@pytest.mark.parametrize(
    "path, covered",
    [
        (SINGLE, True),
        (COUPLE, True),
        (SAVINGS_CREDIT, True),
        (HOUSING_BENEFIT, True),
        ("gov.dwp.housing_benefit.allowances.couple.aged", True),
        ("gov.dwp.housing_benefit.allowances.lone_parent.aged", True),
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


def _update(parameters, path, date, value):
    parameters.get_child(path).update(start=instant(date), value=value)


def stand_in(
    *,
    published=True,
    index=AT_EARNINGS,
    rates=(SINGLE, COUPLE),
    amounts=None,
    reformed_only=False,
):
    """A processed tree whose guarantee rates in ``rates`` name ``index``
    as their uprating rule, with ``amounts`` typed in for April 2027.

    A built model has both in the tree as built, the ``baseline`` child
    the check reads; ``reformed_only`` puts them only in the tree a
    measure changes. The raw tree records whether May to July 2026
    earnings are published, separately from the processed input, which a
    forecast can fill.
    """
    system = copy.copy(installed_system)
    system.parameters = installed_system.parameters.clone()
    system._parameters_at_instant_cache = {}
    system._raw_parameters = statutory_parameters()
    if not published:
        _update(system._raw_parameters, EARNINGS, "2026-07-01", None)
    trees = [system.parameters]
    if not reformed_only:
        trees.append(system.parameters.children["baseline"])
    for tree in trees:
        for path in rates:
            node = tree.get_child(path)
            node.metadata = {**node.metadata, "uprating": index}
        for path, value in (amounts or {}).items():
            _update(tree, path, "2027-04-01", value)
    return SimpleNamespace(tax_benefit_system=system)


def test_the_stand_in_indices_step_as_described():
    def step(path):
        index = installed_system.parameters.get_child(path)
        return index("2027-04-30") / index("2026-04-30")

    assert step(AT_EARNINGS) == pytest.approx(1 + EARNINGS_2026, abs=1e-5)
    assert step(CALENDAR_EARNINGS) < 1.03
    assert step(LAGGED_CPI) < 1.03


def test_the_installed_model_publishes_the_2026_earnings_input():
    """The check reads this input; if a release unpublishes it, the limit
    could never lift, so say so here rather than in the tripwire."""
    raw = statutory_parameters().get_child(EARNINGS)("2026-07-01")
    assert raw == pytest.approx(EARNINGS_2026)


# Earnings-level 2027-28 rates, as an Up-rating statement would give them.
TYPED_IN = {SINGLE: 247.30, COUPLE: 377.45}


@pytest.mark.parametrize(
    "kwargs, fixed",
    [
        ({}, True),
        ({"index": {"parameter": AT_EARNINGS}}, True),
        # Typed-in 2027-28 rates over the CPI rule: 2028 onwards still
        # follows CPI, and a measure could type them in too.
        ({"index": BENEFIT_INDEX, "amounts": TYPED_IN}, False),
        ({"index": BENEFIT_INDEX}, False),
        ({"index": LAGGED_CPI}, False),
        ({"index": CALENDAR_EARNINGS}, False),
        ({"index": f"{INDICES}.no_such_index"}, False),
        ({"index": None}, False),
        ({"published": False}, False),
        ({"rates": (SINGLE,)}, False),
        ({"rates": (COUPLE,)}, False),
    ],
    ids=[
        "earnings rule",
        "earnings rule, long form",
        "typed-in rates",
        "benefit index",
        "lagged CPI",
        "calendar-year earnings",
        "a missing index",
        "no rule",
        "earnings unpublished",
        "single only",
        "couple only",
    ],
)
def test_the_fix_is_an_earnings_rule_for_both_rates(kwargs, fixed):
    assert LIMIT.fixed(stand_in(**kwargs).tax_benefit_system) is fixed


def test_a_measure_cannot_make_its_own_model_count_as_fixed():
    """The check reads the tree as the model built it: a scenario that
    sets earnings-level 2027 rates, or a modifier that repoints the rule
    in the tree it changes, leaves the model unfixed (review of #90)."""
    scenario = simulation({SINGLE: {"2027": 250.0}, COUPLE: {"2027": 380.0}})
    assert LIMIT.fixed(scenario.tax_benefit_system) is False
    assert LIMIT.fixed(stand_in(reformed_only=True).tax_benefit_system) is (
        False
    )


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


def pensioners(year, count):
    people = {f"p{i}": {"age": {year: 70}} for i in range(count)}
    return {
        "people": people,
        "benunits": {"b": {"members": list(people)}},
        "households": {"h": {"members": list(people)}},
    }


@pytest.mark.parametrize("count", [1, 2], ids=["single", "couple"])
def test_the_fix_check_agrees_with_the_guarantee_pensioners_get(count):
    """Differential: the check reads the uprating rule; this reads the
    standard minimum guarantee the model gives a pensioner benefit unit,
    through its formulas, in 2026-27 and 2027-28."""

    def guarantee(year):
        sim = Simulation(situation=pensioners(year, count))
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
    it. The triple lock reads the input too, so other limits are recorded
    beside it."""
    touched = limits_touched(simulation(), simulation({EARNINGS: {key: 0.1}}))
    assert record(LIMIT, [EARNINGS]) in touched


def test_a_measure_confined_to_2026_does_not_record_the_limit():
    """The 2026-27 rates are legislated and unaffected."""
    assert (
        limits_touched(simulation(), simulation({SINGLE: {"2026": 250.0}}))
        == []
    )


@pytest.mark.parametrize("value", [238.0, 300.0], ids=["freeze", "raise"])
def test_with_the_fix_a_guarantee_measure_records_only_the_benefit_limit(
    value,
):
    """The limit expires on its own once the model has the fix, whatever
    the measure does to the guarantee: the check reads the rule, not the
    measure's amounts."""
    reformed = stand_in()
    _update(
        reformed.tax_benefit_system.parameters, SINGLE, "2027-04-01", value
    )
    touched = limits_touched(stand_in(), reformed)
    assert [item["key"] for item in touched] == [BENEFIT_LIMIT.key]


def test_a_measure_typing_in_the_guarantee_does_not_count_as_the_fix():
    """Earnings-level 2027 rates on both sides, over the CPI rule, leave the
    model unfixed, so a measure on another covered amount stays held."""
    baseline = stand_in(index=BENEFIT_INDEX, amounts=TYPED_IN)
    reformed = stand_in(
        index=BENEFIT_INDEX, amounts={**TYPED_IN, SAVINGS_CREDIT: 230.0}
    )
    touched = limits_touched(baseline, reformed)
    assert record(LIMIT, [SAVINGS_CREDIT]) in touched


def test_a_template_built_measure_warns():
    with pytest.warns(ModelLimitedWarning, match="minimum guarantee"):
        rate_change(SINGLE, {2027: 260.0})
