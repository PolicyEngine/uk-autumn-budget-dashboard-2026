"""Publish one measure at a time, and refresh the combined run (#105).

On Budget day each measure is coded, checked and published on its own, so
a measure ready at 13:30 does not wait for the slowest one, and a late fix
reruns one measure, not every one.

``uk-budget-data publish-measure <id>`` runs every flat table for that one
measure and writes its rows into the public CSVs:

- the flat tables: budgetary_impact, distributional_impact, winners_losers
  and metrics;
- age_impact, household_scatter_binned and income_curve.

Each file is rewritten line by line. Only the measure's rows for the years
run are replaced; every other line keeps its exact bytes, so other
measures' figures cannot move. Blocks stay in the registry's order (the
combined run first), and rows within a block in year order, so a full
``generate`` and a run of ``publish-measure`` for every measure give the
same file. Running it twice gives the same bytes.

Each file whose bytes changed gets a **pending** review row: the Reconciler
named by ``--reconciler`` decides, by an expiry date at most
``PENDING_DAYS`` days away (``scripts/check_public_data.py`` allows 14).
Nothing here signs a row. The Reconciler signs on the data pull request,
with ``uk-budget-data sign-pending --reviewer NAME``, which restores each
row's kind and refuses a file that changed after it was marked.

**What "live" means.** A measure is live when its rows are in the deployed
``public/data/budgetary_impact.csv``: the data pull request that wrote them
merged to ``main``, which deploys. That is what the page already treats as
published when there is no manifest (#104's catalogue, CSV mode), so there
is no separate status file to keep in step. ``live_measure_ids`` reads it.

**The combined run.** ``refresh-combined`` simulates the live measures
together (``publication.combine.combine_measures``) and writes the rows
under ``AUTUMN_BUDGET_2026_COMBINED_ID``, so every view that reads the
combined run keeps working. Its budgetary rows name their members in
``reform_members`` (``a+b+c``, by id). The page treats the combined run as
current only when those members are exactly the live measures; until then
it labels totals "sum of measures". When ``publish-measure`` changes a
member's rows it blanks that cell on the combined run's rows (their figures
keep their bytes), so a correction makes the combined run stale too.

**Results by area** (regional and constituency) are not written here. They
wait for #59, which moves geography onto Microcosm's local-area file; see
``publish_geography``.

The work splits in two so that a workflow can run measures in parallel
and still open one pull request: ``compute_fragment`` simulates and writes
a measure's rows to a fragment directory (no public file touched), and
``apply_fragments`` upserts fragments into the public CSVs, marks the
review rows pending and writes the summary.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

BUDGETARY = "budgetary_impact.csv"
DISTRIBUTIONAL = "distributional_impact.csv"
# Every public file one measure writes rows into, in the order they are
# applied and listed.
MEASURE_TABLES = (
    BUDGETARY,
    DISTRIBUTIONAL,
    "winners_losers.csv",
    "metrics.csv",
    "age_impact.csv",
    "household_scatter_binned.csv",
    "income_curve.csv",
)
# Metadata columns on the budgetary rows. A column is filled only when the
# public file already has it, so this command never changes a file's shape.
MEMBERS_COLUMN = "reform_members"
DESCRIPTION_COLUMN = "reform_description"
PERSONAL_COLUMN = "reform_personal"
META_FILE = "meta.json"

RECONCILER = "juaristi22"
PENDING_DAYS = 7
SUMMARY_YEAR = 2029
GEOGRAPHY_GATE = "#59"
REVIEW_CSV = Path("data_inputs/public_data_review.csv")

_PENDING_BASIS = re.compile(
    r"^Pending review: rows for (?P<ids>\S+(?:, \S+)*) rewritten by "
    r"publish-measure \(was (?P<kind>[a-z_]+)\)\. The Reconciler signs "
    r"before merge\. (?P<basis>.*)$",
    re.DOTALL,
)


class PublishMeasureError(RuntimeError):
    """Raised when a measure cannot be published; nothing is written."""


# ---------------------------------------------------------------------------
# The registry and what is live
# ---------------------------------------------------------------------------


def registry_order() -> list[str]:
    """Measure ids in the order the public files list them."""
    from uk_budget_data.reforms import get_autumn_budget_2026_reforms

    return [reform.id for reform in get_autumn_budget_2026_reforms()]


def is_combined(reform_id: str) -> bool:
    return reform_id.endswith("_combined")


def _read_table(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def live_measure_ids(output_dir: Path) -> list[str]:
    """The single measures published in ``budgetary_impact.csv``.

    In file order, without the combined run. These are the live measures
    once the file is on ``main``.
    """
    path = Path(output_dir) / BUDGETARY
    if not path.is_file():
        return []
    _, rows = _read_table(path)
    seen: list[str] = []
    for row in rows:
        reform_id = row.get("reform_id", "")
        if reform_id and not is_combined(reform_id) and reform_id not in seen:
            seen.append(reform_id)
    return seen


def combined_members(output_dir: Path, combined_id: str) -> Optional[list]:
    """The members the published combined run names, or None if unnamed."""
    path = Path(output_dir) / BUDGETARY
    if not path.is_file():
        return None
    columns, rows = _read_table(path)
    if MEMBERS_COLUMN not in columns:
        return None
    for row in rows:
        if row["reform_id"] == combined_id and row[MEMBERS_COLUMN]:
            return row[MEMBERS_COLUMN].split("+")
    return None


# ---------------------------------------------------------------------------
# The upsert: one measure's lines replaced, every other line kept verbatim
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Line:
    reform_id: str
    year: Optional[int]
    text: str


def _parse_lines(text: str) -> tuple[str, list[str], list[_Line]]:
    """A table's header line, its columns and its data lines."""
    if not text:
        return "", [], []
    lines = text.splitlines(keepends=True)
    header = lines[0]
    columns = next(csv.reader([header]))
    at_id = columns.index("reform_id")
    at_year = columns.index("year")
    parsed = []
    for line in lines[1:]:
        if not line.strip():
            continue
        values = next(csv.reader([line]))
        year = values[at_year]
        parsed.append(
            _Line(values[at_id], int(float(year)) if year else None, line)
        )
    return header, columns, parsed


