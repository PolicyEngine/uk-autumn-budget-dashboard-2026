"""Tests for scripts/map_check.py, the before/after map check.

Synthetic tables only: tests/fixtures/map_check holds an old and a new
``public/data`` folder for six made-up seats and three made-up measures.
The expected counts and means below were worked out by hand from those
rows, not read back from the script.
"""

import csv
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "map_check.py"
FIXTURES = REPO / "tests" / "fixtures" / "map_check"
OLD, NEW = FIXTURES / "old", FIXTURES / "new"
HOUSEHOLDS = FIXTURES / "households.csv"
CASES = (
    REPO / "src" / "test" / "fixtures" / "geography" / "classify_cases.json"
)
CLASSIFY_JS = REPO / "src" / "utils" / "geography" / "classify.js"

spec = importlib.util.spec_from_file_location("map_check", SCRIPT)
map_check = importlib.util.module_from_spec(spec)
sys.modules["map_check"] = map_check
spec.loader.exec_module(map_check)

ALPHA, BETA, GAMMA = "alpha_rates_up", "beta_payment", "gamma_new_measure"
AVERAGE, RELATIVE = "average_change", "relative_change"
SEAT = {letter: f"T1400000{n}" for n, letter in enumerate("ABCDEF", start=1)}


def load(folder: Path):
    return map_check.load_table(
        (folder / "constituency.csv").read_bytes(), folder.name
    )


def compared(**options):
    return map_check.compare(load(OLD), load(NEW), **options)


def one(comparisons, reform, year, outcome=AVERAGE):
    return next(
        c
        for c in comparisons
        if (c.reform, c.year, c.outcome) == (reform, year, outcome)
    )


def moves_of(comparison):
    return {move.area_name[-1]: move for move in comparison.moves}


# -- what changed -------------------------------------------------------------


def test_it_counts_figures_moves_and_withheld_cells():
    c = one(compared(), ALPHA, 2029)
    # Old: D withheld. New: E withheld. A, B, C and F have a figure in both.
    assert (c.published_old, c.published_new) == (5, 5)
    assert (c.withheld_old, c.withheld_new) == (1, 1)
    assert sorted(m.area_name for m in c.both) == [
        "Seat A",
        "Seat B",
        "Seat C",
        "Seat F",
    ]
    # B moves from -9 to -11 and C from -20 to -30; A and F stay.
    assert c.moved == 2
    assert c.median_move == Decimal("1")
    assert c.largest_move == Decimal("10")
    moves = moves_of(c)
    assert moves["B"].change == Decimal("-2")
    assert moves["C"].change == Decimal("-10")
    assert moves["D"].change is None
    assert moves["E"].change is None


def test_it_flags_a_new_figure_outside_the_old_interval():
    c = one(compared(), ALPHA, 2029)
    moves = moves_of(c)
    # C's new -30 is outside the old -25 to -15; B's new -11 is inside
    # the old -12 to -6.
    assert moves["C"].outside_old_interval
    assert not moves["B"].outside_old_interval
    # A cell with no figure on one side is never "outside".
    assert not moves["D"].outside_old_interval
    assert not moves["E"].outside_old_interval
    assert c.outside == 1


def test_it_reports_each_colour_change_on_the_map():
    c = one(compared(), ALPHA, 2029)
    assert c.colour_changes == 3
    assert dict(c.colour_transitions) == {
        ("little_change", "small_loss"): 1,  # B
        ("not_published", "small_loss"): 1,  # D gains a figure
        ("small_loss", "not_published"): 1,  # E loses its figure
    }
    moves = moves_of(c)
    # F is too uncertain to classify in both, so its colour does not change.
    assert moves["F"].shown_old == moves["F"].shown_new == "too_uncertain"
    assert not moves["F"].colour_changed
    # C moves outside its old interval but stays a small loss.
    assert not moves["C"].colour_changed
    assert one(compared(), ALPHA, 2030).colour_changes == 0


def test_a_measure_only_in_the_new_table_has_no_old_rows():
    c = one(compared(), GAMMA, 2029)
    assert (c.published_old, c.published_new) == (0, 6)
    assert c.both == []
    assert c.median_move is None and c.largest_move is None
    assert dict(c.colour_transitions) == {("absent", "little_change"): 6}
    assert c.mean_old is None
    assert c.mean_new == Decimal("3")


