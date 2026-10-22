"""Refuse the engine's gross-wealth bases for net-assets announcements: in
the templates, and in generation, whether a measure changes a wealth-tax
scale in its ``parameter_changes`` or in what its built simulations run."""

from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_core.periods import instant
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data import data_limits
from uk_budget_data.measure_templates import (
    WEALTH_TAX_SCALES,
    allowance_uprating,
    is_wealth_tax_path,
    rate_change,
    threshold_change,
    wealth_tax_paths,
    wealth_tax_paths_differing,
    wealth_tax_refusal,
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generation
from uk_budget_data.publication.receipt import ReceiptUnavailable
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

WEALTH_TAX = "gov.contrib.ubi_center.wealth_tax"
NPR_WEALTH_TAX = "gov.contrib.cec.non_primary_residence_wealth_tax"
SCALES = [WEALTH_TAX, NPR_WEALTH_TAX]
WEALTH_RATE = WEALTH_TAX + "[1].rate"
NPR_RATE = NPR_WEALTH_TAX + "[0].rate"
BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
PENSION = "gov.dwp.state_pension.new_state_pension.amount"
# What each scale's refusal says its base is.
BASES = {
    WEALTH_TAX: ["wealth_tax applies to total_wealth: gross wealth"],
    NPR_WEALTH_TAX: [
        "non_primary_residence_wealth_tax applies to total_wealth less "
        "main_residence_value: gross wealth",
        "less the main home's full value rather than its equity",
    ],
}
HOUSEHOLD = {
    "people": {"p": {"age": {2027: 40}}},
    "benunits": {"b": {"members": ["p"]}},
    "households": {"h": {"members": ["p"]}},
}


# --- the templates -------------------------------------------------------------


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
@pytest.mark.parametrize(
    "path",
    [
        WEALTH_TAX + suffix
        for suffix in ["", "[0].rate", "[1].threshold", ".not_a_native_leaf"]
    ]
    + [
        NPR_WEALTH_TAX + suffix for suffix in ["", "[0].rate", "[0].threshold"]
    ],
)
def test_annual_builders_refuse_every_path_under_a_wealth_tax_scale(
    builder, path
):
    with pytest.raises(ValueError) as error:
        builder(path, {2027: 0.02})
    message = str(error.value)
    scale = next(scale for scale in SCALES if path.startswith(scale))
    assert message.startswith(f"{path} is under {scale}, which the engine's")
    for words in BASES[scale]:
        assert words in message
    assert "private pension" in message
    assert "no debts netted" in message
    assert "net assets would be scored on the wrong base" in message
    assert "budget-triage/JUDGED.md, S4" in message


@pytest.mark.parametrize("scale", SCALES)
def test_allowance_builder_also_refuses_the_wealth_tax_base(scale):
    with pytest.raises(ValueError, match="wrong base"):
        allowance_uprating(scale + "[0].threshold", 10_000_000, {2027: 0})


@pytest.mark.parametrize("scale", SCALES)
def test_a_similarly_named_unknown_path_is_not_mistaken_for_wealth_tax(scale):
    with pytest.raises(ValueError, match="Unknown parameter path"):
        rate_change(scale + "_other", {2027: 0.02})


# --- the engine ----------------------------------------------------------------


def test_the_refused_scales_are_the_engines_wealth_taxes():
    """Tripwire: the installed engine's wealth-tax variables are the two
    whose scales are refused, and each formula reads total_wealth. A new
    wealth tax, or one moved to a net base, fails here until the refusal
    is updated."""
    assert set(WEALTH_TAX_SCALES) == set(SCALES)
    names = {name for name in system.variables if "wealth_tax" in name}
    assert names == {"wealth_tax", "non_primary_residence_wealth_tax"}
    for name in names:
        formula = system.variables[name].get_formula("2027")
        assert "total_wealth" in formula.__code__.co_consts


def test_the_installed_leaves_refused_are_exactly_those_under_the_scales():
    """An oracle independent of the path test: membership in the installed
    tree. Every leaf under either scale is refused, and no other leaf of
    gov.contrib, where both scales and their neighbours are (a path outside
    it cannot start with either scale's path)."""
    leaves = data_limits._structure(system.parameters, "gov.contrib")
    under = {
        path
        for scale in SCALES
        for path in data_limits._structure(system.parameters, scale)
    }
    assert {p for p in under if p.startswith(WEALTH_TAX)}
    assert {p for p in under if p.startswith(NPR_WEALTH_TAX)}
    assert {path for path in leaves if is_wealth_tax_path(path)} == under


# --- generation and the flat pipeline -------------------------------------------


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


def plain(path):
    return {path: {"2027": 0.02, "2028": 0.02}}


GOOD_CHANGE = {BASIC_RATE: {"2027": 0.21, "2028": 0.21}}
INCOMPLETE = {PENSION: {"2027": 250}}


@pytest.mark.parametrize("path", [WEALTH_RATE, NPR_RATE])
@pytest.mark.parametrize("side", ["reform", "baseline", "configured baseline"])
def test_generation_refuses_a_plain_wealth_tax_change_and_writes_the_others(
    world, side, path
):
    bad = Reform(
        id="bad",
        name="Bad",
        parameter_changes=plain(path) if side == "reform" else {},
        baseline_parameter_changes=(
            plain(path) if side == "baseline" else None
        ),
    )
    good = Reform(
        id="good",
        name="Good",
        baseline_parameter_changes={},
        parameter_changes=GOOD_CHANGE,
    )
    progress = []
    built = []

    def build(dataset, scenario=None):
        built.append(scenario)
        return world.sim()

    report = generation.generate_artifacts(
        [bad, good],
        DataConfig(
            years=[2027, 2028],
            baseline_parameter_changes=(
                plain(path) if side == "configured baseline" else None
            ),
        ),
        artifacts_root=world.artifacts,
        build=build,
        process=_process,
        on_progress=progress.append,
    )
    reason = wealth_tax_refusal(path)
    assert report.refused == {"bad": reason}
    assert [reference.key for reference in report.written] == ["good"]
    assert len(built) == 2  # the good measure's two simulations only
    assert not (world.artifacts / "bad").exists()
    assert f"bad: REFUSED: {reason}" in progress


def _fail_the_consistency_check(monkeypatch):
    from uk_budget_data.publication import combine

    # Refused before the consistency check builds its parameter snapshots.
    monkeypatch.setattr(
        combine,
        "check_consistency",
        lambda *args: pytest.fail("a refused set is not checked"),
    )


@pytest.mark.parametrize(
    "side", ["reform", "member baseline", "configured baseline"]
)
def test_a_combined_set_cannot_carry_a_wealth_tax_change(
    world, monkeypatch, side
):
    _fail_the_consistency_check(monkeypatch)
    bad = Reform(
        id="bad",
        name="Bad",
        parameter_changes=plain(WEALTH_RATE) if side == "reform" else {},
        baseline_parameter_changes=(
            plain(WEALTH_RATE) if side == "member baseline" else None
        ),
    )
    other = Reform(id="other", name="Other", parameter_changes=GOOD_CHANGE)
    report = generation.generate_artifacts(
        [],
        DataConfig(
            years=[2027, 2028],
            baseline_parameter_changes=(
                plain(WEALTH_RATE) if side == "configured baseline" else None
            ),
        ),
        combined_sets=[[bad, other]],
        artifacts_root=world.artifacts,
        build=lambda *args: pytest.fail("a refused set builds nothing"),
        process=_process,
    )
    assert report.written == []
    assert report.refused == {
        "combined--bad+other": wealth_tax_refusal(WEALTH_RATE)
    }


def test_the_wealth_tax_reason_comes_before_a_left_out_year(world):
    both = Reform(
        id="both",
        name="Both",
        parameter_changes={**plain(WEALTH_RATE), **INCOMPLETE},
    )
    report = generation.generate_artifacts(
        [both],
        DataConfig(years=[2027, 2028]),
        artifacts_root=world.artifacts,
        build=lambda *args: pytest.fail("a refused measure builds nothing"),
        process=_process,
    )
    assert report.refused == {"both": wealth_tax_refusal(WEALTH_RATE)}


def test_a_combined_sets_wealth_tax_reason_comes_first(world, monkeypatch):
    _fail_the_consistency_check(monkeypatch)
    wealth = Reform(
        id="wealth", name="Wealth", parameter_changes=plain(WEALTH_RATE)
    )
    gap = Reform(id="gap", name="Gap", parameter_changes=INCOMPLETE)
    report = generation.generate_artifacts(
        [],
        DataConfig(years=[2027, 2028]),
        combined_sets=[[wealth, gap]],
        artifacts_root=world.artifacts,
        build=lambda *args: pytest.fail("a refused set builds nothing"),
        process=_process,
    )
    assert report.refused == {
        "combined--gap+wealth": wealth_tax_refusal(WEALTH_RATE)
    }


def test_every_wealth_tax_path_a_measure_changes_is_named():
    paths = [NPR_RATE, WEALTH_RATE, WEALTH_TAX + "[1].threshold"]  # sorted
    with pytest.raises(ReceiptUnavailable) as error:
        generation._refuse_wealth_tax_base(
            "m",
            SimpleNamespace(parameter_changes={paths[2]: {"2027": 1e7}}),
            SimpleNamespace(
                parameter_changes={
                    paths[1]: {"2027": 0.02},
                    paths[0]: {"2027": 0.01},
                }
            ),
        )
    reason = error.value.reason
    assert reason == wealth_tax_refusal(*paths)
    assert reason.startswith(f"{paths[0]} is under {NPR_WEALTH_TAX}")
    assert f" {paths[1]}, {paths[2]} are under {WEALTH_TAX}" in reason
    assert reason.count("budget-triage/JUDGED.md, S4") == 1


# --- a modifier that edits a scale, as the built simulations show it -------------


def raise_the_wealth_tax(sim):
    """A modifier that edits a wealth-tax scale with no parameter_changes."""
    sim.tax_benefit_system.parameters.get_child(WEALTH_RATE).update(
        start=instant("2027-01-01"), stop=instant("2028-12-31"), value=0.02
    )


def raise_the_wealth_tax_in_2027_only(sim):
    sim.tax_benefit_system.parameters.get_child(WEALTH_RATE).update(
        start=instant("2027-01-01"), stop=instant("2027-12-31"), value=0.02
    )


def raise_the_npr_wealth_tax(sim):
    sim.tax_benefit_system.parameters.get_child(NPR_RATE).update(
        start=instant("2027-01-01"), stop=instant("2028-12-31"), value=0.01
    )


def set_the_wealth_tax_in_place(sim):
    """As reforms.py edits the dividend scale: each stored value in place."""
    rate = sim.tax_benefit_system.parameters.get_child(WEALTH_RATE)
    for entry in rate.values_list:
        if entry.instant_str >= "2027":
            entry.value = 0.02


def rebind_the_wealth_tax(sim):
    """A modifier that binds the scale's attribute to another node, which
    the stored tree does not show: refused as the scale itself."""
    ubi_center = sim.tax_benefit_system.parameters.gov.contrib.ubi_center
    ubi_center.wealth_tax = ubi_center.wealth_tax.clone()


def raise_the_basic_rate(sim):
    sim.tax_benefit_system.parameters.get_child(BASIC_RATE).update(
        start=instant("2027-01-01"), stop=instant("2028-12-31"), value=0.22
    )


def built(world, modifier, side):
    """Stand-ins carrying a real parameter tree built with the scenario,
    with ``modifier`` applied on ``side`` only (the reform side is the one
    with GOOD_CHANGE)."""

    def build(dataset, scenario=None):
        changes = getattr(scenario, "parameter_changes", None) or None
        reform_side = bool(changes) and BASIC_RATE in changes
        sim = world.sim()
        sim.tax_benefit_system = Simulation(
            situation=HOUSEHOLD,
            scenario=Scenario(
                parameter_changes=changes,
                simulation_modifier=(
                    modifier if reform_side == (side == "reform") else None
                ),
            ),
        ).tax_benefit_system
        return sim

    return build


@pytest.mark.parametrize(
    "modifier, paths",
    [
        (raise_the_wealth_tax, [WEALTH_RATE]),
        (raise_the_wealth_tax_in_2027_only, [WEALTH_RATE]),
        (raise_the_npr_wealth_tax, [NPR_RATE]),
        (set_the_wealth_tax_in_place, [WEALTH_RATE]),
        (rebind_the_wealth_tax, [WEALTH_TAX]),
    ],
)
@pytest.mark.parametrize("side", ["reform", "baseline"])
def test_generation_refuses_a_modifier_that_edits_a_scale(
    world, modifier, paths, side
):
    processed = []

    def process(*args):
        processed.append(args[0].id)
        return _process(*args)

    report = generation.generate_artifacts(
        [Reform(id="bad", name="Bad", parameter_changes=GOOD_CHANGE)],
        DataConfig(years=[2027, 2028]),
        artifacts_root=world.artifacts,
        build=built(world, modifier, side),
        process=process,
    )
    assert report.refused == {"bad": wealth_tax_refusal(*paths)}
    assert report.written == []
    assert processed == []  # refused before any figure is made


def raise_every_wealth_tax_leaf(sim):
    """Edits every leaf of both scales: eight paths, named in sorted order."""
    for scale in SCALES:
        for leaf in data_limits._structure(
            sim.tax_benefit_system.parameters, scale
        ).values():
            leaf.update(
                start=instant("2027-01-01"),
                stop=instant("2028-12-31"),
                value=1e6 if leaf.name.endswith("threshold") else 0.01,
            )


def test_every_leaf_a_modifier_changes_is_named_once_in_sorted_order():
    leaves = sorted(
        path
        for scale in SCALES
        for path in data_limits._structure(system.parameters, scale)
    )
    assert len(leaves) == 8
    baseline = Simulation(situation=HOUSEHOLD)
    reformed = Simulation(
        situation=HOUSEHOLD,
        scenario=Scenario(simulation_modifier=raise_every_wealth_tax_leaf),
    )
    assert wealth_tax_paths_differing(baseline, reformed) == leaves
    assert wealth_tax_paths_differing(reformed, baseline) == leaves


@pytest.mark.parametrize("modifier", [None, raise_the_basic_rate])
def test_built_simulations_that_agree_on_the_scales_are_written(
    world, modifier
):
    report = generation.generate_artifacts(
        [Reform(id="good", name="Good", parameter_changes=GOOD_CHANGE)],
        DataConfig(years=[2027, 2028]),
        artifacts_root=world.artifacts,
        build=built(world, modifier, "reform"),
        process=_process,
    )
    assert report.refused == {}
    assert [reference.key for reference in report.written] == ["good"]


def _caches(systems):
    """The keys of every at-instant cache formulas read through, in each
    system: its own and every parameter node's (``data_limits._caches``,
    the caches the comparison's restore covers)."""
    return [
        [set(cache) for cache in data_limits._caches(system)]
        for system in systems
    ]


@pytest.mark.parametrize(
    "modifier, expected",
    [(raise_the_basic_rate, []), (raise_the_wealth_tax, [WEALTH_RATE])],
    ids=["scales agree", "a scale differs"],
)
def test_the_comparison_leaves_the_parameter_caches_as_it_found_them(
    modifier, expected
):
    baseline = Simulation(situation=HOUSEHOLD)
    reformed = Simulation(
        situation=HOUSEHOLD, scenario=Scenario(simulation_modifier=modifier)
    )
    systems = [baseline.tax_benefit_system, reformed.tax_benefit_system]
    before = _caches(systems)
    assert wealth_tax_paths_differing(baseline, reformed) == expected
    assert _caches(systems) == before


# Generated from a capital gains projection: the engine refuses a direct
# change and takes CapitalGainsProjection(...) instead, so no measure's
# parameter_changes moves it.
GENERATED_SERIES = {"gov.economic_assumptions.yoy_growth.capital_gains"}


def test_moving_every_growth_series_leaves_both_scales_unchanged():
    """Tripwire: neither scale is projected by an economic assumption on
    this engine, so a measure that moves the macro path is not refused as a
    wealth tax. If the engine starts indexing a scale, this fails and a
    person decides how the built-tree check should treat it."""
    series = data_limits._structure(
        system.parameters, "gov.economic_assumptions.yoy_growth"
    )
    assert len(series) > 20
    changes = {}
    for path, leaf in series.items():
        if path in GENERATED_SERIES:
            continue
        values = {}
        for year in ("2027", "2028"):
            current = leaf(f"{year}-01-01")
            values[year] = (
                float(current) + 0.02
                if isinstance(current, (int, float))
                else 0.03
            )
        changes[path] = values
    scenario = Scenario(parameter_changes=changes)
    assert wealth_tax_paths(None, scenario) == []
    baseline = Simulation(situation=HOUSEHOLD)
    moved = Simulation(situation=HOUSEHOLD, scenario=scenario)
    cpi = "gov.economic_assumptions.yoy_growth.obr.consumer_price_index"
    assert moved.tax_benefit_system.parameters.get_child(cpi)(
        "2027-01-01"
    ) == pytest.approx(changes[cpi]["2027"])
    assert wealth_tax_paths_differing(baseline, moved) == []


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_no_registered_measure_changes_a_wealth_tax_scale(reform):
    """Registering such a measure fails here, in its parameter changes or
    in what its two built simulations run."""
    config = DataConfig()
    baseline_scenario = reform.baseline_scenario_for(config)
    reform_scenario = reform.to_scenario()
    assert wealth_tax_paths(baseline_scenario, reform_scenario) == []
    baseline = Simulation(situation=HOUSEHOLD, scenario=baseline_scenario)
    reformed = Simulation(situation=HOUSEHOLD, scenario=reform_scenario)
    assert wealth_tax_paths_differing(baseline, reformed) == []


def _flat_pipeline(monkeypatch, build=lambda *args: object()):
    from uk_budget_data import pipeline

    processed = []

    class Processor:
        def __init__(self, reform, config):
            self.reform = reform

        def process(self, *args):
            processed.append(self.reform.id)

    monkeypatch.setattr(pipeline, "build_microsimulation", build)
    monkeypatch.setattr(pipeline, "ReformProcessor", Processor)
    monkeypatch.setattr(
        pipeline.data_limits, "limits_touched", lambda *args: []
    )
    monkeypatch.setattr(
        pipeline.model_limits, "limits_touched", lambda *args: []
    )
    monkeypatch.setattr(pipeline, "aggregate_results", lambda r, config: {})
    monkeypatch.setattr(pipeline.DataPipeline, "_save_all", lambda *args: None)
    return pipeline, processed


@pytest.mark.parametrize("side", ["reform", "baseline"])
def test_the_flat_pipeline_warns_and_runs_the_measure(
    monkeypatch, capsys, side
):
    pipeline, processed = _flat_pipeline(monkeypatch)
    reforms = [
        Reform(
            id="bad",
            name="Bad",
            parameter_changes={
                **({} if side == "baseline" else plain(WEALTH_RATE)),
                **INCOMPLETE,
            },
            baseline_parameter_changes=(
                plain(WEALTH_RATE) if side == "baseline" else None
            ),
        ),
        Reform(id="good", name="Good", parameter_changes=GOOD_CHANGE),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027, 2028])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    warning = f"WARNING bad: {wealth_tax_refusal(WEALTH_RATE)}"
    assert f"{warning} Generation refuses it." in out
    # In generation's order: the wealth tax, then the left-out year.
    assert out.index(warning) < out.index(
        "WARNING bad: ", out.index(warning) + 1
    )
    assert "WARNING good" not in out
    assert processed == ["bad", "good"]


