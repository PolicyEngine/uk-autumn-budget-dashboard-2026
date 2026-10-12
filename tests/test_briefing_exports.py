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
        for key in ("alpha", "beta"):
            for filename, table, field, scale in (
                ("distributional.json", "distributional_impact", "value", 100),
                ("winners_losers.json", "winners_losers", "avg_change", 1),
                ("revenue.json", "budgetary_impact", "value", 1),
            ):
                chart = json.loads((blog_out / key / filename).read_text())
                allowed = {row[field] for row in tables[key][table]}
                for trace in chart["data"]:
                    # Treasury comparisons are separately gated values; in
                    # this world their values match the fiscal table.
                    for value in trace["y"]:
                        assert any(
                            abs(value * scale - approved) < 1e-10
                            for approved in allowed
                        )
                    assert all(
                        str(year) + "-" in str(trace.get("name", ""))
                        or f"{year}-{(year + 1) % 100:02d}"
                        in trace.get("x", [])
                        for year in years
                        if str(year) in str(trace)
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
    reconciliation["rows"].append(
        {
            "year": 2029,
            "status": "not_comparable",
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
