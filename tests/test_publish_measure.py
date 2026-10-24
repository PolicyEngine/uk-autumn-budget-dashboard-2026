"""publish-measure and refresh-combined, without a simulation (#105).

The upsert must leave every other measure's bytes alone and be idempotent;
review rows go pending, never signed, until the Reconciler signs; "live" is
what budgetary_impact.csv publishes; the combined run names its members.
"""

import csv
import hashlib
import io

import pandas as pd
import pytest

from uk_budget_data import publish_measure as pm
from uk_budget_data.pipeline import with_members_column
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
)

ORDER = ["autumn_budget_2026_combined", "alpha", "beta", "gamma"]

BUDGET = (
    "reform_id,reform_name,year,value\n"
    "autumn_budget_2026_combined,Combined,2026,-3.4038755822481286\n"
    "autumn_budget_2026_combined,Combined,2027,-1.6493821385719603\n"
    "alpha,Alpha,2026,0.1\n"
    "alpha,Alpha,2027,0.30000000000000004\n"
    'gamma,"Gamma, with a comma",2026,-2.5\n'
    'gamma,"Gamma, with a comma",2027,-2.25\n'
)


def rows(reform_id, name, values):
    return [
        {
            "reform_id": reform_id,
            "reform_name": name,
            "year": str(year),
            "value": value,
        }
        for year, value in values.items()
    ]


def lines_of(text, reform_id):
    return [line for line in text.splitlines() if line.startswith(reform_id)]


# ---------------------------------------------------------------------------
# The upsert
# ---------------------------------------------------------------------------


def test_upsert_replaces_only_that_measures_rows_for_those_years():
    new = pm.upsert_text(
        BUDGET, "alpha", [2027], rows("alpha", "Alpha", {2027: "9.5"}), ORDER
    )
    assert lines_of(new, "alpha") == [
        "alpha,Alpha,2026,0.1",
        "alpha,Alpha,2027,9.5",
    ]
    for other in ("autumn_budget_2026_combined", "gamma"):
        assert lines_of(new, other) == lines_of(BUDGET, other)
    assert new.splitlines()[0] == BUDGET.splitlines()[0]


def test_upsert_is_idempotent():
    update = rows("alpha", "Alpha", {2026: "1.0", 2027: "2.0"})
    once = pm.upsert_text(BUDGET, "alpha", [2026, 2027], update, ORDER)
    twice = pm.upsert_text(once, "alpha", [2026, 2027], update, ORDER)
    assert once == twice


def test_upserting_the_same_rows_changes_no_byte():
    same = list(csv.DictReader(io.StringIO(BUDGET)))
    same = [row for row in same if row["reform_id"] == "gamma"]
    assert pm.upsert_text(BUDGET, "gamma", [2026, 2027], same, ORDER) == BUDGET


def test_a_new_measure_goes_in_registry_order():
    new = pm.upsert_text(
        BUDGET,
        "beta",
        [2026, 2027],
        rows("beta", "Beta", {2026: "1", 2027: "2"}),
        ORDER,
    )
    ids = [line.split(",")[0] for line in new.splitlines()[1:]]
    assert ids == [
        "autumn_budget_2026_combined",
        "autumn_budget_2026_combined",
        "alpha",
        "alpha",
        "beta",
        "beta",
        "gamma",
        "gamma",
    ]


def test_a_measure_not_in_the_registry_order_goes_last():
    new = pm.upsert_text(
        BUDGET, "zeta", [2026], rows("zeta", "Zeta", {2026: "1"}), ORDER
    )
    assert new.splitlines()[-1] == "zeta,Zeta,2026,1"


def test_one_year_rerun_keeps_the_blocks_year_order():
    new = pm.upsert_text(
        BUDGET, "gamma", [2026], rows("gamma", "G", {2026: "7"}), ORDER
    )
    assert lines_of(new, "gamma") == [
        "gamma,G,2026,7",
        'gamma,"Gamma, with a comma",2027,-2.25',
    ]


