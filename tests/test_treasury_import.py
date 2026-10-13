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


def test_repeated_fiscal_year_columns_are_refused():
    rows = [
        ("", "", "Head", "2026-27", "2026-27", "2028-29"),
        ("1", "A measure", "Tax", 100, 200, 300),
        ("", "Total policy decisions", "", 100, 200, 300),
    ]
    with pytest.raises(ScorecardError, match="repeat: 2026-27"):
        parse_rows(rows)


@pytest.mark.parametrize(
    "bad", ["NaN", "nan", "inf", "-Infinity", float("nan")]
)
def test_non_finite_figures_are_refused(bad):
    with pytest.raises(ScorecardError, match="finite"):
        parse_figure(bad)


@pytest.mark.parametrize(
    "label",
    [
        "Total policy decisions",
        "Total tax policy decisions",
        "Total spending policy decisions",
    ],
)
def test_a_total_printed_twice_is_refused(label):
    """Review round 3: a second total row replaced the first, so a
    contradictory total (999 beside 100) disappeared."""
    rows = sheet_rows([(1, "A measure", "Tax", [100] * 5)])
    rows.insert(-1, (None, None, label, None, *([999] * 5)))
    with pytest.raises(ScorecardError, match="appears twice"):
        parse_rows(rows)


def test_a_measure_with_only_nil_figures_is_kept(tmp_path):
    """Review round 3: a numbered measure whose figures were all blank was
    taken for a heading and left out of both exports."""
    measures = [
        (1, "A measure", "Tax", [100] * 5),
        (2, "A measure with nil figures", "Spend", [None] * 5),
    ]
    scorecard = parse_rows(sheet_rows(measures))
    assert [m.number for m in scorecard.measures] == ["1", "2"]
    nil = scorecard.measures[1]
    assert nil.head == "spend"
    assert set(nil.values_m.values()) == {0.0}
    check_totals(scorecard)
    rows = source_rows(scorecard, "S", "Budget 2026")
    nil_rows = [row for row in rows if row["row_id"] == "2"]
    assert len(rows) == 10 and len(nil_rows) == 5
    assert {row["value_bn"] for row in nil_rows} == {"0.0000"}


@pytest.mark.parametrize("blank_first", [True, False])
def test_a_blank_total_beside_a_printed_one_is_refused(blank_first):
    """Review round 4: a total printed blank was skipped as a blank row, so
    a nil total and a £100m total passed as one £100m total. A total must
    print its figures; a blank one is refused."""
    rows = sheet_rows([(1, "A measure", "Tax", [100] * 5)])
    blank = (None, None, "Total policy decisions", None, *([None] * 5))
    position = next(
        i for i, row in enumerate(rows) if "Total policy decisions" in row
    )
    rows.insert(position if blank_first else position + 1, blank)
    with pytest.raises(ScorecardError, match="does not print every"):
        parse_rows(rows)


def test_a_nil_total_printed_as_dashes_is_a_total():
    rows = sheet_rows([(1, "A measure", "Tax", [100] * 5)], totals=False)
    rows.insert(-1, (None, None, "Total policy decisions", None, *(["-"] * 5)))
    scorecard = parse_rows(rows)
    assert set(scorecard.totals_m[None].values()) == {0.0}
    with pytest.raises(TotalsMismatch):
        check_totals(scorecard)


HEADER = (None, None, None, "Head", "2026-27", "2027-28", "2028-29")
TAX = (None, 1, "Tax measure", "Tax", 100, 100, 100)
SPEND = (None, 2, "Spend measure", "Spend", -100, -100, -100)
GRAND_TOTAL = (None, None, "Total policy decisions", None, 100, 100, 100)


MARK = ("\u00b9", None, "Total policy decisions", None)


@pytest.mark.parametrize(
    "rows, message",
    [
        # Round 5: a heading, then measures that cancel.
        (
            [HEADER, (None, "Total policy decisions", None, None), TAX, SPEND],
            "does not print every",
        ),
        # Round 5: a footnote quoting the total's words beside its text.
        (
            [
                HEADER,
                TAX,
                SPEND,
                ("Total policy decisions", None, "See note 1", None),
            ],
            "beside other text",
        ),
        # Round 6: a heading in the description column before the measures.
        (
            [HEADER, (None, None, "Total policy decisions", None), TAX, SPEND],
            "does not print every",
        ),
        # Round 6: a marked blank total beside a real one, either order.
        ([HEADER, TAX, MARK, GRAND_TOTAL], "does not print every"),
        ([HEADER, TAX, GRAND_TOTAL, MARK], "does not print every"),
    ],
)
def test_a_total_row_that_is_not_plainly_a_total_is_refused(rows, message):
    """Review rounds 5 and 6: headings, notes and blank totals were read as
    nil totals, or skipped, so a sheet with no (or a contradictory)
    printed total passed. Each is now refused for a person to check."""
    with pytest.raises(ScorecardError, match=message):
        parse_rows(rows)


