"""Briefing tables are checked before hashing and at publication gates."""

import copy

import pytest

from tests.publication_support import (
    World,
    make_household_rows,
    make_tables,
)
from uk_budget_data.models import ReformResult
from uk_budget_data.publication.artifacts import (
    ArtifactError,
    read_receipt,
    read_tables,
    table_files,
    write_artifact,
)
from uk_budget_data.publication.generate import result_tables
from uk_budget_data.publication.tables import (
    BRIEFING_CATEGORIES,
    BRIEFING_DECILES,
    BRIEFING_POVERTY_KEYS,
    TABLES,
    TableError,
    canonical_csv,
    normalise,
    parse_csv,
    sha256_bytes,
)
from uk_budget_data.publication.validate import table_problems

KEY = "alpha"
YEARS = [2027, 2028]


def complete_tables():
    tables = make_tables(KEY, dict.fromkeys(YEARS, -1.0))
    tables.update(
        briefing_deciles=[], briefing_winners_losers=[], briefing_poverty=[]
    )
    for year in YEARS:
        base = {"reform_id": KEY, "year": year}
        for decile in sorted(BRIEFING_DECILES):
            tables["briefing_deciles"].append(
                {**base, "decile": decile, "avg_change_gbp": -123.456}
            )
            for category in sorted(BRIEFING_CATEGORIES):
                tables["briefing_winners_losers"].append(
                    {
                        **base,
                        "decile": decile,
                        "category": category,
                        "share_pct": 20.0,
                    }
                )
        for measure, housing, group in sorted(BRIEFING_POVERTY_KEYS):
            tables["briefing_poverty"].append(
                {
                    **base,
                    "measure": measure,
                    "housing": housing,
                    "group": group,
                    "baseline_rate_pct": 20.3,
                    "reform_rate_pct": 18.2,
                    "change_pp": 18.2 - 20.3,
                }
            )
    return tables


def test_optional_briefing_tables_preserve_existing_artifacts():
    old = make_tables(KEY, dict.fromkeys(YEARS, -1.0))
    assert table_problems(old, key=KEY, years=YEARS) == []
    tables = {k: v for k, v in old.items() if k != "household_scatter_binned"}
    result = ReformResult(
        reform_id=KEY,
        reform_name="Alpha",
        constituency=[],
        demographic_constituency=[],
        household_scatter=make_household_rows(KEY, dict.fromkeys(YEARS, -1.0)),
        **tables,
    )
    generated = result_tables(result)
    for name in (
        "briefing_deciles",
        "briefing_winners_losers",
        "briefing_poverty",
    ):
        assert generated[name] == []
        assert TABLES[name].required is False
        assert TABLES[name].filename not in table_files(generated, KEY)


def test_briefing_tables_are_canonical_hashed_and_receipted():
    world = World()
    try:
        tables = complete_tables()
        reference = world.write(KEY, dict.fromkeys(YEARS, -1.0), tables=tables)
        receipt = read_receipt(reference.path)
        restored = read_tables(reference.path)
        assert table_problems(restored, key=KEY, years=YEARS) == []
        for name in (
            "briefing_deciles",
            "briefing_winners_losers",
            "briefing_poverty",
        ):
            data = (reference.path / TABLES[name].filename).read_bytes()
            assert receipt["dashboard"]["files"][
                TABLES[name].filename
            ] == sha256_bytes(data)
            assert parse_csv(name, data) == normalise(name, tables[name])
            assert canonical_csv(name, reversed(tables[name])) == data
    finally:
        world.close()


@pytest.mark.parametrize(
    "name", ["briefing_deciles", "briefing_winners_losers", "briefing_poverty"]
)
def test_briefing_tables_require_columns_and_finite_numbers(name):
    tables = complete_tables()
    rows = copy.deepcopy(tables[name])
    rows[0].pop("year")
    with pytest.raises(TableError, match="missing columns"):
        canonical_csv(name, rows)
    rows = copy.deepcopy(tables[name])
    value_column = {
        "briefing_deciles": "avg_change_gbp",
        "briefing_winners_losers": "share_pct",
        "briefing_poverty": "baseline_rate_pct",
    }[name]
    rows[0][value_column] = float("inf")
    with pytest.raises(TableError, match="not finite"):
        canonical_csv(name, rows)


@pytest.mark.parametrize(
    "name", ["briefing_deciles", "briefing_winners_losers"]
)
def test_briefing_decile_sets_are_exact(name):
    rows = complete_tables()[name]
    rows[0]["decile"] = "11"
    with pytest.raises(TableError, match="incomplete decile"):
        canonical_csv(name, rows)
    rows = [row for row in complete_tables()[name] if row["decile"] != "all"]
    with pytest.raises(TableError, match="incomplete decile"):
        canonical_csv(name, rows)


def test_winners_losers_category_set_and_total_are_enforced():
    rows = complete_tables()["briefing_winners_losers"]
    rows[0]["category"] = "unexpected"
    with pytest.raises(TableError, match="incomplete category"):
        canonical_csv("briefing_winners_losers", rows)
    rows = complete_tables()["briefing_winners_losers"]
    rows[0]["share_pct"] = 19.999
    with pytest.raises(TableError, match="do not sum to 100"):
        canonical_csv("briefing_winners_losers", rows)
    rows[0]["share_pct"] = -1
    with pytest.raises(TableError, match="outside"):
        canonical_csv("briefing_winners_losers", rows)


def test_poverty_dimensions_rates_and_changes_are_enforced():
    rows = complete_tables()["briefing_poverty"]
    rows[0]["measure"] = "undefined"
    with pytest.raises(TableError, match="incomplete measure/housing/group"):
        canonical_csv("briefing_poverty", rows)
    rows = complete_tables()["briefing_poverty"]
    rows[0]["baseline_rate_pct"] = 101
    with pytest.raises(TableError, match="poverty rate outside"):
        canonical_csv("briefing_poverty", rows)
    rows = complete_tables()["briefing_poverty"]
    rows[0]["change_pp"] += 0.001
    with pytest.raises(TableError, match="inconsistent poverty change"):
        canonical_csv("briefing_poverty", rows)


def test_present_briefing_tables_cover_every_receipted_year():
    tables = complete_tables()
    for name in (
        "briefing_deciles",
        "briefing_winners_losers",
        "briefing_poverty",
    ):
        tables[name] = [row for row in tables[name] if row["year"] == YEARS[0]]
    problems = table_problems(tables, key=KEY, years=YEARS)
    assert set(problems) == {
        f"{name}: missing {YEARS[1]}"
        for name in (
            "briefing_deciles",
            "briefing_winners_losers",
            "briefing_poverty",
        )
    }


def test_artifact_writer_refuses_invalid_briefing_before_writing(tmp_path):
    """Review round 3: this used to call table_files, never the writer."""
    tables = complete_tables()
    tables["briefing_winners_losers"][0]["share_pct"] = 21
    with pytest.raises(ArtifactError, match="do not sum to 100"):
        table_files(tables, KEY)
    receipts = []
    root = tmp_path / "artifacts"
    with pytest.raises(ArtifactError, match="do not sum to 100"):
        write_artifact(tables, KEY, receipts.append, root)
    assert receipts == []
    assert not root.exists()


def test_no_briefing_effect_before_effective_year():
    tables = complete_tables()
    problems = table_problems(
        tables, key=KEY, years=YEARS, effective_from_year=2029
    )
    for name in (
        "briefing_deciles",
        "briefing_winners_losers",
        "briefing_poverty",
    ):
        assert any(
            problem.startswith(name) and "before the measure" in problem
            for problem in problems
        )
