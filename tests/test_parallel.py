"""Running measures side by side (``--jobs``, ``--backend modal``).

The runners must give back every unit's result in unit order, so that the
files written are the same bytes as a serial run's; the process runner must
hold a unit back until its memory is free; and the Modal runner must refuse
what it cannot run. These tests use stand-ins: the real determinism check,
serial against ``--jobs auto`` on the certified data, is in the PR.
"""

import hashlib
import multiprocessing
import pickle
from pathlib import Path

import pandas as pd
import pytest

from tests import parallel_helpers
from uk_budget_data import parallel
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.parallel import (
    GB,
    ProcessRunner,
    RegisteredReform,
    SerialRunner,
    make_runner,
    plan_jobs,
    portable,
    resolve_reform,
)


class ReversingRunner:
    """Runs units last first, and returns them in unit order, as a pool
    whose units finish out of order does."""

    jobs = 2

    def __init__(self):
        self.ran = []

    def map(self, function, units, on_result=lambda i, r: None):
        units = list(units)
        results = [None] * len(units)
        for index in reversed(range(len(units))):
            results[index] = function(units[index])
            self.ran.append(index)
        for index, result in enumerate(results):
            on_result(index, result)
        return results


def snapshot(directory: Path) -> dict[str, str]:
    return {
        str(path.relative_to(directory)): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


# --- choosing the number of jobs -------------------------------------------


def test_a_number_of_jobs_is_taken_as_given_up_to_one_per_unit():
    assert plan_jobs("3", 10, 20.0, available=0).jobs == 3
    assert plan_jobs(4, 2, 20.0, available=0).jobs == 2
    with pytest.raises(ValueError):
        plan_jobs("0", 10, 20.0, available=0)


def test_auto_takes_what_the_free_memory_holds_after_the_reserve():
    # 64 GB free, 6 kept back: two 20 GB measures fit, not three.
    plan = plan_jobs("auto", 10, 20.0, available=64 * GB, cpus=18)
    assert plan.jobs == 2
    assert "64 GB free" in plan.reason


def test_auto_runs_one_at_a_time_when_one_measure_does_not_fit():
    assert plan_jobs("auto", 10, 20.0, available=8 * GB, cpus=18).jobs == 1


def test_auto_takes_no_more_than_the_cores_less_one_or_the_units():
    assert plan_jobs("auto", 10, 1.0, available=512 * GB, cpus=4).jobs == 3
    assert plan_jobs("auto", 2, 1.0, available=512 * GB, cpus=18).jobs == 2


def test_a_measure_s_footprint_grows_with_its_years():
    assert parallel.footprint_memory_gb(2) == pytest.approx(19.1)
    assert parallel.footprint_memory_gb(6) == pytest.approx(22.5)


def test_auto_runs_two_flat_measures_on_a_shared_mac():
    # 25 October: 21 GB free beside other sessions, six years, ten units.
    unit_gb = parallel.unit_memory_gb(6)
    assert plan_jobs("auto", 10, unit_gb, available=21 * GB, cpus=18).jobs == 2


def test_a_second_flat_measure_is_admitted_while_the_first_ramps():
    runner = parallel.ProcessRunner(
        2, parallel.unit_memory_gb(6), available=lambda: 21 * GB
    )
    assert runner._room(ramping=1)
    assert not runner._room(ramping=2)


def test_one_job_is_the_serial_runner():
    assert isinstance(make_runner("1", 10, 6), SerialRunner)


def test_heavy_swap_runs_one_at_a_time(monkeypatch):
    monkeypatch.setattr(parallel, "available_memory_bytes", lambda: 512 * GB)
    monkeypatch.setattr(parallel, "swap_used_bytes", lambda: 31 * GB)
    said = []
    runner = make_runner("4", 10, 6, say=said.append)
    assert isinstance(runner, SerialRunner)
    assert "swap" in said[0]


def test_free_memory_and_swap_can_be_read():
    assert parallel.available_memory_bytes() > 0
    assert parallel.swap_used_bytes() >= 0


# --- the runners -----------------------------------------------------------


def test_the_serial_runner_reports_in_order():
    seen = []
    results = SerialRunner().map(
        lambda x: x * 2, [1, 2, 3], on_result=lambda i, r: seen.append((i, r))
    )
    assert results == [2, 4, 6]
    assert seen == [(0, 2), (1, 4), (2, 6)]


def _context():
    methods = multiprocessing.get_all_start_methods()
    return multiprocessing.get_context(
        "forkserver" if "forkserver" in methods else "spawn"
    )


def test_the_process_runner_returns_units_in_order_however_they_finish():
    # The first unit is the slowest, so it finishes last.
    units = [0.6, 0.0, 0.2, 0.1]
    seen = []
    runner = ProcessRunner(
        3, 1.0, available=lambda: 512 * GB, poll_s=0.01, context=_context()
    )
    results = runner.map(
        parallel_helpers.slow_echo,
        units,
        on_result=lambda i, r: seen.append(i),
    )
    assert [r[0] for r in results] == units
    assert seen == [0, 1, 2, 3]
    # Each unit ran in a fresh worker, not in this process.
    import os

    assert all(pid != os.getpid() for _, pid in results)
    assert len({pid for _, pid in results}) == len(units)


def test_the_process_runner_raises_a_unit_s_failure():
    runner = ProcessRunner(
        2, 1.0, available=lambda: 512 * GB, poll_s=0.01, context=_context()
    )
    with pytest.raises(ValueError, match="unit 2 failed"):
        runner.map(parallel_helpers.fail_on_two, [1, 2, 3])


def test_a_unit_waits_until_its_memory_is_free():
    # No room at first: the runner waits, polling, before the first unit.
    readings = iter([0, 0, 0] + [512 * GB] * 100)
    waits = []
    runner = ProcessRunner(
        2,
        10.0,
        available=lambda: next(readings),
        poll_s=0.01,
        on_wait=waits.append,
        context=_context(),
    )
    results = runner.map(parallel_helpers.slow_echo, [0.0, 0.0])
    assert [r[0] for r in results] == [0.0, 0.0]
    assert len(waits) == 1 and "10 GB" in waits[0]


def test_a_second_unit_waits_for_the_first_when_memory_is_short():
    # Room for one unit: once it runs, the free memory reads short, so the
    # second starts only after the first has ended.
    readings = iter([17 * GB, 5 * GB] + [17 * GB] * 100)
    runner = ProcessRunner(
        2,
        10.0,
        available=lambda: next(readings),
        poll_s=0.01,
        context=_context(),
    )
    results = runner.map(parallel_helpers.timed_echo, [0.3, 0.0])
    (start_a, end_a), (start_b, _) = results
    assert start_b >= end_a


def test_a_unit_starts_alone_when_memory_never_frees():
    """On a busy machine the free figure may never reach the estimate. With
    none running, a unit then starts alone after alone_wait_s, as a serial
    run would, instead of waiting without end; the run waits so once."""
    waits = []
    runner = ProcessRunner(
        2,
        10.0,
        available=lambda: 0,
        poll_s=0.01,
        alone_wait_s=0.05,
        on_wait=waits.append,
        context=_context(),
    )
    results = runner.map(parallel_helpers.timed_echo, [0.0, 0.0])
    (start_a, end_a), (start_b, _) = results
    assert start_b >= end_a
    assert sum("starting the next unit alone" in w for w in waits) == 1
    assert sum("waiting for" in w for w in waits) == 1


# --- carrying measures to workers ------------------------------------------


def test_a_picklable_measure_is_sent_as_itself():
    reform = Reform(id="m", name="M", parameter_changes={})
    assert portable(reform) is reform
    assert resolve_reform(portable(reform)) is reform


def test_an_unpicklable_registered_measure_is_sent_by_id():
    from uk_budget_data.reforms import get_reform

    combined = get_reform("autumn_budget_2026_combined")
    with pytest.raises(Exception):
        pickle.dumps(combined)
    reference = portable(combined)
    assert reference == RegisteredReform("autumn_budget_2026_combined")
    pickle.dumps(reference)
    assert resolve_reform(reference).id == combined.id


def test_an_unpicklable_unregistered_measure_is_refused():
    reform = Reform(
        id="not_registered", name="X", simulation_modifier=lambda sim: sim
    )
    with pytest.raises(ValueError, match="not a registered measure"):
        portable(reform)
    with pytest.raises(ValueError, match="not a registered measure"):
        portable(reform, ProcessRunner(2, 1.0))


def test_a_serial_run_takes_an_unpicklable_unregistered_measure_as_is():
    """Its units never leave this process, so a test's stand-in or an
    unregistered template measure still runs serially, as before --jobs."""
    reform = Reform(
        id="not_registered", name="X", simulation_modifier=lambda sim: sim
    )
    assert portable(reform, SerialRunner()) is reform


# --- the flat CSVs: same bytes whatever the order --------------------------


def _fake_outcome(unit):
    from uk_budget_data.pipeline import FlatOutcome

    reform = resolve_reform(unit.reform)
    rows = {
        "reform_id": reform.id,
        "reform_name": reform.name,
    }
    result = None
    if "flat" in unit.tables:
        result = ReformResult(
            reform_id=reform.id,
            reform_name=reform.name,
            budgetary_impact=[
                {**rows, "year": year, "value": len(reform.id) / year}
                for year in unit.config.years
            ],
            distributional_impact=[],
            winners_losers=[],
            metrics=[],
            income_curve=[],
            household_scatter=[],
            constituency=[],
            demographic_constituency=[],
            age_impact=[
                {**rows, "year": year, "age_band": "16-24", "change": 1.5}
                for year in unit.config.years
            ],
        )
    cells = [
        {
            **rows,
            "year": year,
            "income_band": 10_000,
            "change_band": 0,
            "change_band_upper": 10,
            "households": 100,
            "income_basis_year": unit.config.years[0],
        }
        for year in unit.config.years
    ]
    return FlatOutcome(
        reform_id=reform.id,
        result=result,
        age_rows=result.age_impact if result else [],
        scatter_cells=cells if "household_scatter" in unit.tables else [],
        messages=[f"done {reform.id}"],
    )


@pytest.mark.parametrize("only", [None, "age_impact", "household_scatter"])
def test_the_flat_files_are_the_same_bytes_in_any_order(
    monkeypatch, tmp_path, capsys, only
):
    from uk_budget_data import pipeline

    monkeypatch.setattr(pipeline, "run_flat_unit", _fake_outcome)
    reforms = [
        Reform(id=name, name=name.title(), parameter_changes={})
        for name in ("alpha", "beta", "gamma")
    ]

    def run(directory, runner):
        config = DataConfig(output_dir=directory, years=[2027, 2028])
        if only == "age_impact":
            pipeline.generate_age_impact(reforms, config, runner=runner)
        elif only == "household_scatter":
            pipeline.generate_household_scatter(reforms, config, runner=runner)
        else:
            pipeline.generate_all_data(
                reforms,
                config,
                skip_input_check=True,
                runner=runner,
                household_scatter=True,
            )
        return capsys.readouterr().out

    run(tmp_path / "serial", SerialRunner())
    reversing = ReversingRunner()
    parallel_out = run(tmp_path / "parallel", reversing)
    assert reversing.ran == [2, 1, 0]
    assert snapshot(tmp_path / "serial") == snapshot(tmp_path / "parallel")
    assert snapshot(tmp_path / "serial")
    # Each measure's lines in measure order, as a serial run says them.
    assert [
        line for line in parallel_out.splitlines() if line.startswith("done")
    ] == ["done alpha", "done beta", "done gamma"]
    if only is None:
        written = sorted(p.name for p in (tmp_path / "serial").iterdir())
        assert "household_scatter_binned.csv" in written
        assert "age_impact.csv" in written
        frame = pd.read_csv(tmp_path / "serial" / "budgetary_impact.csv")
        assert list(frame["reform_id"]) == [
            "alpha",
            "alpha",
            "beta",
            "beta",
            "gamma",
            "gamma",
        ]


def test_the_full_run_writes_the_same_scatter_as_the_scatter_alone(
    monkeypatch, tmp_path
):
    from uk_budget_data import pipeline

    monkeypatch.setattr(pipeline, "run_flat_unit", _fake_outcome)
    reforms = [Reform(id="alpha", name="Alpha", parameter_changes={})]
    full = DataConfig(output_dir=tmp_path / "full", years=[2027])
    alone = DataConfig(output_dir=tmp_path / "alone", years=[2027])
    pipeline.generate_all_data(
        reforms, full, skip_input_check=True, household_scatter=True
    )
    pipeline.generate_household_scatter(reforms, alone)
    name = pipeline.HOUSEHOLD_SCATTER_FILE
    assert (tmp_path / "full" / name).read_bytes() == (
        tmp_path / "alone" / name
    ).read_bytes()


# --- receipted artifacts: same artifacts whatever the order ---------------


@pytest.fixture
def world(monkeypatch):
    from tests.publication_support import World
    from uk_budget_data.publication import generate as generate_module

    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


def test_artifacts_are_the_same_whatever_order_they_run_in(world, tmp_path):
    from tests.test_publication_flow import (
        HIGHER_RATE_PATH,
        YEARS,
        fake_process,
        reform,
    )
    from uk_budget_data.publication.generate import generate_artifacts

    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: -0.5, 2028: -0.6},
        "combined--alpha+beta": {2027: -1.4, 2028: -2.5},
    }
    beta = Reform(
        id="beta",
        name="Beta",
        parameter_changes={HIGHER_RATE_PATH: {str(y): 0.41 for y in YEARS}},
    )
    measures = [reform("alpha"), beta]

    def run(root, runner):
        lines = []
        report = generate_artifacts(
            measures,
            DataConfig(years=YEARS),
            combined_sets=[measures],
            artifacts_root=root,
            generator_argv=["test"],
            build=lambda dataset, scenario=None: world.sim(),
            process=fake_process(values),
            on_progress=lines.append,
            runner=runner,
        )
        return report, lines

    serial, serial_lines = run(tmp_path / "serial", SerialRunner())
    reversing = ReversingRunner()
    other, other_lines = run(tmp_path / "parallel", reversing)
    assert reversing.ran  # it ran them, last first
    assert [r.key for r in other.written] == [r.key for r in serial.written]
    assert [r.artifact_sha256 for r in other.written] == [
        r.artifact_sha256 for r in serial.written
    ]
    assert serial.refused == {}, serial.refused
    assert [r.key for r in serial.written][-1].startswith("combined--")
    assert other.refused == serial.refused
    assert len(other_lines) == len(serial_lines)

    def tables(directory):
        return {
            name: digest
            for name, digest in snapshot(directory).items()
            if not name.endswith("receipt.json")
        }

    assert tables(tmp_path / "serial") == tables(tmp_path / "parallel")