def test_a_year_of_zeros_in_both_tables_is_silent():
    assert one(compared(), BETA, 2029).silent
    assert not one(compared(), ALPHA, 2029).silent
    assert not one(compared(), GAMMA, 2029).silent


def test_the_relative_change_rows_compare_in_their_own_units():
    c = one(compared(), ALPHA, 2029, RELATIVE)
    moves = moves_of(c)
    assert moves["B"].change == Decimal("-0.0002")
    # -0.0009 is under 0.1% of income; -0.0011 is a small loss.
    assert (moves["B"].shown_old, moves["B"].shown_new) == (
        "little_change",
        "small_loss",
    )
    assert map_check.figure(RELATIVE, moves["B"].new.value, 4) == "-0.11%"


# -- the map against the national figure --------------------------------------


def test_the_means_are_simple_means_of_the_published_figures():
    c = one(compared(), ALPHA, 2029)
    # Old: (-14 - 9 - 20 - 40 + 5) / 5. New: (-14 - 11 - 30 - 12 + 5) / 5.
    assert c.mean_old == Decimal("-15.6")
    assert c.mean_new == Decimal("-12.4")
    # A, B, C, F: (-14 - 9 - 20 + 5) / 4, then (-14 - 11 - 30 + 5) / 4.
    assert c.mean_old_both == Decimal("-9.5")
    assert c.mean_new_both == Decimal("-12.5")


def test_the_map_is_set_against_the_national_averages_move():
    c = one(compared(), ALPHA, 2029)
    old = map_check.load_national(map_check.DirectorySource(OLD))
    new = map_check.load_national(map_check.DirectorySource(NEW))
    before, after = old.averages[(ALPHA, 2029)], new.averages[(ALPHA, 2029)]
    assert (before, after) == (Decimal("-10.0"), Decimal("-11.0"))
    drift = map_check.map_against_national(c, before, after)
    # The seats in both moved by 12.5 / 9.5; the national figure by 11 / 10.
    assert float(drift) == pytest.approx(
        float(Fraction(125, 95) / Fraction(11, 10) - 1)
    )
    assert map_check.percent(drift) == "+19.6%"
    # No national figure, no comparison.
    assert map_check.map_against_national(c, before, None) is None
    assert map_check.map_against_national(c, Decimal(0), after) is None


def test_the_national_average_comes_from_the_artifact_the_area_run_bound():
    old = map_check.load_national(map_check.DirectorySource(OLD))
    # area_provenance.json names aaaa0001; the manifest's stale path has no
    # file, and the provenance wins.
    assert old.averages[(ALPHA, 2029)] == Decimal("-10.0")
    assert old.averages[(ALPHA, 2030)] == Decimal("-10.5")
    # beta_payment is in the manifest only.
    assert old.averages[(BETA, 2029)] == Decimal("0.0")
    assert old.names == {ALPHA: "Alpha rates up", BETA: "Beta payment"}
    new = map_check.load_national(map_check.DirectorySource(NEW))
    # A blank cell is a withheld national figure.
    assert new.averages[(ALPHA, 2030)] is None
    assert new.averages[(GAMMA, 2029)] == Decimal("2.5")


def test_a_folder_with_no_usable_manifest_gives_no_national_figures(tmp_path):
    shutil.copy(NEW / "constituency.csv", tmp_path / "constituency.csv")
    empty = map_check.load_national(map_check.DirectorySource(tmp_path))
    assert (empty.names, empty.averages, empty.order) == ({}, {}, [])
    (tmp_path / "manifest.json").write_text('{"measures": ["alpha"]}')
    (tmp_path / "area_provenance.json").write_text('{"reforms": null}')
    odd = map_check.load_national(map_check.DirectorySource(tmp_path))
    assert (odd.names, odd.averages, odd.order) == ({}, {}, [])
    (tmp_path / "manifest.json").write_text("not json")
    with pytest.raises(map_check.MapCheckError, match="is not JSON"):
        map_check.load_national(map_check.DirectorySource(tmp_path))


