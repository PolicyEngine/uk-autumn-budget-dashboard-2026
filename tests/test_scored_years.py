"""Every scored year written for an uprated amount (policyengine-uk #2430).

After a bounded change the engine returns an uprated amount to its old
projected path, so a measure on one must write every scored year from its
first changed year. ``uk_budget_data.scored_years`` finds the years a
measure leaves out; generation refuses such a measure and writes the
others, and the flat pipeline warns. The properties below run on the
installed engine's own key reader, and a differential test checks the
check against the values the engine actually builds.
"""

from types import SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data import scored_years
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generation
from uk_budget_data.reforms import get_autumn_budget_2026_reforms
from uk_budget_data.scored_years import ScoredYearGap, missing_scored_years

PENSION = "gov.dwp.state_pension.new_state_pension.amount"
UC = "gov.dwp.universal_credit.standard_allowance.amount.SINGLE_OLD"
LEL = "gov.hmrc.national_insurance.class_1.thresholds.lower_earnings_limit"
CHILD_BENEFIT = "gov.hmrc.child_benefit.amount.eldest"
PLAN_2 = "gov.hmrc.student_loans.thresholds.plan_2"
# Day-weighted over the fiscal year (fiscal_year_blend).
FUEL_DUTY = "gov.hmrc.fuel_duty.petrol_and_diesel"
# Outside gov: never annualised, read at 1 January.
CARBON = (
    "household.consumption.carbon.intensity."
    "food_and_non_alcoholic_beverages_consumption"
)
UPRATED = [PENSION, UC, LEL, CHILD_BENEFIT, PLAN_2, FUEL_DUTY]
# Frozen by stated values, or never uprated.
ALLOWANCE = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
HIGHER_RATE_THRESHOLD = "gov.hmrc.income_tax.rates.uk[1].threshold"
BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"
NOT_UPRATED = [ALLOWANCE, HIGHER_RATE_THRESHOLD, BASIC_RATE]
YEARS = [2026, 2027, 2028, 2029, 2030]


def uprating(path):
    return system.parameters.get_child(path).metadata.get("uprating")


def test_the_paths_here_are_uprated_or_not_as_the_tests_assume():
    assert all(uprating(path) is not None for path in [*UPRATED, CARBON])
    assert all(uprating(path) is None for path in NOT_UPRATED)
    fuel = system.parameters.get_child(FUEL_DUTY).metadata
    assert fuel.get("fiscal_year_blend")


# --- properties ---------------------------------------------------------------


@st.composite
def written_changes(draw):
    """An uprated parameter's change writing every scored year from its
    first changed year, each year as a bare key or inside a ``start.stop``
    run of whole fiscal years; the first changed year may precede the
    scored years."""
    path = draw(st.sampled_from(UPRATED))
    last = draw(st.integers(2026, 2031))
    scored = list(range(draw(st.integers(2026, last)), last + 1))
    first = draw(st.integers(scored[0] - 2, last))
    runs = []
    year = first
    while year <= last:
        length = draw(st.integers(1, last - year + 1))
        bare = length == 1 and draw(st.booleans())
        runs.append((year, length, bare, draw(st.integers(1, 10_000))))
        year += length
    return path, scored, first, runs


def keys(runs, removed=None):
    """The change's keys, leaving out the year ``removed``."""
    changes = {}
    for start, length, bare, value in runs:
        years = [y for y in range(start, start + length) if y != removed]
        if not years:
            continue
        if bare:
            changes[str(start)] = value
            continue
        # A removed year splits a run in two around it.
        pieces, piece = [], [years[0]]
        for year in years[1:]:
            if year == piece[-1] + 1:
                piece.append(year)
            else:
                pieces.append(piece)
                piece = [year]
        pieces.append(piece)
        for piece in pieces:
            changes[f"{piece[0]}-04-06.{piece[-1] + 1}-04-05"] = value
    return changes


def on(side, changes):
    return (changes, None) if side == "baseline" else (None, changes)


@given(written_changes(), st.sampled_from(["baseline", "reform"]))
@settings(max_examples=60, deadline=None)
def test_writing_every_scored_year_passes(change, side):
    path, scored, first, runs = change
    assert (
        missing_scored_years(*on(side, {path: keys(runs)}), scored, system)
        == []
    )


