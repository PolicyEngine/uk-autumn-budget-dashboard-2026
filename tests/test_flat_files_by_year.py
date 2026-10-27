"""income_distribution and income_growth, one unit per measure and year.

On Modal (``generate --only income_distribution|income_growth --backend
modal``) each measure's years run in containers of their own, side by side,
and are folded back into one outcome per measure (``pipeline.flat_units``
with ``by_year``, ``pipeline.merge_year_outcomes``). The files must be the
same bytes as one unit over every year: same rows, same order, same
rounding, and income_growth's floor applied across every year after the
merge. ``--sequential`` keeps one unit per measure.

The last test runs the real engine on the invented ``synthetic_dataset`` (no
survey data), both ways, and compares the three files byte for byte.
"""

import filecmp
import functools

import numpy as np
import pytest

from tests.test_income_growth_with_measures import cells as growth_cells
from uk_budget_data import calculators, cli, pipeline
from uk_budget_data.living_standards import measures_growth
from uk_budget_data.models import DataConfig
from uk_budget_data.reforms import get_reform

YEARS = [2026, 2027, 2028, 2029]


class Recorder:
    """A runner that keeps the units and answers each from ``answer``."""

    def __init__(self, answer):
        self.answer = answer
        self.units = []

    def map(self, function, units, on_result=lambda i, r: None):
        assert function is pipeline.run_flat_unit
        self.units = list(units)
        results = []
        for index, unit in enumerate(self.units):
            results.append(self.answer(unit))
            on_result(index, results[-1])
        return results


def distribution_answer(unit):
    """One row per year read, as ``run_flat_unit`` appends them."""
    years = unit.years or tuple(unit.config.years)
    return pipeline.FlatOutcome(
        reform_id=unit.reform.id,
        years=unit.years,
        reform_name=getattr(unit.reform, "name", unit.reform.id),
        distribution_rows=[
            {"reform_id": unit.reform.id, "year": y, "side": s}
            for y in years
            for s in ("baseline", "reform")
        ],
        mobility_rows=[
            {"reform_id": unit.reform.id, "year": y} for y in years
        ],
        messages=[f"limit of {unit.reform.id}", f"done {unit.reform.id}"],
    )


def test_units_are_measure_major_and_year_minor(tmp_path):
    reforms = [get_reform("threshold_freeze_2031_32")]
    sets = [
        [
            get_reform("threshold_freeze_2031_32"),
            get_reform("road_fuel_vat_cut"),
        ]
    ]
    runner = Recorder(distribution_answer)
    config = DataConfig(output_dir=tmp_path, years=YEARS)
    pipeline.generate_income_distribution(
        reforms, config, runner=runner, combined_sets=sets, by_year=True
    )
    ids = [reform.id for reform in pipeline.with_combined_sets(reforms, sets)]
    assert [(u.reform.id, u.years) for u in runner.units] == [
        (reform_id, (year,)) for reform_id in ids for year in YEARS
    ]
    # The config is never cut down: a measure composes as in a whole unit
    assert all(u.config.years == YEARS for u in runner.units)


def test_merged_files_are_the_whole_units_bytes(tmp_path):
    reforms = [get_reform("threshold_freeze_2031_32")]
    sets = [
        [
            get_reform("threshold_freeze_2031_32"),
            get_reform("road_fuel_vat_cut"),
        ]
    ]
    for by_year in (False, True):
        out = tmp_path / str(by_year)
        pipeline.generate_income_distribution(
            reforms,
            DataConfig(output_dir=out, years=YEARS),
            runner=Recorder(distribution_answer),
            combined_sets=sets,
            by_year=by_year,
        )
    for name in (
        pipeline.INCOME_DISTRIBUTION_FILE,
        pipeline.INCOME_MOBILITY_FILE,
    ):
        assert filecmp.cmp(
            tmp_path / "False" / name, tmp_path / "True" / name, shallow=False
        )