def test_a_households_file_weights_the_means():
    weights = map_check.load_households(HOUSEHOLDS)
    c = one(compared(weights=weights), ALPHA, 2029)
    counts = {"A": 40000, "B": 45000, "C": 50000, "F": 42000}
    old = {"A": -14, "B": -9, "C": -20, "F": 5}
    new = {"A": -14, "B": -11, "C": -30, "F": 5}
    total = sum(counts.values())
    assert float(c.mean_old_both) == pytest.approx(
        float(Fraction(sum(counts[s] * old[s] for s in counts), total))
    )
    assert float(c.mean_new_both) == pytest.approx(
        float(Fraction(sum(counts[s] * new[s] for s in counts), total))
    )
    # Heavier seats count for more: the weighted mean is not the simple one.
    assert c.mean_old_both != Decimal("-9.5")


def test_a_seat_with_no_household_count_is_refused():
    weights = map_check.load_households(HOUSEHOLDS)
    del weights[SEAT["C"]]
    with pytest.raises(map_check.MapCheckError, match="no count for"):
        compared(weights=weights)


# -- the colour rule is the page's --------------------------------------------


def case_row(case):
    def number(text):
        return Decimal(text) if text != "" else None

    return map_check.Row(
        level="constituency",
        area_code="T14000001",
        area_name="Seat A",
        reform=ALPHA,
        year=2029,
        outcome=case["outcome"],
        tier=case["tier"],
        value=number(case["value"]),
        lo=number(case["lo"]),
        hi=number(case["hi"]),
    )


def test_the_colour_rule_gives_the_pages_answers():
    """The same cases as src/utils/geography/classifyCases.test.js."""
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 20
    for case in cases:
        assert map_check.classify(case_row(case)) == case["expected"], case


def test_the_breaks_and_categories_equal_the_pages():
    source = CLASSIFY_JS.read_text(encoding="utf-8")
    breaks = {
        outcome: (Decimal(small), Decimal(large))
        for outcome, small, large in re.findall(
            r'(\w+): Object\.freeze\(\{ small: "([\d.]+)", '
            r'large: "([\d.]+)" \}\)',
            source,
        )
    }
    assert breaks == map_check.CATEGORY_BREAKS
    block = re.search(
        r"export const CATEGORIES = Object\.freeze\(\[(.*?)\]\)", source, re.S
    )
    assert tuple(re.findall(r'"(\w+)"', block.group(1))) == (
        map_check.CATEGORIES
    )
    assert 'TOO_UNCERTAIN = "too_uncertain"' in source
    assert map_check.TOO_UNCERTAIN == "too_uncertain"


# -- what it refuses ----------------------------------------------------------

HEADER = (
    "level,area_code,area_name,reform,year,outcome,value,lo,hi,direction,"
    "tier,reason,support_band,noise,estimator"
)
GOOD = (
    "constituency,T14000001,Seat A,alpha_rates_up,2029,average_change,"
    "-14.0,-22.0,-7.0,loss,reported,,30+,False,direct"
)


def test_it_refuses_a_table_with_private_audit_columns():
    table = f"{HEADER},exact_value,n_sources\n{GOOD},-14.2,31\n"
    with pytest.raises(map_check.MapCheckError) as refused:
        map_check.load_table(table.encode(), "audit")
    message = str(refused.value)
    assert "private-audit columns ['exact_value', 'n_sources']" in message
    # The refusal names columns only, never a figure.
    assert "14.2" not in message and "31" not in message


@pytest.mark.parametrize(
    "text, problem",
    [
        (f"{HEADER}\n", "has no rows"),
        (f"{HEADER.replace(',tier', '')}\n", "lacks the columns"),
        (f"{HEADER}\n{GOOD}\n{GOOD}\n", "repeats an earlier one"),
        (
            f"{HEADER}\n{GOOD.replace('reported', 'withheld')}\n",
            "a withheld row has a figure",
        ),
        (f"{HEADER}\n{GOOD.replace('-14.0', 'n/a')}\n", "is not a number"),
        (f"{HEADER}\n{GOOD.replace('-14.0', 'nan')}\n", "is not finite"),
        (f"{HEADER}\n{GOOD.replace('-14.0', '')}\n", "is not a number"),
        (
            f"{HEADER}\n{GOOD.replace('average_change', 'total_change')}\n",
            "unknown outcome",
        ),
        (f"{HEADER}\n{GOOD.replace('2029', 'soon')}\n", "year is not"),
    ],
)
def test_it_refuses_a_malformed_table(text, problem):
    with pytest.raises(map_check.MapCheckError, match=problem):
        map_check.load_table(text.encode(), "table")