# --- results by area: the same tables whatever the order ------------------


def test_area_tables_are_the_same_whatever_order_measures_run_in(
    monkeypatch, tmp_path
):
    from tests.test_geography import run_cli
    from uk_budget_data import geography as g

    outputs = []
    for name, runner in (("serial", None), ("parallel", ReversingRunner())):
        directory = tmp_path / name
        directory.mkdir()
        monkeypatch.setattr(g, "_geography_runner", lambda parsed: runner)
        code, out, _ = run_cli(monkeypatch, directory)
        assert code == 0
        outputs.append(snapshot(out))
    assert outputs[0] == outputs[1]
    assert outputs[0]


# --- Modal ----------------------------------------------------------------


def _flat_unit(reform_id="alpha", dataset_path=None):
    from uk_budget_data.pipeline import FLAT, FlatUnit

    return FlatUnit(
        reform=Reform(id=reform_id, name=reform_id, parameter_changes={}),
        config=DataConfig(years=[2027]),
        dataset_path=dataset_path,
        tables=FLAT,
    )


def test_modal_runs_the_flat_units_and_keeps_their_order():
    from uk_budget_data.modal_runner import ModalRunner
    from uk_budget_data.pipeline import FlatOutcome, run_flat_unit

    sent = []

    def remote(units):
        sent.extend(units)
        for unit in units:
            yield FlatOutcome(reform_id=unit.reform.id)

    seen = []
    units = [_flat_unit("alpha"), _flat_unit("beta")]
    results = ModalRunner(say=lambda m: None, remote=remote).map(
        run_flat_unit, units, on_result=lambda i, r: seen.append(i)
    )
    assert [r.reform_id for r in results] == ["alpha", "beta"]
    assert sent == units
    assert seen == [0, 1]