def _real_build(dataset, scenario=None):
    return Simulation(situation=HOUSEHOLD, scenario=scenario)


@pytest.mark.parametrize(
    "reform",
    [
        Reform(id="bad", name="Bad", parameter_changes=plain(WEALTH_RATE)),
        Reform(
            id="bad",
            name="Bad",
            parameter_changes=GOOD_CHANGE,
            simulation_modifier=raise_the_wealth_tax,
        ),
    ],
    ids=["parameter changes", "modifier"],
)
def test_the_flat_pipeline_warns_once_on_built_simulations(
    monkeypatch, capsys, reform
):
    pipeline, processed = _flat_pipeline(monkeypatch, _real_build)
    pipeline.DataPipeline([reform], DataConfig(years=[2027, 2028])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    assert out.count("WARNING bad:") == 1
    assert f"WARNING bad: {wealth_tax_refusal(WEALTH_RATE)}" in out
    assert processed == ["bad"]


# --- properties ----------------------------------------------------------------

# Paths near the scales' names: their parts, siblings, and lookalikes.
NEAR_PATHS = st.builds(
    lambda stem, tail: stem + tail,
    st.sampled_from(
        [
            WEALTH_TAX,
            WEALTH_TAX[:-1],
            WEALTH_TAX + "_other",
            NPR_WEALTH_TAX,
            NPR_WEALTH_TAX + "es",
            "gov.contrib.ubi_center",
            "gov.contrib.ubi_center.wealth",
            "gov.contrib.cec",
        ]
    ),
    st.text(alphabet=".[]0123_ratehsold", max_size=12),
)


@settings(max_examples=200, deadline=None)
@given(NEAR_PATHS)
def test_the_templates_and_generation_refuse_the_same_paths(path):
    """The wiring of the two entry points: a template builder refuses a
    path as a wealth tax exactly when generation refuses a measure that
    writes it as plain parameter_changes. (Which paths are refused is
    checked against the installed tree above.)"""
    try:
        rate_change(path, {2027: 0.02})
        template_refuses = False
    except ValueError as error:
        template_refuses = "wrong base" in str(error)
    try:
        generation._refuse_wealth_tax_base(
            "m", None, SimpleNamespace(parameter_changes={path: {}})
        )
        generation_refuses = False
    except ReceiptUnavailable:
        generation_refuses = True
    assert template_refuses == generation_refuses == is_wealth_tax_path(path)


@settings(max_examples=200, deadline=None)
@given(st.lists(NEAR_PATHS, max_size=8), st.lists(NEAR_PATHS, max_size=8))
def test_the_named_paths_are_both_sides_wealth_tax_paths_sorted(left, right):
    """Deterministic: the refusal names each wealth-tax path once, in sorted
    order, whatever the order of the changes or the hash seed."""
    named = wealth_tax_paths(
        SimpleNamespace(parameter_changes=dict.fromkeys(left)),
        SimpleNamespace(parameter_changes=dict.fromkeys(reversed(right))),
    )
    assert named == sorted(
        {path for path in left + right if is_wealth_tax_path(path)}
    )


@given(st.one_of(st.none(), st.integers(), st.binary(), st.tuples()))
def test_a_key_that_is_not_a_path_is_not_the_wealth_tax(key):
    assert not is_wealth_tax_path(key)
