"""Tests for the Table 4.1 scorecard importer (synthetic workbooks only)."""

import csv

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from openpyxl import Workbook

from uk_budget_data.treasury_import import (
    ROUNDING_PER_FIGURE_M,
    ScorecardError,
    TotalsMismatch,
    check_totals,
    main,
    parse_figure,
    parse_rows,
    read_workbook,
    source_rows,
)

YEARS = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"]


def sheet_rows(measures, totals=True, years=YEARS):
    """Rows laid out like the Treasury's presentational scorecard."""
    rows = [
        (None, None, "Table 4.1 policy decisions (£ million)", None),
        (None, None, None, "Head", *years),
        (None, "A section heading", None, None),
    ]
    for number, label, head, values in measures:
        rows.append((None, number, label, head, *values))
    if totals:
        for name, heads in (
            ("Total policy decisions", {"Tax", "Spend"}),
            ("Total spending policy decisions", {"Spend"}),
            ("Total tax policy decisions", {"Tax"}),
        ):
            sums = [
                sum(
                    parse_figure(m[3][i])[0] for m in measures if m[2] in heads
                )
                for i in range(len(years))
            ]
            rows.append((None, None, name, None, *sums))
    rows.append((None, "1 Totals may not sum due to rounding.", None, None))
    return rows


MEASURES = [
    (
        1,
        "Fuel Duty: freeze main rates",
        "Tax",
        [-385, -2190, -1705, -1740, -1770],
    ),
    (3, "One-off payment", "Spend", [-870, 0, 0, 0, 0]),
    (6, "Capital Gains Tax: raise rates", "Tax", [450, 250, 1150, "*", "-"]),
]


def test_parses_measures_heads_and_years():
    scorecard = parse_rows(sheet_rows(MEASURES))
    assert scorecard.fiscal_years == YEARS
    assert [m.number for m in scorecard.measures] == ["1", "3", "6"]
    assert [m.head for m in scorecard.measures] == ["tax", "spend", "tax"]
    cgt = scorecard.measures[2]
    assert cgt.values_m["2029-30"] == 0.0
    assert cgt.negligible == {"2029-30"}
    assert cgt.values_m["2030-31"] == 0.0


def test_totals_that_add_up_pass():
    report = check_totals(parse_rows(sheet_rows(MEASURES)))
    assert len(report) == 3 * len(YEARS)


def test_a_miskeyed_row_fails_the_totals_check():
    rows = sheet_rows(MEASURES)
    miskeyed = list(rows[3])
    miskeyed[5] = -2910  # transposed digits in 2027-28
    rows[3] = tuple(miskeyed)
    with pytest.raises(TotalsMismatch, match="2027-28"):
        check_totals(parse_rows(rows))


def test_missing_grand_total_fails():
    with pytest.raises(TotalsMismatch, match="no 'Total policy decisions'"):
        check_totals(parse_rows(sheet_rows(MEASURES, totals=False)))


@pytest.mark.parametrize(
    "rows, message",
    [
        ([(None, "no years here")], "no header row"),
        (
            [
                (None, None, None, "Head", *YEARS),
                (None, 1, "Twice", "Tax", 1, 1, 1, 1, 1),
                (None, 1, "Twice", "Tax", 1, 1, 1, 1, 1),
            ],
            "appears twice",
        ),
        (
            [
                (None, None, None, "Head", *YEARS),
                (None, None, "No number", "Tax", 1, 1, 1, 1, 1),
            ],
            "measure number",
        ),
        (
            [
                (None, None, None, "Head", *YEARS),
                (None, 2, "Bad head", "Both", 1, 1, 1, 1, 1),
            ],
            "head",
        ),
        (
            [
                (None, None, None, "Head", *YEARS),
                (None, 2, "Bad figure", "Tax", "n/a", 1, 1, 1, 1),
            ],
            "not a figure",
        ),
        (
            [(None, None, None, "Head", "2026-28", "2027-28", "2028-29")],
            "malformed fiscal year",
        ),
    ],
)
def test_ambiguous_sheets_fail_loudly(rows, message):
    with pytest.raises(ScorecardError, match=message):
        parse_rows(rows)


def test_source_rows_convert_to_billions_with_exchequer_sign():
    rows = source_rows(parse_rows(sheet_rows(MEASURES)), "T41", "Budget")
    fuel_2027 = next(
        r for r in rows if r["row_id"] == "1" and r["fiscal_year"] == "2027-28"
    )
    assert fuel_2027["value_bn"] == "-2.1900"
    assert fuel_2027["basis"] == "post_behavioural"
    assert fuel_2027["sign_convention"] == "exchequer_positive"
    assert len(rows) == len(MEASURES) * len(YEARS)


def test_workbook_round_trip_and_cli(tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "PresentationalScorecardRounded"
    for row in sheet_rows(MEASURES):
        sheet.append(list(row))
    path = tmp_path / "decisions.xlsx"
    workbook.save(path)

    assert len(read_workbook(path).measures) == 3

    out = tmp_path / "sources" / "T41.csv"
    static = tmp_path / "sources" / "T41-static.csv"
    code = main(
        [
            str(path),
            "--source-id",
            "T41",
            "--document",
            "Budget",
            "--out",
            str(out),
            "--static-template",
            str(static),
        ]
    )
    assert code == 0
    written = list(csv.DictReader(out.open()))
    assert len(written) == 15
    blanks = list(csv.DictReader(static.open()))
    assert {r["basis"] for r in blanks} == {"static_costing"}
    assert {r["value_bn"] for r in blanks} == {""}


figures = st.integers(-5000, 5000)


@settings(max_examples=60, deadline=None)
@given(
    table=st.lists(
        st.tuples(
            st.sampled_from(["Tax", "Spend"]),
            st.lists(figures, min_size=5, max_size=5),
        ),
        min_size=1,
        max_size=12,
    ),
    which=st.integers(0, 11),
    year=st.integers(0, 4),
    error=st.integers(-1000, 1000),
)
def test_round_trip_and_any_large_slip_is_caught(table, which, year, error):
    measures = [
        (i + 1, f"Measure {i + 1}", head, values)
        for i, (head, values) in enumerate(table)
    ]
    rows = sheet_rows(measures)
    scorecard = parse_rows(rows)
    check_totals(scorecard)  # exact totals always pass
    for (_, _, _, values), parsed in zip(measures, scorecard.measures):
        assert [parsed.values_m[y] for y in YEARS] == [
            float(v) for v in values
        ]

    # Mis-key one figure after the totals were printed.
    index = which % len(measures)
    rows[3 + index] = tuple(
        value + error if position == 4 + year else value
        for position, value in enumerate(rows[3 + index])
    )
    slipped = parse_rows(rows)
    allowance = ROUNDING_PER_FIGURE_M * (len(measures) + 1)
    if abs(error) > allowance:
        with pytest.raises(TotalsMismatch):
            check_totals(slipped)