def test_messages_are_said_once_per_measure(capsys, tmp_path):
    reforms = [get_reform("threshold_freeze_2031_32")]
    pipeline.flat_units(
        reforms,
        DataConfig(output_dir=tmp_path, years=YEARS),
        None,
        pipeline.DISTRIBUTION,
        Recorder(distribution_answer),
        by_year=True,
    )
    said = capsys.readouterr().out
    assert said.count("limit of threshold_freeze_2031_32") == 1
    assert said.count("done threshold_freeze_2031_32") == 1


def per_year_growth(all_cells_base, all_cells_reform, years):
    return [
        pipeline.FlatOutcome(
            reform_id="m",
            reform_name="M",
            years=(year,),
            growth_cells={
                "baseline": {year: all_cells_base[year]},
                "reform": {year: all_cells_reform[year]},
            },
            messages=["✓ M"],
        )
        for year in years
    ]


def test_growth_rows_are_made_after_the_merge_from_every_year():
    base = growth_cells(households=3000)
    reform = growth_cells({2028: 0.01}, households=3000)
    years = sorted(base)
    merged = pipeline.merge_year_outcomes(
        per_year_growth(base, reform, years), years, pipeline.GROWTH
    )
    whole = measures_growth.growth_rows(
        "m", "M", base, reform, years[1:], measures_growth.deflator()
    )
    assert merged.growth_rows == whole and whole
    assert merged.messages == ["✓ M"]


def test_the_growth_floor_reads_every_year_after_the_merge():
    # 3000 households pass every grouping's floor; one year of 1500 puts
    # the vigintiles (75 each) under it. The whole grouping is withheld,
    # every year, as one unit over every year withholds it.
    base = growth_cells(households=3000)
    thin = growth_cells(households=1500)
    years = sorted(base)
    base[years[2]] = thin[years[2]]
    merged = pipeline.merge_year_outcomes(
        per_year_growth(base, base, years), years, pipeline.GROWTH
    )
    groupings = {row["grouping"] for row in merged.growth_rows}
    assert "vigintile" not in groupings and "quintile" in groupings
    assert merged.growth_rows == measures_growth.growth_rows(
        "m", "M", base, base, years[1:], measures_growth.deflator()
    )


def test_a_missing_or_misplaced_year_is_refused():
    base = growth_cells(households=3000)
    years = sorted(base)
    outcomes = per_year_growth(base, base, years)
    with pytest.raises(ValueError, match="per-year outcomes"):
        pipeline.merge_year_outcomes(outcomes[:-1], years, pipeline.GROWTH)
    swapped = [outcomes[1], outcomes[0], *outcomes[2:]]
    with pytest.raises(ValueError, match="in place of"):
        pipeline.merge_year_outcomes(swapped, years, pipeline.GROWTH)


def test_only_the_two_package_files_split_by_year(tmp_path):
    with pytest.raises(ValueError, match="by_year"):
        pipeline.flat_units(
            [get_reform("threshold_freeze_2031_32")],
            DataConfig(output_dir=tmp_path),
            None,
            pipeline.AGE,
            Recorder(distribution_answer),
            by_year=True,
        )


def test_the_modal_runner_checks_each_outcomes_year():
    from uk_budget_data.modal_runner import ModalRunner, ModalUnavailable
    from uk_budget_data.parallel import RegisteredReform

    config = DataConfig()
    units = [
        pipeline.FlatUnit(
            RegisteredReform("m"), config, None, pipeline.GROWTH, (year,)
        )
        for year in (2026, 2027)
    ]
    said = []
    good = ModalRunner(
        say=said.append,
        remote=lambda us: [
            pipeline.FlatOutcome(reform_id="m", years=u.years) for u in us
        ],
    ).map(pipeline.run_flat_unit, units)
    assert [o.years for o in good] == [(2026,), (2027,)]
    assert "one container per measure and year" in said[0]
    with pytest.raises(ModalUnavailable, match="years"):
        ModalRunner(
            say=lambda m: None,
            remote=lambda us: [
                pipeline.FlatOutcome(reform_id="m", years=(2026,)) for u in us
            ],
        ).map(pipeline.run_flat_unit, units)