def test_upsert_fills_metadata_columns_the_file_has():
    text = "reform_id,reform_name,year,value,reform_members\n" + (
        "alpha,Alpha,2026,1,\n"
    )
    new = pm.upsert_text(
        text,
        "autumn_budget_2026_combined",
        [2026],
        rows("autumn_budget_2026_combined", "C", {2026: "2"}),
        ORDER,
        fill={"reform_members": "alpha+beta"},
    )
    assert (
        new.splitlines()[1]
        == "autumn_budget_2026_combined,C,2026,2,alpha+beta"
    )


def test_upsert_refuses_rows_that_do_not_fit_the_file():
    with pytest.raises(pm.PublishMeasureError, match="columns"):
        pm.upsert_text(
            BUDGET,
            "alpha",
            [2026],
            [{"reform_id": "alpha", "reform_name": "A", "year": "2026"}],
            ORDER,
        )


def test_upsert_writes_a_new_file_with_the_rows_header():
    new = pm.upsert_text(
        "", "alpha", [2026], rows("alpha", "Alpha", {2026: "1"}), ORDER
    )
    assert new == "reform_id,reform_name,year,value\nalpha,Alpha,2026,1\n"


def test_upserted_lines_match_what_pandas_writes():
    frame = pd.DataFrame(
        [
            {
                "reform_id": "alpha",
                "reform_name": "A, b",
                "year": 2026,
                "value": 0.1 + 0.2,
            },
        ]
    )
    expected = frame.to_csv(index=False)
    fresh = pm._frame_rows(frame.to_dict("records"))
    assert pm.upsert_text("", "alpha", [2026], fresh, ORDER) == expected


# ---------------------------------------------------------------------------
# Live measures and the combined run's members
# ---------------------------------------------------------------------------


def test_live_measures_are_the_singles_in_budgetary_impact(tmp_path):
    (tmp_path / pm.BUDGETARY).write_text(BUDGET)
    assert pm.live_measure_ids(tmp_path) == ["alpha", "gamma"]
    assert pm.live_measure_ids(tmp_path / "missing") == []


def test_combined_members_come_from_the_members_column(tmp_path):
    (tmp_path / pm.BUDGETARY).write_text(BUDGET)
    assert pm.combined_members(tmp_path, ORDER[0]) is None
    (tmp_path / pm.BUDGETARY).write_text(
        "reform_id,reform_name,year,value,reform_members\n"
        "autumn_budget_2026_combined,C,2026,1,alpha+gamma\n"
        "alpha,A,2026,1,\n"
    )
    assert pm.combined_members(tmp_path, ORDER[0]) == ["alpha", "gamma"]


def test_a_full_run_names_the_combined_runs_members():
    frame = pd.DataFrame(
        [
            {"reform_id": AUTUMN_BUDGET_2026_COMBINED_ID, "value": 1.0},
            {"reform_id": "two_child_limit", "value": 2.0},
        ]
    )
    named = with_members_column(frame)
    assert named["reform_members"].tolist() == [
        "+".join(sorted(AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)),
        "",
    ]


# ---------------------------------------------------------------------------
# Applying fragments: review rows pending, the summary, signing
# ---------------------------------------------------------------------------

REVIEW_HEADER = "path,kind,sha256,reviewer,reviewed_on,expires_on,basis\n"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def repo(tmp_path):
    data = tmp_path / "public" / "data"
    data.mkdir(parents=True)
    (data / pm.BUDGETARY).write_text(BUDGET)
    (data / pm.DISTRIBUTIONAL).write_text(
        "reform_id,reform_name,year,decile,value\n"
        "alpha,Alpha,2029,1st,0.5\n"
        "alpha,Alpha,2029,2nd,0.25\n"
    )
    other = tmp_path / "public" / "other.png"
    other.write_bytes(b"png")
    review = tmp_path / "data_inputs"
    review.mkdir()
    lines = [REVIEW_HEADER]
    for path in sorted(
        ["public/other.png"]
        + [f"public/data/{name}" for name in (pm.BUDGETARY, pm.DISTRIBUTIONAL)]
    ):
        kind = "static_asset" if path.endswith(".png") else "national_table"
        digest = sha((tmp_path / path).read_bytes())
        lines.append(
            f'{path},{kind},{digest},vahid-ahmadi,2026-10-24,,"Basis, {path}"\n'
        )
    (review / "public_data_review.csv").write_text("".join(lines))
    return tmp_path


