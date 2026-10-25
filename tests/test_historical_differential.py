"""The national differential for a past event: this dashboard's figure
against the scorecard replay's, within max(1%, £1m), reported and never
gating (uk_budget_data.historical_differential)."""

import json
import shutil
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tests.publication_support import World, make_tables
from uk_budget_data import historical_differential as d
from uk_budget_data import historical_events, releases
from uk_budget_data.publication import artifacts as artifact_module

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ARTIFACTS = (
    ROOT / "src" / "test" / "fixtures" / "publication" / "artifacts"
)
HISTORICAL = [r for r in releases.RELEASES.values() if r.historical]
pounds = st.floats(min_value=-1e12, max_value=1e12, allow_nan=False)


@given(pounds, pounds)
def test_agreement_is_within_one_percent_or_a_million_pounds(
    dashboard, replay
):
    bound = max(0.01 * abs(replay), 1e6)
    assert d.agrees(dashboard, replay) == (abs(dashboard - replay) <= bound)
    # The bound depends on the replay's size, not its sign
    assert d.agrees(-dashboard, -replay) == d.agrees(dashboard, replay)


@given(
    pounds,
    st.floats(min_value=0, max_value=1e12),
    st.floats(min_value=0, max_value=1),
)
def test_a_closer_figure_agrees_whenever_a_farther_one_does(
    replay, gap, share
):
    if d.agrees(replay + gap, replay):
        assert d.agrees(replay + gap * share, replay)


@pytest.mark.parametrize("release", HISTORICAL, ids=lambda r: r.id)
def test_compare_lists_each_measure_year_once_and_never_reads_a_missing_figure_as_zero(
    release,
):
    document = historical_events.load_event(release.id)
    first = document["measures"][0]
    year = document["years"][0]
    figures = {first["id"]: {"receipt": {}, "years": {year: 123e6}}}
    rows = d.compare(document, figures)
    keys = [(row["id"], row["year"]) for row in rows]
    expected = [
        (record["id"], year)
        for record in document["measures"]
        for year in document["years"]
        if str(year) in record["replay"]
    ]
    assert keys == expected
    for row in rows:
        if (row["id"], row["year"]) == (first["id"], year):
            assert row["dashboard_gbp"] == 123e6
            replay = float(
                historical_events.decode(
                    first["replay"][str(year)]["measure_total_gbp"]
                )
            )
            assert row["replay_gbp"] == replay
            assert row["difference_gbp"] == 123e6 - replay
            assert row["agrees"] == d.agrees(123e6, replay)
        else:
            assert row["dashboard_gbp"] is None
            assert row["difference_gbp"] is None
            assert row["agrees"] is None
        assert row["heads"]
    text = d.report(document, figures, rows)
    assert (
        f"{sum(r['agrees'] is True for r in rows)} of {len(rows)} measure-years agree"
        in text
    )
    assert "missing" in text


def _artifacts_root(tmp_path: Path, release) -> Path:
    root = tmp_path / "releases" / release.id / "artifacts"
    shutil.copytree(FIXTURE_ARTIFACTS / "alpha", root / "alpha")
    return root


def test_figures_are_read_in_pounds_from_receipted_artifacts_only(tmp_path):
    root = _artifacts_root(tmp_path, HISTORICAL[0])
    figures = d.dashboard_figures(root)
    assert list(figures) == ["alpha"]
    (artifact,) = (root / "alpha").iterdir()
    lines = (artifact / "budgetary_impact.csv").read_text().splitlines()
    header = lines[0].split(",")
    for line in lines[1:]:
        cells = dict(zip(header, line.split(",")))
        assert figures["alpha"]["years"][int(cells["year"])] == pytest.approx(
            float(cells["value"]) * 1e9
        )
    assert d._pair(figures["alpha"]["receipt"]).startswith("policyengine-uk ")
    # A changed table is refused, not read
    path = artifact / "budgetary_impact.csv"
    path.write_text(path.read_text().replace(lines[-1], lines[-1] + "1"))
    with pytest.raises(
        d.DifferentialError, match="does not match its recorded digest"
    ):
        d.dashboard_figures(root)


def test_the_command_refuses_artifacts_of_another_event_and_another_root(
    tmp_path,
):
    root = _artifacts_root(tmp_path, HISTORICAL[0])
    with pytest.raises(SystemExit, match="not in"):
        d.main([str(root)])
    current = tmp_path / "data" / "artifacts"
    current.mkdir(parents=True)
    with pytest.raises(SystemExit, match="not a past event"):
        d.main([str(current)])


