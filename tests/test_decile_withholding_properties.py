"""Properties of decile withholding, including the pre-change contract."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tests.publication_support import make_tables
from tests.test_disclosure_floor import _Dataset, _Simulation
from uk_budget_data.publication import disclosure_floor as floor
from uk_budget_data.publication import generate, publish, tables

YEARS = (2027, 2028)
BASELINE = "f80215e7e3afe154ab18be6a33e6b002085800eb"


@st.composite
def populations(draw):
    """Survey households with several records, deciles and change masks."""
    copies = draw(st.lists(st.integers(1, 4), min_size=1, max_size=25))
    survey = np.repeat(np.arange(len(copies)), copies)
    size = len(survey)
    deciles = np.asarray(
        draw(st.lists(st.integers(1, 10), min_size=size, max_size=size))
    )
    changes = {
        year: np.asarray(
            draw(st.lists(st.booleans(), min_size=size, max_size=size))
        )
        for year in YEARS
    }
    return survey, deciles, changes


def _found(population):
    """Find thin groups independently for both years and decile tables."""
    survey, deciles, changes = population
    found = {}
    for year, changed in changes.items():
        thin = floor.thin_groups(floor.decile_groups(deciles), changed, survey)
        if thin:
            for table in floor.DECILE_TABLES:
                found[table, year] = thin
    return found


def _rows(table, deciles, changes):
    """Synthetic weighted means with each published row's actual label."""
    rows = []
    weights = np.arange(len(deciles)) % 5 + 1
    baseline_income = np.arange(len(deciles)) + 10_000
    for year, changed in changes.items():
        for label, mask in floor.decile_groups(deciles).items():
            if table == "distributional_impact" and label == "all":
                continue
            numerator = (changed[mask] * weights[mask] * 100).sum()
            denominator = (
                (baseline_income[mask] * weights[mask]).sum() / 100
                if table == "distributional_impact"
                else weights[mask].sum()
            )
            published_label = label
            if table == "distributional_impact":
                n = int(label)
                suffix = {1: "st", 2: "nd", 3: "rd"}.get(n, "th")
                published_label = f"{n}{suffix}"
            rows.append(
                {
                    "reform_id": "a",
                    "reform_name": "A",
                    "year": year,
                    "decile": published_label,
                    (
                        "value"
                        if table == "distributional_impact"
                        else "avg_change"
                    ): (
                        float(numerator / denominator) if denominator else 0.0
                    ),
                }
            )
    return rows


@given(populations())
@settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_no_publishable_decile_cell_remains_thin(population):
    """Whole-measure thin runs remain refused; every other thin row is blank."""
    found = _found(population)
    withheld = floor.withheld_decile_cells(found)
    record = floor.floor_record(found, withheld=withheld)
    whole_thin = any("all" in labels for labels in found.values())
    assert record["thin_cells_in_tables"] is whole_thin
    _, deciles, changes = population
    published = {}
    for table in floor.DECILE_TABLES:
        rows = floor.withhold_decile_rows(
            _rows(table, deciles, changes), table, withheld
        )
        published[table] = rows
        value_column = (
            "value" if table == "distributional_impact" else "avg_change"
        )
        for row in rows:
            thin = found.get((table, row["year"]), [])
            if "all" in thin:
                continue
            if row[value_column] is not None:
                assert floor.decile_label(row["decile"]) not in thin
    problems = publish._floor_problems(
        {"disclosure_floor": record}, published, "staged"
    )
    assert (
        any(
            "fewer than 3 survey households" in problem for problem in problems
        )
        is whole_thin
    )
    if not whole_thin:
        assert problems == []


@given(populations())
@settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_complementary_all_withholding_prevents_difference_recovery(
    population,
):
    """No published linear combination can recover a withheld decile.

    Treat each decile's weighted change as an independent coordinate.
    Published decile means are multiples of coordinate vectors, and the
    overall mean has nonzero coefficients in every populated decile. The
    rank test covers every sum and difference, including weighted ones.
    """
    found = _found(population)
    withheld = floor.withheld_decile_cells(found)
    _, deciles, changes = population
    for year in YEARS:
        has_withheld_decile = any(
            label != "all"
            for table in floor.DECILE_TABLES
            for label in withheld.get((table, year), [])
        )
        if has_withheld_decile:
            assert "all" in withheld.get(("winners_losers", year), [])
        for table in floor.DECILE_TABLES:
            hidden = set(withheld.get((table, year), []))
            if not hidden:
                continue
            labels = [str(n) for n in range(1, 11)]
            if table == "winners_losers":
                labels.append("all")
            vectors = {
                label: (
                    np.asarray(
                        [np.any(deciles == n) for n in range(1, 11)],
                        dtype=float,
                    )
                    if label == "all"
                    else np.eye(10)[int(label) - 1]
                )
                for label in labels
            }
            published = [
                vectors[label] for label in labels if label not in hidden
            ]
            matrix = np.asarray(published).reshape(-1, 10)
            rank = np.linalg.matrix_rank(matrix) if len(matrix) else 0
            for label in hidden:
                if label in vectors:
                    assert (
                        np.linalg.matrix_rank(
                            np.vstack([matrix, vectors[label]])
                        )
                        > rank
                    )


