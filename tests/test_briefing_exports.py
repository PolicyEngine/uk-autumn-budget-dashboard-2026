"""Every briefing output is gated and bound to approved artifact bytes."""

import hashlib
import json
import re

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from scripts import generate_blog_charts as blog
from scripts import generate_combined_charts as combined
from tests.briefing_support import (
    COMBINED_KEY,
    approved_world,
    briefing_tables,
)
from tests.publication_support import World
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_tables
from uk_budget_data.publication.publish import PublishError


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def html_payload(path, variable):
    """Read the embedded analytical JSON, excluding layout/timing numbers."""
    text = path.read_text()
    match = re.search(rf"const\s+{variable}\s*=\s*", text)
    assert match, f"No {variable} payload in {path}"
    return json.JSONDecoder().raw_decode(text[match.end() :])[0]


def numbers(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from numbers(child)
    elif isinstance(value, list):
        for child in value:
            yield from numbers(child)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


@pytest.fixture
def world():
    instance = World()
    yield instance
    instance.close()


def _decile_label(table, x):
    """The table's decile key for a chart's x label."""
    if table == "distributional_impact":
        n = int(x)
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n if n < 4 else 0, "th")
        return f"{n}{suffix}"
    return x


@pytest.mark.parametrize("generator", [blog, combined])
@pytest.mark.parametrize(
    "state", ["staged", "provisional", "stale", "withdrawn", "missing"]
)
def test_generators_refuse_nonapproved_keys_before_writing(
    world, tmp_path, generator, state
):
    manifest, _ = approved_world(world)
    key = COMBINED_KEY if generator is combined else "alpha"
    if state == "missing":
        key = "missing"
    else:
        manifest.group(key)[key].status = state
        manifest.group(key)[key].approval = None
        m.save_manifest(manifest, world.data_root)
    out = tmp_path / "briefing"
    out.mkdir()
    sentinel = out / "existing.txt"
    sentinel.write_text("Keep this existing output")
    args = (
        world.data_root / "manifest.json",
        key if generator is combined else [key],
        out,
    )
    with pytest.raises(PublishError):
        generator.generate(*args, inputs=world.inputs)
    assert list(out.iterdir()) == [sentinel]
    assert sentinel.read_text() == "Keep this existing output"


@pytest.mark.parametrize("generator", [blog, combined])
def test_generator_cli_returns_nonzero_and_creates_no_output(
    world, tmp_path, generator
):
    approved_world(world)
    out = tmp_path / "must-not-exist"
    option = "--key" if generator is combined else "--keys"
    code = generator.main(
        [
            "--manifest",
            str(world.data_root / "manifest.json"),
            option,
            "missing",
            "--out-dir",
            str(out),
            "--inputs",
            str(world.inputs),
        ]
    )
    assert code != 0
    assert not out.exists()


def test_blog_preflights_all_requested_keys(world, tmp_path):
    approved_world(world)
    out = tmp_path / "briefing"
    with pytest.raises(PublishError):
        blog.generate(
            world.data_root / "manifest.json",
            ["alpha", "missing"],
            out,
            inputs=world.inputs,
        )
    assert not out.exists()


@pytest.mark.parametrize("generator", [blog, combined])
def test_generators_refuse_tampered_artifact(world, tmp_path, generator):
    manifest, _ = approved_world(world)
    key = COMBINED_KEY if generator is combined else "alpha"
    artifact = world.data_root / manifest.entries()[key].artifact
    table = artifact / "budgetary_impact.csv"
    table.write_bytes(table.read_bytes() + b"unreceipted change\n")
    out = tmp_path / "briefing"
    with pytest.raises(PublishError, match="digest"):
        generator.generate(
            world.data_root / "manifest.json",
            key if generator is combined else [key],
            out,
            inputs=world.inputs,
        )
    assert not out.exists()


def test_combined_requires_complete_briefing_tables_before_writing(
    world, tmp_path
):
    by_key = {
        key: briefing_tables(key, [2027])
        for key in ("alpha", "beta", COMBINED_KEY)
    }
    del by_key[COMBINED_KEY]["briefing_poverty"]
    approved_world(world, years=[2027], tables_by_key=by_key)
    out = tmp_path / "briefing"
    with pytest.raises(PublishError, match="briefing_poverty"):
        combined.generate(
            world.data_root / "manifest.json",
            COMBINED_KEY,
            out,
            inputs=world.inputs,
        )
    assert not out.exists()


