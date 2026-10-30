"""Checks on data_inputs/treasury/behavioural_adjustments.csv, the
reference file of what behaviour each official costing includes. Nothing
reads it at run time; these tests keep it consistent with mapping.csv, with
Table 6.1, with the published artifacts and with its own sign convention.

The ``ours_bn`` figures on the ``net`` basis are tested against the published
``budgetary_impact.csv`` of each measure, so a rerun that moves them fails
here until the file is refreshed. The Carer's Allowance rows use the Carer's
Allowance + Universal Credit basis, which no published file carries: they are
a snapshot of #320's ring."""

import csv
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TREASURY = ROOT / "data_inputs" / "treasury"
ADJUSTMENTS = TREASURY / "behavioural_adjustments.csv"
PUBLISHED = ROOT / "public" / "data"

# The sign of an adjustment, Exchequer sign (positive improves the balance),
# that each direction implies.
SIGN = {
    "lowers_cost": 1,
    "raises_cost": -1,
    "lowers_yield": -1,
    "none": 0,
}

# Table 6.1 rounds to the nearest £5m, so a smaller residual is nothing to
# explain.
MATERIAL_BN = 0.005


def _rows(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _number(text):
    return None if text.strip() == "" else float(text)


def explains_residual(direction, official, ours, comparable=True):
    """ "yes" when the adjustment's sign matches official minus ours.

    Adding the adjustment to ours then moves ours towards the official
    figure. When the official behaviour instead moves the official figure
    towards ours, its sign is the opposite and adding it widens the gap.
    A residual within Table 6.1's rounding, or a year that is not comparable
    (its residual is timing), is "no"."""
    sign = SIGN[direction]
    residual = official - ours
    if sign == 0 or not comparable or abs(residual) <= MATERIAL_BN:
        return "no"
    return "yes" if (residual > 0) == (sign > 0) else "no"


ROWS = _rows(ADJUSTMENTS)
MAPPING = {r["measure_id"]: r for r in _rows(TREASURY / "mapping.csv")}
SIZED = [r for r in ROWS if r["ours_bn"].strip()]


def _id(row):
    return f"{row['measure_id']}-{row['fiscal_year']}"


def _start_year(fiscal_year):
    return int(fiscal_year.split("-")[0])


def test_every_mapped_measure_has_a_row_on_its_treasury_row():
    mapping = {m: r["row_id"] for m, r in MAPPING.items()}
    rows = {}
    for row in ROWS:
        rows.setdefault(row["measure_id"], set()).add(row["treasury_row"])
    assert set(rows) == set(mapping)
    for measure_id, row_id in mapping.items():
        assert rows[measure_id] == {row_id}, measure_id


@pytest.mark.parametrize("row", ROWS, ids=_id)
def test_values_follow_the_direction_and_central_lies_in_the_range(row):
    assert row["direction"] in SIGN
    assert row["source"].strip()
    assert row["method"].strip()
    low, central, high = (
        _number(row[k]) for k in ("low_bn", "central_bn", "high_bn")
    )
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


@pytest.mark.parametrize(
    "direction, official, ours, comparable, expected",
    [
        # Trading allowance 2029-30: official -165, ours -119; a response
        # that raises cost moves ours towards the official figure.
        ("raises_cost", -0.165, -0.119, True, "yes"),
        # Fuel duty 2026-27: the official behaviour takes the official figure
        # from about -600 to -575, towards our -301; adding it widens the gap.
        ("lowers_cost", -0.575, -0.301, True, "no"),
        # Property income 2029-30: the official behaviour takes about +535 to
        # +435, towards our +429.
        ("lowers_yield", 0.435, 0.429, True, "no"),
        # Property income 2027-28 would read "yes" on the sign alone, but the
        # residual is Self Assessment timing.
        ("lowers_yield", 0.035, 0.399, False, "no"),
        ("lowers_yield", 0.035, 0.399, True, "yes"),
        # Within Table 6.1's rounding there is nothing to explain.
        ("lowers_cost", -0.040, -0.039, True, "no"),
        ("none", -0.5, -0.1, True, "no"),
    ],
)
def test_the_rule(direction, official, ours, comparable, expected):
    assert explains_residual(direction, official, ours, comparable) == expected


@pytest.mark.parametrize("row", ROWS, ids=_id)
def test_explains_residual_follows_the_rule(row):
    if row["direction"] == "none":
        assert row["explains_residual"] == "no"
        return
    if not row["explains_residual"].strip():
        # Recorded only: savings income is held back from the release.
        assert row["measure_id"] == "savings_income_rates_up"
        return
    not_comparable = MAPPING[row["measure_id"]]["not_comparable_years"].split(
        ";"
    )
    expected = explains_residual(
        row["direction"],
        float(row["official_bn"]),
        float(row["ours_bn"]),
        comparable=row["fiscal_year"] not in not_comparable,
    )
    assert row["explains_residual"] == expected


@pytest.mark.parametrize("row", SIZED, ids=_id)
def test_official_figures_match_table_6_1(row):
    source = {
        (r["row_id"], r["fiscal_year"]): float(r["value_bn"])
        for r in _rows(TREASURY / "sources" / "AB2026-T6.1.csv")
    }
    official = source[(row["treasury_row"], row["fiscal_year"])]
    assert float(row["official_bn"]) == pytest.approx(official, abs=5e-4)


@pytest.mark.parametrize(
    "row", [r for r in SIZED if r["ours_basis"] == "net"], ids=_id
)
def test_ours_matches_the_published_budgetary_impact(row):
    manifest = json.loads((PUBLISHED / "manifest.json").read_text())
    artifact = PUBLISHED / manifest["measures"][row["measure_id"]]["artifact"]
    published = {
        int(r["year"]): float(r["value"])
        for r in _rows(artifact / "budgetary_impact.csv")
    }
    ours = published[_start_year(row["fiscal_year"])]
    assert float(row["ours_bn"]) == pytest.approx(
        ours, abs=5e-4
    ), "the published figure moved: refresh ours_bn and the sizes derived from it"


def test_carers_allowance_rows_name_their_basis():
    rows = [
        r for r in ROWS if r["measure_id"] == "carers_allowance_earnings_taper"
    ]
    assert rows
    for row in rows:
        assert row["ours_basis"] == "carers_allowance_plus_universal_credit"
        assert "Carer's Allowance + Universal Credit" in row["method"]
        assert "already below" not in row["method"]


@pytest.mark.parametrize("row", SIZED, ids=_id)
def test_sizes_follow_the_method_from_ours(row):
    ours = float(row["ours_bn"])
    low, central, high = (
        _number(row[k]) for k in ("low_bn", "central_bn", "high_bn")
    )
    measure = row["measure_id"]
    if measure == "property_income_rates_up":
        # 20% of the static yield, 10% to 30%.
        assert central == pytest.approx(-0.2 * ours, abs=1e-3)
        assert low == pytest.approx(-0.1 * ours, abs=1e-3)
        assert high == pytest.approx(-0.3 * ours, abs=1e-3)
    elif measure == "fuel_duty_rise_deferral":
        # |e| x (52.95p + 25.1p) / 150.8p of our static cost.
        share = (52.95 + 25.1) / 150.8
        assert central == pytest.approx(0.07 * share * -ours, abs=1e-3)
        assert high == pytest.approx(0.13 * share * -ours, abs=1e-3)
    elif measure == "trading_allowance_raise":
        # From 0 to the residual.
        assert low == 0
        assert high == pytest.approx(
            float(row["official_bn"]) - ours, abs=1e-3
        )