@given(written_changes(), st.sampled_from(["baseline", "reform"]), st.data())
@settings(max_examples=60, deadline=None)
def test_leaving_out_any_later_year_is_caught_as_that_year(change, side, data):
    path, scored, first, runs = change
    later = [year for year in scored if year > first]
    if not later:
        return
    removed = data.draw(st.sampled_from(later))
    changes = {path: keys(runs, removed)}
    assert missing_scored_years(*on(side, changes), scored, system) == [
        ScoredYearGap(side, path, (removed,))
    ]


@given(
    st.sampled_from(UPRATED),
    st.integers(2026, 2029),
    st.integers(1, 6),
    st.sampled_from(["baseline", "reform"]),
    st.data(),
)
@settings(max_examples=40, deadline=None)
def test_removing_any_scored_year_is_caught_after_an_earlier_change(
    path, first_scored, length, side, data
):
    """The change starts before scoring, so removing even the first
    scored year leaves a gap after the first changed year."""
    scored = list(range(first_scored, first_scored + length))
    values = {str(year): 1 for year in [first_scored - 1, *scored]}
    assert (
        missing_scored_years(*on(side, {path: values}), scored, system) == []
    )
    removed = data.draw(st.sampled_from(scored))
    del values[str(removed)]
    assert missing_scored_years(*on(side, {path: values}), scored, system) == [
        ScoredYearGap(side, path, (removed,))
    ]


@given(written_changes())
@settings(max_examples=40, deadline=None)
def test_leaving_out_the_first_year_starts_the_change_a_year_later(change):
    """Not a gap: the year before a change's first is prior law, which is
    what a change starting then means."""
    path, scored, first, runs = change
    changes = {path: keys(runs, first)}
    assert missing_scored_years(None, changes, scored, system) == []


@given(
    st.sampled_from(NOT_UPRATED),
    st.sets(st.integers(2020, 2035), min_size=1),
    st.lists(st.integers(2024, 2032), min_size=1, unique=True),
)
@settings(max_examples=40, deadline=None)
def test_a_parameter_without_uprating_is_never_flagged(path, written, scored):
    """The frozen personal allowance and higher rate threshold, and a rate:
    a stated value resumes after a bounded change."""
    changes = {path: {str(year): 1 for year in written}}
    assert missing_scored_years(changes, changes, scored, system) == []


# --- examples -----------------------------------------------------------------


def test_each_side_is_checked_on_its_own():
    """A year written on one side does not fill the other's gap: each side
    runs its own simulation."""
    assert missing_scored_years(
        {PENSION: {"2027": 250}}, {PENSION: {"2028": 260}}, YEARS, system
    ) == [
        ScoredYearGap("baseline", PENSION, (2028, 2029, 2030)),
        ScoredYearGap("reform", PENSION, (2029, 2030)),
    ]


@pytest.mark.parametrize(
    "values, missing",
    [
        ({"2027": 1, "2028": 1, "2029": 1, "2030": 1}, ()),
        ({2027: 1, 2028: 1, 2029: 1, 2030: 1}, ()),
        ({"2027-04-06.2031-04-05": 1}, ()),
        ({"2027-04-06.2100-12-31": 1}, ()),
        ({"2027-04-06.2029-04-05": 1}, (2029, 2030)),
        # A lone date is that one day. 6 April moves no year's value, so
        # nothing changed (registered measures may not use one:
        # tests/test_measure_keys.py); 30 April moves that year's.
        ({"2027-04-06": 1}, ()),
        ({"2027-04-30": 1}, (2028, 2029, 2030)),
        # Starting after 30 April, the change first moves the next year.
        ({"2027-05-01.2031-04-05": 1}, ()),
        ({"2027-05-01.2030-04-05": 1}, (2030,)),
        # An earlier, unscored change starts the rule.
        ({"2024": 1, "2028": 1}, (2026, 2027, 2029, 2030)),
        # Scalars hold from 2000 to 2099.
        (1, ()),
        ({}, ()),
    ],
)
def test_keys_are_read_as_the_engine_reads_them(values, missing):
    gaps = missing_scored_years(None, {PENSION: values}, YEARS, system)
    assert gaps == (
        [ScoredYearGap("reform", PENSION, missing)] if missing else []
    )