# -- the command, end to end --------------------------------------------------


def test_the_report_and_details_from_two_folders(tmp_path, capsys):
    report, details = tmp_path / "report.md", tmp_path / "details.csv"
    status = map_check.main(
        [
            "--old-dir",
            str(OLD),
            "--new-dir",
            str(NEW),
            "--report",
            str(report),
            "--details",
            str(details),
        ]
    )
    assert status == 0
    text = report.read_text(encoding="utf-8")
    assert text.startswith("# Before/after map check\n")
    assert (
        "| Alpha rates up | 2029-30 | 5 → 5 | 1 → 1 | 2 of 4 | 1 | 3 | £1 "
        "| £10 |" in text
    )
    assert (
        "| Alpha rates up | 2030-31 | 5 → 5 | 1 → 1 | 3 of 5 | 1 | 0 | £1 "
        "| £12 |" in text
    )
    assert (
        "| Alpha rates up | 2029-30 | -£10 → -£11 | -£15.6 → -£12.4 | 4 | "
        "-£9.5 → -£12.5 | +10% | +31.6% | +19.6% |" in text
    )
    # The national figure for 2030-31 is withheld in the new tables.
    assert (
        "| Alpha rates up | 2030-31 | -£10.5 → n/a | -£16.2 → -£19.4 | 5 | "
        "-£16.2 → -£19.4 | n/a | +19.8% | n/a |" in text
    )
    assert "| little change → small loss | 1 |" in text
    assert "| no row → little change | 6 |" in text
    # Measures keep the new manifest's order: alpha before gamma.
    assert text.index("| Alpha rates up | 2029-30") < text.index(
        "| Gamma new measure | 2029-30"
    )
    # The year of zeros is named once and has no row.
    assert "every constituency reads zero in both tables (Beta payment)" in (
        text
    )
    assert "| Beta payment |" not in text
    # The movers: each seat at the year of its largest move, largest first.
    movers = text[text.index("## Constituencies that move most") :]
    order = [movers.index(f"| Seat {seat} |") for seat in "CEBA"]
    assert order == sorted(order)
    assert (
        "| Seat B | 2029-30 | -£9 (-£12 to -£6) | -£11 (-£14 to -£8) | -£2 "
        "| little change → small loss |" in movers
    )
    assert "Seat F" not in movers and "Seat D" not in movers

    with open(details, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    # Six seats in each of five groups (alpha 2029 twice, alpha 2030,
    # beta 2029, gamma 2029).
    assert len(rows) == 30
    assert tuple(rows[0]) == map_check.DETAIL_COLUMNS
    row = next(
        r
        for r in rows
        if (r["area_code"], r["reform"], r["year"], r["outcome"])
        == (SEAT["C"], ALPHA, "2029", AVERAGE)
    )
    assert (row["old_value"], row["new_value"], row["change"]) == (
        "-20.0",
        "-30.0",
        "-10.0",
    )
    assert row["new_outside_old_interval"] == "true"
    assert row["colour_changed"] == "false"
    assert capsys.readouterr().out == ""


def test_the_report_prints_when_no_file_is_named(capsys):
    assert map_check.main(["--old-dir", str(OLD), "--new-dir", str(NEW)]) == 0
    assert capsys.readouterr().out.startswith("# Before/after map check\n")


def test_filters_keep_the_named_measures_and_years(capsys):
    arguments = ["--old-dir", str(OLD), "--new-dir", str(NEW)]
    assert map_check.main([*arguments, "--years", "2030"]) == 0
    text = capsys.readouterr().out
    assert "| Alpha rates up | 2030-31 |" in text
    assert "2029-30" not in text
    assert map_check.main([*arguments, "--reforms", "no_such_measure"]) == 2
    assert "no rows match" in capsys.readouterr().err


def test_the_relative_change_report_has_no_national_section(capsys):
    arguments = ["--old-dir", str(OLD), "--new-dir", str(NEW)]
    assert map_check.main([*arguments, "--outcome", RELATIVE]) == 0
    text = capsys.readouterr().out
    assert "## The map against the national figure" not in text
    assert "| Seat B | 2029-30 | -0.09% (-0.12% to -0.06%) |" in text


def test_a_missing_table_stops_with_a_message(tmp_path, capsys):
    status = map_check.main(
        ["--old-dir", str(tmp_path), "--new-dir", str(NEW)]
    )
    assert status == 2
    assert "has no constituency.csv" in capsys.readouterr().err


def git(repo: Path, *arguments: str) -> str:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("GIT_")
    }
    return subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Map check tests",
            "-c",
            "user.email=map-check@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.hooksPath=/dev/null",
            *arguments,
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    ).stdout.strip()