def _ensure_newline(text: str) -> str:
    return text if text.endswith(("\n", "\r")) else text + "\n"


def format_rows(columns: list[str], rows: Iterable[dict]) -> list[str]:
    """Rows as CSV lines under ``columns``, quoted as pandas writes them."""
    lines = []
    for row in rows:
        buffer = io.StringIO()
        csv.writer(buffer, lineterminator="\n").writerow(
            [row.get(column, "") for column in columns]
        )
        lines.append(buffer.getvalue())
    return lines


def upsert_text(
    text: str,
    reform_id: str,
    years: Iterable[int],
    rows: list[dict],
    order: list[str],
    fill: Optional[dict] = None,
) -> str:
    """The table with ``reform_id``'s rows for ``years`` replaced by ``rows``.

    ``rows`` are string-valued dicts keyed by column. Every other line is
    kept byte for byte. The measure's block keeps its place, or, for a new
    measure, goes before the first measure that follows it in ``order``.
    Within the block, rows are in year order; rows of one year keep the
    order they come in. ``fill`` gives values for columns the file has and
    the rows lack (the budgetary metadata columns); any other missing
    column, or a column the file lacks, is refused.
    """
    # A row's own year is always replaced too, so no rerun can duplicate it
    years = {int(year) for year in years} | {
        int(float(row["year"])) for row in rows
    }
    fill = fill or {}
    if not text:
        if not rows:
            return ""
        columns = list(rows[0])
        header = format_rows(columns, [dict(zip(columns, columns))])[0]
        lines: list[_Line] = []
    else:
        header, columns, lines = _parse_lines(text)
    if rows:
        given = set(rows[0])
        unknown = sorted(given - set(columns))
        missing = sorted(set(columns) - given - set(fill))
        if unknown or missing:
            raise PublishMeasureError(
                f"{reform_id}: the new rows do not fit the file's columns "
                f"(not in the file: {unknown}; not in the rows: {missing})"
            )
    full_rows = [{**fill, **row} for row in rows]
    new = [
        _Line(reform_id, int(float(row["year"])), line)
        for row, line in zip(full_rows, format_rows(columns, full_rows))
    ]
    kept = [
        line
        for line in lines
        if not (line.reform_id == reform_id and line.year in years)
    ]
    others = [line for line in kept if line.reform_id != reform_id]
    block = [line for line in kept if line.reform_id == reform_id] + new
    block.sort(key=lambda line: (line.year is None, line.year or 0))

    first = next(
        (i for i, line in enumerate(kept) if line.reform_id == reform_id),
        None,
    )
    if first is not None:
        position = sum(
            1 for line in kept[:first] if line.reform_id != reform_id
        )
    else:
        rank = {measure: i for i, measure in enumerate(order)}
        mine = rank.get(reform_id, len(order))
        position = next(
            (
                i
                for i, line in enumerate(others)
                if rank.get(line.reform_id, len(order)) > mine
            ),
            len(others),
        )
    result = others[:position] + block + others[position:]
    parts = [_ensure_newline(header)] + [line.text for line in result]
    for i in range(1, len(parts) - 1):
        parts[i] = _ensure_newline(parts[i])
    return "".join(parts)


