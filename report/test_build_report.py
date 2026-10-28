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
    # Figure 1 is the combined run, titled with what it shows
    assert '<span class="ftitle">The measures together raise revenue from 2026-27 to 2028-29</span>' in html
    assert 'class="watermark"' in html


def test_one_measure_is_named_not_called_the_measures_together(tmp_path):
    html = build(publication(tmp_path, n=1), tmp_path / "out")
    assert "The measures together" not in html
    assert "All measures together" not in html
    assert '<span class="ftitle">Measure 0 raises revenue from 2026-27 to 2028-29</span>' in html
    assert "How one measure would change" in html
    assert "Each measure on its own" not in html


def test_fifteen_measures(tmp_path):
    html = build(publication(tmp_path, n=15), tmp_path / "out")
    assert "How 15 measures would change" in html
    assert html.count('<th scope="row">Measure ') >= 15


def test_figures_and_tables_are_numbered_in_order_each_with_a_source(tmp_path):
    import re

    html = build(publication(tmp_path), tmp_path / "out")
    figs = [int(n) for n in re.findall(r'<span class="fnum">Figure (\d+)</span>', html)]
    tabs = [int(n) for n in re.findall(r'<span class="fnum">Table (\d+)</span>', html)]
    assert figs == list(range(1, len(figs) + 1)) and len(figs) >= 6
    assert tabs == list(range(1, len(tabs) + 1)) and len(tabs) >= 6
    # every figure has a source line; every table but the descriptive measures table
    assert html.count('<p class="fsrc">') == len(figs) + len(tabs) - 1
    assert "PolicyEngine UK microsimulation" in html


def test_key_findings_box_running_header_and_annexes(tmp_path):
    html = build(publication(tmp_path), tmp_path / "out")
    kf = html[html.index('<div class="kf">'):]
    kf = kf[: kf.index("</ol>")]
    assert 4 <= kf.count("<li>") <= 7
    assert "@top-left" in html and "counter(pages)" in html
    # the running header names the Budget date, not one year: several sections cover several years
    import re

    assert re.search(r'@top-right \{ content: "Budget 28 October 2026"', html)
    for annex in ("Annex A", "Annex B"):
        assert f'<p class="secnum">{annex}</p>' in html
    assert '<p class="secnum">Annex C</p>' not in html
    # areas are not published here: no empty section, the method annex says so
    assert 'id="areas"' not in html
    assert "not yet published in this release" in html


def test_summary_scope_introduction_and_section_numbers(tmp_path):
    import re

    html = build(publication(tmp_path), tmp_path / "out")
    # The summary page holds the key findings only
    summary = html[html.index('<section id="summary"'):]
    summary = summary[: summary.index("</section>")]
    assert "What the report compares" not in summary
    # The introduction is section 1: what the report compares, and Table 1, every measure shown
    intro = html[html.index('<section class="sec" id="introduction">'):]
    intro = intro[: intro.index("</section>")]
    assert '<p class="secnum">1</p><h2>Introduction</h2>' in intro
    assert "What the report compares" in intro
    assert '<span class="fnum">Table 1</span> <span class="ftitle">The measures in this report' in intro
    for name in re.findall(r'<tr><th scope="row">([^<]+)</th><td class="num total-col', html):
        if name != "All measures together":
            assert f'<tr><th scope="row">{name}</th>' in intro
    # Its pointer to the poverty section uses that section's number
    num = re.search(r'<p class="secnum">(\d+)</p><h2>Poverty and inequality</h2>', html).group(1)
    assert f"Section {num}." in intro
    # The model description is said once, in the introduction
    assert html.count("open-source microsimulation model") == 1


def test_better_off_threshold_and_left_out_outlook(tmp_path):
    html = build(publication(tmp_path), tmp_path / "out")
    # calculators.py AGE_CHANGE_THRESHOLD = 0.0001: more than 0.01% of net income
    assert "rises by more than 0.01%" in html
    assert "Changes of any size count" not in html
    assert "Living standards outlook." in html
    assert '<p class="explain">' in html


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
    rev = html[html.index('id="revenue"'):]
    row = rev[rev.index('<th scope="row">Measure 1</th>'):]
    row = row[: row.index("</tr>")]
    assert row.count("n/a") == 2  # the 2028-29 cell and the total


def test_a_measure_missing_a_year_is_n_a_not_zero(tmp_path):
    html = build(publication(tmp_path, skip={"m02": 2028}), tmp_path / "out")
    rev = html[html.index('id="revenue"'):]
    row = rev[rev.index('<th scope="row">Measure 2</th>'):]
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
    assert "Modelled but not in this report" in html
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


