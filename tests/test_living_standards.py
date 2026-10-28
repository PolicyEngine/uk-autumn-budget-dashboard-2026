"""The Living standards pipeline (src/uk_budget_data/living_standards/).

Logic tests on tiny synthetic inputs: the weighted statistics, a whole
projection year from a stand-in simulation, the build's deflator rebasing,
decile growth and poverty-line maths, the end year and its note, the OBR
forecast reader on a synthetic workbook in the OBR layout, the derived
series, and the review row. A contract test runs the CLI on synthetic
projections and checks its output, and the committed file, against
docs/DATA_CONTRACT.md. No test here needs the certified dataset.
"""

import copy
import csv
import hashlib
import json
import re
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from uk_budget_data.cli import main, parse_args
from uk_budget_data.living_standards import INPUTS_DIR, OUTPUT_PATH, engine
from uk_budget_data.living_standards.build import build_outlook, outlook_text
from uk_budget_data.living_standards.forecast import (
    POST_FILE_NAME,
    STALE_POST_NOTE,
    apply_post,
    check_pre_is_march,
    compute_post,
    read_post_document,
)
from uk_budget_data.living_standards.hbai import extract_hbai
from uk_budget_data.living_standards.obr import (
    EFO_FILE_NAME,
    ForecastTableError,
    ParsedSeries,
    extract_rhdi,
    read_forecast,
    read_pdf_table_a1,
)
from uk_budget_data.living_standards.projections import (
    INCOME_GROUPINGS,
    baseline_year,
    decile_medians,
    family_type,
    gini,
    rate,
    wmedian,
    wquantile,
)
from uk_budget_data.living_standards.review import set_pending
from uk_budget_data.living_standards.uc_health_element import (
    EXTENSION_YEARS,
    needs_uc_health_element_extension,
)

ROOT = Path(__file__).resolve().parent.parent
INPUTS = ROOT / INPUTS_DIR
COMMITTED = ROOT / OUTPUT_PATH
FY = re.compile(r"^\d{4}-\d{2}$")
RECORD_LEVEL = re.compile(r"\b(?:household|benunit|person)_(?:id|weight)\b")

# --- Weighted statistics ----------------------------------------------------


def test_weighted_quantiles_follow_the_weights():
    values = np.array([10.0, 20.0, 30.0, 40.0])
    assert wmedian(values, np.ones(4)) == 20.0
    # Most of the weight on 40: the median moves there.
    assert wmedian(values, np.array([1.0, 1.0, 1.0, 10.0])) == 40.0
    assert wquantile(values, np.ones(4), 0.9) == 40.0
    assert wquantile(values, np.ones(4), 0.1) == 10.0


def test_gini_is_zero_for_equal_incomes_and_known_for_two_people():
    assert gini(np.full(5, 100.0), np.ones(5)) == pytest.approx(0.0)
    # One person has everything: Gini of two equal-weight people is 1/2.
    assert gini(np.array([0.0, 100.0]), np.ones(2)) == pytest.approx(0.5)


def test_decile_medians_rank_within_the_year():
    values = np.arange(1.0, 101.0)  # 1..100, one person each
    medians = decile_medians(values[::-1].copy(), np.ones(100))
    # Ten groups of ten, lowest first, whatever the input order.
    assert medians == [5.0 + 10 * d for d in range(10)]


def test_rate_is_the_weighted_share_within_the_group():
    flag = np.array([True, False, True, False])
    weight = np.array([1.0, 1.0, 2.0, 4.0])
    group = np.array([True, True, True, False])
    assert rate(flag, weight, group) == pytest.approx(3 / 4)


def test_family_type_puts_any_benefit_unit_with_a_pensioner_first():
    a = {
        "weight": np.ones(5),
        "bu_children": np.array([1, 2, 0, 0, 1]),
        "bu_adults": np.array([1, 2, 1, 2, 2]),
        "bu_has_pensioner": np.array([False, False, False, False, True]),
    }
    assert list(family_type(a)) == [
        "lone_parent",
        "couple_with_children",
        "single_no_children",
        "couple_no_children",
        "pensioner",
    ]


# --- A projection year from a stand-in simulation -------------------------

REGIONS = [
    "NORTH_EAST",
    "NORTH_WEST",
    "YORKSHIRE",
    "EAST_MIDLANDS",
    "WEST_MIDLANDS",
    "EAST_OF_ENGLAND",
    "LONDON",
    "SOUTH_EAST",
    "SOUTH_WEST",
    "WALES",
    "SCOTLAND",
    "NORTHERN_IRELAND",
]
TENURES = [
    "OWNED_OUTRIGHT",
    "OWNED_WITH_MORTGAGE",
    "RENT_FROM_COUNCIL",
    "RENT_FROM_HA",
    "RENT_PRIVATELY",
]
# Benefit-unit shapes: (adults, children, pensioner) cover every family type.
SHAPES = [(1, 0, False), (2, 0, False), (1, 2, False), (2, 3, False)]
SHAPES += [(2, 1, False), (1, 0, True), (2, 0, True)]