def test_the_old_table_can_come_from_a_git_ref(tmp_path, capsys):
    """As at an adoption: the published table is on a ref, the regenerated
    one in the checkout."""
    repo = tmp_path / "repo"
    shutil.copytree(OLD, repo / "public" / "data")
    git(repo, "init", "--quiet")
    git(repo, "add", "-A")
    git(repo, "commit", "--quiet", "-m", "Published tables")
    shutil.rmtree(repo / "public" / "data")
    shutil.copytree(NEW, repo / "public" / "data")
    status = map_check.main(["--repo", str(repo), "--old-ref", "HEAD"])
    assert status == 0
    text = capsys.readouterr().out
    head = git(repo, "rev-parse", "--short=8", "HEAD")
    assert f"- Old table: `HEAD:public/data` at `{head}` (sha256 `" in text
    # The checkout's folder is named from the repository root, not by the
    # path of the machine the check ran on.
    assert "- New table: `public/data in the checkout` (sha256 `" in text
    assert str(tmp_path) not in text
    assert (
        "| Alpha rates up | 2029-30 | -£10 → -£11 | -£15.6 → -£12.4 | 4 | "
        "-£9.5 → -£12.5 | +10% | +31.6% | +19.6% |" in text
    )
    # A ref with no table stops the check.
    assert (
        map_check.main(["--repo", str(repo), "--old-ref", "no-such-ref"]) == 2
    )
    assert "has no constituency.csv" in capsys.readouterr().err


def test_the_private_audits_uk_rows_go_to_the_terminal_only(tmp_path, capsys):
    audit = tmp_path / "disclosure_audit.csv"
    audit.write_text(
        "level,area_code,reform,year,outcome,family,exact_value,n_sources\n"
        "national,UK,alpha_rates_up,2029,average_change,change,-11.726,987654\n"
        "national,UK,alpha_rates_up,2029,total_change,change,-333444555,987654\n"
        "national,UK,alpha_rates_up,2030,average_change,change,-12.5,987654\n"
        f"constituency,{SEAT['A']},alpha_rates_up,2029,average_change,"
        "change,-14.4321,31\n",
        encoding="utf-8",
    )
    report = tmp_path / "report.md"
    status = map_check.main(
        [
            "--old-dir",
            str(OLD),
            "--new-dir",
            str(NEW),
            "--report",
            str(report),
            "--local-uk-audit",
            str(audit),
        ]
    )
    assert status == 0
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "not part of the report" in captured.err
    # 11.726 / 11 - 1 = 6.6%; the withheld 2030-31 national figure has no
    # line.
    assert (
        "Alpha rates up, 2029-30: local -£11.73, national -£11, local "
        "against national +6.6%" in captured.err
    )
    assert "2030-31" not in captured.err
    # No area row and no count is read or printed, and the report holds
    # nothing from the audit.
    for private in ("14.4321", "333444555", "987654"):
        assert private not in captured.err
    text = report.read_text(encoding="utf-8")
    for private in ("11.73", "11.726", "private audit", "14.4321"):
        assert private not in text


def test_a_file_that_is_not_an_audit_is_refused(tmp_path, capsys):
    status = map_check.main(
        [
            "--old-dir",
            str(OLD),
            "--new-dir",
            str(NEW),
            "--local-uk-audit",
            str(NEW / "constituency.csv"),
        ]
    )
    assert status == 2
    assert "is not a disclosure audit" in capsys.readouterr().err


# -- properties ---------------------------------------------------------------

tenths = st.integers(-3000, 3000).map(lambda n: Decimal(n) / 10)


@st.composite
def cells(draw):
    """A public cell: a figure inside its interval, or None for withheld."""
    if draw(st.integers(0, 4)) == 0:
        return None
    value = draw(tenths)
    below = draw(st.integers(0, 800)) / Decimal(10)
    above = draw(st.integers(0, 800)) / Decimal(10)
    return value - below, value, value + above


