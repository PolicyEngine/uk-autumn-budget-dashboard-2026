"""Parameters the engine charges in step with another: a measure that
changes one without the other is refused in generation and warned about in
the flat pipeline (``uk_budget_data.parameter_companions``)."""

from types import SimpleNamespace

import pytest
from policyengine_core.periods import instant
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.parameter_companions import (
    COMPANIONS,
    built_companion_gaps,
    companion_gaps,
    companion_refusal,
    installed,
)
from uk_budget_data.publication import generate as generation
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

CGT_HIGHER = "gov.hmrc.cgt.higher_rate"
CGT_ADDITIONAL = "gov.hmrc.cgt.additional_rate"
LHA_FREEZE = "gov.dwp.LHA.freeze"
NI_LHA_FREEZE = "gov.dfc.LHA.freeze"
BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
BOTH_YEARS = {"2027": 0.26, "2028": 0.26}


def _every(path):
    return True


def scenario(changes):
    return SimpleNamespace(parameter_changes=changes)


def test_a_new_higher_rate_alone_is_a_gap():
    (gap,) = companion_gaps(scenario({CGT_HIGHER: BOTH_YEARS}), has=_every)
    assert (gap.path, gap.companion, gap.years) == (
        CGT_HIGHER,
        CGT_ADDITIONAL,
        ("2027", "2028"),
    )


def test_both_rates_together_are_not_a_gap():
    changes = {CGT_HIGHER: BOTH_YEARS, CGT_ADDITIONAL: BOTH_YEARS}
    assert companion_gaps(scenario(changes), has=_every) == []


def test_the_companion_alone_is_not_a_gap():
    """An additional rate of capital gains tax is a reform of its own."""
    assert (
        companion_gaps(scenario({CGT_ADDITIONAL: BOTH_YEARS}), has=_every)
        == []
    )


def test_a_year_left_out_of_the_companion_is_a_gap():
    changes = {CGT_HIGHER: BOTH_YEARS, CGT_ADDITIONAL: {"2027": 0.26}}
    (gap,) = companion_gaps(scenario(changes), has=_every)
    assert gap.years == ("2028",)


def test_either_side_is_checked():
    assert companion_gaps(
        None, scenario({CGT_HIGHER: BOTH_YEARS}), has=_every
    ) == companion_gaps(scenario({CGT_HIGHER: BOTH_YEARS}), None, has=_every)


def test_a_pair_the_engine_lacks_is_not_checked():
    """Northern Ireland's LHA parameters arrive in policyengine-uk 2.151.0;
    on an engine without them a Great Britain change stands alone."""
    changes = scenario({LHA_FREEZE: {"2027": False}})
    assert companion_gaps(changes, has=lambda path: "dfc" not in path) == []
    (gap,) = companion_gaps(changes, has=_every)
    assert gap.companion == NI_LHA_FREEZE


def test_the_reason_names_both_parameters_the_years_and_why():
    reason = companion_refusal(
        companion_gaps(scenario({CGT_HIGHER: BOTH_YEARS}), has=_every)
    )
    assert reason == (
        f"{CGT_HIGHER} changes in 2027, 2028 but {CGT_ADDITIONAL} does not, "
        "and the engine charges gains above the higher rate limit at it, "
        "equal to the higher rate in current law. Change both, or set "
        f"{CGT_ADDITIONAL} to its current value to leave it."
    )


@pytest.mark.parametrize("path, companion, why", COMPANIONS)
def test_each_pair_holds_one_value_in_current_law(path, companion, why):
    """The premise of every pair, on the installed engine: the first
    parameter exists, and its companion, where the engine has it, holds the
    same value, so a measure changing both to one value keeps them in step."""
    assert installed(path)
    if not installed(companion):
        return
    for year in range(2026, 2032):
        instant = f"{year}-04-06"
        first = system.parameters.get_child(path)(instant)
        second = system.parameters.get_child(companion)(instant)
        assert first == pytest.approx(second), year


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_no_registered_measure_has_a_gap(reform):
    config = DataConfig()
    assert (
        companion_gaps(
            reform.baseline_scenario_for(config), reform.to_scenario()
        )
        == []
    )


# --- generation and the flat pipeline ----------------------------------------


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generation, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


def _process(reform, config, baseline, reformed, baseline_scenario):
    values = {year: 1.0 for year in config.years}
    tables = make_tables(reform.id, values)
    tables.pop("household_scatter_binned")
    return ReformResult(
        reform_id=reform.id,
        reform_name=reform.name,
        household_scatter=make_household_rows(reform.id, values),
        constituency=[],
        demographic_constituency=[],
        **tables,
    )


BAD = {CGT_HIGHER: BOTH_YEARS}
GOOD = {BASIC_RATE: {"2027": 0.21, "2028": 0.21}}


def test_generation_refuses_a_higher_rate_without_its_companion(world):
    bad = Reform(id="bad", name="Bad", parameter_changes=BAD)
    good = Reform(id="good", name="Good", parameter_changes=GOOD)
    progress = []
    built = []

    def build(dataset, scenario=None):
        built.append(scenario)
        return world.sim()

    report = generation.generate_artifacts(
        [bad, good],
        DataConfig(years=[2027, 2028]),
        artifacts_root=world.artifacts,
        build=build,
        process=_process,
        on_progress=progress.append,
    )
    reason = companion_refusal(companion_gaps(scenario(BAD)))
    assert report.refused == {"bad": reason}
    assert [reference.key for reference in report.written] == ["good"]
    assert len(built) == 2  # the good measure's two simulations only
    assert f"bad: REFUSED: {reason}" in progress