class _Result:
    def __init__(self, values):
        self.values = np.asarray(values)

    def sum(self):
        return float(self.values.sum())


class FakeSim:
    """Persons in one-benefit-unit households, incomes growing by year."""

    def __init__(self, households: int = 240, seed: int = 1):
        rng = np.random.default_rng(seed)
        rows = []
        for h in range(households):
            adults, children, pensioner = SHAPES[h % len(SHAPES)]
            base = float(rng.lognormal(10.3, 0.5))
            for i in range(adults + children):
                child = i >= adults
                kind = (
                    "CHILD"
                    if child
                    else ("PENSIONER" if pensioner else "WORKING_AGE_ADULT")
                )
                rows.append(
                    {
                        "hh": h,
                        "bu": h,
                        "type": kind,
                        "child": child,
                        "disabled": h % 9 == 0 and i == 0,
                        "tenure": TENURES[h % len(TENURES)],
                        "region": REGIONS[h % len(REGIONS)],
                        "income": base,
                        "weight": 1000.0 + 10 * (h % 7),
                    }
                )
        self.p = pd.DataFrame(rows)

    def calculate(self, var, year, map_to=None):
        p = self.p
        growth = 1.03 ** (year - 2024)
        bhc = p["income"].to_numpy() * growth
        ahc = bhc * 0.85
        cash = {
            "person_weight": p["weight"].to_numpy(),
            "equiv_hbai_household_net_income": bhc,
            "equiv_hbai_household_net_income_ahc": ahc,
            "hbai_person_type": p["type"].to_numpy(),
            "is_hbai_dependent_child": p["child"].to_numpy(),
            "is_disabled_for_benefits": p["disabled"].to_numpy(),
            "person_household_id": p["hh"].to_numpy(dtype=float),
            "person_benunit_id": p["bu"].to_numpy(dtype=float),
            "tenure_type": p["tenure"].to_numpy(),
            "region": p["region"].to_numpy(),
            "universal_credit": np.full(len(p), 1e6),
        }
        line = {"bhc": 0.6 * np.median(bhc), "ahc": 0.6 * np.median(ahc)}
        cash["in_relative_poverty_bhc"] = bhc < line["bhc"]
        cash["in_relative_poverty_ahc"] = ahc < line["ahc"]
        cash["in_poverty_bhc"] = bhc < line["bhc"] / growth
        cash["in_poverty_ahc"] = ahc < line["ahc"] / growth
        return _Result(cash[var])


@pytest.fixture(scope="module")
def projections():
    sim = FakeSim()
    end = engine.headline_end_year(engine.engine_versions()["policyengine_uk"])
    snapshot = (engine.BASE_YEAR, end)
    out = {
        "meta": {
            "dataset_sha256": engine.certified_dataset()["sha256"],
            **engine.engine_versions(),
            # What run_projections records when it applies the extension.
            "uc_health_element_extension": {
                "applied": True,
                "years": list(EXTENSION_YEARS),
                "upstream_fix": "PolicyEngine/policyengine-uk#2428",
            },
        }
    }
    for year in range(engine.FIRST_YEAR, end + 1):
        out[str(year)] = baseline_year(sim, year, snapshot)
    return out


def test_a_projection_year_has_every_section(projections):
    year = projections[str(engine.BASE_YEAR)]
    for key in (
        "people",
        "median_equivalised_income_bhc",
        "decile_medians_ahc",
        "inequality_bhc",
        "poverty",
        "non_pensioner_split_ahc",
        "deep_poverty_ahc",
        "child_poverty_by_family",
        "poverty_by_group",
    ):
        assert key in year
    assert "poverty_by_group" not in projections[str(engine.FIRST_YEAR)]
    # Every person is in exactly one HBAI group.
    deep = year["deep_poverty_ahc"]
    assert deep["below_60pc"]["rate"] == pytest.approx(
        deep["check_in_relative_poverty_ahc"]
    )
    assert (
        deep["below_40pc"]["rate"]
        <= deep["below_50pc"]["rate"]
        <= deep["below_60pc"]["rate"]
    )


# --- The build ----------------------------------------------------------------


@pytest.fixture(scope="module")
def outlook(projections):
    hbai = json.loads((INPUTS / "hbai_outturn.json").read_text())
    rhdi = json.loads((INPUTS / "obr_rhdi.json").read_text())
    doc = build_outlook(
        projections, hbai, rhdi, generated_at="2026-10-24T00:00:00+00:00"
    )
    return apply_post(doc, None)


def _cpi(basis: str):
    from uk_budget_data.forecast import forecast_parameters

    indices = forecast_parameters().gov.economic_assumptions.indices.obr
    leaf = (
        "consumer_price_index"
        if basis == "bhc"
        else "consumer_price_index_ahc"
    )
    return getattr(indices, leaf)


