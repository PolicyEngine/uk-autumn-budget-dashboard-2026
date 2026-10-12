"""Canonical bytes for the dashboard's output tables.

An artifact is identified by the digest of its files, so the same rows must
always serialise to the same bytes: a fixed column order, rows sorted by the
table's key, UTF-8, LF line endings, one final newline, and floats written
in their shortest round-trip form. Non-finite numbers, unknown or missing
columns and duplicate keys are refused, so a table that would mislead never
gets a digest.
"""

import csv
import hashlib
import io
import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

STR, INT, FLOAT, BOOL = "str", "int", "float", "bool"


class TableError(ValueError):
    """Raised when rows cannot be written as a canonical table."""


@dataclass(frozen=True)
class TableSpec:
    """Column order, types and key of one output table."""

    name: str
    columns: tuple[tuple[str, str], ...]
    key: tuple[str, ...]
    required: bool = True

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(name for name, _ in self.columns)

    @property
    def filename(self) -> str:
        return f"{self.name}.csv"


TABLES: dict[str, TableSpec] = {
    spec.name: spec
    for spec in (
        TableSpec(
            "briefing_deciles",
            (
                ("reform_id", STR),
                ("year", INT),
                ("decile", STR),
                ("avg_change_gbp", FLOAT),
            ),
            ("reform_id", "year", "decile"),
            required=False,
        ),
        TableSpec(
            "briefing_winners_losers",
            (
                ("reform_id", STR),
                ("year", INT),
                ("decile", STR),
                ("category", STR),
                ("share_pct", FLOAT),
            ),
            ("reform_id", "year", "decile", "category"),
            required=False,
        ),
        TableSpec(
            "briefing_poverty",
            (
                ("reform_id", STR),
                ("year", INT),
                ("measure", STR),
                ("housing", STR),
                ("group", STR),
                ("baseline_rate_pct", FLOAT),
                ("reform_rate_pct", FLOAT),
                ("change_pp", FLOAT),
            ),
            ("reform_id", "year", "measure", "housing", "group"),
            required=False,
        ),
        TableSpec(
            "budgetary_impact",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("value", FLOAT),
            ),
            ("reform_id", "year"),
        ),
        TableSpec(
            "distributional_impact",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("decile", STR),
                ("value", FLOAT),
            ),
            ("reform_id", "year", "decile"),
        ),
        TableSpec(
            "winners_losers",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("decile", STR),
                ("avg_change", FLOAT),
            ),
            ("reform_id", "year", "decile"),
        ),
        TableSpec(
            "metrics",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("people_affected", FLOAT),
                ("gini_change", FLOAT),
                ("poverty_change_pp", FLOAT),
                ("poverty_change_pct", FLOAT),
            ),
            ("reform_id", "year"),
        ),
        TableSpec(
            "income_curve",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("employment_income", FLOAT),
                ("baseline_net_income", FLOAT),
                ("reform_net_income", FLOAT),
            ),
            ("reform_id", "year", "employment_income"),
        ),
        # Households by baseline income band and income change band. No
        # household-level rows: see bin_scatter.
        TableSpec(
            "household_scatter_binned",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("income_band", FLOAT),
                ("change_band", FLOAT),
                ("households", FLOAT),
            ),
            ("reform_id", "year", "income_band", "change_band"),
        ),
        TableSpec(
            "constituency",
            (
                ("reform_id", STR),
                ("year", INT),
                ("constituency_code", STR),
                ("constituency_name", STR),
                ("average_gain", FLOAT),
                ("relative_change", FLOAT),
            ),
            ("reform_id", "year", "constituency_code"),
            required=False,
        ),
        TableSpec(
            "demographic_constituency",
            (
                ("reform_id", STR),
                ("year", INT),
                ("constituency_code", STR),
                ("constituency_name", STR),
                ("num_children", STR),
                ("is_married", BOOL),
                ("average_gain", FLOAT),
                ("relative_change", FLOAT),
                ("household_count", FLOAT),
            ),
            (
                "reform_id",
                "year",
                "constituency_code",
                "num_children",
                "is_married",
            ),
            required=False,
        ),
    )
}


