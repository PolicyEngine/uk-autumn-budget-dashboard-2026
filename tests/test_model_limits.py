"""The model-limit guard: a measure the installed model mis-costs until a
known fix lands is held at provisional, never approved.

Until policyengine-uk #2336, additional State Pension and protected
payments rise with the full rates, so changing the full rates or triple
lock moves them too. Until #2533, CPI-linked benefit levels from 2027
follow lagged calendar-year CPI rather than the September outturn. Until
the UK hub's earnings fix, the Pension Credit minimum guarantee does too,
though the law requires it to rise with earnings. Until #2187, household
VAT is grossed up to receipts by one factor, so VAT runs about 23% high;
that limit covers variables as well as parameters.
"""

import copy
import warnings
from functools import partial

import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_core.periods import YEAR
from policyengine_core.variables import Variable
from policyengine_uk import Simulation
from policyengine_uk.entities import Person
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data import model_limits
from uk_budget_data.measure_templates import (
    ModelLimitedWarning,
    pension_uprating,
    rate_change,
)
from uk_budget_data.model_limits import (
    MODEL_LIMITS,
    limits_for_paths,
    limits_for_scenarios,
    limits_touched,
    record,
    record_problems,
    variable_path,
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import PublishError, approve, stage
from uk_budget_data.publication.receipt import dashboard_problems


def limit_by_key(key):
    """A registered limit by key, not by position, so removing a limit at
    adoption fails loudly at that limit's own lookups instead of quietly
    pointing a test at another limit."""
    return {limit.key: limit for limit in MODEL_LIMITS}[key]


LIMIT = limit_by_key("state_pension_add_on_uprating")
BENEFIT_LIMIT = limit_by_key("benefit_uprating_september_cpi")
PENSION_CREDIT_LIMIT = limit_by_key("pc_minimum_guarantee_uprating")
BENEFIT_RATE = "gov.hmrc.child_benefit.amount.eldest"
NEW_PENSION = "gov.dwp.state_pension.new_state_pension.amount"
BASIC_PENSION = "gov.dwp.state_pension.basic_state_pension.amount"
TRIPLE_LOCK_MINIMUM = "gov.dwp.state_pension.triple_lock.minimum_rate"
INCOME_TAX = "gov.hmrc.income_tax.rates.uk[0].rate"
VALUES = {2027: 1.0, 2028: 2.0}
YEARS = [2027, 2028]


def household(year=2027):
    return {
        "people": {"p": {"age": {year: 70}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def simulation(changes=None, modifier=None):
    scenario = None
    if changes or modifier:
        scenario = Scenario(
            parameter_changes=changes, simulation_modifier=modifier
        )
    return Simulation(situation=household(), scenario=scenario)


class additional_state_pension(Variable):
    """A stand-in for policyengine-uk #2336's variable: it reads September
    CPI, which is what the guard looks for. Its values are not the law's;
    only whether the guard sees the fix is tested with it."""

    entity = Person
    definition_period = YEAR
    value_type = float
    label = "Additional State Pension (a stand-in uprated by September CPI)"

    def formula(person, period, parameters):
        index = parameters(
            period
        ).gov.economic_assumptions.indices.september_cpi_uprating
        return person("age", period) * 0 * index


def with_the_fix(sim):
    """Install the stand-in, as a model with #2336 would have it."""
    sim.tax_benefit_system.update_variable(additional_state_pension)


def fixed(changes=None):
    return simulation(changes, with_the_fix)


# --- the registry ----------------------------------------------------------


def test_every_registered_parameter_exists_in_the_installed_engine():
    from policyengine_uk.system import system

    for limit in MODEL_LIMITS:
        for prefix in limit.parameters:
            assert system.parameters.get_child(prefix) is not None, prefix


def test_every_registered_variable_exists_in_the_installed_engine():
    from policyengine_uk.system import system

    for limit in MODEL_LIMITS:
        for name in limit.variables:
            assert name in system.variables, name


def test_the_installed_model_still_lacks_the_fix():
    """Tripwire: when the installed policyengine-uk has #2336, this fails,
    and the limit is removed in the bundle-adoption PR that brings it."""
    assert not LIMIT.installed_fixed(), (
        "the installed policyengine-uk uprates additional State Pension by "
        f"September CPI ({LIMIT.fixed_by}): remove {LIMIT.key}"
    )


def test_the_two_checks_for_the_fix_agree_on_the_installed_model():
    """Differential: the installed source file and the built system's own
    formula give the same answer."""
    from policyengine_uk.system import system

    assert LIMIT.fixed(system) == LIMIT.installed_fixed()
    assert LIMIT.fixed(simulation().tax_benefit_system) is False


def test_the_system_check_sees_the_fix_when_the_formula_has_it():
    assert LIMIT.fixed(fixed().tax_benefit_system) is True


def test_a_system_without_the_variable_counts_as_unfixed():
    """Fail safe: a model that lacks the variable, or whose formula source
    can't be read, holds the measure rather than approving it."""
    assert LIMIT.fixed(object()) is False


# --- what a measure touches -----------------------------------------------


@pytest.mark.parametrize(
    "changes, recorded",
    [
        ({NEW_PENSION: {"2027": 250.0}}, [NEW_PENSION]),
        ({BASIC_PENSION: {"2027": 190.0}}, [BASIC_PENSION]),
        # The model derives the full rates from the triple lock, so both
        # move with it.
        (
            {TRIPLE_LOCK_MINIMUM: {"2027": 0.05}},
            [BASIC_PENSION, NEW_PENSION, TRIPLE_LOCK_MINIMUM],
        ),
    ],
)
def test_a_state_pension_measure_without_the_fix_records_the_limit(
    changes, recorded
):
    """The triple lock's CPI leg also reads the September 2026 input, so
    the September CPI limit holds a triple-lock change as well; a change to
    the full rates alone records only this limit."""
    touched = limits_touched(simulation(), simulation(changes))
    if TRIPLE_LOCK_MINIMUM in changes:
        assert [item["key"] for item in touched] == [
            LIMIT.key,
            BENEFIT_LIMIT.key,
        ]
        touched = touched[:1]
    assert touched == [record(LIMIT, recorded)]


UPRATING_INPUTS = "gov.economic_assumptions.statutory_uprating_inputs"


@pytest.mark.parametrize(
    "changes, also",
    [
        (
            {f"{UPRATING_INPUTS}.awe_total_pay_may_july": {"2026": 0.10}},
            [BENEFIT_LIMIT, PENSION_CREDIT_LIMIT],
        ),
        (
            {f"{UPRATING_INPUTS}.cpi_september": {"2027": 0.10}},
            [BENEFIT_LIMIT],
        ),
    ],
)
def test_an_uprating_input_that_moves_the_full_rates_records_them(
    changes, also
):
    """By effect: the triple lock is built from these inputs, so the full
    rates' stored amounts move and are recorded (#71's review found a 10%
    earnings input moved a pensioner's add-on). A CPI input also moves the
    September CPI index, recorded too. Each input is also covered by
    other limits: from 2027 the triple lock index and the September CPI
    index are the September CPI limit's, and the earnings input is the
    minimum guarantee's."""
    touched = {
        item["key"]: item
        for item in limits_touched(simulation(), simulation(changes))
    }
    assert list(touched) == [LIMIT.key, *(limit.key for limit in also)]
    assert {BASIC_PENSION, NEW_PENSION} <= set(
        touched[LIMIT.key]["parameters"]
    )


def test_the_state_pension_limit_still_covers_changes_confined_to_2026():
    assert limits_touched(
        simulation(), simulation({NEW_PENSION: {"2026": 250.0}})
    ) == [record(LIMIT, [NEW_PENSION])]


def test_a_change_to_the_cached_views_alone_records_it():
    """A modifier can change what formulas read by editing the system's
    cached view, leaving the stored tree untouched; the views are compared
    too, recorded as the limit's own prefix."""
    reformed = simulation()
    view = reformed.tax_benefit_system.parameters("2027-01-01")
    view.gov.dwp.state_pension.new_state_pension.amount = 300.0
    touched = limits_touched(simulation(), reformed)
    assert touched == [record(LIMIT, [NEW_PENSION])]


def test_a_change_on_the_baseline_side_counts_too():
    assert limits_touched(
        simulation({NEW_PENSION: {"2027": 250.0}}), simulation()
    ) == [record(LIMIT, [NEW_PENSION])]


@pytest.mark.parametrize(
    "limit, path, amount",
    [
        (LIMIT, NEW_PENSION, pension_uprating(230.25, 0.048)),
        (BENEFIT_LIMIT, BENEFIT_RATE, 30.0),
    ],
)
def test_a_template_built_measure_records_its_limit_and_warns(
    limit, path, amount
):
    with pytest.warns(ModelLimitedWarning, match=limit.fixed_by):
        changes = rate_change(path, {2027: amount})
    assert limits_touched(simulation(), simulation(changes)) == [
        record(limit, [path])
    ]


def raise_the_new_state_pension(sim):
    """A module-level modifier that edits the rate itself."""
    from policyengine_core.periods import instant

    sim.tax_benefit_system.parameters.get_child(NEW_PENSION).update(
        start=instant("2027-01-01"), stop=instant("2027-12-31"), value=300.0
    )


def test_a_modifier_that_changes_the_rate_records_it():
    assert limits_touched(
        simulation(), simulation(modifier=raise_the_new_state_pension)
    ) == [record(LIMIT, [NEW_PENSION])]


def test_with_the_fix_a_state_pension_measure_records_nothing():
    """The limit expires on its own once the model has the fix."""
    assert limits_touched(fixed(), fixed({NEW_PENSION: {"2027": 250.0}})) == []


def test_the_fix_on_one_side_only_still_records_it():
    """Either side's model lacking the fix is enough to hold the measure."""
    assert limits_touched(
        fixed(), simulation({NEW_PENSION: {"2027": 250.0}})
    ) == [record(LIMIT, [NEW_PENSION])]


@pytest.mark.parametrize("build", [simulation, fixed])
def test_a_measure_that_does_not_touch_the_state_pension_is_unaffected(build):
    assert limits_touched(build(), build({INCOME_TAX: {"2027": 0.21}})) == []


def test_no_template_warning_for_a_measure_off_the_state_pension():
    with warnings.catch_warnings():
        warnings.simplefilter("error", ModelLimitedWarning)
        rate_change(INCOME_TAX, {2027: 0.21})


@pytest.fixture
def installed_with_the_fix(monkeypatch):
    """The registry as it reads on an installed model that has the fix."""
    monkeypatch.setattr(
        model_limits,
        "MODEL_LIMITS",
        tuple(
            type(limit)(**{**vars(limit), "installed_fixed": lambda: True})
            for limit in MODEL_LIMITS
        ),
    )


@pytest.mark.usefixtures("installed_with_the_fix")
def test_the_template_warning_follows_the_installed_model():
    with warnings.catch_warnings():
        warnings.simplefilter("error", ModelLimitedWarning)
        rate_change(NEW_PENSION, {2027: 250.0})


# --- from the scenarios only (stand-ins) -----------------------------------


def scenario(changes):
    return Scenario(parameter_changes=changes)


def test_the_scenarios_record_it_against_the_installed_model():
    assert limits_for_scenarios(
        None, scenario({NEW_PENSION: {"2027": 250.0}})
    ) == [record(LIMIT, [NEW_PENSION])]
    assert (
        limits_for_scenarios(None, scenario({INCOME_TAX: {"2027": 0.2}})) == []
    )


@pytest.mark.usefixtures("installed_with_the_fix")
def test_the_scenarios_record_nothing_once_the_installed_model_has_it():
    assert (
        limits_for_scenarios(None, scenario({NEW_PENSION: {"2027": 250.0}}))
        == []
    )


# --- the record --------------------------------------------------------------


def test_limits_for_paths_matches_prefixes_not_name_fragments():
    assert limits_for_paths([NEW_PENSION]) == [LIMIT]
    assert limits_for_paths([NEW_PENSION + "_extra"]) == []
    # The triple lock is also the September CPI limit's, from 2027.
    assert limits_for_paths(["gov.dwp.state_pension.triple_lock"]) == [
        LIMIT,
        BENEFIT_LIMIT,
    ]
    assert limits_for_paths([TRIPLE_LOCK_MINIMUM]) == [LIMIT, BENEFIT_LIMIT]
    assert limits_for_paths([INCOME_TAX]) == []


def record_cases(limit):
    """Exercise every limit while retaining the original nested path, and
    each variable the limit covers as its record names it."""
    paths = (*limit.parameters, *map(variable_path, limit.variables))
    if limit == LIMIT:
        paths = (*paths, TRIPLE_LOCK_MINIMUM)
    return st.tuples(
        st.just(limit), st.lists(st.sampled_from(paths), min_size=1)
    )


PATHS = st.sampled_from(MODEL_LIMITS).flatmap(record_cases)


@given(PATHS)
def test_every_record_the_guard_makes_passes_its_own_check(case):
    limit, paths = case
    assert record_problems([record(limit, paths)]) == []


@given(st.lists(PATHS, unique_by=lambda case: case[0].key))
def test_records_for_several_limits_keep_registry_order(cases):
    records = [
        record(limit, paths)
        for limit in MODEL_LIMITS
        for chosen, paths in cases
        if chosen == limit
    ]
    assert record_problems(records) == []
    if len(records) > 1:
        assert record_problems(list(reversed(records)))


def test_a_path_under_two_limits_is_recorded_under_either():
    """Limits may overlap: September CPI is the State Pension limit's and,
    from 2027, the benefit index's; the minimum guarantee is the benefit
    index's and its own limit's. A record of either is the guard's."""
    september = "gov.economic_assumptions.indices.september_cpi_uprating"
    guarantee = (
        "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE"
    )
    assert limits_for_paths([september]) == [LIMIT, BENEFIT_LIMIT]
    assert limits_for_paths([guarantee]) == [
        BENEFIT_LIMIT,
        PENSION_CREDIT_LIMIT,
    ]
    assert record_problems([record(LIMIT, [september])]) == []
    assert record_problems([record(BENEFIT_LIMIT, [september])]) == []
    assert record_problems([record(PENSION_CREDIT_LIMIT, [guarantee])]) == []
    assert record_problems([record(PENSION_CREDIT_LIMIT, [september])])


BROKEN = [
    lambda r: {**r, "key": "unknown"},
    lambda r: {**r, "reason": r["reason"] + " "},
    lambda r: {**r, "parameters": []},
    lambda r: {**r, "parameters": list(reversed(r["parameters"]))},
    lambda r: {**r, "parameters": r["parameters"] + [INCOME_TAX]},
    lambda r: {
        **r,
        "parameters": sorted(r["parameters"] + ["variable:not_covered"]),
    },
    lambda r: {**r, "parameters": r["parameters"] + [r["parameters"][0]]},
    lambda r: {**r, "parameters": "not a list"},
]


@given(st.sampled_from(MODEL_LIMITS), st.sampled_from(BROKEN))
def test_a_record_the_guard_did_not_make_is_refused(limit, break_it):
    good = record(limit, limit.parameters[:2])
    broken = break_it(copy.deepcopy(good))
    if broken == good:
        return
    assert record_problems([broken]) != []


@pytest.mark.parametrize("limit", MODEL_LIMITS)
def test_a_limit_listed_twice_or_a_non_list_is_refused(limit):
    good = record(limit, [limit.parameters[0]])
    assert record_problems([good, good]) != []
    assert record_problems(good) == ["model_limits must be a list"]


# --- the gate ----------------------------------------------------------------


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


HELD = record(LIMIT, [NEW_PENSION])


@pytest.mark.parametrize("limit", MODEL_LIMITS)
def test_a_model_limited_measure_stages_provisional_but_is_never_approved(
    world,
    limit,
):
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    reference = world.ready(
        "alpha", VALUES, model_limits=[record(limit, [limit.parameters[0]])]
    )
    stage(manifest, reference.path, provisional=True, **args)
    assert manifest.entries()["alpha"].status == m.PROVISIONAL
    with pytest.raises(PublishError, match="held at provisional"):
        approve(manifest, "alpha", "Reviewer", **args)
    assert manifest.entries()["alpha"].status == m.PROVISIONAL


def test_the_same_measure_without_the_limit_is_approved(world):
    """Control: the only difference is the recorded model limit."""
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    reference = world.ready("alpha", VALUES)
    stage(manifest, reference.path, provisional=True, **args)
    approve(manifest, "alpha", "Reviewer", **args)
    assert manifest.entries()["alpha"].status == m.APPROVED


@pytest.mark.parametrize("limit", MODEL_LIMITS)
def test_the_refusal_names_the_reason(world, limit):
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    reference = world.ready(
        "alpha", VALUES, model_limits=[record(limit, [limit.parameters[0]])]
    )
    stage(manifest, reference.path, provisional=True, **args)
    with pytest.raises(PublishError) as raised:
        approve(manifest, "alpha", "Reviewer", **args)
    assert limit.reason in str(raised.value)


def test_a_receipt_without_recorded_model_limits_is_a_problem(world):
    document = read_receipt(world.write("alpha", VALUES).path)
    del document["dashboard"]["model_limits"]
    assert "its model limits are not recorded" in dashboard_problems(document)


def test_a_receipt_from_another_model_limit_registry_is_a_problem(world):
    document = read_receipt(world.write("alpha", VALUES).path)
    document["dashboard"]["model_limits_registry_sha256"] = "0" * 64
    assert any(
        "another model-limit registry" in p
        for p in dashboard_problems(document)
    )


def test_a_receipt_with_an_edited_model_limit_is_a_problem(world):
    document = read_receipt(
        world.write("alpha", VALUES, model_limits=[HELD]).path
    )
    document["dashboard"]["model_limits"][0]["reason"] = "edited"
    assert any(
        p.startswith("model limits:") for p in dashboard_problems(document)
    )


# --- generation --------------------------------------------------------------


def fake_process(values):
    def process(reform, config, baseline, reformed, baseline_scenario):
        tables = make_tables(reform.id, values)
        tables.pop("household_scatter_binned")
        return ReformResult(
            household_scatter=make_household_rows(reform.id, values),
            reform_id=reform.id,
            reform_name=reform.name,
            constituency=[],
            demographic_constituency=[],
            **tables,
        )

    return process


def built(world, modifier=None):
    """Stand-in simulations carrying a real parameter tree and model,
    built with the scenario, as generation compares them on a real run."""

    def build(dataset, scenario=None):
        sim = world.sim()
        if modifier is not None:
            scenario = Scenario(
                parameter_changes=getattr(scenario, "parameter_changes", None),
                simulation_modifier=modifier,
            )
        sim.tax_benefit_system = Simulation(
            situation=household(), scenario=scenario
        ).tax_benefit_system
        return sim

    return build


def generated(world, reform, build):
    report = generate_artifacts(
        [reform],
        DataConfig(years=YEARS),
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=build,
        process=fake_process(VALUES),
    )
    assert not report.refused, report.refused
    return read_receipt(report.written[0].path)["dashboard"]["model_limits"]


BENEFIT_RISE = Reform(
    id="benefit_rise",
    name="Benefit rise",
    parameter_changes={BENEFIT_RATE: {"2027": 30.0, "2028": 31.0}},
)


PENSION_RISE = Reform(
    id="pension_rise",
    name="Pension rise",
    parameter_changes={NEW_PENSION: {"2027": 250.0, "2028": 260.0}},
)


@pytest.mark.parametrize(
    "reform, held",
    [
        (PENSION_RISE, HELD),
        (BENEFIT_RISE, record(BENEFIT_LIMIT, [BENEFIT_RATE])),
    ],
)
def test_generation_records_the_limit_from_the_scenarios_and_the_trees(
    world,
    reform,
    held,
):
    # From the scenarios alone (stand-ins with no model) ...
    assert generated(
        world, reform, lambda dataset, scenario=None: world.sim()
    ) == [held]
    # ... and from the built trees and model.
    assert generated(world, reform, built(world)) == [held]


def test_generation_records_a_change_on_the_baseline_side(world):
    """A measure whose change sits in its baseline (as several registered
    measures' do) is held too."""
    reform = Reform(
        id="pension_baseline",
        name="Pension baseline",
        parameter_changes={},
        baseline_parameter_changes={NEW_PENSION: {"2027": 250.0}},
    )
    assert generated(world, reform, built(world)) == [HELD]


def test_generation_records_nothing_on_a_model_with_the_fix(world):
    assert generated(world, PENSION_RISE, built(world, with_the_fix)) == []


def test_generation_records_nothing_for_a_measure_off_the_state_pension(
    world,
):
    reform = Reform(
        id="basic_rate",
        name="Basic rate",
        parameter_changes={INCOME_TAX: {"2027": 0.21, "2028": 0.21}},
    )
    assert generated(world, reform, built(world)) == []


# --- the flat pipeline -------------------------------------------------------


def test_the_flat_pipeline_says_when_this_model_mis_costs_a_measure(
    monkeypatch, capsys
):
    """The flat CSV path has no publication gate; it says loudly that the
    model mis-costs a State Pension measure, and stays quiet for the
    others."""
    from uk_budget_data import pipeline

    class Processor:
        def __init__(self, reform, config):
            pass

        def process(self, *args):
            return None

    monkeypatch.setattr(
        pipeline,
        "build_microsimulation",
        lambda dataset, scenario=None: Simulation(
            situation=household(), scenario=scenario
        ),
    )
    monkeypatch.setattr(pipeline, "ReformProcessor", Processor)
    monkeypatch.setattr(pipeline, "aggregate_results", lambda r, config: {})
    monkeypatch.setattr(pipeline.DataPipeline, "_save_all", lambda s, d: None)
    reforms = [
        PENSION_RISE,
        BENEFIT_RISE,
        Reform(
            id="income",
            name="Income",
            parameter_changes={INCOME_TAX: {"2027": 0.22}},
        ),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    assert out.count("MIS-COSTED BY THIS MODEL") == 2
    assert "Benefit rise: The installed benefit uprating index" in out
    assert "Pension rise: The installed model" in out
    assert "Income: The installed model" not in out


# --- review of #73, round 1 ----------------------------------------------------

CPI_INDEX = "gov.economic_assumptions.indices.september_cpi_uprating"
CPI_INPUT = "gov.economic_assumptions.statutory_uprating_inputs.cpi_september"


def named_only_formula(person, period, parameters):
    """Names the index (september_cpi_uprating) but never reads it."""
    # TODO: uprate by september_cpi_uprating
    unused = "gov.economic_assumptions.indices.september_cpi_uprating"
    del unused
    return person("age", period) * 0


def ignoring_formula(person, period, parameters):
    return person("age", period) * 0


def reading_formula(person, period, parameters):
    index = parameters(
        period
    ).gov.economic_assumptions.indices.september_cpi_uprating
    return person("age", period) * 0 * index


def with_formulas(**formulas):
    """A modifier installing an ``additional_state_pension`` whose own class
    carries exactly these formulas. (A subclass with no formulas of its own
    keeps the baseline's: core merges a reform variable's formulas with the
    baseline's before its first date.)"""
    variable = type(
        "additional_state_pension",
        (Variable,),
        {
            "entity": Person,
            "definition_period": YEAR,
            "value_type": float,
            "label": "Additional State Pension (a stand-in)",
            **formulas,
        },
    )

    def modifier(sim):
        sim.tax_benefit_system.update_variable(variable)

    return modifier


def installed_formulas(sim):
    variable = sim.tax_benefit_system.variables["additional_state_pension"]
    return {date: f.__name__ for date, f in variable.formulas.items()}


def test_naming_the_index_without_reading_it_is_not_the_fix():
    """Review of #73, finding A: a comment, docstring or string naming the
    index counted as fixed, so the guard would lift itself."""
    sim = simulation(modifier=with_formulas(formula=named_only_formula))
    assert installed_formulas(sim) == {"0001-01-01": "named_only_formula"}
    assert LIMIT.fixed(sim.tax_benefit_system) is False
    reading = simulation(modifier=with_formulas(formula=reading_formula))
    assert LIMIT.fixed(reading.tax_benefit_system) is True


def test_every_dated_formula_must_read_the_index():
    """Fixed only from 2026 is not fixed: the formula before then still
    rises with the full rates."""
    sim = simulation(
        modifier=with_formulas(
            formula=ignoring_formula, formula_2026=reading_formula
        )
    )
    assert installed_formulas(sim) == {
        "0001-01-01": "ignoring_formula",
        "2026-01-01": "reading_formula",
    }
    assert LIMIT.fixed(sim.tax_benefit_system) is False


def installed_source(monkeypatch, tmp_path, text):
    """Point the installed-model check at a file holding ``text``."""
    path = tmp_path / "additional_state_pension.py"
    path.write_text(text, encoding="utf-8")

    class Root:
        def joinpath(self, *parts):
            return path

    monkeypatch.setattr(model_limits, "files", lambda package: Root())


def test_the_installed_check_reads_the_formula_not_the_text(
    monkeypatch, tmp_path
):
    installed_source(
        monkeypatch,
        tmp_path,
        "class additional_state_pension:\n"
        "    def formula(person, period, parameters):\n"
        "        # september_cpi_uprating\n"
        "        return 'september_cpi_uprating'\n",
    )
    assert LIMIT.installed_fixed() is False
    installed_source(
        monkeypatch,
        tmp_path,
        "class additional_state_pension:\n"
        "    def formula(person, period, parameters):\n"
        "        return parameters(period).gov.economic_assumptions"
        ".indices.september_cpi_uprating\n",
    )
    assert LIMIT.installed_fixed() is True
    # Every formula of the class must read it, not just one.
    installed_source(
        monkeypatch,
        tmp_path,
        "class additional_state_pension:\n"
        "    def formula(person, period, parameters):\n"
        "        return 0\n"
        "    def formula_2026(person, period, parameters):\n"
        "        return parameters(period).gov.economic_assumptions"
        ".indices.september_cpi_uprating\n",
    )
    assert LIMIT.installed_fixed() is False


@pytest.mark.parametrize("problem", ["missing", "unparsable"])
def test_an_unreadable_installed_source_counts_as_unfixed(
    monkeypatch, tmp_path, problem
):
    if problem == "missing":
        monkeypatch.setattr(model_limits, "_ADD_ON_FILE", "no/such/file.py")
    else:
        installed_source(monkeypatch, tmp_path, "class (:\n")
    assert LIMIT.installed_fixed() is False


def raise_the_new_state_pension_by_rebinding(sim):
    """A modifier that rebinds the node formulas read by attribute, leaving
    the stored tree's child as it was (review of #73, finding B)."""
    node = sim.tax_benefit_system.parameters.gov.dwp.state_pension
    node = node.new_state_pension
    rebound = node.children["amount"].clone()
    for value in rebound.values_list:
        if value.value is not None:
            value.value = value.value * 1.1
    node.amount = rebound


def test_a_rebound_node_is_recorded():
    assert limits_touched(
        simulation(),
        simulation(modifier=raise_the_new_state_pension_by_rebinding),
    ) == [record(LIMIT, [NEW_PENSION])]


def test_a_cpi_change_that_does_not_bind_the_full_rates_is_recorded():
    """Review of #73, finding C: without the fix the add-on ignores CPI, so
    a CPI change the triple lock doesn't pass on (earnings bind) still
    mis-costs it, though the full rates don't move. The index's April 2027
    step moves, so the benefit index's limit records it too."""
    touched = limits_touched(
        simulation(), simulation({CPI_INPUT: {"2026": 0.030}})
    )
    assert [item["key"] for item in touched] == [
        LIMIT.key,
        BENEFIT_LIMIT.key,
    ]
    paths = touched[0]["parameters"]
    assert any(path.startswith(CPI_INDEX) for path in paths)


def test_the_fix_missing_on_the_baseline_side_only_still_records_it():
    """Either side lacking the fix holds the measure (the reverse of
    test_the_fix_on_one_side_only_still_records_it)."""
    assert limits_touched(
        simulation(), fixed({NEW_PENSION: {"2027": 250.0}})
    ) == [record(LIMIT, [NEW_PENSION])]


def test_detection_leaves_the_parameter_caches_as_it_found_them():
    baseline = simulation()
    reformed = simulation({NEW_PENSION: {"2027": 250.0}})
    systems = [baseline.tax_benefit_system, reformed.tax_benefit_system]

    def caches():
        """Every cache detection could fill: the system's, the root's, and
        each covered node's (views are built at the prefixes whose stored
        trees match)."""
        return [
            (
                set(system._parameters_at_instant_cache),
                set(system.parameters._at_instant_cache),
                *(
                    set(
                        getattr(
                            system.parameters.get_child(prefix),
                            "_at_instant_cache",
                            {},
                        )
                    )
                    for prefix in LIMIT.parameters
                ),
            )
            for system in systems
        ]

    before = caches()
    assert limits_touched(baseline, reformed)
    assert caches() == before


def add_a_triple_lock_leaf(sim):
    from policyengine_core.parameters import Parameter

    node = sim.tax_benefit_system.parameters.get_child(
        "gov.dwp.state_pension.triple_lock"
    )
    node.add_child(
        "extra",
        Parameter(
            "gov.dwp.state_pension.triple_lock.extra",
            {"values": {"2020-01-01": 1.0}},
        ),
    )


def test_an_added_leaf_under_a_covered_prefix_is_recorded():
    touched = limits_touched(
        simulation(), simulation(modifier=add_a_triple_lock_leaf)
    )
    assert touched and touched[0]["key"] == LIMIT.key
    assert (
        "gov.dwp.state_pension.triple_lock.extra" in touched[0]["parameters"]
    )


def test_the_scenarios_record_a_change_on_the_baseline_side():
    assert limits_for_scenarios(
        scenario({NEW_PENSION: {"2027": 250.0}}), None
    ) == [record(LIMIT, [NEW_PENSION])]


def test_a_combined_run_with_its_own_model_limit_is_never_approved(world):
    """Even with every member approved, a combined run whose own receipt
    records a model limit is refused approval."""
    from uk_budget_data.publication.artifacts import read_receipt as receipt_of

    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    for key in ("alpha", "beta"):
        stage(manifest, world.ready(key, VALUES).path, **args)
        approve(manifest, key, "Reviewer", **args)
    records = [
        {
            "id": member,
            "reform": receipt_of(
                world.data_root / manifest.measures[member].artifact
            )["execution_receipt"]["reform"],
            "baseline": receipt_of(
                world.data_root / manifest.measures[member].artifact
            )["execution_receipt"]["baseline"],
        }
        for member in ("alpha", "beta")
    ]
    combined = world.write(
        "combined--alpha+beta",
        {2027: 2.0, 2028: 4.0},
        members=records,
        measure_ids=["alpha", "beta"],
        member_outputs={
            member: manifest.measures[member].outputs_sha256
            for member in ("alpha", "beta")
        },
        model_limits=[HELD],
    )
    key = stage(manifest, combined.path, **args)
    with pytest.raises(PublishError, match="held at provisional"):
        approve(manifest, key, "Reviewer", **args)


# --- review of #73, round 2 ----------------------------------------------------


def pensioner(year, age):
    return {
        "people": {
            "p": {"age": {year: age}, "state_pension_reported": {year: 20_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


@pytest.mark.parametrize(
    "age, pension, rate, raised_to",
    [(70, "NEW", NEW_PENSION, 260.0), (85, "BASIC", BASIC_PENSION, 200.0)],
    ids=["new State Pension", "basic State Pension"],
)
def test_both_checks_for_the_fix_agree_with_what_the_model_does(
    age, pension, rate, raised_to
):
    """The checks read code; this tripwire reads behaviour. Without #2336
    the add-on rises with the full rate, so raising the full rate moves it;
    with #2336 it is uprated by September CPI and shouldn't move. If a
    release fools the code checks, or #2336 lands in a form that still moves
    the add-on, this fails, and the limit is revisited in that PR.

    Both pensions are tested: a release that fixes the new State Pension's
    add-on but not the basic's (review of #73, round 3) passes the code
    checks, since every formula reads the index, and fails here."""
    year = 2028
    baseline = Simulation(situation=pensioner(year, age))
    raised = Simulation(
        situation=pensioner(year, age),
        scenario=Scenario(parameter_changes={rate: {str(year): raised_to}}),
    )
    # Each case stays the pension it is named for, so the basic case can't
    # quietly become a second new State Pension case.
    assert baseline.calculate("state_pension_type", year)[0] == pension
    before = baseline.calculate("additional_state_pension", year)[0]
    after = raised.calculate("additional_state_pension", year)[0]
    assert before > 0
    moves = bool(after != before)
    assert moves is not LIMIT.installed_fixed()
    assert moves is not LIMIT.fixed(baseline.tax_benefit_system)


def test_a_rebound_node_on_the_baseline_side_is_recorded():
    assert limits_touched(
        simulation(modifier=raise_the_new_state_pension_by_rebinding),
        simulation(),
    ) == [record(LIMIT, [NEW_PENSION])]


def raise_the_new_state_pension_by_rebinding_its_node(sim):
    """Rebind the node above the leaf: formulas reach the clone by
    attribute, and the stored tree below it is the original."""
    node = sim.tax_benefit_system.parameters.gov.dwp.state_pension
    rebound = node.children["new_state_pension"].clone()
    for value in rebound.children["amount"].values_list:
        if value.value is not None:
            value.value = value.value * 1.1
    node.new_state_pension = rebound


def test_a_rebound_node_above_the_leaf_is_recorded():
    reformed = simulation(
        modifier=raise_the_new_state_pension_by_rebinding_its_node
    )
    pensions = reformed.tax_benefit_system.parameters.gov.dwp.state_pension
    assert pensions.new_state_pension is not (
        pensions.children["new_state_pension"]
    )
    assert limits_touched(simulation(), reformed) == [
        record(LIMIT, [NEW_PENSION])
    ]


def test_a_formula_without_compiled_code_counts_as_unfixed():
    """A formula the guard can't read (here a partial, which has no
    ``__code__``) is not proof of the fix, even when it wraps one that
    reads the index."""
    sim = simulation(modifier=with_formulas(formula=partial(reading_formula)))
    variable = sim.tax_benefit_system.variables["additional_state_pension"]
    [formula] = variable.formulas.values()
    assert isinstance(formula, partial)
    assert LIMIT.fixed(sim.tax_benefit_system) is False


def test_the_installed_check_ignores_a_bare_name(monkeypatch, tmp_path):
    """Only reading the index as an attribute counts: a global or local of
    the same name is not the index."""
    installed_source(
        monkeypatch,
        tmp_path,
        "september_cpi_uprating = 1\n"
        "class additional_state_pension:\n"
        "    def formula(person, period, parameters):\n"
        "        return person('age', period) * september_cpi_uprating\n",
    )
    assert LIMIT.installed_fixed() is False


@pytest.mark.parametrize("missing", ["data_limits", "model_limits"])
def test_a_receipt_cannot_be_built_without_its_limits(missing):
    """Review of #73, round 3: with a default of no limits, a caller that
    forgot them would record that the measure touches none. Both are
    required."""
    from uk_budget_data.publication.receipt import ReceiptInputs

    fields = dict(
        key="alpha",
        measure_ids=["alpha"],
        years=[2027],
        baseline_identity=None,
        reform_identity=None,
        file_digests={},
        basis={},
        revision=None,
        data_limits=[],
        model_limits=[],
    )
    del fields[missing]
    with pytest.raises(TypeError, match=missing):
        ReceiptInputs(**fields)