def test_real_values_are_rebased_to_the_base_year(outlook, projections):
    base = engine.BASE_YEAR
    for metric, basis in (
        ("median_equivalised_income", "bhc"),
        ("median_equivalised_income_ahc", "ahc"),
    ):
        idx = _cpi(basis)
        rows = {
            r["year"]: r
            for r in outlook["living_standards"]["projection"][metric]
        }
        # In the base year, real equals cash.
        assert (
            rows[engine.fy(base)]["real"] == rows[engine.fy(base)]["nominal"]
        )
        src = f"median_equivalised_income_{basis}"
        for year in range(engine.FIRST_YEAR, base + 4):
            nominal = projections[str(year)][src]
            expected = nominal * idx(f"{base}-01-01") / idx(f"{year}-01-01")
            assert rows[engine.fy(year)]["real"] == round(expected)


def test_decile_growth_runs_from_the_base_year(outlook):
    block = outlook["income_by_decile"]["bhc"]
    first, last = block["by_year"][0], block["by_year"][-1]
    assert first["year"] == engine.fy(engine.BASE_YEAR)
    assert first["cumulative_growth"] == [0.0] * 10
    assert block["cumulative_growth_to_end"] == last["cumulative_growth"]
    for i in range(10):
        growth = last["real_median"][i] / first["real_median"][i] - 1
        # Growth comes from the unrounded values; the medians are rounded to
        # whole pounds, which moves their ratio by up to about 1 / median.
        tolerance = 1 / first["real_median"][i] + 1e-5
        assert last["cumulative_growth"][i] == pytest.approx(
            growth, abs=tolerance
        )


def test_income_groups_match_the_decile_medians(projections):
    year = projections[str(engine.BASE_YEAR)]
    groups = year["income_groups"]
    for basis in ("bhc", "ahc"):
        assert (
            groups["all"][basis]["decile"]["medians"]
            == year[f"decile_medians_{basis}"]
        )
        assert (
            groups["all"][basis]["quintile"]["medians"]
            == year[f"quintile_medians_{basis}"]
        )
        for pop in ("all", "non_pensioners"):
            for name, n in INCOME_GROUPINGS.items():
                cell = groups[pop][basis][name]
                assert (
                    len(cell["medians"])
                    == len(cell["unweighted_households"])
                    == n
                )
                assert cell["medians"] == sorted(cell["medians"])


def test_growth_by_group_withholds_groupings_below_the_floor(outlook):
    # 240 synthetic households: every grouping has cells under 100
    block = outlook["income_growth_by_group"]
    assert block["groupings"] == {}
    assert set(block["withheld_groupings"]) == set(INCOME_GROUPINGS)
    for pop in block["series"].values():
        for basis in pop.values():
            assert basis == {}


def test_growth_by_group_annual_changes_chain_to_the_cumulative(projections):
    from uk_budget_data.living_standards import build

    big = {}
    for y, r in projections.items():
        if not y.isdigit():
            continue
        # Scale the household counts past the floor; the medians stay
        groups = json.loads(json.dumps(r["income_groups"]))
        for pop in groups.values():
            for basis in pop.values():
                for cell in basis.values():
                    cell["unweighted_households"] = [
                        c * 100 for c in cell["unweighted_households"]
                    ]
        big[y] = {"income_groups": groups}
    years = list(range(engine.BASE_YEAR, engine.END_YEAR + 1))
    block = build.growth_by_group(big, years, lambda v, y, b: v / 1.02**y)
    assert list(block["groupings"]) == list(INCOME_GROUPINGS)
    assert block["withheld_groupings"] == {}
    rows = block["series"]["non_pensioners"]["ahc"]["vigintile"]["by_year"]
    assert [r["year"] for r in rows][0] == "2027-28"
    assert rows[0]["cumulative_growth"] == [0.0] * 20
    for g in range(20):
        chained = np.prod([1 + r["annual_growth"][g] for r in rows[1:]]) - 1
        assert chained == pytest.approx(
            rows[-1]["cumulative_growth"][g], abs=5e-5
        )
    # 2027-28's annual change is on 2026-27
    first = big[str(engine.BASE_YEAR)]["income_groups"]["all"]["bhc"]
    before = big[str(engine.BASE_YEAR - 1)]["income_groups"]["all"]["bhc"]
    row = block["series"]["all"]["bhc"]["decile"]["by_year"][0]
    expected = (
        first["decile"]["medians"][0] / 1.02 / before["decile"]["medians"][0]
        - 1
    )
    assert row["annual_growth"][0] == pytest.approx(expected, abs=1e-5)


def test_poverty_lines_are_shares_of_the_models_own_median(
    outlook, projections
):
    for row in outlook["deep_poverty"]["projection"]["below_40pc_median_ahc"]:
        year = row["year"][:4]
        median = projections[year]["deep_poverty_ahc"]["median"]
        assert row["threshold_annual"] == round(median * 0.4)
    for row in outlook["deep_poverty"]["projection"]["below_50pc_median_ahc"]:
        median = projections[row["year"][:4]]["deep_poverty_ahc"]["median"]
        assert row["threshold_annual"] == round(median * 0.5)