def test_a_total_with_a_footnote_marker_is_read():
    """A marker beside a total's label does not hide the total."""
    rows = [HEADER, TAX, (*MARK, 100, 100, 100)]
    assert check_totals(parse_rows(rows))
    rows = [HEADER, TAX, (*MARK, 100, 100, 100), GRAND_TOTAL]
    with pytest.raises(ScorecardError, match="appears twice"):
        parse_rows(rows)


@pytest.mark.parametrize(
    "rows, message",
    [
        # Round 7: one printed dash, the other years blank.
        (
            [
                HEADER,
                TAX,
                SPEND,
                (None, None, "Total policy decisions", None, "-", None, None),
            ],
            "does not print every",
        ),
        # Round 7: a note in the Head column of a total.
        (
            [
                HEADER,
                TAX,
                SPEND,
                (None, None, "Total policy decisions", "See note 1", 0, 0, 0),
            ],
            "Head column",
        ),
        # Round 7: a second total label in the Head column.
        (
            [
                HEADER,
                TAX,
                (
                    None,
                    None,
                    "Total policy decisions",
                    "Total policy decisions",
                    100,
                    100,
                    100,
                ),
            ],
            "Head column",
        ),
        # Round 7: a subtotal with an inline marker, numbered like a measure.
        (
            [
                HEADER,
                TAX,
                (None, 1, "Total tax policy decisions\u00b9", "Tax", 0, 0, 0),
                GRAND_TOTAL,
            ],
            "Head column",
        ),
        # Round 7: a contradictory total above the header.
        (
            [
                (None, None, "Total policy decisions", None, 999, 999, 999),
                HEADER,
                TAX,
                GRAND_TOTAL,
            ],
            "above the header",
        ),
        # An unrecognised total is refused, not taken for a measure.
        (
            [
                HEADER,
                TAX,
                (
                    None,
                    None,
                    "Total policy decisions excluding X",
                    None,
                    100,
                    100,
                    100,
                ),
            ],
            "unrecognised total",
        ),
    ],
)
def test_more_ambiguous_total_rows_are_refused(rows, message):
    with pytest.raises(ScorecardError, match=message):
        parse_rows(rows)


@pytest.mark.parametrize("inline", ["\u00b9", "1", "*"])
def test_an_inline_marker_does_not_hide_a_total(inline):
    """Round 7: 'Total policy decisions¹' was not read as a total, so a
    blank one vanished beside a real one."""
    marked = (
        None,
        None,
        f"Total policy decisions{inline}",
        None,
        100,
        100,
        100,
    )
    with pytest.raises(ScorecardError, match="appears twice"):
        parse_rows([HEADER, TAX, marked, GRAND_TOTAL])
    assert check_totals(parse_rows([HEADER, TAX, marked]))


def test_a_year_printed_with_an_en_dash_is_read():
    """Round 7: a 2029\u201330 column was not recognised, so its contradictory
    total was never checked."""
    rows = [
        (*HEADER, "2029\u201330"),
        (*TAX, 100),
        (*GRAND_TOTAL, 999),
    ]
    scorecard = parse_rows(rows)
    assert scorecard.fiscal_years[-1] == "2029-30"
    with pytest.raises(TotalsMismatch, match="2029-30"):
        check_totals(scorecard)


def test_figures_outside_the_year_columns_are_refused():
    rows = [HEADER, (*TAX, 100), GRAND_TOTAL]
    with pytest.raises(ScorecardError, match="outside the fiscal-year"):
        parse_rows(rows)


@pytest.mark.parametrize(
    "label",
    [
        "Total tax policy decisions 1",
        "Total tax policy decisions (a)",
        "Total tax policy decisions (1)",
    ],
)
def test_a_numbered_subtotal_with_any_marker_is_not_a_measure(label):
    """Round 8: an unfamiliar marker on a numbered, Tax-headed subtotal made
    it a nil measure, so its contradictory subtotal was never checked."""
    with pytest.raises(ScorecardError):
        parse_rows(
            [HEADER, TAX, (None, 1, label, "Tax", 0, 0, 0), GRAND_TOTAL]
        )


def test_a_head_column_after_the_years_is_refused():
    """Round 8: with Head after the years, figures fell among the labels."""
    header = (None, None, None, "2026-27", "2027-28", "2028-29", "Head")
    with pytest.raises(ScorecardError, match="before the fiscal years"):
        parse_rows([header, (None, 7, "Tax measure", 100, 100, 100, "Tax")])


def test_any_total_like_label_above_the_header_is_refused():
    rows = [
        (None, None, "Total policy decisions (\u00a3m)", None, 999, 999, 999),
        HEADER,
        TAX,
        GRAND_TOTAL,
    ]
    with pytest.raises(ScorecardError, match="above the header"):
        parse_rows(rows)
