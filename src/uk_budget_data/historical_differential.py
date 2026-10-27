"""The national differential for a past event (docs/historical-releases.md).

For each imported measure and scored year, this dashboard's figure (the
change in ``gov_balance`` on the dashboard's pair, from the measure's
receipted artifact) is set beside the scorecard replay's
``measure_total_gbp`` (the sum of the measure's declared heads' effects on
the replay's pair, from the event's registry). They agree when they are
within ``max(1%, £1m)`` of the replay's figure.

Until the scorecard has a replay on the dashboard's own pair, a difference
can come from the pair (model or data) as well as from the heads
(``gov_balance`` against the declared heads), so the comparison is
reported, not used as a gate. The report names both pairs and each
measure's declared heads, so a reader can see which inputs differ.

    python -m uk_budget_data.historical_differential \\
        public/data/releases/<id>/artifacts [--out report.md]
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Optional

from uk_budget_data import historical_events, releases
from uk_budget_data.publication import artifacts
from uk_budget_data.publication.receipt import (
    artifact_sha256,
    document_problems,
)

RELATIVE_TOLERANCE = 0.01
ABSOLUTE_TOLERANCE_GBP = 1_000_000.0


class DifferentialError(ValueError):
    """Artifacts the differential cannot read as one past event's."""


def tolerance_gbp(replay_gbp: float) -> float:
    """The largest difference that counts as agreement with a replay figure."""
    return max(RELATIVE_TOLERANCE * abs(replay_gbp), ABSOLUTE_TOLERANCE_GBP)


def agrees(dashboard_gbp: float, replay_gbp: float) -> bool:
    return abs(dashboard_gbp - replay_gbp) <= tolerance_gbp(replay_gbp)


def artifact_problems(
    captured: artifacts.Captured, key: str, years: Optional[list[int]] = None
) -> list[str]:
    """Ways an artifact is not the receipted run of ``key`` it sits under.

    The receipt must describe itself (its digests recompute, as the publish
    gate checks with ``document_problems``), every file must match it, the
    receipt and every table row must name ``key``, the directory must be
    named by the artifact's digest, and every row's year must be one the
    receipt reports. With ``years``, the receipt may report only those.
    """
    document = captured.document
    problems = document_problems(document) + artifacts.captured_file_problems(
        captured
    )
    if problems:
        return problems
    dashboard = document["dashboard"]
    if dashboard.get("key") != key:
        return [f"its receipt is for {dashboard.get('key')!r}, not {key!r}"]
    if captured.path.name != artifact_sha256(document)[:16]:
        problems.append("its directory is not named by its digest")
    reported = set(document["execution_receipt"]["years"])
    if years is not None and not reported <= set(years):
        problems.append(
            f"its receipt reports years the event does not score: "
            f"{sorted(reported - set(years))}"
        )
    for name, rows in sorted(artifacts.captured_tables(captured).items()):
        foreign = sorted({str(row["reform_id"]) for row in rows} - {key})
        if foreign:
            problems.append(f"{name} holds rows for {foreign}")
        extra = sorted(
            {row["year"] for row in rows if "year" in row} - reported
        )
        if extra:
            problems.append(
                f"{name} has rows for years its receipt does not report: "
                f"{extra}"
            )
    return problems


def dashboard_figures(
    artifacts_root: Path, years: Optional[list[int]] = None
) -> dict[str, dict]:
    """Each measure's budgetary impact by year, in pounds, from its one
    artifact under ``artifacts_root``, read only when the artifact is the
    receipted run of the measure its directory names (artifact_problems)."""
    figures = {}
    for directory in sorted(artifacts_root.glob("*/*")):
        if not directory.is_dir():
            continue
        key = directory.parent.name
        captured = artifacts.capture(directory)
        problems = artifact_problems(captured, key, years)
        if problems:
            raise DifferentialError(f"{directory}: {'; '.join(problems)}")
        if key.startswith(artifacts.COMBINED_PREFIX):
            continue
        if key in figures:
            raise DifferentialError(f"{key} has more than one artifact")
        rows = artifacts.captured_tables(captured).get("budgetary_impact", [])
        figures[key] = {
            "receipt": captured.document,
            "years": {
                int(row["year"]): float(row["value"]) * 1e9 for row in rows
            },
        }
    return figures