@settings(max_examples=12, deadline=None)
@given(
    seed=st.integers(min_value=1, max_value=2**32 - 1),
    years=st.lists(
        st.integers(min_value=2025, max_value=2030),
        min_size=1,
        max_size=2,
        unique=True,
    ).map(sorted),
)
def test_every_chart_data_number_is_receipted(seed, years):
    """Random artifact values catch any embedded analytical constants.

    Percent-format Plotly fractions are converted back to the artifact's
    percent units. Decile labels, axes, dimensions and animation timings are
    presentation metadata; the analytical payload alone is checked.
    """
    world = World()
    try:
        _, tables = approved_world(world, seed, years)
        manifest = world.data_root / "manifest.json"
        combined_out = world.root / "combined-export"
        blog_out = world.root / "blog-export"
        combined.generate(
            manifest, COMBINED_KEY, combined_out, inputs=world.inputs
        )
        blog.generate(
            manifest, ["alpha", "beta"], blog_out, inputs=world.inputs
        )
        expected = tables[COMBINED_KEY]
        payloads = (
            (
                "distributional.html",
                "data",
                "briefing_deciles",
                "avg_change_gbp",
            ),
            (
                "winners_losers.html",
                "data",
                "briefing_winners_losers",
                "share_pct",
            ),
            (
                "poverty_inequality.html",
                "povertyData",
                "briefing_poverty",
                "change_pp",
            ),
            (
                "constituency_map.html",
                "dataByYear",
                "constituency",
                "average_gain",
            ),
        )
        for filename, variable, table, field in payloads:
            payload = html_payload(combined_out / filename, variable)
            allowed = {round(row[field], 1) for row in expected[table]}
            actual = list(numbers(payload))
            assert actual, filename
            assert set(actual) <= allowed, filename
        deciles = html_payload(combined_out / "distributional.html", "data")
        for year in years:
            label = f"{year}-{(year + 1) % 100:02d}"
            assert deciles[label] == [
                round(row["avg_change_gbp"], 1)
                for row in sorted(
                    expected["briefing_deciles"],
                    key=lambda row: (
                        int(row["decile"]) if row["decile"] != "all" else 0
                    ),
                )
                if row["year"] == year and row["decile"] != "all"
            ]
        labels = {year: f"{year}-{(year + 1) % 100:02d}" for year in years}
        for key in ("alpha", "beta"):
            # Decile charts: one trace per year, named by its fiscal year,
            # each value the table's value for that year and decile.
            for filename, table, field, scale in (
                ("distributional.json", "distributional_impact", "value", 100),
                ("winners_losers.json", "winners_losers", "avg_change", 1),
            ):
                chart = json.loads((blog_out / key / filename).read_text())
                assert [trace["name"] for trace in chart["data"]] == [
                    labels[year] for year in years
                ]
                for trace, year in zip(chart["data"], years, strict=True):
                    rows = {
                        row["decile"]: row[field]
                        for row in tables[key][table]
                        if row["year"] == year
                    }
                    expected_y = [
                        rows[_decile_label(table, x)] for x in trace["x"]
                    ]
                    assert [v * scale for v in trace["y"]] == pytest.approx(
                        expected_y, abs=1e-10
                    )
            # Revenue: each bar on its own fiscal year.
            chart = json.loads((blog_out / key / "revenue.json").read_text())
            by_year = {
                row["year"]: row["value"]
                for row in tables[key]["budgetary_impact"]
            }
            for trace in chart["data"]:
                assert trace["x"] == [labels[year] for year in years]
            assert chart["data"][0]["y"] == pytest.approx(
                [by_year[year] for year in years], abs=1e-10
            )
    finally:
        world.close()


@pytest.mark.parametrize("generator", [blog, combined])
def test_export_receipt_binds_manifest_artifacts_and_file_bytes(
    world, tmp_path, generator
):
    manifest, _ = approved_world(world, years=[2029, 2030])
    manifest_path = world.data_root / "manifest.json"
    out = tmp_path / "briefing"
    keys = [COMBINED_KEY] if generator is combined else ["alpha", "beta"]
    generator.generate(
        manifest_path,
        keys[0] if generator is combined else keys,
        out,
        inputs=world.inputs,
    )
    receipt = json.loads((out / "briefing-export-receipt.json").read_text())
    assert receipt["manifest_revision"] == manifest.revision
    assert receipt["manifest_sha256"] == digest(manifest_path)
    assert len(receipt["generator_git_sha"]) == 40
    assert receipt["generated_at"].endswith(("Z", "+00:00"))
    assert receipt["files"] == {
        str(path.relative_to(out)): digest(path)
        for path in out.rglob("*")
        if path.is_file() and path.name != "briefing-export-receipt.json"
    }
    for key in keys:
        expected = manifest.entries()[key]
        assert (
            receipt["artifacts"][key]["outputs_sha256"]
            == expected.outputs_sha256
        )
        assert (
            receipt["artifacts"][key]["execution_identity_sha256"]
            == expected.execution_identity_sha256
        )
    for path in out.rglob("*.html"):
        text = path.read_text()
        assert "<!--" in text
        assert "PolicyEngine UK " in text
        assert (
            f"publication manifest rev {manifest.revision} ({digest(manifest_path)[:12]})"
            in text
        )


