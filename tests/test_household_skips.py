"""The household skip rules: each rule against the full run in every policy
year, and each rule tied to the definition its last check ran on.

``household_impact.provably_unaffected`` leaves a measure out of the split by
policy when ``rule_says_unaffected`` says it is exactly £0 for a household and
year and ``household_skip_definitions.rule_is_current`` says the rule's last
check ran on the measure's definition as it now stands.

The invariants, for every household, year and selection of measures:

1. Soundness: where a current rule says £0, the measure's own run leaves net
   income unchanged, to the last bit (the page's status compares the
   unrounded change with 0).
2. Equivalence: the split by policy with skips equals the split without.
3. Fail-safe: a rule whose definition has changed, or that the code can't work
   out, is off, and the measure runs in full with its own row.
4. A definition digest changes with whatever a measure's own run reads from
   the definitions, stays the same for a label or another checkout, and
   doesn't depend on the process.
5. Only a check the rule passed, on households it said £0 for, turns a rule on.

A stale rule fails no test here: the calculator is right without it, only
slower, and CI's "Household skip rules" check names it. A correction must not
wait on a speed-up. So the tests that read the committed digests assert only
on the rules they find current, and the rest set the digests themselves.
"""

import ast
import dataclasses
import importlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import uuid
from pathlib import Path

import pytest
from hypothesis import HealthCheck, Phase, given, seed, settings
from hypothesis import strategies as st