def test_small_cells_are_suppressed(outlook):
    pbg = outlook["poverty_by_group"]
    for breakdown in pbg["breakdowns"].values():
        for cells in breakdown["cells"].values():
            for cell in cells.values():
                small = (
                    cell["unweighted_households"]
                    < pbg["min_unweighted_households"]
                )
                assert cell["suppressed"] is small
                if small:
                    assert cell["relative_ahc"] is None


def test_the_build_refuses_projections_from_another_dataset(projections):
    other = json.loads(json.dumps(projections))
    other["meta"]["dataset_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="another dataset"):
        build_outlook(other, {}, {})


def test_the_build_refuses_projections_without_the_uc_extension(projections):
    other = json.loads(json.dumps(projections))
    other["meta"].pop("uc_health_element_extension")
    if needs_uc_health_element_extension(other["meta"]["policyengine_uk"]):
        with pytest.raises(ValueError, match="UC health element"):
            build_outlook(other, {}, {})


# --- Period: 2027-28 to 2031-32 on every engine -----------------------------


@pytest.mark.parametrize(
    "pe_uk, patched",
    [
        ("2.132.6", True),
        ("2.134.3", True),
        ("2.134.4", False),
        ("2.140.0", False),
    ],
)
def test_the_period_is_the_same_on_every_engine(pe_uk, patched):
    assert (engine.BASE_YEAR, engine.END_YEAR) == (2027, 2031)
    assert engine.headline_end_year(pe_uk) == 2031
    assert engine.projection_years(pe_uk) == list(range(2024, 2032))
    note = engine.headline_end_year_note(pe_uk)
    assert note.startswith("2031-32 is the last year of the OBR October 2026")
    assert needs_uc_health_element_extension(pe_uk) is patched


# --- Contract: the CLI's output and the committed file -----------------------

CONTRACT_SECTIONS = (
    "meta",
    "living_standards",
    "poverty",
    "forecast",
    "income_by_decile",
    "child_poverty_by_family",
    "inequality",
    "deep_poverty",
    "poverty_by_group",
    "obr_rhdi",
    "income_growth_by_group",
)
META_KEYS = (
    "generated_at",
    "policyengine",
    "policyengine_uk",
    "dataset",
    "real_price_base",
    "headline_start_year",
    "headline_end_year",
    "headline_end_year_note",
    "cpi_ahc_note",
    "deflator",
    "outturn_source",
    "units",
    "method",
    "comparators",
    "validation_2024_25",
    "notes",
    "caveats",
)


def check_contract(doc: dict) -> None:
    """The shape docs/DATA_CONTRACT.md describes."""
    assert list(doc) == list(CONTRACT_SECTIONS)
    meta = doc["meta"]
    for key in META_KEYS:
        assert key in meta, key
    assert set(meta["dataset"]) >= {"name", "tag", "sha256", "hf_repo"}
    assert meta["real_price_base"] == meta["headline_start_year"] == "2027-28"
    end = meta["headline_end_year"]
    assert end == "2031-32"
    # Runs on the OBR October 2026 forecast write the first; the committed
    # outlook keeps the second until it is regenerated on that forecast.
    assert meta["headline_end_year_note"].startswith(
        (
            f"{end} is the last year of the OBR October 2026",
            f"{end} is past the OBR March 2026 forecast",
        )
    )
    if needs_uc_health_element_extension(meta["policyengine_uk"]):
        assert meta["uc_health_element_extension"]["years"] == [2030, 2031]
    for note in meta["notes"] + meta["caveats"]:
        assert len(note) <= 160

    def years(series):
        ys = [p["year"] for p in series]
        assert all(FY.match(y) for y in ys) and ys == sorted(ys)
        assert ys[-1] <= end
        return ys

    for metric in doc["living_standards"]["metrics"]:
        years(doc["living_standards"]["projection"][metric])
    for groups in doc["poverty"]["projection"].values():
        for series in groups.values():
            assert all(0 <= p["rate"] <= 1 for p in series)
            years(series)
    dec = doc["income_by_decile"]
    assert dec["base_year"] == "2027-28" and dec["end_year"] == end
    for basis in ("bhc", "ahc"):
        assert len(dec[basis]["cumulative_growth_to_end"]) == 10
    # Every year from the base year to the end, so any two can be compared
    group_years = doc["poverty_by_group"]["years"]
    assert group_years[0] == "2027-28" and group_years[-1] == end
    assert group_years == sorted(group_years) and len(group_years) >= 2
    for basis in ("bhc", "ahc"):
        quintiles = dec[basis]["quintile_by_year"]
        assert [q["year"] for q in quintiles] == [
            d["year"] for d in dec[basis]["by_year"]
        ]
        assert all(len(q["real_median"]) == 5 for q in quintiles)
    growth = doc["income_growth_by_group"]
    assert growth["base_year"] == "2027-28" and growth["end_year"] == end
    assert growth["measure"] == "median"
    assert set(growth["populations"]) == {"all", "non_pensioners"}
    assert set(growth["bases"]) == {"bhc", "ahc"}
    assert set(growth["groupings"]) | set(growth["withheld_groupings"]) == {
        "quintile",
        "decile",
        "vigintile",
    }
    for pop in growth["populations"]:
        for basis in growth["bases"]:
            cells = growth["series"][pop][basis]
            assert set(cells) == set(growth["groupings"])
            for name, n in growth["groupings"].items():
                assert (
                    cells[name]["min_unweighted_households"]
                    >= growth["min_unweighted_households"]
                )
                rows = cells[name]["by_year"]
                assert [r["year"] for r in rows] == [
                    d["year"] for d in dec["bhc"]["by_year"]
                ]
                for r in rows:
                    for key in (
                        "real_median",
                        "annual_growth",
                        "cumulative_growth",
                    ):
                        assert len(r[key]) == n
                assert rows[0]["cumulative_growth"] == [0.0] * n
    for key in ("child_poverty_by_family", "deep_poverty"):
        block = doc[key]["projection"]
        first = next(iter(block.values()))
        first = (
            first if isinstance(first, list) else next(iter(first.values()))
        )
        assert first[0]["year"] == "2027-28" and first[-1]["year"] == end

    forecast = doc["forecast"]
    assert forecast["pre_label"] == "OBR March 2026 (pre-Budget)"
    assert isinstance(forecast["post_published"], bool)
    assert forecast["headline"] == ["cpi", "rpi", "earnings"]
    for section in forecast["sections"]:
        for s in section["series"]:
            # OBR calendar years 2027 to 2030; 2031 is not an OBR forecast.
            assert [p["year"] for p in s["pre"]] == [
                "2027",
                "2028",
                "2029",
                "2030",
            ]
            # post is null only for a series the loaded Budget forecast
            # lacks, and post_source says why
            if s["post"] is None:
                assert forecast["post_published"] and s["post_source"]
                continue
            assert [p["year"] for p in s["pre"]] == [
                p["year"] for p in s["post"]
            ]
            if not forecast["post_published"]:
                assert s["post"] == s["pre"]
    if forecast["post_published"]:
        assert set(forecast["post_source"]) >= {
            "release",
            "file",
            "file_sha256",
            "url",
        }

    text = json.dumps(doc)
    assert not RECORD_LEVEL.search(text)


def test_the_cli_writes_the_contract(tmp_path, projections, monkeypatch):
    saved = tmp_path / "projections.json"
    saved.write_text(json.dumps(projections))
    out = tmp_path / "outlook.json"
    code = main(
        [
            "living-standards",
            "--projections",
            str(saved),
            "--output",
            str(out),
            "--inputs-dir",
            str(INPUTS),
            "--reviewer",
            "",
        ]
    )
    assert code == 0
    doc = json.loads(out.read_text())
    check_contract(doc)
    dataset = engine.certified_dataset()
    assert doc["meta"]["dataset"]["sha256"] == dataset["sha256"]
    assert doc["meta"]["dataset"]["tag"] == dataset["tag"]
    assert (
        doc["meta"]["policyengine_uk"]
        == engine.engine_versions()["policyengine_uk"]
    )
    assert out.read_text() == outlook_text(doc)


def test_the_committed_outlook_meets_the_contract_on_the_pinned_engine():
    doc = json.loads(COMMITTED.read_text())
    check_contract(doc)
    assert (
        doc["meta"]["dataset"]["sha256"]
        == engine.certified_dataset()["sha256"]
    )
    versions = engine.engine_versions()
    assert doc["meta"]["policyengine"] == versions["policyengine"]
    assert doc["meta"]["policyengine_uk"] == versions["policyengine_uk"]
    assert doc["meta"]["headline_end_year"] == engine.fy(
        engine.headline_end_year(versions["policyengine_uk"])
    )


def test_cli_parses_both_commands():
    args = parse_args(["living-standards"])
    assert args.output == OUTPUT_PATH and args.projections is None
    args = parse_args(["obr-forecast", "--efo", "x.xlsx", "--label", "L"])
    assert args.efo == Path("x.xlsx") and args.label == "L"
    with pytest.raises(SystemExit):
        parse_args(["obr-forecast"])  # --efo is required


# --- Committed extracts reproduce from their source files --------------------


def test_hbai_extract_reproduces_from_the_committed_tables():
    payload = extract_hbai(INPUTS / "summary-hbai-1994-95-2024-25-tables.ods")
    assert (
        json.dumps(payload, indent=2)
        == (INPUTS / "hbai_outturn.json").read_text()
    )


def test_rhdi_extract_reproduces_from_the_committed_efo():
    payload = extract_rhdi(INPUTS / EFO_FILE_NAME)
    assert (
        json.dumps(payload, indent=2) + "\n"
        == (INPUTS / "obr_rhdi.json").read_text()
    )


# --- The OBR forecast reader -------------------------------------------------

YEARS = list(range(2025, 2031))


def _table(number, title, columns, calendar, header=("Year-on-year growth",)):
    """A sheet in the EFO layout: title, headings, quarters, calendar rows."""
    width = 2 + len(columns)
    rows = [["Back to contents"] + [None] * (width - 1)]
    rows.append([None, f"{number} {title}"] + [None] * (width - 2))
    for h in header:
        rows.append([None, None, h] + [None] * (width - 3))
    rows.append([None, None] + list(columns))
    for y in YEARS:
        for q in range(1, 5):
            rows.append([None, f"{y}Q{q}"] + [1.0] * len(columns))
    rows.append([None] * width)
    for y in YEARS:
        rows.append([None, y] + [calendar[c][y] for c in columns])
    return pd.DataFrame(rows)


def _workbook(path, drop=None, gap=None):
    """A synthetic economy workbook, its tables renumbered from March 2026."""
    flat = lambda v: {y: v for y in YEARS}  # noqa: E731
    inflation = {
        "RPI": flat(3.04),
        "RPIX": flat(2.9),
        "CPI": {**flat(2.0), 2026: 2.46},
        "CPIH": flat(2.51),
        "Mortgage interest payments": {**flat(4.0), 2030: float("nan")},
        "Actual rents for housing": flat(3.0),
    }
    if gap:
        inflation[gap[0]][gap[1]] = float("nan")
    sheets = {
        "Contents": pd.DataFrame([[None, "Economy tables"]]),
        "2.4": _table(
            "2.4",
            "Labour market",
            [
                "Employment (16+, millions)",
                "Average weekly earnings growth (per cent)",
            ],
            {
                "Employment (16+, millions)": flat(30.0),
                "Average weekly earnings growth (per cent)": flat(3.36),
            },
            header=(),
        ),
        "2.5": _table("2.5", "Inflation", list(inflation), inflation),
        "2.9": _table(
            "2.9",
            "Household disposable income (£ billion)",
            ["Labour income", "Non-labour income"],
            {
                "Labour income": flat(1.0),
                "Non-labour income": {
                    y: 100 * 1.05 ** (y - 2025) for y in YEARS
                },
            },
            header=(),
        ),
        "2.12": _table(
            "2.12",
            "Housing market",
            [
                "House price index \n(Jan 2023 = 100)",
                "House price index \n(per cent change on a year earlier)",
            ],
            {
                "House price index \n(Jan 2023 = 100)": flat(100.0),
                "House price index \n(per cent change on a year earlier)": flat(
                    2.75
                ),
            },
            header=(),
        ),
        "2.13": _table(
            "2.13", "CPI category inflation", ["Food"], {"Food": flat(9.9)}
        ),
    }
    if drop:
        sheets[drop[0]] = sheets[drop[0]].drop(
            columns=sheets[drop[0]].columns[-1]
        )
    with pd.ExcelWriter(path) as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, header=False, index=False)
    return path