@pytest.mark.parametrize(
    "values, missing",
    [
        ({"2027": 1}, ()),
        ({"2027-04-06.2027-10-05": 1, "2027-10-06.2028-04-05": 2}, ()),
        # One uncovered day moves the year's average.
        ({"2027-04-06.2027-10-05": 1, "2027-10-07.2028-04-05": 2}, (2027,)),
        ({"2027-04-07.2028-04-05": 1}, (2027,)),
        # Changed from January, the fiscal year that began in 2026 moved.
        ({"2027-01-01.2028-04-05": 1}, (2026,)),
    ],
)
def test_a_blended_amount_needs_every_day_of_the_fiscal_year(values, missing):
    gaps = missing_scored_years(
        None, {FUEL_DUTY: values}, [2026, 2027], system
    )
    assert gaps == (
        [ScoredYearGap("reform", FUEL_DUTY, missing)] if missing else []
    )


def stand_in(**metadata):
    """A system with one uprated parameter carrying this metadata."""
    parameter = SimpleNamespace(
        metadata={"uprating": "index", **metadata}, parent=None
    )
    return SimpleNamespace(
        parameters=SimpleNamespace(get_child=lambda path: parameter)
    )


def test_statutory_dates_need_every_day_of_the_fiscal_year():
    system_ = stand_in(preserve_calendar_dates=True)
    assert missing_scored_years(
        None, {PENSION: {"2027-04-06.2028-04-04": 1}}, [2027], system_
    ) == [ScoredYearGap("reform", PENSION, (2027,))]
    assert (
        missing_scored_years(None, {PENSION: {"2027": 1}}, [2027], system_)
        == []
    )


def test_a_parameter_outside_gov_is_read_at_1_january():
    """A bare year names the calendar year where the engine reads keys that
    way (policyengine 6.10.0); before, the fiscal year from 6 April, which
    misses the year's 1 January and sets the next year's."""
    gaps = missing_scored_years(
        None, {CARBON: {"2027": 1}}, [2027, 2028, 2029], system
    )
    if scored_years.parameter_reads_calendar_years is not None:
        assert gaps == [ScoredYearGap("reform", CARBON, (2028, 2029))]
    else:
        # Before #2404 the engine keeps prior law's path for gov parameters
        # only, so every scored year of a change outside gov must be written.
        assert gaps == [ScoredYearGap("reform", CARBON, (2027, 2029))]
    assert (
        missing_scored_years(
            None, {CARBON: {"2027-01-01.2029-12-31": 1}}, [2027, 2029], system
        )
        == []
    )


def test_an_unknown_path_or_unreadable_key_is_left_to_the_scenario():
    assert (
        missing_scored_years(
            None,
            {PENSION + "_extra": {"2027": 1}, PENSION: {"2027-13-01": 1}},
            YEARS,
            system,
        )
        == []
    )


def test_the_reason_names_the_path_and_years():
    assert ScoredYearGap("reform", PENSION, (2028, 2029)).reason == (
        f"{PENSION} has no value for 2028, 2029; after a bounded change an "
        "uprated amount returns to the old path (policyengine-uk #2430). "
        "Write every scored year."
    )


# --- against the engine -------------------------------------------------------

# Each change's value is far from the parameter's path, so a year shows
# the value exactly when the engine built it from the change.
DIFFERENTIAL = {
    PENSION: (300.0, {"2027": 300.0, "2029-04-06.2030-04-05": 300.0}),
    UC: (600.0, {"2027-05-01.2030-04-05": 600.0}),
    FUEL_DUTY: (0.9, {"2027": 0.9, "2028-04-06.2028-10-05": 0.9}),
    CARBON: (9.0, {"2027": 9.0}),
}


def test_the_check_finds_the_years_the_engine_builds_from_the_old_path():
    """Differential: for each change, the years the engine does not build
    from it, from the first year it moves, are the years the check
    reports."""
    situation = {
        "people": {"person": {"age": {2027: 40}}},
        "benunits": {"benunit": {"members": ["person"]}},
        "households": {"household": {"members": ["person"]}},
    }
    changes = {path: values for path, (_, values) in DIFFERENTIAL.items()}
    built = Simulation(
        situation=situation, scenario=Scenario(parameter_changes=changes)
    ).tax_benefit_system.parameters
    reported = {
        gap.path: gap.years
        for gap in missing_scored_years(None, changes, YEARS, system)
    }
    for path, (value, _) in DIFFERENTIAL.items():
        moved = [
            year
            for year in YEARS
            if built.get_child(path)(str(year))
            != system.parameters.get_child(path)(str(year))
        ]
        old_path = tuple(
            year
            for year in YEARS
            if year >= moved[0]
            and built.get_child(path)(str(year)) != pytest.approx(value)
        )
        assert reported.get(path, ()) == old_path, path