def test_modal_refuses_a_result_out_of_order():
    from uk_budget_data.modal_runner import ModalRunner, ModalUnavailable
    from uk_budget_data.pipeline import FlatOutcome, run_flat_unit

    def remote(units):
        for unit in reversed(units):
            yield FlatOutcome(reform_id=unit.reform.id)

    with pytest.raises(ModalUnavailable, match="in place of"):
        ModalRunner(say=lambda m: None, remote=remote).map(
            run_flat_unit, [_flat_unit("alpha"), _flat_unit("beta")]
        )


def test_modal_refuses_a_missing_result():
    from uk_budget_data.modal_runner import ModalRunner, ModalUnavailable
    from uk_budget_data.pipeline import run_flat_unit

    with pytest.raises(ModalUnavailable, match="0 results for 1 units"):
        ModalRunner(say=lambda m: None, remote=lambda units: []).map(
            run_flat_unit, [_flat_unit()]
        )


def test_modal_runs_flat_units_on_the_bundle_s_dataset_only():
    from uk_budget_data.modal_runner import ModalRunner, ModalUnavailable
    from uk_budget_data.pipeline import run_flat_unit

    runner = ModalRunner(say=lambda m: None, remote=lambda units: [])
    with pytest.raises(ModalUnavailable, match="bundle's dataset"):
        runner.map(run_flat_unit, [_flat_unit(dataset_path="local.h5")])
    with pytest.raises(ModalUnavailable, match="flat CSVs"):
        runner.map(len, [_flat_unit()])