# ---------------------------------------------------------------------------
# Computing one measure's rows
# ---------------------------------------------------------------------------


@dataclass
class Fragment:
    """One measure's rows for every table, as written by a full run."""

    reform_id: str
    reform_name: str
    years: list[int]
    tables: dict[str, list[dict]]
    members: Optional[list[str]] = None
    warnings: list[str] = field(default_factory=list)


def _frame_rows(rows: list[dict]) -> list[dict]:
    """Rows as the full run writes them: through pandas, as strings."""
    import pandas as pd

    if not rows:
        return []
    text = pd.DataFrame(rows).to_csv(index=False)
    return list(csv.DictReader(io.StringIO(text)))


def compute_measure_rows(
    reform,
    config,
    build: Optional[Callable] = None,
) -> tuple[dict[str, list[dict]], list[str]]:
    """Every table's rows for one measure, and any model-limit warnings.

    Builds the measure's two simulations once and runs each calculator the
    full run uses on them; the binned scatter as ``generate --only
    household_scatter`` bins it, and the income curve from household
    simulations as ``uk-budget-data income-curve`` does. Refuses a measure
    the data cannot cost (``data_limits``): the flat path would only warn,
    and these rows go straight to a data pull request.
    """
    from uk_budget_data import data_limits, model_limits
    from uk_budget_data.calculators import (
        AgeImpactCalculator,
        BudgetaryImpactCalculator,
        DistributionalImpactCalculator,
        IncomeCurveCalculator,
        MetricsCalculator,
        WinnersLosersCalculator,
    )
    from uk_budget_data.example_households import EXAMPLE_HOUSEHOLDS
    from uk_budget_data.geography import household_values
    from uk_budget_data.pipeline import (
        build_microsimulation,
        household_scatter_rows,
        scatter_survey_households,
    )
    from uk_budget_data.publication.tables import bin_scatter

    build = build or build_microsimulation
    years = list(config.years)
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    baseline_scenario = reform.baseline_scenario_for(config)
    reform_scenario = reform.to_scenario()
    baseline = data_limits.watched_build(
        build, dataset_path, baseline_scenario
    )
    reformed = data_limits.watched_build(build, dataset_path, reform_scenario)

    tables: dict[str, list[dict]] = {name: [] for name in MEASURE_TABLES}
    distributional = DistributionalImpactCalculator()
    winners_losers = WinnersLosersCalculator()
    metrics = MetricsCalculator()
    age = AgeImpactCalculator()
    survey = scatter_survey_households(baseline, dataset_path)
    scatter = []
    with data_limits.observing(baseline, reformed) as observed:
        tables[BUDGETARY] = BudgetaryImpactCalculator(years=years).calculate(
            baseline, reformed, reform.id, reform.name
        )
        for year in years:
            rows, decile_df = distributional.calculate(
                baseline, reformed, reform.id, reform.name, year
            )
            tables[DISTRIBUTIONAL].extend(rows)
            tables["winners_losers.csv"].extend(
                winners_losers.calculate(
                    decile_df, reform.id, reform.name, year
                )
            )
            tables["metrics.csv"].extend(
                metrics.calculate(
                    baseline, reformed, reform.id, reform.name, year
                )
            )
            tables["age_impact.csv"].extend(
                age.calculate(baseline, reformed, reform.id, reform.name, year)
            )
            scatter.extend(
                household_scatter_rows(
                    reform,
                    year,
                    household_values(baseline, "household_net_income", year),
                    household_values(reformed, "household_net_income", year),
                    household_values(baseline, "household_weight", year),
                    survey,
                    config.household_scatter_max_income,
                )
            )
    limits = data_limits.limits_touched(baseline, reformed, observed)
    if limits:
        raise PublishMeasureError(
            f"{reform.id} is not computable on current data: "
            + "; ".join(limit["reason"] for limit in limits)
            + " Publish it through the gated path, which lists it as not "
            "computable."
        )
    warnings = [
        f"Mis-costed by this model: {limit['reason']}"
        for limit in model_limits.limits_touched(baseline, reformed)
    ]
    tables["household_scatter_binned.csv"] = bin_scatter(scatter)
    del baseline, reformed, observed, scatter

    calculator = IncomeCurveCalculator(num_points=config.income_curve_points)
    curve = []
    for household in EXAMPLE_HOUSEHOLDS:
        curve.extend(
            calculator.rows(
                household,
                calculator.simulate(household, baseline_scenario, years),
                calculator.simulate(household, reform_scenario, years),
                reform.id,
                reform.name,
                years,
            )
        )
    household_order = {h.id: i for i, h in enumerate(EXAMPLE_HOUSEHOLDS)}
    curve.sort(
        key=lambda row: (
            row["year"],
            household_order[row["household"]],
            row["income"],
        )
    )
    tables["income_curve.csv"] = curve
    return {name: _frame_rows(rows) for name, rows in tables.items()}, warnings