def fragment(values, deciles=None, reform_id="alpha"):
    tables = {name: [] for name in pm.MEASURE_TABLES}
    tables[pm.BUDGETARY] = rows(reform_id, "Alpha", values)
    tables[pm.DISTRIBUTIONAL] = [
        {
            "reform_id": reform_id,
            "reform_name": "Alpha",
            "year": "2029",
            "decile": decile,
            "value": value,
        }
        for decile, value in (deciles or {}).items()
    ]
    return pm.Fragment(
        reform_id=reform_id,
        reform_name="Alpha",
        years=sorted(values),
        tables=tables,
    )


def review_rows(root):
    with (root / "data_inputs" / "public_data_review.csv").open() as handle:
        return {row["path"]: row for row in csv.DictReader(handle)}


def apply(repo, frag, **kwargs):
    return pm.apply_fragments(
        [frag],
        repo / "public" / "data",
        root=repo,
        order=ORDER,
        on="2026-10-28",
        **kwargs,
    )


def test_changed_files_go_pending_and_nothing_is_signed(repo):
    before = review_rows(repo)
    report = apply(repo, fragment({2026: "0.2", 2027: "0.3"}))
    assert report.changed_files == ["public/data/budgetary_impact.csv"]
    after = review_rows(repo)
    row = after["public/data/budgetary_impact.csv"]
    assert row["kind"] == "pending"
    assert row["reviewer"] == pm.RECONCILER
    assert row["reviewed_on"] == "2026-10-28"
    assert row["expires_on"] == "2026-11-04"
    assert row["sha256"] == sha(
        (repo / "public/data/budgetary_impact.csv").read_bytes()
    )
    assert "(was national_table)" in row["basis"]
    assert row["basis"].endswith("Basis, public/data/budgetary_impact.csv")
    # Files whose bytes did not change keep their signed rows
    for path in ("public/other.png", "public/data/distributional_impact.csv"):
        assert after[path] == before[path]
    assert "Review rows are pending" in report.summary


def test_applying_twice_gives_the_same_bytes(repo):
    frag = fragment({2026: "0.2", 2027: "0.3"}, {"1st": "0.6"})
    apply(repo, frag)
    files = {
        path: path.read_bytes()
        for path in sorted(repo.rglob("*"))
        if path.is_file()
    }
    second = apply(repo, frag)
    assert second.pending == []
    assert {
        path: path.read_bytes()
        for path in sorted(repo.rglob("*"))
        if path.is_file()
    } == files


def test_a_rerun_with_identical_rows_marks_nothing(repo):
    same = fragment({2026: "0.1", 2027: "0.30000000000000004"})
    report = apply(repo, same)
    assert report.changed_files == [] and report.pending == []


def test_a_second_measure_joins_the_pending_row(repo):
    apply(repo, fragment({2026: "0.2"}))
    gamma = fragment({2026: "-1"}, reform_id="gamma")
    apply(repo, gamma)
    basis = review_rows(repo)["public/data/budgetary_impact.csv"]["basis"]
    assert basis.startswith("Pending review: rows for alpha, gamma ")
    assert basis.count("Pending review") == 1


def test_summary_shows_revenue_deciles_and_the_change(repo):
    report = apply(
        repo, fragment({2026: "0.2"}, {"1st": "0.75", "2nd": "0.25"})
    )
    summary = report.summary
    assert "| 2026 | 0.20 | 0.10 | 0.10 |" in summary
    assert "| 1st | 0.750 | 0.500 | 0.250 |" in summary
    assert "| 2nd | 0.250 | 0.250 | 0.000 |" in summary


def test_sign_pending_restores_each_rows_kind(repo):
    apply(repo, fragment({2026: "0.2"}, {"1st": "0.75"}))
    signed = pm.sign_pending(repo, "juaristi22", on="2026-10-28")
    assert signed == [
        "public/data/budgetary_impact.csv",
        "public/data/distributional_impact.csv",
    ]
    rows_after = review_rows(repo)
    for path in signed:
        row = rows_after[path]
        assert row["kind"] == "national_table"
        assert row["reviewer"] == "juaristi22"
        assert row["expires_on"] == ""
        assert row["basis"] == f"Basis, {path}"