def test_a_combined_set_cannot_carry_a_gap(world, monkeypatch):
    from uk_budget_data.publication import combine

    monkeypatch.setattr(
        combine,
        "check_consistency",
        lambda *args: pytest.fail("a refused set is not checked"),
    )
    report = generation.generate_artifacts(
        [],
        DataConfig(years=[2027, 2028]),
        combined_sets=[
            [
                Reform(id="bad", name="Bad", parameter_changes=BAD),
                Reform(id="good", name="Good", parameter_changes=GOOD),
            ]
        ],
        artifacts_root=world.artifacts,
        build=lambda *args: pytest.fail("a refused set builds nothing"),
        process=_process,
    )
    assert report.written == []
    assert report.refused == {
        "combined--bad+good": companion_refusal(companion_gaps(scenario(BAD)))
    }


def test_the_flat_pipeline_warns_and_runs_the_measure(monkeypatch, capsys):
    from uk_budget_data import pipeline

    processed = []

    class Processor:
        def __init__(self, reform, config):
            self.reform = reform

        def process(self, *args):
            processed.append(self.reform.id)

    monkeypatch.setattr(pipeline, "build_microsimulation", lambda *a: object())
    monkeypatch.setattr(pipeline, "ReformProcessor", Processor)
    monkeypatch.setattr(pipeline.data_limits, "limits_touched", lambda *a: [])
    monkeypatch.setattr(pipeline.model_limits, "limits_touched", lambda *a: [])
    monkeypatch.setattr(pipeline, "aggregate_results", lambda r, config: {})
    monkeypatch.setattr(pipeline.DataPipeline, "_save_all", lambda *a: None)
    reforms = [
        Reform(id="bad", name="Bad", parameter_changes=BAD),
        Reform(id="good", name="Good", parameter_changes=GOOD),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027, 2028])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    (gap,) = companion_gaps(scenario(BAD))
    assert f"WARNING bad: {gap.reason} Generation refuses it." in out
    assert "WARNING good" not in out
    assert processed == ["bad", "good"]


# --- what the built simulations run -------------------------------------------

HOUSEHOLD = {
    "people": {"p": {"age": {2027: 40}}},
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}
YEARS = [2027, 2028, 2029]


def _raise(sim, *paths):
    for path in paths:
        sim.tax_benefit_system.parameters.get_child(path).update(
            start=instant("2027-01-01"), stop=instant("2028-12-31"), value=0.26
        )


def raise_the_cgt_higher_rate(sim):
    _raise(sim, CGT_HIGHER)


def raise_both_cgt_rates(sim):
    _raise(sim, CGT_HIGHER, CGT_ADDITIONAL)


def _built(modifier=None, changes=None):
    return Simulation(
        situation=HOUSEHOLD,
        scenario=Scenario(
            parameter_changes=changes, simulation_modifier=modifier
        ),
    )


def test_a_modifier_raising_a_higher_rate_alone_is_a_built_gap():
    """#208 review, finding 8: a modifier changes no parameter_changes, so
    only the built simulations show it."""
    (gap,) = built_companion_gaps(
        _built(), _built(raise_the_cgt_higher_rate), YEARS
    )
    assert (gap.path, gap.companion, gap.years) == (
        CGT_HIGHER,
        CGT_ADDITIONAL,
        ("2027", "2028"),
    )


def test_a_modifier_raising_both_rates_is_not_a_built_gap():
    assert (
        built_companion_gaps(_built(), _built(raise_both_cgt_rates), YEARS)
        == []
    )


def test_a_companion_named_at_its_current_value_is_not_a_built_gap():
    """Leaving the companion as it is, written down in parameter_changes."""
    current = {
        str(year): system.parameters.get_child(CGT_ADDITIONAL)(f"{year}-01-01")
        for year in (2027, 2028)
    }
    changes = {CGT_ADDITIONAL: current}
    reformed = _built(raise_the_cgt_higher_rate, changes)
    gaps = built_companion_gaps(_built(), reformed, YEARS, scenario(changes))
    assert gaps == []


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_no_registered_measure_has_a_built_gap(reform):
    config = DataConfig()
    baseline_scenario = reform.baseline_scenario_for(config)
    reform_scenario = reform.to_scenario()
    assert (
        built_companion_gaps(
            Simulation(situation=HOUSEHOLD, scenario=baseline_scenario),
            Simulation(situation=HOUSEHOLD, scenario=reform_scenario),
            config.years,
            baseline_scenario,
            reform_scenario,
        )
        == []
    )


def test_generation_refuses_a_modifier_raising_a_higher_rate_alone(world):
    processed = []

    def build(dataset, scenario=None):
        changes = getattr(scenario, "parameter_changes", None) or None
        reform_side = bool(changes) and BASIC_RATE in changes
        sim = world.sim()
        real = _built(
            raise_the_cgt_higher_rate if reform_side else None, changes
        )
        sim.tax_benefit_system = real.tax_benefit_system
        return sim

    def process(*args):
        processed.append(args[0].id)
        return _process(*args)

    report = generation.generate_artifacts(
        [Reform(id="bad", name="Bad", parameter_changes=GOOD)],
        DataConfig(years=[2027, 2028]),
        artifacts_root=world.artifacts,
        build=build,
        process=process,
    )
    (gap,) = built_companion_gaps(
        _built(), _built(raise_the_cgt_higher_rate), [2027, 2028]
    )
    assert report.refused == {"bad": companion_refusal([gap])}
    assert report.written == []
    assert processed == []  # refused before any figure is made