def test_blog_only_uses_pass_or_accepted_reconciliation_rows(world, tmp_path):
    manifest, _ = approved_world(world)
    directory = world.data_root / manifest.measures["alpha"].artifact
    path = directory / "reconciliation.json"
    reconciliation = json.loads(path.read_text())
    # Summary stays approved; an out-of-scope alongside record must never
    # turn into an exported comparator just because it contains a number.
    # An edited record claims a passing comparator worth a made-up number.
    for row in reconciliation["rows"]:
        row["status"] = "pass"
        if "comparator" in row:
            row["comparator"]["value_bn"] = 918273.645
    reconciliation["rows"].append(
        {
            "year": 2029,
            "status": "pass",
            "comparator": {
                "basis": "post_behavioural",
                "value_bn": 918273.645,
                "rows": [{"source_id": "unapproved", "row_id": "bad"}],
            },
        }
    )
    path.write_text(json.dumps(reconciliation))
    out = tmp_path / "briefing"
    blog.generate(
        world.data_root / "manifest.json", ["alpha"], out, inputs=world.inputs
    )
    chart = json.loads((out / "alpha" / "revenue.json").read_text())
    comparators = chart["data"][1:]
    assert comparators
    assert "918273.645" not in json.dumps(chart)
    assert all(
        "static_costing" in json.dumps(trace)
        and "S" in json.dumps(trace)
        and "alpha" in json.dumps(trace)
        for trace in comparators
    )


def test_unsupported_years_never_reach_a_chart(world, tmp_path):
    """Review finding: 2031 figures were exported beside supported years."""
    manifest, _ = approved_world(world, years=(2027, 2031))
    assert manifest.measures["alpha"].unsupported_years == [2031]
    out = tmp_path / "combined"
    combined.generate(
        world.data_root / "manifest.json",
        COMBINED_KEY,
        out,
        inputs=world.inputs,
    )
    payload = html_payload(out / "distributional.html", "data")
    assert set(payload) == {"2027-28"}
    blog_out = tmp_path / "blog"
    blog.generate(
        world.data_root / "manifest.json",
        ["alpha"],
        blog_out,
        inputs=world.inputs,
    )
    chart = json.loads((blog_out / "alpha" / "revenue.json").read_text())
    assert chart["data"][0]["x"] == ["2027-28"]


def test_the_revenue_chart_puts_each_value_on_its_own_year(world, tmp_path):
    manifest, _ = approved_world(world)
    out = tmp_path / "briefing"
    blog.generate(
        world.data_root / "manifest.json", ["alpha"], out, inputs=world.inputs
    )
    chart = json.loads((out / "alpha" / "revenue.json").read_text())
    trace = chart["data"][0]
    assert trace["x"] == ["2027-28", "2028-29"]
    tables = read_tables(world.data_root / manifest.measures["alpha"].artifact)
    by_year = {row["year"]: row["value"] for row in tables["budgetary_impact"]}
    assert trace["y"] == pytest.approx(
        [by_year[2027], by_year[2028]], abs=0.01
    )


def test_an_export_never_writes_into_a_used_directory(world, tmp_path):
    """Review finding: a withdrawn measure's chart outlived its receipt."""
    approved_world(world)
    out = tmp_path / "briefing"
    out.mkdir()
    (out / "beta").mkdir()
    (out / "beta" / "revenue.json").write_text("{}")
    with pytest.raises(PublishError, match="not empty"):
        blog.generate(
            world.data_root / "manifest.json",
            ["alpha"],
            out,
            inputs=world.inputs,
        )
    assert sorted(p.name for p in out.rglob("*")) == ["beta", "revenue.json"]


def test_the_export_receipt_binds_the_treasury_inputs(world, tmp_path):
    approved_world(world)
    out = tmp_path / "briefing"
    receipt = blog.generate(
        world.data_root / "manifest.json", ["alpha"], out, inputs=world.inputs
    )
    from uk_budget_data.publication.briefing_export import inputs_digest

    assert receipt["treasury_inputs_sha256"] == inputs_digest(world.inputs)
