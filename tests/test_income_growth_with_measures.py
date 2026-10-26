"""income_growth_with_measures.csv (living_standards/measures_growth.py).

Logic tests on synthetic group cells: the rows match the outlook's own
growth_by_group on the same cells, the difference is the reform's growth less
its own baseline's, the floor withholds a grouping, vigintile 1 is left out,
and the floor and the deflator are the outlook's. No dataset needed.
"""

import numpy as np
import pytest

from uk_budget_data.living_standards import build, measures_growth
from uk_budget_data.living_standards.projections import (
    INCOME_GROUPINGS,
    income_groups,
)

YEARS = [2027, 2028, 2029]


def person_arrays(year, shift=0.0, households=400):
    """A synthetic population whose incomes grow 2% a year, plus ``shift``."""
    rng = np.random.default_rng(year)
    n = households * 2
    hh = np.repeat(np.arange(households), 2)
    income = np.repeat(rng.lognormal(10, 0.6, households), 2) * 1.02 ** (
        year - 2026
    )
    income = income * (1 + shift)
    return {
        "weight": np.ones(n),
        "eq_bhc": income,
        "eq_ahc": income * 0.8,
        "hh_id": hh.astype(np.int64),
        "bu_has_pensioner": np.repeat(np.arange(households) % 5 == 0, 2),
    }


def cells(shift_by_year=None, households=400):
    shift_by_year = shift_by_year or {}
    return {
        y: income_groups(
            person_arrays(y, shift_by_year.get(y, 0.0), households)
        )
        for y in [YEARS[0] - 1, *YEARS]
    }


def real(value, year, basis):
    return value / (1.03 if basis == "bhc" else 1.04) ** year


def test_floor_and_price_base_are_the_outlooks():
    assert measures_growth.MIN_HOUSEHOLDS == build.MIN_HOUSEHOLDS
    assert measures_growth.PRICE_BASE_YEAR == build.PRICE_BASE_YEAR


def test_baseline_growth_matches_the_outlooks_growth_by_group():
    base = cells(households=3000)
    rows = measures_growth.growth_rows("m", "M", base, base, YEARS, real)
    proj = {str(y): {"income_groups": c} for y, c in base.items()}
    block = build.growth_by_group(proj, YEARS, real)
    assert list(block["groupings"]) == list(INCOME_GROUPINGS)
    for row in rows:
        series = block["series"][row["population"]][row["basis"]]
        by_year = series[row["grouping"]]["by_year"]
        published = next(r for r in by_year if r["year"].startswith(str(row["year"])))
        k = row["group"] - 1
        assert row["baseline_annual_growth"] == published["annual_growth"][k]
        assert row["baseline_real_median"] == published["real_median"][k]
        # Same cells on both sides: the measure does nothing
        assert row["growth_difference"] == 0


def test_difference_is_reform_growth_less_its_own_baseline():
    base = cells(households=3000)
    # The measure raises every income 1% from 2028
    reform = cells({2028: 0.01, 2029: 0.01}, households=3000)
    rows = measures_growth.growth_rows("m", "M", base, reform, YEARS, real)
    for row in rows:
        assert row["growth_difference"] == pytest.approx(
            row["reform_annual_growth"] - row["baseline_annual_growth"],
            abs=2e-5,
        )
        # 1% more of a median that grew by g: 0.01 * (1 + g)
        expected = (
            0.01 * (1 + row["baseline_annual_growth"])
            if row["year"] == 2028
            else 0.0
        )
        assert row["growth_difference"] == pytest.approx(expected, abs=2e-5)


def test_vigintile_1_is_left_out_and_others_kept():
    base = cells(households=3000)
    rows = measures_growth.growth_rows("m", "M", base, base, YEARS, real)
    groups = {
        name: sorted({r["group"] for r in rows if r["grouping"] == name})
        for name in INCOME_GROUPINGS
    }
    assert groups == {
        "quintile": [1, 2, 3, 4, 5],
        "decile": list(range(1, 11)),
        "vigintile": list(range(2, 21)),
    }
    assert {r["year"] for r in rows} == set(YEARS)
    assert set(rows[0]) == set(measures_growth.COLUMNS)


def test_a_grouping_under_the_floor_is_withheld_whole():
    # 400 households: vigintile cells hold about 20 households among
    # non-pensioners, deciles about 40, quintiles about 80; all under 100
    small = cells(households=400)
    assert measures_growth.growth_rows("m", "M", small, small, YEARS, real) == []
    # 1,200: quintiles clear the floor, vigintiles do not
    mid = cells(households=1200)
    rows = measures_growth.growth_rows("m", "M", mid, mid, YEARS, real)
    assert {r["grouping"] for r in rows} == {"quintile"}


def test_the_floor_counts_the_reform_side_too():
    base = cells(households=3000)
    reform = cells(households=400)
    assert measures_growth.growth_rows("m", "M", base, reform, YEARS, real) == []


def test_deflator_rebases_to_2027_28():
    real_ = measures_growth.deflator()
    assert real_(100.0, measures_growth.PRICE_BASE_YEAR, "bhc") == pytest.approx(100.0)
    assert real_(100.0, measures_growth.PRICE_BASE_YEAR, "ahc") == pytest.approx(100.0)
    # Later years' prices are higher, so the same cash is worth less
    assert real_(100.0, 2030, "bhc") < 100.0


def test_cli_offers_income_growth():
    from uk_budget_data.cli import parse_args

    parsed = parse_args(["generate", "--only", "income_growth"])
    assert parsed.only == "income_growth"


def test_generate_writes_the_rows_the_units_return(tmp_path):
    from uk_budget_data import pipeline
    from uk_budget_data.models import DataConfig
    from uk_budget_data.reforms import get_autumn_budget_2026_reforms

    base = cells(households=3000)
    rows = measures_growth.growth_rows("m", "M", base, base, YEARS, real)

    class Runner:
        def map(self, function, units, on_result=lambda i, r: None):
            assert function is pipeline.run_flat_unit
            assert all(u.tables == pipeline.GROWTH for u in units)
            return [
                pipeline.FlatOutcome(reform_id="m", growth_rows=rows)
            ] + [pipeline.FlatOutcome(reform_id=str(i)) for i in units[1:]]

    reforms = get_autumn_budget_2026_reforms()[:2]
    frame = pipeline.generate_income_growth(
        reforms, DataConfig(output_dir=tmp_path), runner=Runner()
    )
    assert list(frame.columns) == measures_growth.COLUMNS
    assert len(frame) == len(rows)
    written = (tmp_path / pipeline.INCOME_GROWTH_FILE).read_text()
    assert written.splitlines()[0] == ",".join(measures_growth.COLUMNS)
