"""The model-limit guard: a measure the installed model overstates until a
known fix lands is held at provisional, never approved.

The one limit today is the State Pension's: up to policyengine-uk #2336,
additional State Pension and protected payments rise with the full rates,
so a change to the full rates or the triple lock moves them too.
"""

import copy
import warnings

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
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import PublishError, approve, stage
from uk_budget_data.publication.receipt import dashboard_problems

LIMIT = MODEL_LIMITS[0]
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
    assert limits_touched(simulation(), simulation(changes)) == [
        record(LIMIT, recorded)
    ]


UPRATING_INPUTS = "gov.economic_assumptions.statutory_uprating_inputs"


@pytest.mark.parametrize(
    "changes",
    [
        {f"{UPRATING_INPUTS}.awe_total_pay_may_july": {"2026": 0.10}},
        {f"{UPRATING_INPUTS}.cpi_september": {"2027": 0.10}},
    ],
)
def test_an_uprating_input_that_moves_the_full_rates_records_them(changes):
    """By effect: the triple lock is built from these inputs, so the full
    rates' stored amounts move, and those are what is recorded (#71's
    review found a 10% earnings input moved a pensioner's add-on)."""
    assert limits_touched(simulation(), simulation(changes)) == [
        record(LIMIT, [BASIC_PENSION, NEW_PENSION])
    ]


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


def test_a_template_built_state_pension_measure_records_it_and_warns():
    with pytest.warns(ModelLimitedWarning, match="#2336"):
        changes = rate_change(
            NEW_PENSION, {2027: pension_uprating(230.25, 0.048)}
        )
    assert limits_touched(simulation(), simulation(changes)) == [
        record(LIMIT, [NEW_PENSION])
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
    assert limits_for_paths(["gov.dwp.state_pension.triple_lock"]) == [LIMIT]
    assert limits_for_paths([TRIPLE_LOCK_MINIMUM]) == [LIMIT]
    assert limits_for_paths([INCOME_TAX]) == []


PATHS = st.lists(
    st.sampled_from(
        [NEW_PENSION, BASIC_PENSION, TRIPLE_LOCK_MINIMUM, *LIMIT.parameters]
    ),
    min_size=1,
)


@given(PATHS)
def test_every_record_the_guard_makes_passes_its_own_check(paths):
    assert record_problems([record(LIMIT, paths)]) == []


BROKEN = [
    lambda r: {**r, "key": "unknown"},
    lambda r: {**r, "reason": r["reason"] + " "},
    lambda r: {**r, "parameters": []},
    lambda r: {**r, "parameters": list(reversed(r["parameters"]))},
    lambda r: {**r, "parameters": r["parameters"] + [INCOME_TAX]},
    lambda r: {**r, "parameters": r["parameters"] + [r["parameters"][0]]},
    lambda r: {**r, "parameters": "not a list"},
]


@given(st.sampled_from(BROKEN))
def test_a_record_the_guard_did_not_make_is_refused(break_it):
    good = record(LIMIT, [BASIC_PENSION, NEW_PENSION])
    broken = break_it(copy.deepcopy(good))
    if broken == good:
        return
    assert record_problems([broken]) != []


def test_a_limit_listed_twice_or_a_non_list_is_refused():
    good = record(LIMIT, [NEW_PENSION])
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


def test_a_model_limited_measure_stages_provisional_but_is_never_approved(
    world,
):
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    reference = world.ready("alpha", VALUES, model_limits=[HELD])
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


def test_the_refusal_names_the_reason(world):
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    reference = world.ready("alpha", VALUES, model_limits=[HELD])
    stage(manifest, reference.path, provisional=True, **args)
    with pytest.raises(PublishError) as raised:
        approve(manifest, "alpha", "Reviewer", **args)
    assert LIMIT.reason in str(raised.value)


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


PENSION_RISE = Reform(
    id="pension_rise",
    name="Pension rise",
    parameter_changes={NEW_PENSION: {"2027": 250.0, "2028": 260.0}},
)


def test_generation_records_the_limit_from_the_scenarios_and_the_trees(
    world,
):
    # From the scenarios alone (stand-ins with no model) ...
    assert generated(
        world, PENSION_RISE, lambda dataset, scenario=None: world.sim()
    ) == [HELD]
    # ... and from the built trees and model.
    assert generated(world, PENSION_RISE, built(world)) == [HELD]


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


def test_the_flat_pipeline_says_when_this_model_overstates_a_measure(
    monkeypatch, capsys
):
    """The flat CSV path has no publication gate; it says loudly that the
    model overstates a State Pension measure, and stays quiet for the
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
    assert out.count("OVERSTATED BY THIS MODEL") == 1
    assert "Pension rise: The installed model" in out
    assert "Income: The installed model" not in out
