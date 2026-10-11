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
        TableSpec(
            "household_scatter",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("baseline_income", FLOAT),
                ("income_change", FLOAT),
                ("household_weight", FLOAT),
                ("household_id", INT),
            ),
            ("reform_id", "year", "household_id"),
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
    return typed


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


# Share of households kept in an artifact's scatter sample, per thousand.
SCATTER_SAMPLE_PER_MILLE = 25


def in_scatter_sample(household_id: int, per_mille: int) -> bool:
    """Whether a household is in the published scatter sample.

    The choice depends only on the household id, so every measure and every
    year samples the same households and their points can be combined.
    """
    digest = hashlib.sha256(str(int(household_id)).encode()).hexdigest()
    return int(digest[:8], 16) % 1000 < per_mille


def sample_scatter(
    rows: Iterable[Mapping[str, Any]],
    per_mille: int = SCATTER_SAMPLE_PER_MILLE,
) -> list[dict]:
    """The published sample of the full household scatter."""
    return [
        dict(row)
        for row in rows
        if in_scatter_sample(row["household_id"], per_mille)
    ]