from uk_budget_data import (
    household_impact,
    household_skip_check,
    household_skip_definitions,
    measure_templates,
    reforms,
)
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.household_impact import (
    BUS_FARE_CAP_REGIONS,
    SKIP_REASONS,
    HouseholdAnswers,
    provably_unaffected,
    rule_says_unaffected,
)
from uk_budget_data.household_skip_check import (
    ANSWER_VALUES,
    ANSWERS_NOT_GENERATED,
    NAMED_HOUSEHOLDS,
)
from uk_budget_data.household_skip_definitions import (
    CHANGED,
    CURRENT,
    NEVER_CHECKED,
    NO_DEFINITION,
    NO_RULE,
    NOT_REGISTERED,
    checked_definitions,
    clear_definition_cache,
    current_definitions,
    record_checked,
    rule_is_current,
    rule_statuses,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication.receipt import ReceiptUnavailable

# The measures with a rule that the registry has, as of this test's writing.
# Written out so that a rule dropped by accident shows here.
REGISTERED_RULES = (
    "bus_fare_cap_2027",
    "carers_allowance_earnings_taper",
    "cash_isa_limit_kept",
    "domestic_electricity_zero_vat",
    "fuel_duty_rise_deferral",
    "machine_games_duty_rise",
    "property_income_rates_up",
    "savings_income_rates_up",
    "state_pension_income_tax_protection",
    "trading_allowance_raise",
)
# A household and year each registered rule says £0 for.
UNAFFECTED = {
    "bus_fare_cap_2027": ({"bus_fare_spending": 0}, 2026),
    "carers_allowance_earnings_taper": ({"is_carer": False}, 2031),
    "cash_isa_limit_kept": ({"cash_isa_subscriptions": 0}, 2027),
    "domestic_electricity_zero_vat": ({"electricity_spending": 0}, 2027),
    "fuel_duty_rise_deferral": ({"petrol_spending": 0}, 2027),
    "machine_games_duty_rise": ({"higher_stake_machine_losses": 0}, 2027),
    "property_income_rates_up": ({"property_income": 0}, 2027),
    "savings_income_rates_up": ({"savings_interest_income": 0}, 2027),
    "state_pension_income_tax_protection": ({"age": 40}, 2027),
    "trading_allowance_raise": ({"self_employment_receipts": 0}, 2027),
}
# A parameter no measure changes, for a definition changed by one that does.
UNTOUCHED_PARAMETER = (
    "gov.hmrc.income_tax.allowances.personal_allowance.amount"
)
# 2026-27, then 2027-28 on (household_impact.state_pension_age, which runs a
# simulation; test_the_state_pension_ages_here_are_the_engines keeps these
# true). The properties below run many households, so they don't ask it.
STATE_PENSION_AGES = {2026: 66, **{year: 67 for year in POLICY_YEARS[1:]}}


def _answers(**values):
    return HouseholdAnswers(**{"salary_year": 2026, **values})


@pytest.fixture(autouse=True)
def _fresh():
    """Each test works out its own digests, in a process whose earlier runs
    may have left a warning attributed to a measure's module, and asks a
    stand-in engine afresh."""
    _forget_warnings()
    clear_definition_cache()
    household_impact.clear_runs()
    yield
    clear_definition_cache()
    household_impact.clear_runs()


def _forget_warnings():
    for name, module in list(sys.modules.items()):
        if name.startswith("uk_budget_data.budget_measures."):
            vars(module).pop("__warningregistry__", None)


@pytest.fixture
def state_pension_ages(monkeypatch):
    monkeypatch.setattr(
        household_impact, "state_pension_age", STATE_PENSION_AGES.__getitem__
    )


@pytest.fixture
def every_rule_current(monkeypatch):
    """Every rule counts as having passed its check on the definition it now
    has, so a test of the skips doesn't depend on the committed digests."""
    monkeypatch.setattr(
        household_skip_definitions,
        "checked_definitions",
        lambda: household_skip_definitions.current_definitions(),
    )


def _use_registry(monkeypatch, changed: dict):
    """The registry with these measures replaced, ``{id: Reform}``, and any
    new id added. Every reader goes through these two caches."""
    members = [
        reform
        for reform in reforms.get_autumn_budget_2026_reforms()
        if reform.id != reforms.AUTUMN_BUDGET_2026_COMBINED_ID
    ]
    kept = [changed.get(reform.id, reform) for reform in members]
    known = {reform.id for reform in members}
    kept += [reform for id_, reform in changed.items() if id_ not in known]
    monkeypatch.setattr(reforms, "_AUTUMN_BUDGET_2026_REFORMS_CACHE", kept)
    monkeypatch.setattr(
        reforms, "_REFORM_LOOKUP_CACHE", {reform.id: reform for reform in kept}
    )
    clear_definition_cache()


def _changed(reform, **fields):
    return reform.model_copy(update=fields)


def _record_at(path: Path, monkeypatch) -> Path:
    """The record of checked digests at ``path``, for reading and writing."""

    class Package:
        @staticmethod
        def joinpath(_name):
            return path

    monkeypatch.setattr(
        household_skip_definitions, "files", lambda _name: Package
    )
    return path


def _with_a_parameter_changed(reform, value=13_000):
    return _changed(
        reform,
        parameter_changes={
            **(reform.parameter_changes or {}),
            UNTOUCHED_PARAMETER: {"2026": value},
        },
    )


def _module(tmp_path, monkeypatch, source: str):
    name = f"skip_rule_mutant_{uuid.uuid4().hex}"
    (tmp_path / f"{name}.py").write_text(source)
    monkeypatch.syspath_prepend(str(tmp_path))
    return importlib.import_module(name)


MODIFIER = """RATE = {rate}


def modifier(sim, step={step}):
    return sim
"""


# --- A rule applies only to the definition its last check ran on ----------


@pytest.mark.parametrize("measure", REGISTERED_RULES)
def test_changing_a_measures_definition_disables_its_rule(
    measure, monkeypatch
):
    """The same household, year and rule. The rule's last check ran on the
    measure as it was; the measure changes and keeps its id; the rule stops
    applying, though it still says £0."""
    answers, year = UNAFFECTED[measure]
    answers = _answers(**answers)
    assert rule_says_unaffected(measure, answers, year)
    checked = dict(current_definitions())
    monkeypatch.setattr(
        household_skip_definitions, "checked_definitions", lambda: checked
    )
    assert provably_unaffected(measure, answers, year)

    _use_registry(
        monkeypatch,
        {measure: _with_a_parameter_changed(reforms.get_reform(measure))},
    )

    assert rule_says_unaffected(measure, answers, year)
    assert not rule_is_current(measure)
    assert not provably_unaffected(measure, answers, year)


@given(
    value=st.integers(1, 100_000).filter(lambda value: value != 13_000),
    measure=st.sampled_from(REGISTERED_RULES),
)
@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_any_changed_value_changes_the_digest(value, measure, monkeypatch):
    """For any value of a changed parameter, however small the change."""
    reform = reforms.get_reform(measure)
    with monkeypatch.context() as patch:
        _use_registry(patch, {measure: _with_a_parameter_changed(reform)})
        one = current_definitions()[measure]
        _use_registry(
            patch, {measure: _with_a_parameter_changed(reform, value)}
        )
        other = current_definitions()[measure]
    clear_definition_cache()
    assert one != other


def test_a_labels_wording_changes_no_definition(monkeypatch):
    before = dict(current_definitions())
    reform = reforms.get_reform("fuel_duty_rise_deferral")
    _use_registry(
        monkeypatch,
        {
            reform.id: _changed(
                reform,
                name="Reworded",
                description="Reworded, for the page only.",
            )
        },
    )
    assert current_definitions() == before


def test_each_definition_is_its_own(monkeypatch):
    """Changing one measure's Budget side leaves the other measures' rules
    alone: only a pre-Budget side reaches them."""
    before = dict(current_definitions())
    measure = "machine_games_duty_rise"
    _use_registry(
        monkeypatch,
        {measure: _with_a_parameter_changed(reforms.get_reform(measure))},
    )
    after = current_definitions()
    assert {id_ for id_ in before if before[id_] != after[id_]} == {measure}


def test_a_change_to_a_pre_budget_side_disables_every_rule(monkeypatch):
    """Every measure's own run holds the planned cash ISA limit at its
    pre-Budget side when a reader selects both, and the savings rule reads it:
    every rule's check ran on that side."""
    before = dict(current_definitions())
    limit = reforms.get_reform(reforms.CASH_ISA_LIMIT_ID)
    assert limit.baseline_scenario_for(DataConfig()) is not None
    _use_registry(
        monkeypatch,
        {
            limit.id: _changed(
                limit,
                baseline_parameter_changes={
                    **(limit.baseline_parameter_changes or {}),
                    UNTOUCHED_PARAMETER: {"2026": 13_000},
                },
            )
        },
    )
    after = current_definitions()
    assert set(after) == set(before)
    assert all(after[id_] != before[id_] for id_ in before)


def test_a_new_pre_budget_side_disables_every_rule(monkeypatch):
    """A measure added with a pre-Budget side of its own is in every other
    measure's run from then on."""
    before = dict(current_definitions())
    _use_registry(
        monkeypatch,
        {
            "new_measure": Reform(
                id="new_measure",
                name="New",
                baseline_parameter_changes={
                    UNTOUCHED_PARAMETER: {"2026": 13_000}
                },
            )
        },
    )
    after = current_definitions()
    assert all(after[id_] != before[id_] for id_ in before)


def test_a_new_measure_on_current_law_disables_no_rule(monkeypatch):
    """Other measures' runs hold it at current law, as they did."""
    before = dict(current_definitions())
    _use_registry(
        monkeypatch,
        {
            "new_measure": Reform(
                id="new_measure",
                name="New",
                parameter_changes={UNTOUCHED_PARAMETER: {"2026": 13_000}},
            )
        },
    )
    after = current_definitions()
    assert {id_: after[id_] for id_ in before} == before


@pytest.mark.parametrize(
    "first, second",
    [
        pytest.param(
            MODIFIER.format(rate=0.2, step=1),
            MODIFIER.format(rate=0.25, step=1),
            id="a constant in the modifier's module",
        ),
        pytest.param(
            MODIFIER.format(rate=0.2, step=1),
            MODIFIER.format(rate=0.2, step=2),
            id="a default argument",
        ),
        pytest.param(
            MODIFIER.format(rate=0.2, step=1),
            MODIFIER.format(rate=0.2, step=1).replace(
                "return sim", "sim.changed = True\n    return sim"
            ),
            id="the modifier's code",
        ),
    ],
)
def test_a_change_to_a_modifier_disables_its_rule(
    first, second, tmp_path, monkeypatch
):
    def digest(source):
        reform = reforms.get_reform("fuel_duty_rise_deferral")
        module = _module(tmp_path, monkeypatch, source)
        # The same name each time: only the source differs.
        module.modifier.__module__ = "skip_rule_mutant"
        module.__name__ = "skip_rule_mutant"
        monkeypatch.setitem(sys.modules, "skip_rule_mutant", module)
        _use_registry(
            monkeypatch,
            {reform.id: _changed(reform, simulation_modifier=module.modifier)},
        )
        return current_definitions()[reform.id]

    assert digest(first) != digest(second)


def test_a_change_to_the_shared_template_code_disables_every_rule(
    tmp_path, monkeypatch
):
    """A receipt binds ``measure_templates`` only through its commit, and a
    digest has no commit in it, so the digest reads its source."""
    before = dict(current_definitions())
    copy = tmp_path / "measure_templates.py"
    copy.write_bytes(
        Path(measure_templates.__file__).read_bytes() + b"\n# Changed\n"
    )

    class EditedTemplates:
        __name__ = measure_templates.__name__
        __file__ = str(copy)

    monkeypatch.setattr(
        household_skip_definitions, "SHARED_CODE", (EditedTemplates,)
    )
    clear_definition_cache()
    after = current_definitions()
    assert set(after) == set(before)
    assert all(after[id_] != before[id_] for id_ in before)


def test_the_shared_code_is_all_a_modifier_calls():
    """A modifier's module is in its measure's identity. Walking what those
    modules import, within this package: ``SHARED_CODE`` or this test names
    every module, with why it can't change an answer. A helper module a
    modifier starts to call fails this until one of them names it."""
    only_warn = {
        # The templates import these only to warn about a limit on a change
        # (_warn_if_data_limited and the like) and to refuse a wealth tax
        # scale; neither changes a number.
        "uk_budget_data.data_limits",
        "uk_budget_data.model_limits",
    }
    package = Path(household_impact.__file__).parent
    shared = {
        module.__name__ for module in household_skip_definitions.SHARED_CODE
    }
    found, stack = set(), [
        module.stem
        for module in (package / "budget_measures").glob("*.py")
        if module.stem != "__init__"
    ]
    stack = [f"uk_budget_data.budget_measures.{stem}" for stem in stack]
    bound = set(stack)
    while stack:
        path = package.parent / (stack.pop().replace(".", "/") + ".py")
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            elif isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            for name in names:
                if name.startswith("uk_budget_data") and name not in found:
                    found.add(name)
                    if name in shared:
                        stack.append(name)
    assert found - bound - only_warn <= shared
    assert shared <= found


@pytest.mark.parametrize(
    "measure", [reforms.CASH_ISA_LIMIT_ID, "fuel_duty_rise_deferral"]
)
def test_a_definition_that_cannot_be_worked_out_counts_as_changed(
    measure, monkeypatch
):
    """The receipt API's refusal, for one measure: its rule is off. For a
    measure with a pre-Budget side, in every other measure's run, all are."""
    every = dict(current_definitions())
    monkeypatch.setattr(
        household_skip_definitions, "checked_definitions", lambda: every
    )
    real = household_skip_definitions.measure_identities

    def refuse(reform, config, revision):
        if reform.id == measure:
            raise ReceiptUnavailable(measure, "refused")
        return real(reform, config, revision)

    monkeypatch.setattr(
        household_skip_definitions, "measure_identities", refuse
    )
    clear_definition_cache()
    assert not rule_is_current(measure)
    other = "machine_games_duty_rise"
    assert rule_is_current(other) is (measure != reforms.CASH_ISA_LIMIT_ID)
    assert rule_statuses(SKIP_REASONS)[measure] == NO_DEFINITION


def test_a_failure_working_out_definitions_turns_rules_off_not_the_calculator(
    monkeypatch,
):
    def fail():
        raise OSError("no source")

    monkeypatch.setattr(household_skip_definitions, "_shared_code", fail)
    clear_definition_cache()
    assert current_definitions() == {}
    assert not provably_unaffected("fuel_duty_rise_deferral", _answers(), 2027)


def test_a_digest_for_a_measure_the_registry_lacks_is_off(monkeypatch):
    """A withdrawn measure's rule stays off, recorded digest or not."""
    measure = "warm_home_discount_top_up"
    assert measure in SKIP_REASONS
    assert measure not in household_impact.measure_ids()
    monkeypatch.setattr(
        household_skip_definitions,
        "checked_definitions",
        lambda: {measure: "0" * 64},
    )
    assert rule_says_unaffected(measure, _answers(), 2027)
    assert not provably_unaffected(measure, _answers(), 2027)


@pytest.mark.parametrize(
    "content",
    ["not json", "[]", '"a string"'],
    ids=["not JSON", "a list", "a string"],
)
def test_an_unreadable_record_leaves_every_rule_off(
    content, tmp_path, monkeypatch
):
    _record_at(tmp_path / "pins.json", monkeypatch).write_text(content)
    clear_definition_cache()
    assert checked_definitions() == {}
    assert not any(rule_is_current(id_) for id_ in REGISTERED_RULES)


def test_a_missing_record_leaves_every_rule_off(monkeypatch):
    monkeypatch.setattr(
        household_skip_definitions, "CHECKED_FILE", "no_such_file.json"
    )
    clear_definition_cache()
    assert checked_definitions() == {}
    assert not any(rule_is_current(id_) for id_ in REGISTERED_RULES)


def test_the_record_names_rules_and_full_digests():
    """The committed file's shape. Whether each digest is current is the
    "Household skip rules" check's business, not a required test's."""
    checked = json.loads(
        (
            Path(household_impact.__file__).parent
            / household_skip_definitions.CHECKED_FILE
        ).read_text()
    )
    assert checked
    assert set(checked) <= set(SKIP_REASONS)
    assert all(re.fullmatch(r"[0-9a-f]{64}", d) for d in checked.values())


def test_recording_a_check_turns_that_rule_on_and_leaves_the_others(
    tmp_path, monkeypatch
):
    path = _record_at(tmp_path / "pins.json", monkeypatch)
    other = "0" * 64
    path.write_text(json.dumps({"fuel_duty_rise_deferral": other}))
    clear_definition_cache()
    assert not rule_is_current("machine_games_duty_rise")
    assert record_checked(["machine_games_duty_rise"]) == path
    assert rule_is_current("machine_games_duty_rise")
    assert not rule_is_current("fuel_duty_rise_deferral")
    written = json.loads(path.read_text())
    assert written["fuel_duty_rise_deferral"] == other
    assert written["machine_games_duty_rise"] == (
        current_definitions()["machine_games_duty_rise"]
    )


def test_the_statuses_name_every_state(monkeypatch):
    current = dict(current_definitions())
    monkeypatch.setattr(
        household_skip_definitions,
        "checked_definitions",
        lambda: {
            "fuel_duty_rise_deferral": current["fuel_duty_rise_deferral"],
            "machine_games_duty_rise": "0" * 64,
            "warm_home_discount_top_up": "0" * 64,
        },
    )
    statuses = rule_statuses(SKIP_REASONS)
    assert statuses["fuel_duty_rise_deferral"] == CURRENT
    assert statuses["machine_games_duty_rise"] == CHANGED
    assert statuses["bus_fare_cap_2027"] == NEVER_CHECKED
    assert statuses["household_energy_payment_2026"] == NO_RULE
    assert statuses["warm_home_discount_top_up"] == NOT_REGISTERED


def test_the_digests_are_the_same_from_a_copy_outside_any_repository(tmp_path):
    """As in the API image, at another path, in a fresh interpreter with
    another hash seed: a digest that differed there would turn every rule off
    in production and in nothing else."""
    source = Path(household_impact.__file__).parent
    copy = tmp_path / "app" / "src"
    shutil.copytree(
        source,
        copy / source.name,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    assert subprocess.run(
        ["git", "rev-parse", "--git-dir"], cwd=copy, capture_output=True
    ).returncode, "the copy must be outside any repository"
    script = textwrap.dedent(
        f"""
        import json, sys
        sys.path.insert(0, {str(copy)!r})
        import uk_budget_data
        from uk_budget_data import household_skip_definitions as definitions
        assert uk_budget_data.__file__.startswith({str(copy)!r})
        print(json.dumps(definitions.current_definitions()))
        """
    )
    output = subprocess.run(
        [sys.executable, "-c", script],
        cwd=copy.parent,
        env={**os.environ, "PYTHONHASHSEED": "12345"},
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    there = json.loads(output.strip().splitlines()[-1])
    assert there == current_definitions()
    assert there


# --- The rules' reach -----------------------------------------------------


@pytest.mark.usefixtures("state_pension_ages")
def test_only_measures_with_a_listed_reason_have_a_rule():
    """Every answer that could fire a rule, in every year: a measure not in
    ``SKIP_REASONS`` never does."""
    households = [*NAMED_HOUSEHOLDS.values(), HouseholdAnswers()]
    for measure in (*household_impact.measure_ids(), "some_future_measure"):
        fires = any(
            rule_says_unaffected(measure, answers, year)
            for answers in households
            for year in POLICY_YEARS
        )
        assert fires is (measure in SKIP_REASONS), measure


def test_every_registered_rule_is_listed_here():
    registered = set(household_impact.measure_ids())
    assert set(SKIP_REASONS) & registered == set(REGISTERED_RULES)
    assert set(UNAFFECTED) == set(REGISTERED_RULES)


# Rules that hold for every household and year: nothing can be eligible.
UNCONDITIONAL_RULES = {
    "badr_lifetime_limit_cut",
    "employer_ni_relief_under_25s",
}


@pytest.mark.usefixtures("state_pension_ages")
@pytest.mark.parametrize(
    "measure", sorted(set(SKIP_REASONS) - UNCONDITIONAL_RULES)
)
def test_the_named_households_cover_both_sides_of_every_conditional_rule(
    measure,
):
    """At least one named household the rule leaves to the run, and at least
    one it says £0 for, somewhere in the policy years."""
    says = {
        rule_says_unaffected(measure, answers, year)
        for answers in NAMED_HOUSEHOLDS.values()
        for year in POLICY_YEARS
    }
    assert says == {True, False}


@pytest.mark.parametrize("measure", sorted(UNCONDITIONAL_RULES))
def test_an_unconditional_rule_says_so_for_every_named_household(measure):
    assert all(
        rule_says_unaffected(measure, answers, year)
        for answers in NAMED_HOUSEHOLDS.values()
        for year in POLICY_YEARS
    )


def test_the_named_households_include_each_kind_a_rule_turns_on():
    named = NAMED_HOUSEHOLDS.values()
    # Warm Home Discount: receiving a benefit its measure pays on
    assert any(a.claims_universal_credit for a in named)
    # State Pension protection: at State Pension age, head or partner
    assert any(a.age >= 67 for a in named)
    assert any(a.has_partner and a.partner_age >= 67 for a in named)
    # Plan 2: head or partner
    assert any(a.student_loan_plan == "PLAN_2" for a in named)
    assert any(
        a.has_partner and a.partner_student_loan_plan == "PLAN_2"
        for a in named
    )
    # Fuel and electricity
    assert any(a.petrol_spending for a in named)
    assert any(a.diesel_spending for a in named)
    assert any(a.electricity_spending for a in named)
    assert any(not a.electricity_spending for a in named)
    # Bus fares, inside the cap's area and outside
    assert any(
        a.bus_fare_spending and a.region in BUS_FARE_CAP_REGIONS for a in named
    )
    assert any(
        a.bus_fare_spending and a.region not in BUS_FARE_CAP_REGIONS
        for a in named
    )
    # The cash ISA limit, over it, on it and at the age it stops applying
    assert any(a.cash_isa_subscriptions > 12_000 and a.age < 65 for a in named)
    assert any(a.cash_isa_subscriptions == 12_000 for a in named)
    assert any(
        a.cash_isa_subscriptions > 12_000 and a.age == 65 for a in named
    )


def test_the_generator_covers_every_answer():
    """A new answer on the form fails this until generated households vary
    it: no check can reach an answer no household gives."""
    fields = {field.name for field in dataclasses.fields(HouseholdAnswers)}
    assert set(ANSWER_VALUES) | ANSWERS_NOT_GENERATED == fields
    assert not set(ANSWER_VALUES) & ANSWERS_NOT_GENERATED


def test_generated_households_are_reproducible_and_answerable():
    from uk_budget_data import api

    one = household_skip_check.generated_households(20, seed=7)
    assert one == household_skip_check.generated_households(20, seed=7)
    assert one != household_skip_check.generated_households(20, seed=8)
    for answers in one:
        api.HouseholdAnswersRequest(**_as_request(answers))


def _as_request(answers):
    values = dataclasses.asdict(answers)
    values["children"] = [dataclasses.asdict(c) for c in answers.children]
    return values


@pytest.mark.slow
def test_the_state_pension_ages_here_are_the_engines():
    assert {
        year: household_impact.state_pension_age(year) for year in POLICY_YEARS
    } == STATE_PENSION_AGES


# --- Skips, with a stand-in engine ----------------------------------------


def households():
    """Any household ``generated_households`` could draw, and amounts
    between its values, within what the form accepts."""
    amount = st.floats(0, 20_000, allow_nan=False).map(lambda v: round(v, 2))
    money = {
        "employment_income",
        "partner_employment_income",
        "dividend_income",
        "savings_interest_income",
        "cash_isa_subscriptions",
        "property_income",
        "private_pension_income",
        "partner_private_pension_income",
        "petrol_spending",
        "diesel_spending",
        "electricity_spending",
        "bus_fare_spending",
        "higher_stake_machine_losses",
        "self_employment_receipts",
        "self_employment_expenses",
    }
    return st.builds(
        HouseholdAnswers,
        **{
            name: (
                st.one_of(st.sampled_from(values), amount)
                if name in money
                else st.sampled_from(values)
            )
            for name, values in ANSWER_VALUES.items()
        },
    )


PROPERTIES = settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@given(households())
@settings(max_examples=30, deadline=None)
def test_a_drawn_household_is_one_the_form_accepts(answers):
    from uk_budget_data import api

    api.HouseholdAnswersRequest(**_as_request(answers))


def _stand_in_engine(monkeypatch, sides, effects, base=40_000.0):
    """Net income is ``base`` plus the effect of whichever measure's own side
    the run is of; the after side gets them all. Returns the sides asked."""
    calls = []
    singles = {
        json.dumps(side, sort_keys=True, default=str): id_
        for id_, side in sides.singles.items()
    }
    after = json.dumps(sides.after, sort_keys=True, default=str)

    def run_scenario(
        people, benunit, household, year, side, axes=None, only=False
    ):
        calls.append(side)
        key = json.dumps(side, sort_keys=True, default=str)
        net = base
        if key == after:
            net += sum(effects.values())
        elif key in singles:
            net += effects.get(singles[key], 0.0)
        if only:
            return {"household_net_income": net}
        return {
            "household_net_income": net,
            "rows": {row.id: 0.0 for row in household_impact._all_rows()},
            "dependants": [
                {v: True for v in household_impact.DEPENDANT_VARIABLES}
            ],
            "brma": "X",
            "local_authority": "Y",
        }

    monkeypatch.setattr(household_impact, "run_scenario", run_scenario)
    return calls


def _by_policy(answers, ids, year, **kwargs):
    household_impact.clear_runs()
    return household_impact.calculate_household_impact(
        answers, ids, year, include=("by_policy",), **kwargs
    )


def _rows(result):
    return {row["id"]: row for row in result["by_policy"]["measures"]}


@pytest.mark.usefixtures("state_pension_ages", "every_rule_current")
@given(
    answers=households(),
    year=st.sampled_from(POLICY_YEARS),
    dropped=st.sets(st.sampled_from(REGISTERED_RULES), max_size=9),
)
@PROPERTIES
def test_a_skipped_measure_is_not_run_and_shows_as_its_run_would(
    answers, year, dropped, monkeypatch
):
    """Any household, year and selection. With an engine where each measure's
    own run shows nothing where its rule says so: the same answer with skips
    as without, and no run asked for the measures left out."""
    ids = [id_ for id_ in household_impact.measure_ids() if id_ not in dropped]
    sides = household_impact.measure_sides(ids)
    says = {id_: rule_says_unaffected(id_, answers, year) for id_ in ids}
    if len(ids) < 2:
        return
    effects = {
        id_: 0.0 if says[id_] else 10.0 + index
        for index, id_ in enumerate(ids)
    }
    with monkeypatch.context() as patch:
        calls = _stand_in_engine(patch, sides, effects)
        full = _by_policy(answers, ids, year, skip_unaffected=False)
        asked_in_full = list(calls)
        calls.clear()
        fast = _by_policy(answers, ids, year)
    assert fast == full
    assert len(asked_in_full) == 2 + len(ids)
    assert calls == [
        sides.before,
        sides.after,
        *(sides.singles[id_] for id_ in sides.included if not says[id_]),
    ]
    rows = _rows(fast)
    for id_ in ids:
        if says[id_]:
            assert rows[id_]["change"] == 0
            assert rows[id_]["status"] == "not_affected"


@pytest.mark.usefixtures("state_pension_ages")
@given(
    answers=households(),
    year=st.sampled_from(POLICY_YEARS),
    changed=st.sets(st.sampled_from(REGISTERED_RULES), min_size=1),
)
@PROPERTIES
def test_a_measure_with_a_stale_rule_keeps_its_own_row(
    answers, year, changed, monkeypatch
):
    """The failure a stale rule would cause. A measure's definition changes,
    so that it now moves a household its rule says £0 for. It is run, and its
    effect stays in its own row, not in "Interaction between policies"."""
    ids = household_impact.measure_ids()
    sides = household_impact.measure_sides(ids)
    current = current_definitions()
    checked = {
        id_: "0" * 64 if id_ in changed else digest
        for id_, digest in current.items()
    }
    effects = {id_: 25.0 if id_ in changed else 0.0 for id_ in ids}
    with monkeypatch.context() as patch:
        patch.setattr(
            household_skip_definitions, "checked_definitions", lambda: checked
        )
        calls = _stand_in_engine(patch, sides, effects)
        result = _by_policy(answers, ids, year)
    rows = _rows(result)
    for id_ in changed:
        assert sides.singles[id_] in calls
        assert rows[id_]["change"] == 25
        assert rows[id_]["status"] == "affected"
    assert result["by_policy"]["residual"] == 0


@pytest.mark.usefixtures("state_pension_ages", "every_rule_current")
def test_a_current_rule_trusted_wrongly_would_fold_the_effect_into_interaction(
    monkeypatch,
):
    """What the digest prevents, with the digest out of the way: the test
    takes the rule as current, the engine moves the household anyway, and the
    row reads £0 with the effect in the residual. Only the differential test
    below, and the recheck, stand between a wrong current rule and this."""
    ids = household_impact.measure_ids()
    measure = "machine_games_duty_rise"
    answers = _answers()
    assert rule_says_unaffected(measure, answers, 2027)
    sides = household_impact.measure_sides(ids)
    effects = {id_: 0.0 for id_ in ids}
    effects[measure] = 25.0
    _stand_in_engine(monkeypatch, sides, effects)
    result = _by_policy(answers, ids, 2027)
    assert _rows(result)[measure]["change"] == 0
    assert _rows(result)[measure]["status"] == "not_affected"
    assert result["by_policy"]["residual"] == 25


@pytest.mark.usefixtures("state_pension_ages")
@given(
    answers=households(),
    year=st.sampled_from(POLICY_YEARS),
    measure=st.sampled_from(
        (*REGISTERED_RULES, "household_energy_payment_2026", "not_a_measure")
    ),
    current=st.booleans(),
)
@PROPERTIES
def test_provably_unaffected_is_exactly_the_rule_and_its_check(
    answers, year, measure, current, monkeypatch
):
    with monkeypatch.context() as patch:
        patch.setattr(
            household_skip_definitions,
            "checked_definitions",
            lambda: current_definitions() if current else {},
        )
        assert provably_unaffected(measure, answers, year) is (
            rule_is_current(measure)
            and rule_says_unaffected(measure, answers, year)
        )
        if not current:
            assert not provably_unaffected(measure, answers, year)


# --- The check and the recheck, with a stand-in engine ---------------------


def _engine_that_moves(patch, measure, moved, selections=None):
    """``household_skip_check.net_incomes`` where net income moves by £1 on
    ``measure``'s own run, in these selections (by default all of them), where
    ``moved(answers, year)`` says, and nowhere else."""
    selections = selections or household_skip_check.selections()
    own = [
        household_impact.measure_sides(ids).singles[measure]
        for ids in selections.values()
        if measure in ids
    ]

    def net_incomes(households_, year, side):
        return [
            40_000.0 + (1.0 if side in own and moved(answers, year) else 0.0)
            for answers in households_
        ]

    patch.setattr(household_skip_check, "net_incomes", net_incomes)


def _engine_that_moves_nothing(patch):
    patch.setattr(
        household_skip_check,
        "net_incomes",
        lambda households_, year, side: [40_000.0] * len(households_),
    )


@pytest.mark.usefixtures("state_pension_ages")
@given(
    answers=households(),
    year=st.sampled_from(POLICY_YEARS),
    measure=st.sampled_from(REGISTERED_RULES),
)
@PROPERTIES
def test_the_check_reports_exactly_the_zeros_the_engine_contradicts(
    answers, year, measure, monkeypatch
):
    """Any household, year and rule, with an engine that moves the household
    on that measure's own run, in each selection with the measure. The check
    breaks the rule where the rule says £0, and says nothing where it doesn't.
    One selection at a time: the cash ISA limit's own run in one is the other's
    before side, and an engine is a function of the side."""
    says = rule_says_unaffected(measure, answers, year)
    for name, ids in household_skip_check.selections().items():
        if measure not in ids:
            continue
        with monkeypatch.context() as patch:
            _engine_that_moves(patch, measure, lambda *_: True, {name: ids})
            broken = household_skip_check.check_selection(
                [answers], year, name, ids
            ).broken()
        assert {(effect.selection, effect.measure) for effect in broken} == (
            {(name, measure)} if says else set()
        )


@pytest.mark.usefixtures("state_pension_ages")
@pytest.mark.parametrize(
    "measure, drawn, moved, smallest",
    [
        pytest.param(
            "machine_games_duty_rise",
            {"age": 45, "employment_income": 70_000, "region": "WALES"},
            lambda answers: answers.age == 45,
            {"age": 45},
            id="keeps the answer the contradiction needs",
        ),
        pytest.param(
            "domestic_electricity_zero_vat",
            {"age": 45, "electricity_spending": 0},
            lambda answers: True,
            {"electricity_spending": 0},
            id="keeps the answer the rule needs to say 0",
        ),
    ],
)
def test_the_smallest_counterexample_drops_every_other_answer(
    measure, drawn, moved, smallest, monkeypatch
):
    households_ = [_answers(**drawn)]
    _engine_that_moves(monkeypatch, measure, lambda answers, _: moved(answers))
    broken = household_skip_check.check_year(households_, 2027).broken()
    assert broken
    for effect in broken:
        answers, change = household_skip_check.smallest_counterexample(
            effect, households_
        )
        assert household_skip_check.describe(answers) == smallest
        assert change == 1.0


class _InThisProcess:
    """The part of ``ProcessPoolExecutor`` the recheck uses, here, so that its
    years run on the test's stand-in engine."""

    def __init__(self, _processes):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    map = staticmethod(map)


@pytest.fixture
def verify(monkeypatch):
    """``scripts/verify_household_skips.py``."""
    path = Path(__file__).parents[1] / "scripts" / "verify_household_skips.py"
    spec = importlib.util.spec_from_file_location("verify_skips_here", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ProcessPoolExecutor", _InThisProcess)
    return module


@pytest.fixture
def record(tmp_path, monkeypatch):
    """An empty record of checked digests, the test's own."""
    path = _record_at(tmp_path / "pins.json", monkeypatch)
    path.write_text("{}\n")
    clear_definition_cache()
    return path


def _recheck(verify, *measures):
    return verify.recheck(list(measures), 0, 2026, 1)


@pytest.mark.usefixtures("state_pension_ages")
@pytest.mark.parametrize(
    "moved",
    [
        pytest.param(lambda answers, year: answers.age == 45, id="every year"),
        pytest.param(
            lambda answers, year: answers.age == 45
            and year == POLICY_YEARS[-1],
            id="the last year alone",
        ),
    ],
)
def test_the_recheck_turns_on_a_rule_that_holds_and_not_a_wrong_one(
    moved, verify, record, monkeypatch, capsys
):
    """The whole recheck but for the engine: named households, every year,
    both selections, the file."""
    right, wrong = "fuel_duty_rise_deferral", "machine_games_duty_rise"
    _engine_that_moves(monkeypatch, wrong, moved)
    assert _recheck(verify, right, wrong) == 1
    assert rule_is_current(right)
    assert not rule_is_current(wrong)
    assert set(json.loads(record.read_text())) == {right}
    output = capsys.readouterr().out
    assert f"{wrong}: the rule is wrong" in output
    assert "{'age': 45}" in output
    # In every selection the measure is in
    for selection in household_skip_check.selections():
        assert f"selection {selection}:" in output


@pytest.mark.usefixtures("state_pension_ages")
def test_a_recheck_that_fails_turns_off_a_rule_that_was_on(
    verify, record, monkeypatch
):
    """The digest doesn't cover the engine, so a rule can be current and
    wrong. Once a recheck finds it wrong, it is off."""
    wrong = "machine_games_duty_rise"
    record.write_text(json.dumps({wrong: current_definitions()[wrong]}))
    clear_definition_cache()
    assert rule_is_current(wrong)
    _engine_that_moves(
        monkeypatch, wrong, lambda answers, _: answers.age == 45
    )
    assert _recheck(verify, wrong) == 1
    assert not rule_is_current(wrong)
    assert json.loads(record.read_text()) == {}


@pytest.mark.usefixtures("state_pension_ages")
def test_the_recheck_records_no_rule_it_never_saw_say_zero(
    verify, record, monkeypatch, capsys
):
    """A rule that said £0 for no household was not checked at all."""
    measure = "fuel_duty_rise_deferral"
    only = _answers(petrol_spending=1_000)
    assert not any(
        rule_says_unaffected(measure, only, year) for year in POLICY_YEARS
    )
    monkeypatch.setattr(
        household_skip_check, "NAMED_HOUSEHOLDS", {"only": only}
    )
    _engine_that_moves_nothing(monkeypatch)
    assert _recheck(verify, measure) == 1
    assert json.loads(record.read_text()) == {}
    assert f"not recorded: {measure}" in capsys.readouterr().out


@pytest.mark.usefixtures("state_pension_ages")
def test_the_recheck_with_none_named_checks_the_rules_that_are_off(
    verify, record, monkeypatch, capsys
):
    off = "machine_games_duty_rise"
    current = current_definitions()
    record.write_text(
        json.dumps(
            {**{id_: current[id_] for id_ in REGISTERED_RULES}, off: "0" * 64}
        )
    )
    clear_definition_cache()
    _engine_that_moves_nothing(monkeypatch)
    assert _recheck(verify) == 0
    assert all(rule_is_current(id_) for id_ in REGISTERED_RULES)
    assert f"Checking {off}:" in capsys.readouterr().out
    # And then there's nothing left to do
    assert _recheck(verify) == 0
    assert "nothing to check" in capsys.readouterr().out


@pytest.mark.parametrize(
    "measure",
    [
        "household_energy_payment_2026",
        "warm_home_discount_top_up",
        "not_a_measure",
    ],
    ids=["no rule", "not registered", "no such measure"],
)
def test_the_recheck_refuses_what_it_cannot_check(measure, verify, record):
    assert _recheck(verify, measure) == 2
    assert json.loads(record.read_text()) == {}


def test_the_status_check_fails_only_on_a_registered_rule_that_is_off(
    verify, monkeypatch, capsys
):
    """No required test fails on a stale rule; this exit code is CI's
    "Household skip rules" check. A measure with no rule and a withdrawn
    measure's rule don't turn it red."""
    current = current_definitions()
    every = {id_: current[id_] for id_ in REGISTERED_RULES}
    monkeypatch.setattr(
        household_skip_definitions, "checked_definitions", lambda: every
    )
    assert verify.status() == 0
    capsys.readouterr()

    off = "machine_games_duty_rise"
    monkeypatch.setattr(
        household_skip_definitions,
        "checked_definitions",
        lambda: {**every, off: "0" * 64},
    )
    assert verify.status() == 1
    assert f"--recheck {off}\n" in capsys.readouterr().out


# --- The rules against the engine, every policy year ----------------------


# Generated households in each year's batch: a batch costs about what one
# household does, and each year draws its own.
GENERATED = int(os.environ.get("SKIP_CHECK_HOUSEHOLDS", 40))
# The household the calculator's own run compares with the batch: reached by
# every conditional rule, so the runs show real effects, not only zeros.
EVERY_RULE = "eligible_for_every_rule"
EVERY_YEAR_FROM_2027 = tuple(year for year in POLICY_YEARS if year >= 2027)
# The years each measure must move some named household, read from the engine
# on 5 November 2026. With the rules' zeros, these pin each rule's boundary
# from both sides: the electricity VAT cut moves households in 2027-28 and is
# exactly £0 for all of them from 2028-29. Asserted only of a current rule: a
# changed measure may move elsewhere.
REAL_EFFECTS = {
    "bus_fare_cap_2027": (2026, 2027),
    "carers_allowance_earnings_taper": (2030, 2031),
    "cash_isa_limit_kept": EVERY_YEAR_FROM_2027,
    "domestic_electricity_zero_vat": (2026, 2027),
    "fuel_duty_rise_deferral": (2026, 2027),
    "machine_games_duty_rise": EVERY_YEAR_FROM_2027,
    "property_income_rates_up": EVERY_YEAR_FROM_2027,
    "savings_income_rates_up": EVERY_YEAR_FROM_2027,
    "state_pension_income_tax_protection": (2027, 2028, 2029),
    "trading_allowance_raise": EVERY_YEAR_FROM_2027,
}
WITHDRAWN_REAL_EFFECTS = {
    "employer_nics_secondary_threshold_raise": EVERY_YEAR_FROM_2027,
    "lha_unfreeze_2027": EVERY_YEAR_FROM_2027,
    "plan_2_threshold_unfreeze": EVERY_YEAR_FROM_2027,
    "road_fuel_vat_cut": (2026, 2027),
    "threshold_freeze_2031_32": (2031,),
    "unearned_income_rates_up": EVERY_YEAR_FROM_2027,
    "warm_home_discount_top_up": (2026,),
}


def _drawn(count: int, year: int) -> list:
    """``count`` households from ``households()``, for one year, the same on
    every run. Nothing runs inside Hypothesis: each batch costs minutes, so
    ``household_skip_check.smallest_counterexample`` does the shrinking."""
    drawn = []

    @seed(year)
    @settings(
        max_examples=count,
        database=None,
        deadline=None,
        phases=[Phase.generate],
        suppress_health_check=list(HealthCheck),
    )
    @given(households())
    def draw(answers):
        drawn.append(answers)

    draw()
    return drawn


def _batch(year: int) -> list:
    return [*NAMED_HOUSEHOLDS.values(), *_drawn(GENERATED, year)]


def _name(households_, index: int) -> str:
    names = list(NAMED_HOUSEHOLDS)
    return names[index] if index < len(names) else f"generated {index}"


def _assert_holds(check, measures=None):
    broken = [
        (
            effect.selection,
            effect.measure,
            _name(check.households, effect.household),
            effect.change,
            household_skip_check.describe(check.households[effect.household]),
        )
        for effect in check.broken(measures)
    ]
    assert not broken


def _assert_real_effects(check, measures, table):
    """Some named household shows each measure's effect in the years it has
    one: a batch of zeros would say nothing about a rule."""
    named = range(len(NAMED_HOUSEHOLDS))
    missing = [
        measure
        for measure in measures
        if check.year in table.get(measure, ())
        and not any(
            effect.change
            for effect in check.effects
            if effect.measure == measure and effect.household in named
        )
    ]
    assert not missing, f"No named household moves in {check.year}: {missing}"


def _current_rules():
    return {id_ for id_ in REGISTERED_RULES if rule_is_current(id_)}


@pytest.mark.slow
@pytest.mark.parametrize("year", POLICY_YEARS)
def test_skips_give_the_same_answer_as_running_every_measure(year):
    """With the engine, every measure selected, in every policy year. For
    every household in the batch, a current rule's £0 is exact. For the
    household in the way of every rule, the calculator's own split with skips
    equals the split without, and both match the batch."""
    current = _current_rules()
    batch = _batch(year)
    check = household_skip_check.check_selection(
        batch, year, "every_measure", household_impact.measure_ids()
    )
    _assert_holds(check, current)
    _assert_real_effects(check, current, REAL_EFFECTS)

    answers = NAMED_HOUSEHOLDS[EVERY_RULE]
    ids = household_impact.measure_ids()
    household_impact.clear_runs()
    full = household_impact.calculate_household_impact(
        answers, ids, year, include=("by_policy",), skip_unaffected=False
    )
    # The run memo keeps the full split's runs, so this runs nothing again:
    # the two can differ only in what the skips leave out.
    fast = household_impact.calculate_household_impact(
        answers, ids, year, include=("by_policy",)
    )
    assert fast == full

    # A batch is the calculator's own calculation
    index = list(NAMED_HOUSEHOLDS).index(EVERY_RULE)
    rows = _rows(full)
    for id_ in ids:
        if id_ in SKIP_REASONS:
            effect = check.of(id_, index)
            assert rows[id_]["change"] == household_impact._money(
                effect.change
            ), id_
            assert (rows[id_]["status"] == "not_affected") is (
                effect.change == 0
            ), id_


@pytest.mark.slow
@pytest.mark.parametrize("year", POLICY_YEARS)
def test_the_rules_hold_when_a_pre_budget_side_is_left_out(year):
    """A reader who leaves the cash ISA limit out: every other measure's own
    run then has current law for its before side. Selections differ only in
    that (``household_skip_check.selections``)."""
    named = household_skip_check.selections()
    assert len(named) == 2
    check = household_skip_check.check_selection(
        _batch(year),
        year,
        "pre_budget_law_as_it_stands",
        named["pre_budget_law_as_it_stands"],
    )
    current = _current_rules()
    _assert_holds(check, current)
    _assert_real_effects(
        check, current - {reforms.CASH_ISA_LIMIT_ID}, REAL_EFFECTS
    )


@pytest.mark.slow
@pytest.mark.parametrize("year", POLICY_YEARS)
def test_the_rules_of_measures_the_registry_no_longer_has_hold(year):
    """The rules for the withdrawn measures (the Warm Home Discount top-up,
    Plan 2, the employer NI relief, the road fuel VAT cut and the rest), each
    measure run alone. They cannot fire in production, and stay off if a
    measure comes back, until a recheck passes; this keeps their logic honest
    against the definitions still in ``reforms``."""
    withdrawn = household_skip_check.withdrawn_measures()
    assert set(withdrawn) == set(SKIP_REASONS) - set(
        household_impact.measure_ids()
    )
    check = household_skip_check.check_withdrawn(_batch(year), year, withdrawn)
    _assert_holds(check)
    _assert_real_effects(check, withdrawn, WITHDRAWN_REAL_EFFECTS)


@pytest.mark.slow
def test_the_check_fails_on_a_wrong_rule_with_the_engine(monkeypatch):
    """The Machine Games Duty rule, made wrong: it says £0 for everyone. With
    the engine, the check breaks it for a player, and the smallest
    counterexample keeps the one answer the duty reads."""
    measure = reforms.MACHINE_GAMES_DUTY_ID
    player = NAMED_HOUSEHOLDS["machine_player"]
    assert not rule_says_unaffected(measure, player, 2027)
    monkeypatch.setattr(
        household_skip_check, "rule_says_unaffected", lambda *_: True
    )
    # Only this measure's run: the others would add a simulation each
    monkeypatch.setattr(
        household_skip_check, "SKIP_REASONS", {measure: SKIP_REASONS[measure]}
    )
    check = household_skip_check.check_selection(
        [player], 2027, "every_measure", household_impact.measure_ids()
    )
    broken = check.broken()
    assert [effect.measure for effect in broken] == [measure]
    assert broken[0].change < 0
    answers, change = household_skip_check.smallest_counterexample(
        broken[0], [player]
    )
    assert household_skip_check.describe(answers) == {
        "higher_stake_machine_losses": player.higher_stake_machine_losses
    }
    assert change < 0


@pytest.mark.slow
def test_a_changed_definition_shows_its_real_effect_in_its_own_row(
    monkeypatch,
):
    """End to end, with the engine and the case the review of #104 raised. On
    the day, the Machine Games Duty rise moves up a year and keeps its id. In
    2026-27 its rule still says £0; the run shows the duty; the page's row
    shows it, and "Interaction between policies" stays at 0."""
    measure = reforms.MACHINE_GAMES_DUTY_ID
    reform = reforms.get_reform(measure)
    other = "fuel_duty_rise_deferral"
    checked = dict(current_definitions())
    answers = _answers(
        employment_income=30_000, higher_stake_machine_losses=1_000
    )
    monkeypatch.setattr(
        household_skip_definitions, "checked_definitions", lambda: checked
    )
    assert rule_says_unaffected(measure, answers, 2026)

    earlier = {
        path: {**periods, "2026": min(periods.values())}
        for path, periods in reform.parameter_changes.items()
    }
    _use_registry(
        monkeypatch, {measure: _changed(reform, parameter_changes=earlier)}
    )

    assert rule_says_unaffected(measure, answers, 2026)
    assert not provably_unaffected(measure, answers, 2026)
    result = _by_policy(answers, [measure, other], 2026)
    row = _rows(result)[measure]
    assert row["status"] == "affected"
    assert row["change"] < 0
    assert result["by_policy"]["residual"] == 0
    # The same answer as asking for every run
    assert result == _by_policy(
        answers, [measure, other], 2026, skip_unaffected=False
    )