def _coerce(value: Any, kind: str, where: str) -> Any:
    """Convert one cell to its declared type, refusing anything ambiguous."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        raise TableError(f"{where}: missing value")
    if kind == STR:
        return str(value)
    if kind == BOOL:
        if isinstance(value, str):
            if value in ("True", "False"):
                return value == "True"
            raise TableError(f"{where}: {value!r} is not a boolean")
        return bool(value)
    try:
        # A float32 is written as its own shortest decimal, as pandas writes
        # it, rather than as the longer exact double.
        if type(value).__name__ == "float32":
            value = str(value)
        number = float(value)
    except (TypeError, ValueError) as error:
        raise TableError(f"{where}: {value!r} is not a number") from error
    if not math.isfinite(number):
        raise TableError(f"{where}: {value!r} is not finite")
    if kind == INT:
        if number != int(number):
            raise TableError(f"{where}: {value!r} is not a whole number")
        return int(number)
    return number


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, float):
        return repr(value)
    return str(value)


def normalise(name: str, rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Type, check and sort rows of the named table.

    Raises TableError for an unknown table, unknown or missing columns,
    untypable or non-finite values, or two rows with the same key.
    """
    if name not in TABLES:
        raise TableError(f"unknown table {name!r}")
    spec = TABLES[name]
    expected = set(spec.column_names)
    typed = []
    for index, row in enumerate(rows):
        columns = set(row)
        if columns != expected:
            extra = sorted(columns - expected)
            missing = sorted(expected - columns)
            raise TableError(
                f"{name} row {index}: unexpected columns {extra}, "
                f"missing columns {missing}"
            )
        typed.append(
            {
                column: _coerce(row[column], kind, f"{name}.{column}[{index}]")
                for column, kind in spec.columns
            }
        )
    typed.sort(key=lambda row: tuple(row[column] for column in spec.key))
    for previous, current in zip(typed, typed[1:]):
        if all(previous[c] == current[c] for c in spec.key):
            raise TableError(
                f"{name}: duplicate key "
                f"{tuple(current[c] for c in spec.key)}"
            )
    _check_briefing(name, typed)
    return typed


BRIEFING_DECILES = frozenset({*(str(n) for n in range(1, 11)), "all"})
BRIEFING_CATEGORIES = frozenset(
    {"gain_more_5", "gain_less_5", "no_change", "lose_less_5", "lose_more_5"}
)
BRIEFING_POVERTY_KEYS = frozenset(
    (measure, housing, group)
    for measure in ("absolute", "relative")
    for housing in ("bhc", "ahc")
    for group in ("overall", "child", "working_age", "pensioner")
)
BRIEFING_TABLES = frozenset(
    {"briefing_deciles", "briefing_winners_losers", "briefing_poverty"}
)


def _check_briefing(name: str, rows: list[dict]) -> None:
    """Check complete briefing dimensions and arithmetic before hashing."""
    if name not in BRIEFING_TABLES:
        return
    groups = {}
    for row in rows:
        groups.setdefault((row["reform_id"], row["year"]), []).append(row)
    for (key, year), matching in groups.items():
        label = f"{name}: {key}, {year}"
        if name == "briefing_poverty":
            if {
                (row["measure"], row["housing"], row["group"])
                for row in matching
            } != BRIEFING_POVERTY_KEYS:
                raise TableError(f"{label}: incomplete measure/housing/group")
            for row in matching:
                if any(
                    not 0 <= row[column] <= 100
                    for column in ("baseline_rate_pct", "reform_rate_pct")
                ):
                    raise TableError(f"{label}: poverty rate outside [0, 100]")
                if (
                    abs(
                        row["change_pp"]
                        - (row["reform_rate_pct"] - row["baseline_rate_pct"])
                    )
                    > 1e-9
                ):
                    raise TableError(f"{label}: inconsistent poverty change")
            continue
        if {row["decile"] for row in matching} != BRIEFING_DECILES:
            raise TableError(f"{label}: incomplete decile")
        if name == "briefing_winners_losers":
            for decile in BRIEFING_DECILES:
                decile_rows = [
                    row for row in matching if row["decile"] == decile
                ]
                if {
                    row["category"] for row in decile_rows
                } != BRIEFING_CATEGORIES:
                    raise TableError(
                        f"{label}: incomplete category in {decile}"
                    )
                shares = [row["share_pct"] for row in decile_rows]
                if any(not 0 <= value <= 100 for value in shares):
                    raise TableError(f"{label}: share outside [0, 100]")
                if abs(math.fsum(shares) - 100) > 1e-9:
                    raise TableError(
                        f"{label}: shares in {decile} do not sum to 100"
                    )