def compare(document: dict, figures: dict[str, dict]) -> list[dict]:
    """One row per imported measure and scored year. A figure the
    dashboard has not produced is missing (None), never zero."""
    rows = []
    for record in document["measures"]:
        own = figures.get(record["id"], {}).get("years", {})
        for year in document["years"]:
            replay = (
                record["replay"].get(str(year), {}).get("measure_total_gbp")
            )
            if replay is None:
                continue
            replay = float(historical_events.decode(replay))
            dashboard = own.get(year)
            difference = None if dashboard is None else dashboard - replay
            rows.append(
                {
                    "id": record["id"],
                    "name": record["name"],
                    "year": year,
                    "dashboard_gbp": dashboard,
                    "replay_gbp": replay,
                    "difference_gbp": difference,
                    "relative": (
                        None
                        if difference is None or replay == 0
                        else difference / abs(replay)
                    ),
                    "tolerance_gbp": tolerance_gbp(replay),
                    "agrees": (
                        None
                        if dashboard is None
                        else agrees(dashboard, replay)
                    ),
                    "heads": sorted(
                        record["replay"][str(year)]["head_effects"]
                    ),
                }
            )
    return rows


def _pair(receipt: dict) -> str:
    execution = receipt.get("execution_receipt") or {}
    model = execution.get("model") or {}
    data = execution.get("data") or {}
    if not model or not data:
        return "unrecorded"
    return f"{model.get('name')} {model.get('version')}, {data.get('dataset')} ({data.get('build_id')})"


def _bn(value: Optional[float]) -> str:
    return "missing" if value is None else f"{value / 1e9:+.3f}"


def report(document: dict, figures: dict[str, dict], rows: list[dict]) -> str:
    """The comparison as markdown, with both pairs named."""
    variant = document["source"]["variant"]
    replay_pair = (
        f"policyengine-uk {variant['packages']['policyengine-uk']}, "
        f"{variant['dataset']['path']} at revision {variant['dataset']['revision']}"
    )
    pairs = sorted({_pair(figure["receipt"]) for figure in figures.values()})
    agreed = sum(1 for row in rows if row["agrees"])
    missing = sum(1 for row in rows if row["agrees"] is None)
    lines = [
        f"# National differential: {document['name']}",
        "",
        f"- This dashboard's pair: {'; '.join(pairs) or 'no artifacts'}",
        f"- The replay's pair: {replay_pair}",
        f"- Tolerance: max({RELATIVE_TOLERANCE:.0%} of the replay's figure, £{ABSOLUTE_TOLERANCE_GBP / 1e6:.0f}m)",
        f"- {agreed} of {len(rows)} measure-years agree; {missing} have no dashboard figure.",
        "",
        "The pairs differ, so a difference can come from the model or data as",
        "well as from the heads (the dashboard's `gov_balance` against the",
        "replay's declared heads). It is reported, not used as a gate.",
        "",
        "| Measure | Year | Dashboard £bn | Replay £bn | Difference £bn | Relative | Agrees | Replay heads |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        relative = "" if row["relative"] is None else f"{row['relative']:+.1%}"
        agrees_text = {True: "yes", False: "no", None: "missing"}[
            row["agrees"]
        ]
        lines.append(
            f"| {row['id']} | {row['year']} | {_bn(row['dashboard_gbp'])} | {_bn(row['replay_gbp'])} "
            f"| {_bn(row['difference_gbp'])} | {relative} | {agrees_text} | {', '.join(row['heads'])} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("artifacts_root", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--json", type=Path, help="also write the rows as JSON"
    )
    parsed = parser.parse_args(argv)
    release = releases.release_for_root(parsed.artifacts_root.parent)
    if not release.historical:
        raise SystemExit(
            f"{parsed.artifacts_root} is not a past event's artifacts root"
        )
    document = historical_events.load_event(release.id)
    if document is None:
        raise SystemExit(f"{release.id}: no event registry is imported")
    keys = {
        path.name
        for path in parsed.artifacts_root.glob("*")
        if path.is_dir()
        and not path.name.startswith(artifacts.COMBINED_PREFIX)
    }
    unknown = sorted(keys - {record["id"] for record in document["measures"]})
    if unknown:
        raise SystemExit(
            f"artifacts for measures not in {release.name}: {', '.join(unknown)}"
        )
    try:
        figures = dashboard_figures(parsed.artifacts_root, document["years"])
    except DifferentialError as error:
        raise SystemExit(str(error)) from error
    rows = compare(document, figures)
    text = report(document, figures, rows)
    if parsed.out:
        parsed.out.write_text(text)
    else:
        sys.stdout.write(text)
    if parsed.json:
        parsed.json.write_text(
            json.dumps(
                [
                    {
                        key: (
                            None
                            if isinstance(value, float)
                            and not math.isfinite(value)
                            else value
                        )
                        for key, value in row.items()
                    }
                    for row in rows
                ],
                indent=1,
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