@pytest.mark.parametrize(
    "args, by_year",
    [
        (["--backend", "modal"], True),
        (["--backend", "modal", "--sequential"], False),
        ([], False),
        (["--sequential"], False),
    ],
)
def test_the_cli_splits_by_year_on_modal_unless_sequential(
    monkeypatch, tmp_path, args, by_year
):
    calls = {}

    def record(name):
        def fake(reforms=None, config=None, runner=None, **kwargs):
            calls[name] = kwargs.get("by_year")

        return fake

    for name in ("generate_income_distribution", "generate_income_growth"):
        monkeypatch.setattr(cli, name, record(name))
    ids = ["threshold_freeze_2031_32", "road_fuel_vat_cut"]
    for only in ("income_distribution", "income_growth"):
        parsed = cli.parse_args(
            [
                "generate",
                "--output-dir",
                str(tmp_path),
                "--only",
                only,
                "--combined",
                *ids,
                *args,
            ]
        )
        assert cli.run_generate(parsed) == 0
    assert calls == {
        "generate_income_distribution": by_year,
        "generate_income_growth": by_year,
    }


@pytest.mark.slow
def test_per_year_units_write_the_same_bytes_on_the_engine(
    monkeypatch, tmp_path
):
    """The real engine on the invented dataset: each year built and read in
    fresh simulations of its own gives the rows the six-year unit gives,
    and the merged files are byte-identical. The invented dataset has no
    survey-household ids, so each record is its own; the distribution's
    floor is lowered so its 1,500 households keep points to compare."""
    from uk_budget_data import synthetic_dataset

    dataset = synthetic_dataset.write(tmp_path / "synthetic.h5", 1500, 2026)

    def own_ids(simulation, dataset_path):
        return np.asarray(simulation.calculate("household_id", 2026).values)

    monkeypatch.setattr(pipeline, "scatter_survey_households", own_ids)
    monkeypatch.setattr(
        calculators,
        "distribution_points",
        functools.partial(calculators.distribution_points, min_households=5),
    )
    reforms = [get_reform("threshold_freeze_2031_32")]
    sets = [
        [
            get_reform("threshold_freeze_2031_32"),
            get_reform("plan_2_threshold_unfreeze"),
        ]
    ]
    years = [2026, 2027, 2028]
    for by_year in (False, True):
        config = DataConfig(
            output_dir=tmp_path / str(by_year),
            dataset_path=dataset,
            years=years,
        )
        pipeline.generate_income_distribution(
            reforms, config, combined_sets=sets, by_year=by_year
        )
        pipeline.generate_income_growth(
            reforms, config, combined_sets=sets, by_year=by_year
        )
    for name in (
        pipeline.INCOME_DISTRIBUTION_FILE,
        pipeline.INCOME_MOBILITY_FILE,
        pipeline.INCOME_GROWTH_FILE,
    ):
        whole = (tmp_path / "False" / name).read_bytes()
        # Something to compare: rows for the measure and the package
        assert whole.count(b"\n") > 10, name
        assert whole == (tmp_path / "True" / name).read_bytes(), name


def test_per_year_cost_guards():
    """The per-year cap and timeout, read as the app's own guards are."""
    from pathlib import Path

    from uk_budget_data import modal_runner

    assert modal_runner.YEAR_MAX_CONTAINERS == 64
    assert modal_runner.YEAR_TIMEOUT_S == 15 * 60
    source = Path(modal_runner.__file__).read_text()
    assert "max_containers=YEAR_MAX_CONTAINERS" in source
    assert "timeout=YEAR_TIMEOUT_S" in source
