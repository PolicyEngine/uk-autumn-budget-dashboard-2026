"""Shared provenance and preflight for manifest-gated briefing generators."""

import html
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from uk_budget_data.publication import exports
from uk_budget_data.publication.manifest import MANIFEST_FILE
from uk_budget_data.publication.publish import PublishError
from uk_budget_data.publication.receipt import (
    load_execution_receipt,
    receipt_api,
)
from uk_budget_data.publication.tables import sha256_bytes


def load(manifest: Path, keys: list[str], *, inputs: Path) -> dict:
    """Resolve the canonical manifest path, then use the publication gate."""
    manifest = Path(manifest)
    if manifest.name != MANIFEST_FILE:
        raise PublishError("export", ["--manifest must name manifest.json"])
    if not keys or len(keys) != len(set(keys)):
        raise PublishError("export", ["request distinct artifact keys"])
    return exports.load_approved(
        keys, data_root=manifest.parent, inputs=Path(inputs)
    )


def supported_years(artifact: dict) -> list[int]:
    """The artifact's years a chart may show: never an unsupported one.

    Years beyond the dataset's projection are unavailable, not figures.
    """
    entry = artifact["entry"]
    years = sorted(y for y in entry.years if y not in entry.unsupported_years)
    if not years:
        raise PublishError(
            "export", [f"{entry.name} has no supported years to show"]
        )
    return years


def require_tables(key: str, artifact: dict, names: tuple[str, ...]) -> None:
    """Optional artifact tables become required when a chart needs them."""
    years = set(supported_years(artifact))
    problems = []
    for name in names:
        rows = artifact["tables"].get(name, [])
        present = {row["year"] for row in rows}
        if not years <= present:
            problems.append(
                f"{key}: {name} does not cover the artifact years "
                f"{sorted(years)}"
            )
    if problems:
        raise PublishError("export", problems)


def year_labels(artifact: dict, years: list[int] | None = None) -> list[str]:
    """Fiscal-year labels, by the W4 receipt's convention, for ``years``.

    ``years`` defaults to the artifact's supported years.
    """
    execution = load_execution_receipt(artifact["receipt"])
    api, _ = receipt_api()
    years = supported_years(artifact) if years is None else years
    return [
        api.fiscal_year_label(year, execution.fiscal_year) for year in years
    ]


def treasury_comparison(artifact: dict, inputs: Path) -> dict:
    """Reconcile the artifact afresh against the current Treasury inputs.

    The ``reconciliation.json`` beside an artifact is a record for people
    and can be edited, so charts never read it. This recomputes the result
    from the artifact's own (checked) budgetary rows and the inputs.
    """
    from uk_budget_data.publication.reconcile import (
        load_exceptions,
        load_expected,
        load_mapping,
        load_policy,
        load_sources,
        reconcile,
    )

    entry = artifact["entry"]
    key = artifact["receipt"]["dashboard"]["key"]
    budgetary = {
        row["year"]: row["value"]
        for row in artifact["tables"]["budgetary_impact"]
        if row["reform_id"] == key
    }
    inputs = Path(inputs)
    return reconcile(
        budgetary,
        measure_id=key,
        outputs_sha256=entry.outputs_sha256,
        sources=load_sources(inputs / "sources"),
        mapping=load_mapping(inputs / "mapping.csv"),
        exceptions=load_exceptions(inputs / "exceptions.yaml"),
        policy=load_policy(inputs / "policy.yaml"),
        expected=load_expected(inputs / "expected_effects.csv"),
        supported_years=set(supported_years(artifact)),
    )


def inputs_digest(inputs: Path) -> str:
    """One digest over every Treasury input file the export may have used."""
    inputs = Path(inputs)
    files = {
        str(path.relative_to(inputs)): sha256_bytes(path.read_bytes())
        for path in sorted(inputs.rglob("*"))
        if path.is_file()
    }
    return sha256_bytes(json.dumps(files, sort_keys=True).encode("utf-8"))


def source_line(artifact: dict, stamp: dict) -> str:
    """The displayed source names the versions which ran, from the receipt."""
    execution = artifact["receipt"]["execution_receipt"]
    return (
        f"PolicyEngine UK {execution['model']['version']}, "
        f"data {execution['data']['release_version']}, "
        f"publication manifest rev {stamp['manifest_revision']} "
        f"({stamp['manifest_sha256'][:12]})"
    )


def json_payload(value) -> str:
    """JSON safe inside an HTML script, with no non-finite values."""
    return json.dumps(value, allow_nan=False).replace("<", "\\u003c")


def stamp_html(content: str, source: str, stamp: dict, payload) -> str:
    """Embed provenance and a machine-readable copy of the chart's data."""
    comment = json.dumps({**stamp, "source": source}, sort_keys=True)
    comment = comment.replace("--", "\\u002d\\u002d")
    content = content.replace(
        "<!DOCTYPE html>", f"<!DOCTYPE html>\n<!-- {comment} -->", 1
    )
    source_html = (
        '<p class="publication-source" style="font-size:11px;color:#6B7280;'
        'margin:8px 16px;position:relative;z-index:1002">'
        + html.escape(source)
        + "</p>"
    )
    content = content.replace("<body>", "<body>\n" + source_html, 1)
    block = (
        '<script id="briefing-data" type="application/json">'
        + json_payload(payload)
        + "</script>\n"
    )
    return content.replace("</body>", block + "</body>", 1)


def stamp_plotly(chart: dict, source: str, stamp: dict) -> dict:
    """Plotly renders the source annotation; metadata carries its binding."""
    layout = chart["layout"]
    layout["meta"] = {**stamp, "source": source}
    layout.setdefault("annotations", []).append(
        {
            "text": html.escape(source),
            "xref": "paper",
            "yref": "paper",
            "x": 0,
            "y": -0.35,
            "xanchor": "left",
            "showarrow": False,
            "font": {
                "family": "Inter, sans-serif",
                "size": 10,
                "color": "#6B7280",
            },
        }
    )
    layout["margin"]["b"] = max(layout["margin"]["b"], 160)
    return chart


def write_export(
    out_dir: Path,
    outputs: dict[str, str],
    loaded: dict,
    *,
    inputs: Path | None = None,
) -> dict:
    """Write already prepared charts and a receipt binding all their bytes.

    The destination must be new or empty, so the receipt describes exactly
    what is in it: nothing left from an earlier export survives beside it.
    """
    out_dir = Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise PublishError(
            "export",
            [f"{out_dir} is not empty; export into a new directory"],
        )
    repo_root = Path(__file__).resolve().parents[3]
    git_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    files = {
        name: sha256_bytes(content.encode("utf-8"))
        for name, content in sorted(outputs.items())
    }
    artifacts = {
        key: dict(artifact["receipt"]["dashboard"]["digests"])
        for key, artifact in loaded["entries"].items()
    }
    receipt = {
        "schema": "uk-budget-dashboard/briefing-export-receipt/v1",
        **loaded["stamp"],
        "keys": list(artifacts),
        "artifacts": artifacts,
        "files": files,
        "generator_git_sha": git_sha,
        "treasury_inputs_sha256": (
            inputs_digest(inputs) if inputs is not None else None
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if len(artifacts) == 1:
        key = next(iter(artifacts))
        receipt.update({"key": key, **artifacts[key]})
    # No directory or file is touched until every gate, chart and digest has
    # been prepared successfully for the complete requested set.
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in outputs.items():
        destination = out_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content.encode("utf-8"))
    (out_dir / "briefing-export-receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return receipt