def test_the_reader_finds_series_by_title_and_heading(tmp_path):
    parsed = read_forecast(_workbook(tmp_path / "efo.xlsx"), YEARS)
    assert parsed["cpi"].values[2026] == 0.025  # 2.46 -> 2.5 (1 d.p.)
    assert parsed["cpih"].values[2026] == 0.0251
    assert parsed["rpi"].values[2027] == 0.03
    assert parsed["earnings"].values[2026] == 0.034
    assert parsed["house_prices"].values[2026] == 0.028
    assert parsed["rent"].values[2026] == 0.03
    assert parsed["non_labour_income"].values[2027] == 0.05
    assert parsed["non_labour_income"].values[2025] is None  # no 2024 level
    assert parsed["mortgage_interest"].values[2030] is None
    assert parsed["cpi"].source == "Table 2.5 Inflation, CPI (calendar year)"


def test_a_missing_column_names_the_series(tmp_path):
    path = _workbook(tmp_path / "efo.xlsx", drop=("2.5", None))
    with pytest.raises(ForecastTableError, match="rent: no column"):
        read_forecast(path, YEARS)


def test_a_missing_table_names_the_series(tmp_path):
    path = _workbook(tmp_path / "efo.xlsx")
    sheets = pd.read_excel(path, sheet_name=None, header=None)
    sheets.pop("2.12")
    with pd.ExcelWriter(path) as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, header=False, index=False)
    with pytest.raises(
        ForecastTableError, match="house_prices: expected one table"
    ):
        read_forecast(path, YEARS)


