"""Canonical bytes for the dashboard's output tables.

An artifact is identified by the digest of its files, so the same rows must
always serialise to the same bytes: a fixed column order, rows sorted by the
table's key, UTF-8, LF line endings, one final newline, and floats written
in their shortest round-trip form. Non-finite numbers, unknown or missing
columns and duplicate keys are refused, so a table that would mislead never
gets a digest.
"""

import bisect
import csv
import hashlib
import io
import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional

STR, INT, FLOAT, BOOL = "str", "int", "float", "bool"
# Integers beyond this cannot all be told apart once read as floats (here, or
# by the browser), so they are refused rather than collapsed together.
MAX_EXACT_INTEGER = 2**53 - 1


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
        # The example households' net income across one income each
        # (uk_budget_data.example_households): ``household`` names the
        # household, ``x_variable`` the income on its x-axis, ``income``
        # that income's value.
        TableSpec(
            "income_curve",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("household", STR),
                ("x_variable", STR),
                ("income", FLOAT),
                ("baseline_net_income", FLOAT),
                ("reform_net_income", FLOAT),
            ),
            ("reform_id", "year", "household", "income"),
        ),
        # The household scatter the dashboard has always published (cos
        # d1397): the same columns as public/data/household_scatter.csv, for
        # a weighted sample of households (see sample_household_scatter).
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
            required=False,
        ),
        # Households by baseline income band and income change band: see
        # bin_scatter.
        TableSpec(
            "household_scatter_binned",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("income_band", FLOAT),
                ("change_band", FLOAT),
                ("change_band_upper", FLOAT),
                ("households", FLOAT),
            ),
            (
                "reform_id",
                "year",
                "income_band",
                "change_band",
                "change_band_upper",
            ),
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
        # UK results by age band (calculators.AgeImpactCalculator). Not
        # required, so artifacts generated before it existed stay complete.
        TableSpec(
            "age_impact",
            (
                ("reform_id", STR),
                ("reform_name", STR),
                ("year", INT),
                ("age_band", STR),
                ("people", FLOAT),
                ("sample_size", INT),
                ("mean_change", FLOAT),
                ("mean_equivalised_change", FLOAT),
                ("pct_better_off", FLOAT),
                ("pct_worse_off", FLOAT),
                ("pct_unchanged", FLOAT),
                ("people_directly_affected", FLOAT),
            ),
            ("reform_id", "year", "age_band"),
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
        if isinstance(value, str) and value in ("True", "False"):
            return value == "True"
        if type(value).__name__ in ("bool", "bool_"):
            return bool(value)
        raise TableError(f"{where}: {value!r} is not a boolean")
    if kind == INT and type(value).__name__ in (
        "int",
        "int8",
        "int16",
        "int32",
        "int64",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
    ):
        number = int(value)
        if abs(number) > MAX_EXACT_INTEGER:
            raise TableError(f"{where}: {value!r} is too large to keep exact")
        return number
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
        if abs(number) > MAX_EXACT_INTEGER:
            raise TableError(f"{where}: {value!r} is too large to keep exact")
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


# The household scatter is published binned, never household by household:
# each row is one cell of baseline income band by income change band, with
# the weighted number of households in it, in pounds a year.
#
# Income bands are SCATTER_BINS["income_band_width"] wide and named by their
# lower edge; values beyond the outer bands are counted in them, so the outer
# income bands are open-ended.
#
# Change bands are set by the edges in SCATTER_BINS["change_edges"], which
# are symmetric about zero: most measures move most households by a few
# pounds, so the bands are narrow near zero and widen outwards. A cell names
# its change band by both edges, ``change_band`` (lower) and
# ``change_band_upper``:
#   - the exact-zero band holds changes strictly between -1 and 1 and is
#     named (-1, 1);
#   - a gain is in [lower, upper) and a loss in (lower, upper], so a band and
#     its mirror image hold the same sizes of change;
#   - changes beyond the outermost edge fall in an open-ended band, named by
#     that edge on both sides: (5000, 5000) for gains of £5,000 or more and
#     (-5000, -5000) for losses of £5,000 or more.
#
# Cells with fewer than SCATTER_MIN_HOUSEHOLDS survey households are left
# out, and counts are rounded to the nearest SCATTER_ROUND_TO households.
SCATTER_CHANGE_EDGES = (
    1.0,
    10.0,
    25.0,
    50.0,
    75.0,
    100.0,
    150.0,
    200.0,
    300.0,
    400.0,
    500.0,
    750.0,
    1_000.0,
    1_500.0,
    2_000.0,
    3_000.0,
    5_000.0,
)
SCATTER_BINS = {
    "income_band_width": 5_000.0,
    "income_min": 0.0,
    "income_max": 150_000.0,
    "change_edges": [-edge for edge in reversed(SCATTER_CHANGE_EDGES)]
    + list(SCATTER_CHANGE_EDGES),
}
SCATTER_MIN_HOUSEHOLDS = 10
# Survey weights run to thousands, so counts are rounded to the nearest
# thousand households: finer rounding would let differences between cells
# reveal one household's weight.
SCATTER_ROUND_TO = 1000


# The household scatter keeps the sample size and seed of the script that
# has always made public/data/household_scatter.csv.
SCATTER_SAMPLE_SIZE = 500
SCATTER_SAMPLE_SEED = 42


def _sampling_key(household_id: int, weight: float, seed: int) -> float:
    """A household's key for weighted sampling without replacement.

    Taking the smallest keys -log(u)/weight, with u uniform in (0, 1),
    samples households with probability rising with their weight
    (Efraimidis and Spirakis). Here u comes from a hash of the seed and
    the household id, so a household's key depends only on its id, its
    weight and the seed: runs over the same households and weights (every
    run whose baseline leaves the dataset's weights alone) keep the same
    households wherever they are eligible.
    """
    digest = hashlib.sha256(f"{seed}:{household_id}".encode()).digest()
    u = (int.from_bytes(digest[:8], "big") + 1) / (2**64 + 2)
    return -math.log(u) / weight


def sample_household_scatter(
    rows: Iterable[Mapping[str, Any]],
    size: int = SCATTER_SAMPLE_SIZE,
    seed: int = SCATTER_SAMPLE_SEED,
    years: Optional[Iterable[int]] = None,
) -> list[dict]:
    """The household scatter as the dashboard has always published it.

    Like scripts/sample_household_scatter.py: households present in every
    year are sampled once, weighted by their first-year weight, and kept
    in every year, with the same columns as public/data/
    household_scatter.csv. The sample is by household, not by draw order:
    it depends only on the households, their first-year weights and the
    seed. Weights are the dataset's, which a measure's own baseline leaves
    unchanged unless it rewrites them, so measures share their sample.

    Args:
        rows: One row per household and year, with ``reform_id``,
            ``reform_name``, ``year``, ``baseline_income``,
            ``income_change``, ``household_weight`` and ``household_id``.
        size: Households to keep.
        seed: Seed of the sampling keys.
        years: Every year the run reported. A household must be present in
            each, so a year with no rows in range empties the sample. By
            default, the years the rows cover.
    """
    columns = TABLES["household_scatter"].column_names
    rows = [{name: row[name] for name in columns} for row in rows]
    covered = {int(row["year"]) for row in rows}
    years = sorted(covered if years is None else {int(y) for y in years})
    if not rows or not years or not set(years) <= covered:
        return []
    present = [
        {int(row["household_id"]) for row in rows if row["year"] == year}
        for year in years
    ]
    common = set.intersection(*present)
    first_weight = {
        int(row["household_id"]): float(row["household_weight"])
        for row in rows
        if row["year"] == years[0]
    }
    eligible = sorted(
        household
        for household in common
        if math.isfinite(first_weight[household])
        and first_weight[household] > 0
    )
    chosen = set(
        sorted(
            eligible,
            key=lambda household: (
                _sampling_key(household, first_weight[household], seed),
                household,
            ),
        )[:size]
    )
    return sorted(
        (row for row in rows if int(row["household_id"]) in chosen),
        key=lambda row: (
            row["reform_id"],
            int(row["year"]),
            int(row["household_id"]),
        ),
    )


def band(value: float, width: float, low: float, high: float) -> float:
    """The lower edge of the band holding ``value``, outer bands open."""
    edge = math.floor(value / width) * width
    # Guard against rounding in the division (for example a tiny negative
    # value whose quotient underflows to -0.0).
    if edge > value:
        edge -= width
    elif edge + width <= value:
        edge += width
    return float(min(max(edge, low), high - width))


def change_band(value: float) -> tuple[float, float]:
    """The (lower, upper) edges of the change band holding ``value``.

    See SCATTER_BINS: (-1, 1) for no change, [lower, upper) for a gain,
    (lower, upper] for a loss, and (edge, edge) beyond the outermost edge.
    """
    size = abs(value)
    if size < SCATTER_CHANGE_EDGES[0]:
        return (-SCATTER_CHANGE_EDGES[0], SCATTER_CHANGE_EDGES[0])
    if size >= SCATTER_CHANGE_EDGES[-1]:
        lower = upper = SCATTER_CHANGE_EDGES[-1]
    else:
        index = bisect.bisect_right(SCATTER_CHANGE_EDGES, size) - 1
        lower = SCATTER_CHANGE_EDGES[index]
        upper = SCATTER_CHANGE_EDGES[index + 1]
    if value < 0:
        return (-upper, -lower)
    return (lower, upper)


def bin_scatter(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Bin household-level scatter rows into publishable cells.

    Args:
        rows: One row per household, with ``reform_id``, ``reform_name``,
            ``year``, ``baseline_income``, ``income_change`` and
            ``household_weight``. A row may also carry
            ``survey_household``: the survey household it was made from.
            Microcosm builds several records from one survey household, so
            when any row carries it, a cell's floor counts distinct survey
            households, not records.

    Returns:
        One row per cell with at least SCATTER_MIN_HOUSEHOLDS households.
    """
    b = SCATTER_BINS
    rows = list(rows)
    by_survey = any("survey_household" in row for row in rows)
    if by_survey and not all("survey_household" in row for row in rows):
        raise ValueError(
            "Some scatter rows name their survey household and some do not"
        )
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
            # Round to the penny first, so float noise around zero is not
            # counted as a change.
            *change_band(round(float(row["income_change"]), 2)),
        )
        cell = cells.setdefault(key, [set() if by_survey else 0, 0.0])
        if by_survey:
            cell[0].add(row["survey_household"])
        else:
            cell[0] += 1
        cell[1] += float(row["household_weight"])
    binned = []
    for (reform_id, name, year, income, change, upper), (
        members,
        weight,
    ) in sorted(cells.items()):
        count = len(members) if by_survey else members
        if count < SCATTER_MIN_HOUSEHOLDS:
            continue
        binned.append(
            {
                "reform_id": reform_id,
                "reform_name": name,
                "year": year,
                "income_band": income,
                "change_band": change,
                "change_band_upper": upper,
                "households": float(
                    round(weight / SCATTER_ROUND_TO) * SCATTER_ROUND_TO
                ),
            }
        )
    return binned