def test_only_forecast_inputs_are_projected_without_uprating_in_the_scored_years():
    """The check reads ``uprating`` metadata. Processing also projects the
    income tax and NICs thresholds past their last stated year, and the
    installed engines return those to the old path after a bounded change
    too, but they are stated through 2030-31, the last default scored
    year. If a parameter is projected without ``uprating`` metadata within
    the default scored years, extend the check to it (unless the engine
    resumes it from the changed amount, as policyengine-uk 2.145.0 does
    for the thresholds)."""
    from policyengine_core.parameters import Parameter
    from policyengine_uk.tax_benefit_system import (
        projected_timelines,
        statutory_parameters,
    )

    last_year = max(DataConfig().years)
    projected = projected_timelines()
    within = []
    for leaf in statutory_parameters().gov.get_descendants():
        if not isinstance(leaf, Parameter) or not leaf.values_list:
            continue
        try:
            if uprating(leaf.name) is not None:
                continue
        except ValueError:  # not in the processed tree
            continue
        stated = max(entry.instant_str for entry in leaf.values_list)
        first = min(
            (
                entry.instant_str
                for entry in projected.get(leaf.name) or []
                if entry.instant_str > stated
            ),
            default=None,
        )
        # Fiscal year Y is read at 30 April Y.
        if first is not None and first <= f"{last_year}-04-30":
            within.append(leaf.name)
    assert all(
        name.startswith("gov.economic_assumptions.statutory_uprating_inputs.")
        for name in within
    ), within


@pytest.mark.parametrize(
    "reform", get_autumn_budget_2026_reforms(), ids=lambda reform: reform.id
)
def test_no_registered_measure_leaves_out_a_scored_year(reform):
    config = DataConfig()
    baseline = reform.baseline_scenario_for(config)
    assert (
        missing_scored_years(
            getattr(baseline, "parameter_changes", None),
            reform.to_scenario().parameter_changes,
            config.years,
            system,
        )
        == []
    )


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


INCOMPLETE = {PENSION: {"2027": 250}}
REASON = ScoredYearGap("reform", PENSION, (2028,)).reason


@pytest.mark.parametrize("side", ["reform", "baseline", "configured baseline"])
def test_generation_refuses_the_measure_and_writes_the_others(world, side):
    bad = Reform(
        id="bad",
        name="Bad",
        parameter_changes=INCOMPLETE if side == "reform" else {},
        baseline_parameter_changes=INCOMPLETE if side == "baseline" else None,
    )
    good = Reform(
        id="good",
        name="Good",
        baseline_parameter_changes={},
        parameter_changes={PENSION: {"2027": 250, "2028": 260}},
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
                INCOMPLETE if side == "configured baseline" else None
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


def test_the_command_prints_the_refusal(world):
    from uk_budget_data.publication.commands import run_generate_artifacts

    printed = []
    code = run_generate_artifacts(
        SimpleNamespace(combined=None, artifacts_root=world.artifacts),
        DataConfig(years=[2027, 2028]),
        [Reform(id="bad", name="Bad", parameter_changes=INCOMPLETE)],
        lambda reform_id: None,
        out=printed.append,
    )
    assert code == 1
    assert f"REFUSED bad: {REASON}" in printed


def test_a_combined_set_cannot_hide_a_members_left_out_year(world):
    bad = Reform(id="bad", name="Bad", parameter_changes={UC: {"2027": 450}})
    other = Reform(
        id="other",
        name="Other",
        parameter_changes={BASIC_RATE: {"2027": 0.21}},
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
    assert report.refused == {
        "combined--bad+other": ScoredYearGap("reform", UC, (2028,)).reason
    }


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
        Reform(id="bad", name="Bad", parameter_changes=INCOMPLETE),
        Reform(
            id="good",
            name="Good",
            parameter_changes={PENSION: {"2027": 250, "2028": 260}},
        ),
    ]
    pipeline.DataPipeline(reforms, DataConfig(years=[2027, 2028])).run(
        skip_input_check=True
    )
    out = " ".join(capsys.readouterr().out.split())
    assert f"WARNING bad: {REASON} Generation refuses it." in out
    assert out.count("WARNING") == 1
    assert processed == ["bad", "good"]