def test_headings_keep_their_spaces_when_they_wrap(tmp_path):
    # Chrome's PDF outline dropped the space at the cover title's line break
    # ("themeasures modelled"). report.css keeps heading spaces, so every
    # heading must be one line with single spaces.
    import re

    out = tmp_path / "out"
    assert br.main(["build", "--data", str(publication(tmp_path)), "--out", str(out),
                    "--title", "Autumn  Budget 2026:\nthe measures modelled"]) == 0
    html = (out / "report.html").read_text()
    css = (Path(br.__file__).parent / "report.css").read_text()
    assert re.search(r"h1, h2, h3 \{ white-space: pre-wrap; \}", css)
    headings = re.findall(r"<h([1-3])[^>]*>(.*?)</h\1>", html, flags=re.S)
    assert headings
    for _, text in headings:
        assert "\n" not in text and "  " not in text, text
    assert "<h1>Autumn Budget 2026: the measures modelled</h1>" in html


def test_pdf_outline_keeps_the_space_at_a_wrapped_title(tmp_path):
    # Needs Chrome, playwright and pypdf; skipped otherwise.
    playwright = pytest.importorskip("playwright.sync_api")
    pypdf = pytest.importorskip("pypdf")
    css = (Path(br.__file__).parent / "report.css").read_text()
    html = tmp_path / "t.html"
    html.write_text(
        f'<!doctype html><html lang="en-GB"><style>{css}</style><body class="cover">'
        '<h1 style="font-size:30pt;max-width:160mm">Autumn Budget 2026: the measures modelled</h1>'
        "<h2>Summary</h2><p>x</p></body></html>"
    )
    pdf = tmp_path / "t.pdf"
    with playwright.sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome")
        except Exception as error:  # no Chrome here
            pytest.skip(f"Chrome not available: {error}")
        page = browser.new_page()
        page.goto(html.resolve().as_uri())
        page.pdf(path=str(pdf), format="A4", tagged=True, outline=True)
        browser.close()
    titles = [o.title for o in pypdf.PdfReader(str(pdf)).outline if not isinstance(o, list)]
    assert titles[0] == "Autumn Budget 2026: the measures modelled"


def test_household_definition_keeps_facts_joined_to_a_selectable_measure():
    d = {"definition": "A couple aged 70 and 68 who own their home outright; they spend £1,040 a year on electricity, and the State Pension income tax protection, when selected, lowers their income tax from 2027-28."}
    text = br.Report._definition(d)
    assert "£1,040 a year on electricity" in text
    assert "when selected" not in text and "protection" not in text
    d = {"definition": "A lone parent; while they receive Universal Credit, the Warm Home Discount top-up, when selected, adds £100 in 2026-27."}
    assert br.Report._definition(d) == "A lone parent."


def test_pensioner_definition_in_the_contract_keeps_its_electricity():
    contract = json.loads(br.CONTRACT.read_text())
    for h in contract["income_curve_households"]:
        if "electricity" in h["definition"]:
            assert "electricity" in br.Report._definition(h), h["id"]


def test_withheld_cells_are_not_plotted_or_ranked_as_zero(tmp_path):
    data = publication(tmp_path)
    m = json.loads((data / "manifest.json").read_text())
    key = next(iter(m["combined"]))
    d = data / m["combined"][key]["artifact"]
    path = d / "age_impact.csv"
    rows = [r for r in csv.DictReader(open(path)) if not (r["age_band"] == "65+" and r["year"] == "2027")]
    _write(path, rows)
    receipt = json.loads((d / "receipt.json").read_text())
    receipt["dashboard"]["files"]["age_impact.csv"] = hashlib.sha256(path.read_bytes()).hexdigest()
    (d / "receipt.json").write_text(json.dumps(receipt))
    html = build(data, tmp_path / "out")
    age = html[html.index('id="age"'):]
    age = age[: age.index("</section>")]
    assert "withheld" in age and br.WITHHELD_NOTE in age
    assert "65 and over gain least" not in age
    assert "every age group with a published figure" in age


def test_later_year_of_opposite_sign_is_a_key_finding(tmp_path):
    data = publication(tmp_path)
    m = json.loads((data / "manifest.json").read_text())
    key = next(iter(m["combined"]))
    d = data / m["combined"][key]["artifact"]
    path = d / "winners_losers.csv"
    rows = list(csv.DictReader(open(path)))
    for r in rows:
        if r["year"] == "2028":
            r["avg_change"] = str(-abs(float(r["avg_change"])) - 50)
    _write(path, rows)
    receipt = json.loads((d / "receipt.json").read_text())
    receipt["dashboard"]["files"]["winners_losers.csv"] = hashlib.sha256(path.read_bytes()).hexdigest()
    (d / "receipt.json").write_text(json.dumps(receipt))
    html = build(data, tmp_path / "out")
    kf = html[html.index('<div class="kf">'):]
    kf = kf[: kf.index("</ol>")]
    assert "Later years." in kf and "By 2028-29" in kf and "falls by" in kf