def canonical_csv(name: str, rows: Iterable[Mapping[str, Any]]) -> bytes:
    """The canonical bytes of the named table."""
    typed = normalise(name, rows)
    spec = TABLES[name]
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(spec.column_names)
    for row in typed:
        writer.writerow([_text(row[column]) for column in spec.column_names])
    return buffer.getvalue().encode("utf-8")


def parse_csv(name: str, data: bytes) -> list[dict]:
    """Read canonical bytes back into typed, sorted rows."""
    reader = csv.DictReader(io.StringIO(data.decode("utf-8"), newline=""))
    return normalise(name, reader)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def records(table: Any) -> list[dict]:
    """Rows of a pandas DataFrame, or a list of dicts unchanged."""
    if hasattr(table, "to_dict"):
        return table.to_dict("records")
    return list(table)


# The household scatter is published binned, never household by household:
# each row is one cell of baseline income band by income change band, with
# the weighted number of households in it. A band is named by its lower edge
# in pounds a year. Values beyond the outer bands are counted in them, so the
# outer bands are open-ended. Cells with fewer than SCATTER_MIN_HOUSEHOLDS
# survey households are left out, and counts are rounded to the nearest
# SCATTER_ROUND_TO households.
SCATTER_BINS = {
    "income_band_width": 5_000.0,
    "income_min": 0.0,
    "income_max": 150_000.0,
    "change_band_width": 100.0,
    "change_min": -2_000.0,
    "change_max": 2_000.0,
}
SCATTER_MIN_HOUSEHOLDS = 10
SCATTER_ROUND_TO = 10


def band(value: float, width: float, low: float, high: float) -> float:
    """The lower edge of the band holding ``value``, outer bands open."""
    edge = math.floor(value / width) * width
    return float(min(max(edge, low), high - width))


def bin_scatter(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Bin household-level scatter rows into publishable cells.

    Args:
        rows: One row per household, with ``reform_id``, ``reform_name``,
            ``year``, ``baseline_income``, ``income_change`` and
            ``household_weight``.

    Returns:
        One row per cell with at least SCATTER_MIN_HOUSEHOLDS households.
    """
    b = SCATTER_BINS
    cells: dict[tuple, list] = {}
    for row in rows:
        key = (
            row["reform_id"],
            row["reform_name"],
            int(row["year"]),
            band(
                float(row["baseline_income"]),
                b["income_band_width"],
                b["income_min"],
                b["income_max"],
            ),
            band(
                float(row["income_change"]),
                b["change_band_width"],
                b["change_min"],
                b["change_max"],
            ),
        )
        cell = cells.setdefault(key, [0, 0.0])
        cell[0] += 1
        cell[1] += float(row["household_weight"])
    binned = []
    for (reform_id, name, year, income, change), (count, weight) in sorted(
        cells.items()
    ):
        if count < SCATTER_MIN_HOUSEHOLDS:
            continue
        binned.append(
            {
                "reform_id": reform_id,
                "reform_name": name,
                "year": year,
                "income_band": income,
                "change_band": change,
                "households": float(
                    round(weight / SCATTER_ROUND_TO) * SCATTER_ROUND_TO
                ),
            }
        )
    return binned