def test_the_command_reports_every_measure_year_missing_before_generation(
    tmp_path,
):
    release = HISTORICAL[0]
    root = tmp_path / "releases" / release.id / "artifacts"
    root.mkdir(parents=True)
    out = tmp_path / "report.md"
    assert (
        d.main(
            [
                str(root),
                "--out",
                str(out),
                "--json",
                str(tmp_path / "rows.json"),
            ]
        )
        == 0
    )
    text = out.read_text()
    document = historical_events.load_event(release.id)
    assert text.startswith(f"# National differential: {document['name']}")
    assert "0 of " in text and "no artifacts" in text


# Artifacts that are not the receipted run of the measure whose directory
# holds them, written by World in a past event's root (synthetic figures
# from its dummy dataset, never real ones)
SHORT = min(
    HISTORICAL, key=lambda r: len(historical_events.load_event(r.id)["years"])
)
SHORT_EVENT = historical_events.load_event(SHORT.id)
FIRST, SECOND = (record["id"] for record in SHORT_EVENT["measures"][:2])
YEAR = SHORT_EVENT["years"][0]


@pytest.fixture
def world():
    instance = World(release=SHORT)
    yield instance
    instance.close()


def _figures(world):
    return d.dashboard_figures(world.artifacts, SHORT_EVENT["years"])


def test_a_receipted_run_of_the_measure_is_read(world):
    world.write(FIRST, {YEAR: -1.5})
    figures = _figures(world)
    assert figures[FIRST]["years"] == {YEAR: -1.5e9}


def test_one_measure_s_artifact_under_another_s_directory_is_refused(world):
    written = world.write(FIRST, {YEAR: -1.5})
    shutil.copytree(written.path, world.artifacts / SECOND / written.path.name)
    shutil.rmtree(world.artifacts / FIRST)
    with pytest.raises(
        d.DifferentialError, match=f"its receipt is for '{FIRST}'"
    ):
        _figures(world)


@pytest.mark.parametrize("block", ["dashboard", "execution_receipt"])
def test_a_receipt_with_a_changed_outputs_digest_is_refused(world, block):
    written = world.write(FIRST, {YEAR: -1.5})
    path = written.path / "receipt.json"
    document = json.loads(path.read_text())
    holder = (
        document["dashboard"]["digests"]
        if block == "dashboard"
        else document["execution_receipt"]
    )
    holder["outputs_sha256"] = "0" * 64
    path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    with pytest.raises(
        d.DifferentialError, match="outputs_sha256|receipt is invalid"
    ):
        _figures(world)


def test_rows_for_another_measure_are_refused(world, monkeypatch):
    # A writer that does not check reform ids, as a hand-made artifact
    # would be: the files name SECOND, the receipt FIRST
    lenient = artifact_module.table_files
    monkeypatch.setattr(
        artifact_module,
        "table_files",
        lambda tables, key: lenient(tables, SECOND),
    )
    world.write(FIRST, {YEAR: -1.5}, tables=make_tables(SECOND, {YEAR: -1.5}))
    with pytest.raises(
        d.DifferentialError, match=f"holds rows for \\['{SECOND}'\\]"
    ):
        _figures(world)


def test_rows_for_a_year_the_receipt_does_not_report_are_refused(world):
    later = YEAR + 1
    world.write(
        FIRST,
        {YEAR: -1.5},
        tables=make_tables(FIRST, {YEAR: -1.5, later: -2.0}),
    )
    with pytest.raises(
        d.DifferentialError, match=f"does not report: \\[{later}\\]"
    ):
        _figures(world)


def test_a_receipt_for_years_the_event_does_not_score_is_refused(world):
    outside = max(SHORT_EVENT["years"]) + 1
    world.write(FIRST, {outside: -1.5})
    with pytest.raises(
        d.DifferentialError, match=f"does not score: \\[{outside}\\]"
    ):
        _figures(world)
    # Without the event's years, only the receipt's own are required
    assert d.dashboard_figures(world.artifacts)[FIRST]["years"] == {
        outside: -1.5e9
    }


def test_an_artifact_not_named_by_its_digest_is_refused(world):
    written = world.write(FIRST, {YEAR: -1.5})
    written.path.rename(written.path.with_name("0" * 16))
    with pytest.raises(d.DifferentialError, match="not named by its digest"):
        _figures(world)


def test_the_command_reports_a_refused_artifact_and_writes_nothing(
    world, tmp_path
):
    written = world.write(FIRST, {YEAR: -1.5})
    shutil.copytree(written.path, world.artifacts / SECOND / written.path.name)
    out = tmp_path / "report.md"
    with pytest.raises(SystemExit, match="its receipt is for"):
        d.main([str(world.artifacts), "--out", str(out)])
    assert not out.exists()