def test_sign_pending_refuses_a_file_changed_after_marking(repo):
    apply(repo, fragment({2026: "0.2"}))
    path = repo / "public/data/budgetary_impact.csv"
    path.write_text(path.read_text() + "beta,Beta,2026,1\n")
    before = (repo / "data_inputs/public_data_review.csv").read_bytes()
    with pytest.raises(pm.PublishMeasureError, match="changed since"):
        pm.sign_pending(repo, "juaristi22")
    assert (repo / "data_inputs/public_data_review.csv").read_bytes() == before


def test_pending_rows_pass_the_public_data_check(repo):
    import importlib.util
    from datetime import date
    from pathlib import Path

    apply(repo, fragment({2026: "0.2"}))
    script = Path(__file__).resolve().parent.parent / "scripts"
    spec = importlib.util.spec_from_file_location(
        "check_public_data", script / "check_public_data.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    entries, problems = module.read_review(repo)
    assert problems == []
    assert entries["public/data/budgetary_impact.csv"].expires_on == date(
        2026, 11, 4
    )


def test_fragments_round_trip(tmp_path):
    frag = fragment({2026: "0.2"}, {"1st": "0.75"})
    frag.members = ["alpha", "gamma"]
    frag.warnings = ["Mis-costed by this model: x"]
    directory = pm.write_fragment(tmp_path, frag)
    assert pm.fragment_dirs([tmp_path]) == [directory]
    back = pm.read_fragment(directory)
    assert back.tables == frag.tables
    assert (back.members, back.warnings, back.years) == (
        ["alpha", "gamma"],
        ["Mis-costed by this model: x"],
        [2026],
    )


def test_the_combined_fragment_names_its_members(repo):
    budget = repo / "public/data" / pm.BUDGETARY
    budget.write_text(
        "reform_id,reform_name,year,value,reform_members\n"
        "autumn_budget_2026_combined,C,2026,1,alpha\n"
        "alpha,Alpha,2026,0.1,\n"
        "gamma,Gamma,2026,0.2,\n"
    )
    frag = fragment({2026: "0.35"}, reform_id="autumn_budget_2026_combined")
    frag.members = ["alpha", "gamma"]
    apply(repo, frag)
    assert pm.combined_members(repo / "public/data", ORDER[0]) == [
        "alpha",
        "gamma",
    ]


def test_geography_waits_for_59():
    with pytest.raises(pm.PublishMeasureError, match="#59"):
        pm.publish_geography(None, None)


def test_an_unknown_measure_is_refused(capsys):
    from uk_budget_data.cli import main

    assert main(["publish-measure", "no_such_measure", "--years", "2029"]) == 1


def test_a_changed_member_marks_the_combined_run_stale(repo):
    budget = repo / "public/data" / pm.BUDGETARY
    budget.write_text(
        "reform_id,reform_name,year,value,reform_members\n"
        "autumn_budget_2026_combined,C,2026,1,alpha+gamma\n"
        "alpha,Alpha,2026,0.1,\n"
        "gamma,Gamma,2026,0.2,\n"
    )
    report = apply(repo, fragment({2026: "0.5"}))
    assert budget.read_text().splitlines()[1:] == [
        "autumn_budget_2026_combined,C,2026,1,",
        "alpha,Alpha,2026,0.5,",
        "gamma,Gamma,2026,0.2,",
    ]
    assert pm.combined_members(repo / "public/data", ORDER[0]) is None
    assert "marked stale" in report.summary


def test_an_unchanged_member_leaves_the_combined_run_current(repo):
    budget = repo / "public/data" / pm.BUDGETARY
    text = (
        "reform_id,reform_name,year,value,reform_members\n"
        "autumn_budget_2026_combined,C,2026,1,alpha+gamma\n"
        "alpha,Alpha,2026,0.1,\n"
    )
    budget.write_text(text)
    apply(repo, fragment({2026: "0.1"}))
    assert budget.read_text() == text


def test_the_combined_run_is_never_its_own_member():
    from uk_budget_data.models import DataConfig

    with pytest.raises(pm.PublishMeasureError, match="combined run"):
        pm.combined_reform(
            ["two_child_limit", AUTUMN_BUDGET_2026_COMBINED_ID], DataConfig()
        )