def _outlook_forecast():
    return json.loads(COMMITTED.read_text())


def test_a_missing_year_is_refused_not_filled(tmp_path):
    path = _workbook(tmp_path / "efo.xlsx", gap=("CPIH", 2028))
    with pytest.raises(ForecastTableError, match="cpih 2028"):
        read_post_document(path, _outlook_forecast(), "L", "u")


def test_the_post_document_and_derived_series(tmp_path):
    outlook = _outlook_forecast()
    doc = read_post_document(
        _workbook(tmp_path / "efo.xlsx"),
        outlook,
        "OBR test",
        "https://obr.uk/efo/",
    )
    series = doc["series"]
    pre = {
        s["key"]: {p["year"]: p["value"] for p in s["pre"]}
        for sec in outlook["forecast"]["sections"]
        for s in sec["series"]
    }
    # Mortgage interest has no 2030 in this file: kept, and said so.
    assert series["mortgage_interest"]["carried"] == ["2030"]
    assert (
        series["mortgage_interest"]["values"]["2030"]
        == pre["mortgage_interest"]["2030"]
    )
    assert (
        "kept at the pre-Budget value" in series["mortgage_interest"]["source"]
    )
    # CPI after housing costs moves with CPI in the same year.
    cpi_change = series["cpi"]["values"]["2027"] - pre["cpi"]["2027"]
    assert series["cpi_ahc"]["values"]["2027"] == pytest.approx(
        pre["cpi_ahc"]["2027"] + cpi_change
    )
    # Social rent: CPI for the year before (rounded) + 1 point. 2027 takes
    # the published September 2026 CPI (3.5%), not the EFO's 2026 CPI.
    assert "2026" not in series["social_rent"]["values"]
    assert series["social_rent"]["values"]["2027"] == pytest.approx(
        0.035 + 0.01
    )
    assert series["social_rent"]["values"]["2028"] == pytest.approx(
        0.02 + 0.01
    )
    assert (
        doc["source"]["file"] == "efo.xlsx"
        and len(doc["source"]["file_sha256"]) == 64
    )

    published = apply_post(json.loads(json.dumps(outlook)), doc)
    forecast = published["forecast"]
    assert (
        forecast["post_published"] is True
        and forecast["post_label"] == "OBR test"
    )
    cpi = next(
        s
        for sec in forecast["sections"]
        for s in sec["series"]
        if s["key"] == "cpi"
    )
    assert cpi["post"][0] == {"year": "2027", "value": 0.02}
    assert cpi["post_source"].startswith("Table 2.5 Inflation")
    # Only the forecast block changes.
    assert {k: v for k, v in published.items() if k != "forecast"} == {
        k: v for k, v in outlook.items() if k != "forecast"
    }
    check_contract(published)
    # And with no post document, post repeats pre again.
    reverted = apply_post(published, None)["forecast"]
    assert (
        reverted["post_published"] is False and reverted["post_source"] is None
    )