@given(
    own=populations(), members=st.lists(populations(), min_size=1, max_size=4)
)
@settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_package_withholding_contains_the_members_union(own, members):
    inherited = {}
    for member in members:
        for cell, labels in floor.withheld_decile_cells(
            _found(member)
        ).items():
            inherited.setdefault(cell, set()).update(labels)
    inherited = {cell: sorted(labels) for cell, labels in inherited.items()}
    package = floor.withheld_decile_cells(_found(own), inherited)
    for cell, labels in inherited.items():
        assert set(package[cell]) >= set(labels)
    for year in YEARS:
        if any(
            set(package.get((table, year), [])) - {"all"}
            for table in floor.DECILE_TABLES
        ):
            assert "all" in package["winners_losers", year]


@given(populations())
@settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_withholding_is_deterministic_and_idempotent(population):
    found = _found(population)
    first = floor.withheld_decile_cells(found)
    reordered = dict(reversed(list(found.items())))
    assert floor.withheld_decile_cells(reordered) == first
    _, deciles, changes = population
    for table in floor.DECILE_TABLES:
        rows = _rows(table, deciles, changes)
        once = floor.withhold_decile_rows(rows, table, first)
        assert floor.withhold_decile_rows(once, table, first) == once
        assert rows == _rows(table, deciles, changes)


@pytest.fixture(scope="module")
def previous_modules(tmp_path_factory):
    """Load the exact starting commit without modifying this worktree."""
    root = Path(__file__).resolve().parents[1]
    directory = tmp_path_factory.mktemp("disclosure-baseline")
    loaded = {}
    for name in ("disclosure_floor", "tables", "generate"):
        source = subprocess.check_output(
            [
                "git",
                "show",
                f"{BASELINE}:src/uk_budget_data/publication/{name}.py",
            ],
            cwd=root,
        )
        path = directory / f"{name}.py"
        path.write_bytes(source)
        module_name = f"_withholding_baseline_{name}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        loaded[name] = module
    loaded["generate"].disclosure_floor = loaded["disclosure_floor"]
    yield loaded
    for module in loaded.values():
        sys.modules.pop(module.__name__, None)


@given(populations())
@settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_no_thin_cells_preserve_baseline_bytes_and_floor_record(
    previous_modules, population
):
    """Compare real canonical writers and floor records with f80215e7."""
    survey, deciles, changes = population
    changes = {year: changed.copy() for year, changed in changes.items()}
    for changed in changes.values():
        for label in floor.thin_groups(
            floor.decile_groups(deciles), changed, survey
        ):
            if label != "all":
                changed[deciles == int(label)] = False
    population = survey, deciles, changes
    assert _found(population) == {}
    withheld = floor.withheld_decile_cells({})
    record = floor.floor_record({}, withheld=withheld)
    assert record.pop("withheld_cells", []) == []
    assert record == previous_modules["disclosure_floor"].floor_record({})
    household_ids = np.arange(len(survey))
    person = {
        "household_id": household_ids,
        "household_income_decile": deciles,
        "age": np.full(len(survey), 40),
    }
    household = {
        "household_id": household_ids,
        "household_income_decile": deciles,
        "household_net_income": np.full(len(survey), 10_000.0),
    }

    class Simulation(_Simulation):
        def calculate(self, variable, period, map_to):
            value = super().calculate(variable, period, map_to)
            if self is reformed and variable == "household_net_income":
                value.values = value.values + changes[period] * 100
            return value

    baseline = Simulation(household, person)
    reformed = Simulation(household, person)
    baseline.dataset = reformed.dataset = _Dataset()
    job = SimpleNamespace(
        config=SimpleNamespace(years=list(YEARS)),
        dataset_path=None,
        refuse_thin_deciles=False,
    )
    inputs = make_tables("a", {year: 1.0 for year in YEARS})
    for table in floor.DECILE_TABLES:
        inputs[table] = _rows(table, deciles, changes)
    old_result = SimpleNamespace(**inputs, age_impact=[], household_scatter=[])
    new_result = SimpleNamespace(**inputs, age_impact=[], household_scatter=[])
    from uk_budget_data import pipeline

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(
            pipeline, "scatter_survey_households", lambda sim, path: survey
        )
        old_warnings, old_record = previous_modules[
            "generate"
        ]._apply_disclosure_floor("a", job, baseline, reformed, old_result)
        new_warnings, new_record = generate._apply_disclosure_floor(
            "a", job, baseline, reformed, new_result
        )
    assert old_warnings == new_warnings == []
    assert new_record.pop("withheld_cells", []) == []
    assert old_record == new_record
    for table in inputs:
        rows = getattr(old_result, table)
        new_rows = getattr(new_result, table)
        old_bytes = previous_modules["tables"].canonical_csv(table, rows)
        assert tables.canonical_csv(table, new_rows) == old_bytes
        assert json.dumps(tables.normalise(table, new_rows)) == json.dumps(
            previous_modules["tables"].normalise(table, rows)
        )