def publish_geography(reform, config) -> None:
    """Results by region and constituency for one measure: not yet.

    The hook for #59. Once #59 merges, results by area come from
    Microcosm's local-area file through the disclosure layer
    (``uk-budget-data geography``); this is where publish-measure will run
    them for one measure and upsert their rows. Until then it refuses.
    """
    raise PublishMeasureError(
        f"Results by area wait for {GEOGRAPHY_GATE}; publish-measure does "
        "not write regional or constituency rows yet."
    )


# ---------------------------------------------------------------------------
# Fragments: one measure's rows on disk, applied later
# ---------------------------------------------------------------------------


def write_fragment(directory: Path, fragment: Fragment) -> Path:
    """Write a fragment to ``directory/<id>/``; returns that directory."""
    target = Path(directory) / fragment.reform_id
    target.mkdir(parents=True, exist_ok=True)
    for name in MEASURE_TABLES:
        rows = fragment.tables.get(name, [])
        columns = list(rows[0]) if rows else []
        lines = format_rows(columns, [dict(zip(columns, columns))]) + (
            format_rows(columns, rows)
        )
        (target / name).write_text("".join(lines) if rows else "")
    meta = {
        "reform_id": fragment.reform_id,
        "reform_name": fragment.reform_name,
        "years": sorted(fragment.years),
        "members": fragment.members,
        "warnings": fragment.warnings,
    }
    (target / META_FILE).write_text(
        json.dumps(meta, indent=2, sort_keys=True) + "\n"
    )
    return target


def read_fragment(directory: Path) -> Fragment:
    directory = Path(directory)
    meta = json.loads((directory / META_FILE).read_text())
    tables = {}
    for name in MEASURE_TABLES:
        path = directory / name
        text = path.read_text() if path.is_file() else ""
        tables[name] = list(csv.DictReader(io.StringIO(text))) if text else []
    return Fragment(
        reform_id=meta["reform_id"],
        reform_name=meta["reform_name"],
        years=list(meta["years"]),
        tables=tables,
        members=meta.get("members"),
        warnings=list(meta.get("warnings") or []),
    )