def test_the_reader_reproduces_the_pre_budget_series_from_march_2026():
    """policyengine-uk's OBR series are the March 2026 EFO's: read them back."""
    outlook = _outlook_forecast()
    parsed = read_forecast(INPUTS / EFO_FILE_NAME, YEARS)
    # The March forecast predates September 2026's CPI outturn.
    computed = compute_post(
        outlook["forecast"], parsed, published_september_cpi={}
    )
    for sec in outlook["forecast"]["sections"]:
        for s in sec["series"]:
            pre = {int(p["year"]): p["value"] for p in s["pre"]}
            assert computed[s["key"]]["values"] == pre, s["key"]
    # Only mortgage interest 2030, which the OBR stopped forecasting, is kept.
    carried = {k: c["carried"] for k, c in computed.items() if c["carried"]}
    assert carried == {"mortgage_interest": [2030]}


def test_compute_post_refuses_an_unknown_gap():
    outlook = _outlook_forecast()
    parsed = read_forecast(INPUTS / EFO_FILE_NAME, YEARS)
    parsed["rpi"] = ParsedSeries(
        "rpi", {**parsed["rpi"].values, 2027: None}, "x"
    )
    with pytest.raises(ForecastTableError, match="rpi 2027"):
        compute_post(outlook["forecast"], parsed)


# --- The review row ---------------------------------------------------------


def test_set_pending_replaces_one_row_and_keeps_the_rest(tmp_path):
    review = tmp_path / "review.csv"
    original = (
        "path,kind,sha256,reviewer,reviewed_on,expires_on,basis\n"
        'public/a.csv,national_table,aa,x,2026-10-01,,"A, kept as is"\n'
        "public/data/living_standards_outlook.json,pending,bb,y,2026-10-01,2026-10-10,old\n"
        "public/z.csv,national_table,cc,x,2026-10-01,,Z\n"
    )
    review.write_text(original)
    set_pending(
        "public/data/living_standards_outlook.json",
        b"new bytes",
        "vahid-ahmadi",
        "New basis, with a comma",
        review_csv=review,
        today=date(2026, 10, 28),
    )
    lines = review.read_text().splitlines()
    assert lines[1] == original.splitlines()[1]
    assert lines[3] == original.splitlines()[3]
    row = next(csv.reader([lines[2]]))
    assert (row[1], row[3]) == ("pending", "vahid-ahmadi")
    assert row[2] == hashlib.sha256(b"new bytes").hexdigest()
    assert row[4:] == ["2026-10-28", "2026-11-11", "New basis, with a comma"]


# --- The October 2026 EFO PDF's Table A.1 (before the detailed tables) ------

