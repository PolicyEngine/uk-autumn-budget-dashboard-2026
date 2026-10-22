"""Refuse the engine's gross-wealth base for net-assets announcements:
in the templates, and in generation for plain ``parameter_changes``."""

from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data.measure_templates import (
    allowance_uprating,
    is_wealth_tax_path,
    rate_change,
    threshold_change,
    wealth_tax_paths,
    wealth_tax_refusal,
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generation
from uk_budget_data.publication.receipt import ReceiptUnavailable
from uk_budget_data.reforms import get_autumn_budget_2026_reforms

WEALTH_TAX = "gov.contrib.ubi_center.wealth_tax"
WEALTH_RATE = WEALTH_TAX + "[1].rate"
BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
@pytest.mark.parametrize(
    "suffix", ["", "[0].rate", "[1].threshold", ".not_a_native_leaf"]
)
def test_annual_builders_refuse_every_path_under_wealth_tax(builder, suffix):
    with pytest.raises(ValueError) as error:
        builder(WEALTH_TAX + suffix, {2027: 0.02})
    message = str(error.value)
    assert WEALTH_TAX + suffix in message
    assert "gross wealth" in message
    assert "private pension" in message
    assert "no debts netted" in message
    assert "net assets would be scored on the wrong base" in message
    assert "budget-triage/JUDGED.md, S4" in message


def test_allowance_builder_also_refuses_the_wealth_tax_base():
    with pytest.raises(ValueError, match="wrong base"):
        allowance_uprating(WEALTH_TAX + "[0].threshold", 10_000_000, {2027: 0})


def test_a_similarly_named_unknown_path_is_not_mistaken_for_wealth_tax():
    with pytest.raises(ValueError, match="Unknown parameter path"):
        rate_change(WEALTH_TAX + "_other", {2027: 0.02})


# --- generation and the flat pipeline -----------------------------------------


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


PLAIN = {WEALTH_RATE: {"2027": 0.02, "2028": 0.02}}
REASON = wealth_tax_refusal(WEALTH_RATE)


@pytest.mark.parametrize("side", ["reform", "baseline", "configured baseline"])
def test_generation_refuses_a_plain_wealth_tax_change_and_writes_the_others(
    world, side
):
    bad = Reform(
        id="bad",
        name="Bad",
        parameter_changes=PLAIN if side == "reform" else {},
        baseline_parameter_changes=PLAIN if side == "baseline" else None,
    )
    good = Reform(
        id="good",
        name="Good",
        baseline_parameter_changes={},
        parameter_changes={BASIC_RATE: {"2027": 0.21, "2028": 0.21}},
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
                PLAIN if side == "configured baseline" else None
            ),
        ),
        artifacts_root=world.artifacts,
        build=build,
        process=_process,
        on_progress=progress.append,
    )
    assert report.refused == {"bad": REASON}
    assert [reference.key for reference in report.written] == ["good"]
    assert len(built) == 2  # the good measure's two simulations only
    assert not (world.artifacts / "bad").exists()
    assert f"bad: REFUSED: {REASON}" in progress


def test_a_combined_set_cannot_carry_a_wealth_tax_change(world, monkeypatch):
    from uk_budget_data.publication import combine

    # Refused before the consistency check builds its parameter snapshots.
    monkeypatch.setattr(
        combine,
        "check_consistency",
        lambda *args: pytest.fail("a refused set is not checked"),
    )
    bad = Reform(id="bad", name="Bad", parameter_changes=PLAIN)
    other = Reform(
        id="other",
        name="Other",
        parameter_changes={BASIC_RATE: {"2027": 0.21, "2028": 0.21}},
    )
    report = generation.generate_artifacts(
        [],
        DataConfig(years=[2027, 2028]),
        combined_sets=[[bad, other]],
        artifacts_root=world.artifacts,
        build=lambda *args: pytest.fail("a refused set builds nothing"),
        process=_process,
    )
    assert report.written == []
    assert report.refused == {"combined--bad+other": REASON}


def test_every_wealth_tax_path_a_measure_changes_is_named():
    paths = [WEALTH_RATE, WEALTH_TAX + "[1].threshold"]  # sorted
    with pytest.raises(ReceiptUnavailable) as error:
        generation._refuse_wealth_tax_base(
            "m",
            SimpleNamespace(parameter_changes={paths[1]: {"2027": 1e7}}),
            SimpleNamespace(parameter_changes={paths[0]: {"2027": 0.02}}),
        )
    assert error.value.reason == wealth_tax_refusal(*paths)
    assert error.value.reason.startswith(", ".join(paths) + " are under")


def test_the_flat_pipeline_warns_and_runs_the_measure(monkeypatch, capsys):
    from uk_budget_data import pipeline

    processed = []

    class Processor:
        def __init__(self, reform, config):
            self.reform = reform

        def process(self, *args):
            processed.append(self.reform.id)

    monkeypatch.setattr(
        pipeline, "build_microsimulation", lambda *args: object()
    )
    monkeypatch.setattr(pipeline, "ReformProcessor", Processor)
    monkeypatch.setattr(
        pipeline.data_limits, "limits_touched", lambda *args: []
    )
    monkeypatch.setattr(
        pipeline.model_limits, "limits_touched", lambda *args: []
    )
    monkeypatch.setattr(pipeline, "aggregate_results", lambda r, config: {})
    monkeypatch.setattr(pipeline.DataPipeline, "_save_all", lambda *args: None)
    reforms = [
        Reform(id="bad", name="Bad", parameter_changes=PLAIN),
        Reform(
            id="good",
            name="Good",
            parameter_changes={BASIC_RATE: {"2027": 0.21, "2028": 0.21}},
        ),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027, 2028])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    assert f"WARNING bad: {REASON} Generation refuses it." in out
    assert "WARNING good" not in out
    assert processed == ["bad", "good"]


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_no_registered_measure_changes_the_wealth_tax(reform):
    config = DataConfig()
    assert (
        wealth_tax_paths(
            reform.baseline_scenario_for(config), reform.to_scenario()
        )
        == []
    )


# Paths near the scale's name: its parts, siblings, and lookalikes.
NEAR_PATHS = st.builds(
    lambda stem, tail: stem + tail,
    st.sampled_from(
        [
            WEALTH_TAX,
            WEALTH_TAX[:-1],
            WEALTH_TAX + "_other",
            "gov.contrib.ubi_center",
            "gov.contrib.ubi_center.wealth",
        ]
    ),
    st.text(alphabet=".[]0123_ratehsold", max_size=12),
)


@settings(max_examples=200, deadline=None)
@given(NEAR_PATHS)
def test_the_templates_and_generation_refuse_the_same_paths(path):
    """A differential check of the two entry points: a template builder
    refuses a path as the wealth tax exactly when generation refuses a
    measure that writes it as plain parameter_changes."""
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