@st.composite
def tables(draw, seats=("S1", "S2", "S3", "S4", "S5")):
    """One group's rows by seat; a seat may be missing from the table."""
    table = {}
    for seat in seats:
        if draw(st.integers(0, 9)) == 0:
            continue
        cell = draw(cells())
        table[seat] = map_check.Row(
            level="constituency",
            area_code=seat,
            area_name=seat,
            reform=ALPHA,
            year=2029,
            outcome=AVERAGE,
            tier="withheld" if cell is None else "reported",
            value=None if cell is None else cell[1],
            lo=None if cell is None else cell[0],
            hi=None if cell is None else cell[2],
        )
    return {("constituency", ALPHA, 2029, AVERAGE): table}


@given(tables())
@settings(max_examples=200, deadline=None)
def test_a_table_against_itself_shows_no_change(table):
    (c,) = map_check.compare(table, table)
    assert c.moved == 0 and c.outside == 0 and c.colour_changes == 0
    assert c.published_old == c.published_new
    assert c.withheld_old == c.withheld_new
    assert c.mean_old == c.mean_new == c.mean_old_both == c.mean_new_both
    national = Decimal("-7.5")
    drift = map_check.map_against_national(c, national, national)
    assert drift is None or drift == 0


@given(tables(), tables())
@settings(max_examples=200, deadline=None)
def test_swapping_old_and_new_reverses_every_move(old, new):
    (forward,) = map_check.compare(old, new)
    (backward,) = map_check.compare(new, old)
    there = {m.area_code: m for m in forward.moves}
    back = {m.area_code: m for m in backward.moves}
    assert there.keys() == back.keys()
    for seat, move in there.items():
        assert move.both_published == back[seat].both_published
        if move.both_published:
            assert move.change == -back[seat].change
        assert (move.shown_old, move.shown_new) == (
            back[seat].shown_new,
            back[seat].shown_old,
        )
    assert forward.moved == backward.moved
    assert forward.colour_changes == backward.colour_changes
    assert forward.median_move == backward.median_move
    assert (forward.published_old, forward.withheld_old) == (
        backward.published_new,
        backward.withheld_new,
    )


@given(tables(), tables())
@settings(max_examples=200, deadline=None)
def test_the_counts_add_up_to_the_seats(old, new):
    (c,) = map_check.compare(old, new)
    group = ("constituency", ALPHA, 2029, AVERAGE)
    assert len(c.moves) == len(set(old[group]) | set(new[group]))
    assert c.published_old + c.withheld_old == len(old[group])
    assert c.published_new + c.withheld_new == len(new[group])
    assert c.moved <= len(c.both) <= min(c.published_old, c.published_new)
    assert c.outside <= c.moved
    assert sum(c.colour_transitions.values()) == c.colour_changes
    if c.both:
        assert 0 <= c.median_move <= c.largest_move
        low = min(m.old.value for m in c.both)
        high = max(m.old.value for m in c.both)
        assert low <= c.mean_old_both <= high


@given(tenths, tenths)
def test_a_larger_figure_never_gets_a_lower_category(a, b):
    low, high = sorted((a, b))
    for outcome in map_check.OUTCOMES:
        scale = Decimal("0.0001") if outcome == RELATIVE else Decimal(1)
        assert map_check.category_index(
            outcome, low * scale
        ) <= map_check.category_index(outcome, high * scale)


@given(cells().filter(lambda cell: cell is not None))
def test_a_rows_category_lies_between_its_intervals_ends(cell):
    lo, value, hi = cell
    row = map_check.Row(
        "constituency", "S1", "S1", ALPHA, 2029, AVERAGE, "reported", value,
        lo, hi,
    )  # fmt: skip
    category = map_check.classify(row)
    low = map_check.category_index(AVERAGE, lo)
    high = map_check.category_index(AVERAGE, hi)
    if high - low > 1:
        assert category == map_check.TOO_UNCERTAIN
    else:
        assert low <= map_check.CATEGORIES.index(category) <= high


@given(tenths)
def test_a_figure_and_its_negative_mirror_each_other(value):
    index = map_check.category_index(AVERAGE, value)
    assert map_check.category_index(AVERAGE, -value) == 4 - index