def test_modal_without_the_package_says_how_to_get_it(monkeypatch):
    import builtins

    from uk_budget_data.modal_runner import ModalUnavailable, _modal_remote

    real_import = builtins.__import__

    def no_modal(name, *args, **kwargs):
        if name == "modal":
            raise ImportError("No module named 'modal'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_modal)
    with pytest.raises(ModalUnavailable, match="--with modal"):
        list(_modal_remote([_flat_unit()]))


def test_the_modal_backend_is_chosen_by_the_flag():
    from uk_budget_data.modal_runner import ModalRunner

    assert isinstance(make_runner("1", 3, 6, backend="modal"), ModalRunner)
    with pytest.raises(ValueError):
        make_runner("1", 3, 6, backend="elsewhere")


def test_the_modal_app_exposes_no_web_endpoint_and_one_secret():
    """Read from the source, since modal is not installed here."""
    source = (
        Path(__file__).parents[1] / "src/uk_budget_data/modal_generate.py"
    ).read_text()
    assert "asgi_app" not in source and "web_endpoint" not in source
    assert "fastapi_endpoint" not in source and "wsgi_app" not in source
    assert source.count("modal.Secret.from_name(") == 1
    # The smoke test's app has no secret at all.
    assert "smoke_app = modal.App(" in source
    assert 'required_keys=["HUGGING_FACE_TOKEN"]' in source
    assert ".uv_sync(" in source and "frozen=True" in source


def test_artifacts_on_modal_never_send_a_dataset_file(capsys):
    from uk_budget_data import cli

    parsed = cli.parse_args(
        [
            "generate",
            "--artifacts",
            "--backend",
            "modal",
            "--dataset",
            "local.h5",
        ]
    )
    assert cli.run_generate(parsed) == 1
    assert "never sends a dataset file" in capsys.readouterr().out


def test_jobs_must_be_a_whole_number_or_auto():
    from uk_budget_data import cli

    parsed = cli.parse_args(["generate", "--jobs", "many"])
    with pytest.raises(SystemExit):
        cli.runner_for(parsed, 3, 2)
    assert cli.parse_args(["generate", "--jobs", "auto"]).jobs == "auto"
    assert cli.parse_args(["geography", "--jobs", "3"]).jobs == "3"


def test_a_unit_still_ramping_up_counts_at_its_whole_estimate():
    # 30 GB free, 6 kept back: room for one 14 GB unit with room to spare,
    # and for a second only if the first is counted at what it uses now; the
    # first has not grown yet, so the second waits until it has had
    # time to (here, until it ends: ramp_s is long).
    runner = ProcessRunner(
        2,
        14.0,
        available=lambda: 30 * GB,
        poll_s=0.01,
        ramp_s=60.0,
        context=_context(),
    )
    (start_a, end_a), (start_b, _) = runner.map(
        parallel_helpers.timed_echo, [0.3, 0.0]
    )
    assert start_b >= end_a
    # With the ramp over at once, both run side by side.
    runner.ramp_s = 0.0
    (start_a, end_a), (start_b, _) = runner.map(
        parallel_helpers.timed_echo, [0.5, 0.0]
    )
    assert start_b < end_a
