"""Checks on data_inputs/treasury/behavioural_adjustments.csv, the
reference file of what behaviour each official costing includes. Nothing
reads it at run time; these tests keep it consistent with mapping.csv and
with its own sign convention."""

import csv
from pathlib import Path

import pytest

TREASURY = Path(__file__).resolve().parents[1] / "data_inputs" / "treasury"
ADJUSTMENTS = TREASURY / "behavioural_adjustments.csv"

# The sign of an adjustment, Exchequer sign (positive improves the balance),
# that each direction implies.
SIGN = {
    "lowers_cost": 1,
    "raises_cost": -1,
    "lowers_yield": -1,
    "none": 0,
}


def _rows(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _number(text):
    return None if text.strip() == "" else float(text)


ROWS = _rows(ADJUSTMENTS)


def test_every_mapped_measure_has_a_row_on_its_treasury_row():
    mapping = {r["measure_id"]: r["row_id"] for r in _rows(TREASURY / "mapping.csv")}
    rows = {}
    for row in ROWS:
        rows.setdefault(row["measure_id"], set()).add(row["treasury_row"])
    assert set(rows) == set(mapping)
    for measure_id, row_id in mapping.items():
        assert rows[measure_id] == {row_id}, measure_id


@pytest.mark.parametrize("row", ROWS, ids=lambda r: f"{r['measure_id']}-{r['fiscal_year']}")
def test_values_follow_the_direction_and_central_lies_in_the_range(row):
    assert row["direction"] in SIGN
    assert row["source"].strip()
    assert row["method"].strip()
    low, central, high = (_number(row[k]) for k in ("low_bn", "central_bn", "high_bn"))
    sign = SIGN[row["direction"]]
    values = [v for v in (low, central, high) if v is not None]
    if sign == 0:
        assert all(v == 0 for v in values)
        return
    for value in values:
        assert value * sign >= 0
    if low is not None and high is not None:
        assert abs(low) <= abs(high)
        if central is not None:
            assert abs(low) <= abs(central) <= abs(high)