def test_provenance_is_one_sentence_with_no_digest_table(tmp_path):
    html = build(publication(tmp_path), tmp_path / "out")
    assert "Artifacts behind this report" not in html
    assert "a" * 16 not in html and "b" * 16 not in html
    assert "traced, with the file, row and column it came from" in html


def test_running_header_carries_the_logo(tmp_path):
    out = tmp_path / "out"
    html = build(publication(tmp_path), out)
    assert '@top-left { content: url("data:image/svg+xml;base64,' in html


def test_curve_spikes_fire_on_an_isolated_point_only():
    flat = [0.0] * 20
    assert br.curve_spikes(flat) == []
    # a step is not a spike, even with a median step of zero
    assert br.curve_spikes([0.0] * 10 + [5000.0] * 10) == []
    # the published couple's curve: +£9,920 at one point between £636 and £342
    curve = [101.0] * 9 + [636.0] * 10 + [9920.0] + [342.0] * 10
    assert [i for i, _ in br.curve_spikes(curve)] == [19]
    # small wiggles under £250 do not fire
    assert br.curve_spikes([0.0, 0.0, 200.0, 0.0, 0.0]) == []


def test_a_spiking_curve_leaves_the_figure_out_and_annex_a_says_why(tmp_path):
    data = publication(tmp_path)
    m = json.loads((data / "manifest.json").read_text())
    key = next(iter(m["combined"]))
    d = data / m["combined"][key]["artifact"]
    path = d / "income_curve.csv"
    rows = list(csv.DictReader(open(path)))
    for r in rows:
        if r["year"] == "2027" and r["income"] == "10000":
            r["reform_net_income"] = str(float(r["reform_net_income"]) + 9000)
    _write(path, rows)
    receipt = json.loads((d / "receipt.json").read_text())
    receipt["dashboard"]["files"]["income_curve.csv"] = hashlib.sha256(path.read_bytes()).hexdigest()
    (d / "receipt.json").write_text(json.dumps(receipt))
    html = build(data, tmp_path / "out")
    assert "How the change varies with earnings" not in html
    assert "The earnings curves are not shown" in html and "+£9,005 at £10,000" in html


def test_no_spike_keeps_the_curve_figure(tmp_path):
    html = build(publication(tmp_path), tmp_path / "out")
    assert "How the change varies with earnings" in html
    assert "The earnings curves are not shown" not in html


@pytest.mark.parametrize(
    "values, shape",
    [
        ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ("rising", None)),
        ([1, 2, 3, 4, 3.5, 6, 7, 8, 9, 10], ("rising", None)),
        ([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], ("falling", None)),
        ([1, 3, 5, 9, 7, 5, 3, 2, 1, 1], ("peaked", 4)),
        ([9, 7, 5, 1, 3, 5, 7, 8, 9, 9], ("troughed", 4)),
        ([1, 5, 1, 5, 1, 5, 1, 5, 1, 5], ("mixed", None)),
        ([1, 2, None, 4, 5, 6, 7, 8, 9, 10], ("mixed", None)),
        # the published 2027-28 pattern: a hump, D1 £194, D9 £612, D10 £87
        ([194, 268, 283, 355, 407, 512, 525, 594, 612, 87], ("peaked", 9)),
    ],
)
def test_decile_shape(values, shape):
    assert br.decile_shape(values) == shape


def test_the_hump_reads_highest_in_the_ninth_decile_never_a_comparison_of_ends():
    text = br.shape_phrase([194, 268, 283, 355, 407, 512, 525, 594, 612, 87])
    assert text == "is highest in the ninth decile"


def _js_text(rel):
    return (Path(br.__file__).resolve().parent.parent / rel).read_text()


def test_map_scale_matches_the_dashboard():
    import re

    theme = _js_text("src/utils/chartTheme.js")
    colours = dict(re.findall(r'^\s+(\w+): "(#[0-9A-Fa-f]{6})",', theme, flags=re.M))
    assert br.MAP_SCALE == {"loss": colours["loss"], "neutral": colours["grid"], "gain": colours["mapGain"]}
    scale = _js_text("src/utils/geography/scale.js")
    assert re.search(r"const STEPS = (\d+);", scale).group(1) == str(br.MAP_STEPS)
    assert "relative_change: 0.01" in scale and br.MAP_EXTENT["relative_change"] == 0.01
    assert br.scale_colour(0) == "#E5E7EB" and br.scale_colour(0.0004) != "#E5E7EB"
    assert br.scale_colour(0.02) == "#14b8a6" and br.scale_colour(-5) == "#d97706"
    # d3.interpolateRgb halfway, rounded as JS rounds
    assert br.scale_colour(0.005) == br._interp_rgb("#E5E7EB", "#14B8A6", 0.5)
    assert br.scale_colour(None) == "#E5E7EB"