def compute_fragment(reform, config, members=None, build=None) -> Fragment:
    tables, warnings = compute_measure_rows(reform, config, build=build)
    return Fragment(
        reform_id=reform.id,
        reform_name=reform.name,
        years=list(config.years),
        tables=tables,
        members=members,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Review rows: pending, then signed by the Reconciler
# ---------------------------------------------------------------------------


def _review_rows(review_path: Path) -> dict[str, list[str]]:
    from uk_budget_data.publication.review_rows import read_review

    _, records = read_review(review_path)
    rows = {}
    for record in records:
        if record.path is not None:
            rows[record.path] = next(csv.reader(io.StringIO(record.raw)))
    return rows


def _write_review(review_path: Path, rows, reviewer: str, on: str) -> None:
    from uk_budget_data.publication import review_rows as rr

    header, records = rr.read_review(review_path)
    text = rr.merge(
        header,
        records,
        rows,
        reviewer=reviewer,
        reviewed_on=on,
        removable=lambda path: False,
        report=rr.Report(revision=0),
    )
    rr._write_text(review_path, text)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mark_pending(
    root: Path,
    public_paths: list[str],
    measure_ids: list[str],
    *,
    reconciler: str = RECONCILER,
    on: Optional[str] = None,
    days: int = PENDING_DAYS,
) -> list[str]:
    """Mark each changed file's review row pending; returns those paths.

    A file whose bytes still match its row is left alone, signed or not,
    so a rerun that changes nothing changes no row. A pending row keeps
    the kind it had (in its basis) for ``sign_pending`` to restore, and
    the ids of every measure rewritten since it was last signed.
    """
    from uk_budget_data.publication.review_rows import Row

    root = Path(root)
    on = on or datetime.now(timezone.utc).date().isoformat()
    expires = (date.fromisoformat(on) + timedelta(days=days)).isoformat()
    review_path = root / REVIEW_CSV
    existing = _review_rows(review_path)
    rows = []
    for public_path in public_paths:
        sha = _sha256(root / public_path)
        row = existing.get(public_path)
        if row is not None and row[2] == sha:
            continue
        kind, basis, ids = "national_table", "", set(measure_ids)
        if row is not None:
            kind, basis = row[1], row[6]
            prior = _PENDING_BASIS.match(basis)
            if kind == "pending" and prior:
                kind, basis = prior["kind"], prior["basis"]
                ids |= set(prior["ids"].split(", "))
        rows.append(
            Row(
                path=public_path,
                kind="pending",
                sha256=sha,
                basis=(
                    f"Pending review: rows for {', '.join(sorted(ids))} "
                    f"rewritten by publish-measure (was {kind}). The "
                    f"Reconciler signs before merge. {basis}"
                ).rstrip(),
                expires_on=expires,
            )
        )
    if rows:
        _write_review(review_path, rows, reconciler, on)
    return [row.path for row in rows]


def sign_pending(
    root: Path, reviewer: str, on: Optional[str] = None
) -> list[str]:
    """Sign every row publish-measure marked pending; returns their paths.

    Run by the Reconciler, by hand, after reviewing the data pull request:
    each row gets back its kind, the reviewer's name and today's date. It
    refuses, writing nothing, if any such file changed after it was marked.
    """
    from uk_budget_data.publication.review_rows import Row

    if not reviewer.strip():
        raise PublishMeasureError("sign-pending needs --reviewer")
    root = Path(root)
    on = on or datetime.now(timezone.utc).date().isoformat()
    review_path = root / REVIEW_CSV
    rows, changed = [], []
    for path, row in _review_rows(review_path).items():
        prior = _PENDING_BASIS.match(row[6])
        if row[1] != "pending" or not prior:
            continue
        if _sha256(root / path) != row[2]:
            changed.append(path)
            continue
        rows.append(Row(path, prior["kind"], row[2], prior["basis"]))
    if changed:
        raise PublishMeasureError(
            "changed since it was marked pending (rerun publish-measure "
            "and review again): " + ", ".join(changed)
        )
    if rows:
        _write_review(review_path, rows, reviewer, on)
    return [row.path for row in rows]


# ---------------------------------------------------------------------------
# Applying fragments, and the summary
# ---------------------------------------------------------------------------


def _fmt(value: Optional[float], digits: int = 2) -> str:
    return "–" if value is None else f"{value:,.{digits}f}"


def _number(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _values(rows, key: str, value: str, **match) -> dict:
    return {
        row[key]: _number(row[value])
        for row in rows
        if all(str(row.get(k)) == str(v) for k, v in match.items())
    }


def fragment_summary(
    fragment: Fragment,
    before: dict[str, list[dict]],
    changed_files: list[str],
) -> str:
    """Markdown for one measure: revenue by year, the 2029 deciles, and
    the change against the rows it replaced."""
    rid = fragment.reform_id
    lines = [f"### `{rid}`: {fragment.reform_name}", ""]
    if fragment.members:
        lines += [f"Members: {', '.join(fragment.members)}", ""]
    years = ", ".join(str(year) for year in sorted(fragment.years))
    lines += [
        f"Years run: {years}. Files changed: "
        + (", ".join(f"`{name}`" for name in changed_files) or "none")
        + ".",
        "",
        "| Year | Revenue (£bn) | Previous (£bn) | Change (£bn) |",
        "|---|---:|---:|---:|",
    ]
    new = _values(fragment.tables[BUDGETARY], "year", "value", reform_id=rid)
    old = _values(before.get(BUDGETARY, []), "year", "value", reform_id=rid)
    for year in sorted(new, key=int):
        change = (
            None
            if new[year] is None or old.get(year) is None
            else new[year] - old[year]
        )
        lines.append(
            f"| {year} | {_fmt(new[year])} | {_fmt(old.get(year))} | "
            f"{_fmt(change)} |"
        )
    year = str(SUMMARY_YEAR)
    new = _values(
        fragment.tables[DISTRIBUTIONAL],
        "decile",
        "value",
        reform_id=rid,
        year=year,
    )
    if new:
        old = _values(
            before.get(DISTRIBUTIONAL, []),
            "decile",
            "value",
            reform_id=rid,
            year=year,
        )
        lines += [
            "",
            f"| Decile | Change in net income, {year} (%) | Previous (%) "
            "| Change (pp) |",
            "|---|---:|---:|---:|",
        ]
        for decile, value in new.items():
            change = (
                None
                if value is None or old.get(decile) is None
                else value - old[decile]
            )
            lines.append(
                f"| {decile} | {_fmt(value, 3)} | {_fmt(old.get(decile), 3)}"
                f" | {_fmt(change, 3)} |"
            )
    for warning in fragment.warnings:
        lines += ["", f"**Warning:** {warning}"]
    return "\n".join(lines) + "\n"


def _budgetary_fill(fragment: Fragment, columns: list[str]) -> dict:
    from uk_budget_data import reforms

    fill = {}
    if MEMBERS_COLUMN in columns:
        fill[MEMBERS_COLUMN] = "+".join(fragment.members or [])
    if DESCRIPTION_COLUMN in columns:
        reform = reforms.get_reform(fragment.reform_id)
        fill[DESCRIPTION_COLUMN] = reform.description if reform else ""
    if PERSONAL_COLUMN in columns:
        series = getattr(reforms, "PUBLIC_PERSONAL_SERIES", {})
        fill[PERSONAL_COLUMN] = (
            json.dumps(series[fragment.reform_id], sort_keys=True)
            if fragment.reform_id in series
            else ""
        )
    return fill


def mark_combined_stale(text: str, measure_id: str, combined_id: str) -> str:
    """Blank the combined run's ``reform_members`` if it includes a measure.

    Run when a measure's rows change: the combined run simulated its old
    rows, so the page must stop using it until ``refresh-combined`` runs.
    Only that one cell of the combined run's rows changes; its figures,
    and every other line, keep their bytes.
    """
    if not text:
        return text
    header, columns, lines = _parse_lines(text)
    if MEMBERS_COLUMN not in columns:
        return text
    at = columns.index(MEMBERS_COLUMN)
    parts = [_ensure_newline(header)]
    for line in lines:
        if line.reform_id == combined_id:
            values = next(csv.reader([line.text]))
            if measure_id in values[at].split("+"):
                values[at] = ""
                row = dict(zip(columns, values))
                parts.append(format_rows(columns, [row])[0])
                continue
        parts.append(_ensure_newline(line.text))
    return "".join(parts)


@dataclass
class ApplyReport:
    changed_files: list[str]
    pending: list[str]
    summary: str


def apply_fragments(
    fragments: list[Fragment],
    output_dir: Path,
    *,
    root: Path = Path("."),
    order: Optional[list[str]] = None,
    reconciler: str = RECONCILER,
    on: Optional[str] = None,
) -> ApplyReport:
    """Upsert each fragment's rows, mark changed files pending, summarise."""
    output_dir = Path(output_dir)
    root = Path(root)
    order = order if order is not None else registry_order()
    try:
        prefix = output_dir.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as error:
        raise PublishMeasureError(
            f"{output_dir} is not inside the repository root {root}"
        ) from error
    sections, changed = [], set()
    for fragment in fragments:
        before = {}
        changed_here = []
        for name in MEASURE_TABLES:
            path = output_dir / name
            text = path.read_text(encoding="utf-8") if path.is_file() else ""
            before[name] = (
                list(csv.DictReader(io.StringIO(text))) if text else []
            )
            rows = fragment.tables.get(name, [])
            columns = (
                _parse_lines(text)[1]
                if text
                else list(rows[0]) if rows else []
            )
            fill = (
                _budgetary_fill(fragment, columns) if name == BUDGETARY else {}
            )
            updated = upsert_text(
                text, fragment.reform_id, fragment.years, rows, order, fill
            )
            if updated != text:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("w", encoding="utf-8", newline="") as handle:
                    handle.write(updated)
                changed_here.append(name)
        if changed_here and fragment.members is None:
            from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

            path = output_dir / BUDGETARY
            text = path.read_text(encoding="utf-8") if path.is_file() else ""
            stale = mark_combined_stale(
                text, fragment.reform_id, AUTUMN_BUDGET_2026_COMBINED_ID
            )
            if stale != text:
                with path.open("w", encoding="utf-8", newline="") as handle:
                    handle.write(stale)
                if BUDGETARY not in changed_here:
                    changed_here.insert(0, BUDGETARY)
                fragment.warnings.append(
                    "The combined run included this measure's previous "
                    "rows, so it is marked stale: the page shows the sum "
                    "of measures until refresh-combined runs."
                )
        changed.update(changed_here)
        sections.append(fragment_summary(fragment, before, changed_here))
    changed_files = [name for name in MEASURE_TABLES if name in changed]
    public_paths = [f"{prefix}/{name}" for name in changed_files]
    pending = (
        mark_pending(
            root,
            public_paths,
            [fragment.reform_id for fragment in fragments],
            reconciler=reconciler,
            on=on,
        )
        if public_paths and (root / REVIEW_CSV).is_file()
        else []
    )
    header = [
        "## Data PR: publish-measure",
        "",
        "Review rows are pending; the Reconciler signs before merge "
        f"(`uk-budget-data sign-pending --reviewer NAME`). Results by area "
        f"are not included (they wait for {GEOGRAPHY_GATE}).",
        "",
    ]
    if pending:
        header += ["Pending review rows:", ""] + [
            f"- `{path}`" for path in pending
        ]
        header.append("")
    return ApplyReport(
        changed_files=public_paths,
        pending=pending,
        summary="\n".join(header) + "\n" + "\n".join(sections),
    )


def fragment_dirs(paths: Iterable[Path]) -> list[Path]:
    """Fragment directories under each path (itself, or its children)."""
    found = []
    for path in paths:
        path = Path(path)
        if (path / META_FILE).is_file():
            found.append(path)
        elif path.is_dir():
            found.extend(
                sorted(
                    child
                    for child in path.iterdir()
                    if (child / META_FILE).is_file()
                )
            )
    return found


# ---------------------------------------------------------------------------
# The combined run
# ---------------------------------------------------------------------------


def combined_reform(measure_ids: list[str], config):
    """The live measures as one simulation, under the combined run's id.

    Built by ``combine_measures`` (each member applied in id order, and
    conflicting members refused), then named as the registry's combined
    run, so every view that reads that id keeps working.
    """
    from uk_budget_data.publication.combine import combine_measures
    from uk_budget_data.reforms import (
        AUTUMN_BUDGET_2026_COMBINED_ID,
        get_reform,
    )

    members = []
    for measure_id in measure_ids:
        reform = get_reform(measure_id)
        if reform is None:
            raise PublishMeasureError(f"unknown measure id: {measure_id}")
        members.append(reform)
    combined = combine_measures(members, config)
    return combined.model_copy(
        update={
            "id": AUTUMN_BUDGET_2026_COMBINED_ID,
            "name": "Autumn Budget 2026 (combined)",
        }
    )