OBR_DIR = ROOT / "data_inputs" / "obr"
OCT_PDF = OBR_DIR / "OBR-Economic-and-Fiscal-Outlook-October-2026.pdf"
OCT_TABLES = "efo-october-2026-detailed-forecast-tables-economy.xlsx"
OCT_TEXT = OBR_DIR / "OBR-Economic-and-Fiscal-Outlook-October-2026.txt"
OCT_PDF_SHA256 = (
    "9e0e9c340e35e603066f3124a614fcd68feadb3d5d10d1f76fb536e150e6225e"
)


def test_the_october_2026_table_a1_rows():
    """Table A.1 (PDF page 183), as printed: 2026 to 2030, per cent."""
    assert hashlib.sha256(OCT_PDF.read_bytes()).hexdigest() == OCT_PDF_SHA256
    parsed, page = read_pdf_table_a1(OCT_TEXT.read_text(), YEARS)
    assert page == "183"
    printed = {
        "cpi": [3.4, 3.1, 3.4, 2.1, 2.1, 2.0],
        "rpi": [4.1, 3.6, 4.3, 3.0, 3.0, 2.3],
        "earnings": [4.1, 3.7, 3.0, 2.2, 2.3, 2.5],
        "house_prices": [2.6, 2.1, 2.4, 2.8, 2.8, 2.7],
    }
    for key, values in printed.items():
        assert [parsed[key].values[y] for y in YEARS] == [
            round(v / 100, 4) for v in values
        ], key


def test_table_a1_reconciles_with_its_changes_since_march():
    """October minus the committed pre (policyengine-uk's March 2026 series)
    is Table A.2's change since March, to its rounding (0.1 points): so pre
    is the March 2026 EFO and post is October's."""
    parsed, _ = read_pdf_table_a1(OCT_TEXT.read_text(), YEARS)
    # Table A.2, 2027 to 2030 (PDF page 184)
    table_a2 = {
        "cpi": [1.5, 0.1, 0.1, 0.0],
        "rpi": [1.3, 0.3, 0.1, 0.0],
        "earnings": [0.6, 0.1, 0.1, 0.1],
        "house_prices": [-0.5, 0.1, 0.2, 0.3],
    }
    forecast = _outlook_forecast()["forecast"]
    pre = {
        s["key"]: {int(p["year"]): p["value"] for p in s["pre"]}
        for sec in forecast["sections"]
        for s in sec["series"]
    }
    for key, changes in table_a2.items():
        for year, change in zip(range(2027, 2031), changes):
            ours = (parsed[key].values[year] - pre[key][year]) * 100
            assert abs(ours - change) <= 0.1 + 1e-9, (key, year)


def test_the_committed_pre_is_march_and_post_is_october():
    """Forecast changes draws two forecasts: pre (March 2026) must not be
    overwritten by the October forecast the projections now run on."""
    forecast = _outlook_forecast()["forecast"]
    cpi = next(
        s
        for sec in forecast["sections"]
        for s in sec["series"]
        if s["key"] == "cpi"
    )
    pre = {p["year"]: p["value"] for p in cpi["pre"]}
    post = {p["year"]: p["value"] for p in cpi["post"]}
    assert (pre["2027"], post["2027"]) == (0.02, 0.034)
    check_pre_is_march(forecast, INPUTS / EFO_FILE_NAME)


def test_a_pre_series_from_the_october_forecast_is_refused():
    """The build's guard: October values in pre fail against the March EFO."""
    forecast = copy.deepcopy(_outlook_forecast()["forecast"])
    for sec in forecast["sections"]:
        for s in sec["series"]:
            if s["key"] == "cpi":
                s["pre"] = [dict(p) for p in s["post"]]
    with pytest.raises(ForecastTableError, match="cpi"):
        check_pre_is_march(forecast, INPUTS / EFO_FILE_NAME)


def test_the_committed_post_document_reproduces_from_the_october_tables():
    outlook = _outlook_forecast()
    saved = json.loads((INPUTS / POST_FILE_NAME).read_text())
    doc = read_post_document(
        INPUTS / OCT_TABLES,
        outlook,
        saved["label"],
        saved["source"]["url"],
    )
    assert doc["series"] == saved["series"]
    assert doc["source"]["file_sha256"] == saved["source"]["file_sha256"]
    # The detailed tables carry every series, CPIH, rents, mortgage interest
    # and non-labour income included.
    assert not [k for k, v in doc["series"].items() if v["values"] is None]
    # The committed outlook carries it, and no longer says post repeats pre
    published = json.loads(COMMITTED.read_text())
    assert STALE_POST_NOTE not in published["meta"]["notes"]
    applied = apply_post(json.loads(json.dumps(published)), saved)
    assert applied["forecast"] == published["forecast"]
    check_contract(published)


def test_a_series_absent_from_the_source_is_refused_unless_named(tmp_path):
    outlook = _outlook_forecast()
    parsed, _ = read_pdf_table_a1(OCT_TEXT.read_text(), YEARS)
    with pytest.raises(ForecastTableError, match="cpih"):
        compute_post(outlook["forecast"], parsed)
