"""Tests for the Budget-day report generator, on small synthetic publications.

Run from the repository root (not collected by the repo's pytest run, whose
testpaths is tests/):

    uv run --no-project --with matplotlib==3.10.1 --with pytest \\
        python -I -m pytest report/test_build_report.py -q

They build report.html and figures.json only (no Chrome, no PDF).
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_report as br  # noqa: E402

YEARS = [2026, 2027, 2028]
AGE = ["all", "0-15", "16-24", "25-34", "35-49", "50-64", "65+"]
POVERTY = [
    f"{who}poverty_{k}_change_{u}"
    for who in ("", "child_")
    for k in ("abs_bhc", "abs_ahc", "rel_bhc", "rel_ahc")
    for u in ("pp", "pct")
] + ["top_10_share_change_pp", "p90_p10_change"]


def _write(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def _artifact(data: Path, key: str, years, scale: float, skip_year=None) -> dict:
    """One run's tables and receipt; returns its manifest fields."""
    d = data / "artifacts" / key / "a1"
    ys = [y for y in years if y != skip_year]
    tables = {
        "budgetary_impact": [{"reform_id": key, "year": y, "value": scale * (y - 2025)} for y in ys],
        "winners_losers": [
            {"reform_id": key, "year": y, "decile": dec, "avg_change": scale * 10}
            for y in ys
            for dec in [str(i) for i in range(1, 11)] + ["all"]
        ],
        "distributional_impact": [
            {"reform_id": key, "year": y, "decile": dec, "value": scale * 0.1} for y in ys for dec in br.REL_DECILES
        ],
        "age_impact": [
            {"reform_id": key, "year": y, "age_band": a, "pct_better_off": 60, "pct_unchanged": 39, "pct_worse_off": 1, "mean_change": scale * 10}
            for y in ys
            for a in AGE
        ],
        "poverty_inequality": [{"reform_id": key, "year": y, **{c: -0.01 * scale for c in POVERTY}} for y in ys],
        "metrics": [{"reform_id": key, "year": y, "gini_change": -0.001 * scale} for y in ys],
        "income_curve": [
            {"reform_id": key, "year": y, "household": "h1", "income": inc, "baseline_net_income": inc, "reform_net_income": inc + scale * 10}
            for y in ys
            for inc in range(0, 100001, 1000)
        ],
    }
    files = {}
    for name, rows in tables.items():
        _write(d / f"{name}.csv", rows)
        files[f"{name}.csv"] = hashlib.sha256((d / f"{name}.csv").read_bytes()).hexdigest()
    (d / "receipt.json").write_text(json.dumps({"dashboard": {"files": files}}))
    outputs = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {
        "artifact": f"artifacts/{key}/a1",
        "artifact_sha256": "a" * 64,
        "receipt_sha256": "b" * 64,
        "outputs_sha256": outputs,
        "years": list(years),
        "unsupported_years": [],
    }


def publication(tmp: Path, n=3, statuses=None, combined=True, skip=None, unsupported=None) -> Path:
    """A publication with n measures; skip={key: year} drops that year's rows,
    unsupported={key: [years]} marks years unsupported but keeps their rows."""
    data = tmp / "data"
    keys = [f"m{i:02d}" for i in range(n)]
    statuses = statuses or {}
    measures = {}
    for i, k in enumerate(keys):
        e = _artifact(data, k, YEARS, scale=(i + 1) * (-1 if i % 2 else 1), skip_year=(skip or {}).get(k))
        e.update(status=statuses.get(k, "provisional"), name=f"Measure {i}", description=f"What measure {i} does.")
        e["unsupported_years"] = (unsupported or {}).get(k, [])
        measures[k] = e
    manifest = {
        "schema": br.MANIFEST_SCHEMA,
        "revision": 1,
        "updated_at": "2026-10-28T13:00:00+00:00",
        "budget": {"date": "2026-10-28"},
        "basis": {"forecast": {"status": "pre_budget"}},
        "measures": measures,
        "combined": {},
    }
    if combined and n > 1:
        c = _artifact(data, "combined--x", YEARS, scale=0.5)
        c.update(
            status="provisional",
            name="Combined",
            measures=keys,
            member_outputs_sha256={k: measures[k]["outputs_sha256"] for k in keys},
        )
        manifest["combined"]["combined--x"] = c
    (data / "manifest.json").write_text(json.dumps(manifest))
    return data


def build(data: Path, out: Path, year=2027) -> str:
    assert br.main(["build", "--data", str(data), "--out", str(out), "--year", str(year)]) == 0
    assert br.main(["check", str(out / "figures.json"), "--data", str(data)]) == 0
    return (out / "report.html").read_text()


def test_several_measures_use_the_combined_run_and_check_passes(tmp_path):
    html = build(publication(tmp_path), tmp_path / "out")
    assert "All measures together" in html
    assert "The measures together: change in government revenue by year" in html
    assert 'class="watermark"' in html


def test_one_measure_is_named_not_called_the_measures_together(tmp_path):
    html = build(publication(tmp_path, n=1), tmp_path / "out")
    assert "The measures together" not in html
    assert "All measures together" not in html
    assert "Measure 0: change in government revenue by year" in html
    assert "How one measure would change" in html
    assert "Each measure on its own" not in html


def test_fifteen_measures(tmp_path):
    html = build(publication(tmp_path, n=15), tmp_path / "out")
    assert "How 15 measures would change" in html
    assert html.count('<th scope="row">Measure ') >= 15


def test_no_combined_run_shows_a_notice_never_a_sum(tmp_path):
    html = build(publication(tmp_path, combined=False), tmp_path / "out")
    assert "No combined run is published for exactly these measures" in html
    assert "All measures together" not in html
    assert "no combined run covers exactly these measures" in html


def test_a_stale_member_means_no_combined_figures(tmp_path):
    data = publication(tmp_path)
    m = json.loads((data / "manifest.json").read_text())
    m["combined"]["combined--x"]["member_outputs_sha256"]["m00"] = "0" * 64
    (data / "manifest.json").write_text(json.dumps(m))
    assert "All measures together" not in build(data, tmp_path / "out")


def test_unsupported_year_is_n_a_and_the_total_is_not_printed(tmp_path):
    html = build(publication(tmp_path, unsupported={"m01": [2028]}), tmp_path / "out")
    row = html[html.index('<th scope="row">Measure 1</th>'):]
    row = row[: row.index("</tr>")]
    assert row.count("n/a") == 2  # the 2028-29 cell and the total


def test_a_measure_missing_a_year_is_n_a_not_zero(tmp_path):
    html = build(publication(tmp_path, skip={"m02": 2028}), tmp_path / "out")
    row = html[html.index('<th scope="row">Measure 2</th>'):]
    assert "n/a" in row[: row.index("</tr>")]


def test_approved_and_provisional_mix_keeps_the_watermark(tmp_path):
    html = build(publication(tmp_path, statuses={"m00": "approved"}), tmp_path / "out")
    assert 'class="watermark"' in html


def test_all_approved_has_no_watermark(tmp_path):
    data = publication(tmp_path, statuses={"m00": "approved", "m01": "approved", "m02": "approved"})
    m = json.loads((data / "manifest.json").read_text())
    m["combined"]["combined--x"]["status"] = "approved"
    (data / "manifest.json").write_text(json.dumps(m))
    html = build(data, tmp_path / "out")
    assert 'class="watermark"' not in html
    assert br.CANDIDATE_PROVISIONAL_LABEL not in html and br.PROVISIONAL_LABEL not in html


def _with_manifest(data: Path, **changes) -> Path:
    m = json.loads((data / "manifest.json").read_text())
    m.update(changes)
    (data / "manifest.json").write_text(json.dumps(m))
    return data


def test_budget_day_provisional_is_statement_figures_though_the_basis_stays_pre_budget(tmp_path):
    # The runbook keeps basis.forecast.status at pre_budget on Budget day
    # unless the forecast is rebased: the label must not call announced
    # measures candidates.
    html = build(publication(tmp_path), tmp_path / "out")
    assert br.PROVISIONAL_LABEL in html
    assert br.CANDIDATE_PROVISIONAL_LABEL not in html


def test_a_manifest_written_before_the_budget_calls_provisional_figures_candidates(tmp_path):
    data = _with_manifest(publication(tmp_path), updated_at="2026-10-27T23:59:59+00:00")
    html = build(data, tmp_path / "out")
    assert br.CANDIDATE_PROVISIONAL_LABEL in html
    assert br.PROVISIONAL_LABEL not in html


@pytest.mark.parametrize(
    "manifest, candidate",
    [
        ({"updated_at": "2026-10-27T23:59:59+00:00", "budget": {"date": "2026-10-28"}, "basis": {"forecast": {"status": "pre_budget"}}}, True),
        ({"updated_at": "2026-10-28T00:00:01+00:00", "budget": {"date": "2026-10-28"}, "basis": {"forecast": {"status": "pre_budget"}}}, False),
        ({"updated_at": "2026-11-02T09:00:00+00:00", "budget": {"date": "2026-10-28"}}, False),
        ({"updated_at": "2026-10-24T13:00:00+00:00", "budget": {"date": "2026-10-28"}, "basis": {"forecast": {"status": "updated"}}}, False),
        ({"budget": {"date": "2026-10-28"}, "basis": {"forecast": {"status": "pre_budget"}}}, False),
        ({"updated_at": "2026-10-24T13:00:00+00:00", "basis": {"forecast": {"status": "pre_budget"}}}, False),
        ({"updated_at": "not a date", "budget": {"date": "2026-10-28"}}, False),
    ],
)
def test_candidate_rule(manifest, candidate):
    assert br.is_candidate_manifest(manifest) is candidate


def test_staged_measure_is_listed_not_shown(tmp_path):
    html = build(publication(tmp_path, statuses={"m02": "staged"}, combined=False), tmp_path / "out")
    assert "Measures in the release but not shown" in html
    assert "awaiting review" in html


def test_missing_manifest_says_so(tmp_path):
    with pytest.raises(SystemExit, match="No manifest.json"):
        br.main(["build", "--data", str(tmp_path), "--out", str(tmp_path / "out")])


def test_missing_receipt_or_table_stops_the_build(tmp_path):
    data = publication(tmp_path)
    (data / "artifacts" / "m00" / "a1" / "metrics.csv").unlink()
    with pytest.raises(SystemExit, match="missing"):
        br.Publication(data)
    (data / "artifacts" / "m00" / "a1" / "receipt.json").unlink()
    with pytest.raises(SystemExit, match="no receipt.json"):
        br.Publication(data)


def test_a_changed_table_stops_the_build(tmp_path):
    data = publication(tmp_path)
    path = data / "artifacts" / "m00" / "a1" / "budgetary_impact.csv"
    path.write_text(path.read_text() + "m00,2029,9\n")
    with pytest.raises(SystemExit, match="differs from its receipt"):
        br.Publication(data)


def test_check_catches_a_changed_figure(tmp_path):
    data = publication(tmp_path)
    build(data, tmp_path / "out")
    figures = json.loads((tmp_path / "out" / "figures.json").read_text())
    figures["figures"][0]["text"] = "£999.0 billion"
    (tmp_path / "out" / "figures.json").write_text(json.dumps(figures))
    assert br.main(["check", str(tmp_path / "out" / "figures.json"), "--data", str(data)]) == 1


@pytest.mark.parametrize(
    "fmt, value, text",
    [
        ("bn2", -2.519, "−£2.52bn"),
        ("bn2", 0.001, "£0.00bn"),
        ("bn_words", -2.519, "£2.5 billion"),
        ("bn_words", -0.42, "£420 million"),
        ("gbp", 85.98, "+£86"),
        ("gbp", -0.4, "£0"),
        ("pp2", -0.002, "0.00pp"),
        ("pct2", -0.159, "−0.16%"),
    ],
)
def test_formats(fmt, value, text):
    assert br.FORMATS[fmt](value) == text


def test_fiscal_year_labels():
    assert br.fy(2027) == "2027-28"
    assert br.fy(2099) == "2099-00"
