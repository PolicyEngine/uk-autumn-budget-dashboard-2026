"""The national results in one run (``generate --national``).

Modal is never called: the Modal runner takes a fake remote. The artifacts
are made by the real generation and receipt code on the publication test
world's stand-in simulations (``tests.publication_support``), and compared
with those the separate commands make. The last test runs the real engine
on the invented dataset and is marked slow.
"""

import functools
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pytest

from tests.publication_support import World
from tests.test_publication_flow import YEARS, fake_process, reform
from uk_budget_data import cli, national, pipeline
from uk_budget_data.modal_runner import (
    ModalRunsFailed,
    ModalUnavailable,
    NationalModalRunner,
)
from uk_budget_data.models import DataConfig
from uk_budget_data.parallel import SerialRunner
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.generate import (
    generate_artifacts,
    run_artifact,
)
from uk_budget_data.publication.receipt import artifact_sha256

KEY = "combined--alpha+beta"
VALUES = {
    "alpha": {2027: -1.0, 2028: -2.0},
    "beta": {2027: -0.5, 2028: -0.6},
    KEY: {2027: -1.4, 2028: -2.5},
}
HIGHER_RATE_PATH = "gov.hmrc.income_tax.rates.uk[1].rate"


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


def measures():
    from uk_budget_data.models import Reform

    beta = Reform(
        id="beta",
        name="Beta",
        parameter_changes={HIGHER_RATE_PATH: {str(y): 0.41 for y in YEARS}},
    )
    # Given out of order: the flat files sort them, as --published-package.
    return [beta, reform("alpha")]


def rows_for(key: str, name: str = None) -> pipeline.FlatOutcome:
    """Stand-in package-file rows of one run, as a whole unit makes them."""
    return pipeline.FlatOutcome(
        reform_id=key,
        reform_name=name or key,
        distribution_rows=[
            {"reform_id": key, "year": y, "p50": 0.1 * i}
            for i, y in enumerate(YEARS)
        ],
        mobility_rows=[{"reform_id": key, "year": y} for y in YEARS],
        growth_rows=[{"reform_id": key, "year": YEARS[-1], "growth": 0.25}],
        messages=[f"done {key}"],
    )


def fake_rows(job, built, tables=national.NATIONAL_TABLES):
    assert len(built) == 2, "the artifact's two simulations"
    return rows_for(job.key)


def stand_in_run(calls):
    """``run_national_job`` with the stand-in rows in place of the engine's
    readers; records each job's key."""

    def run(job, tables):
        calls.append(job.key)
        return national.run_national_job(job, tables)

    return run


def artifacts_by_key(report):
    """Each written artifact's digest (receipt less its volatile fields)
    and table bytes, by key."""
    out = {}
    for reference in report.written:
        files = {
            path.name: path.read_bytes()
            for path in reference.path.iterdir()
            if path.name != "receipt.json"
        }
        out[reference.key] = (
            artifact_sha256(read_receipt(reference.path)),
            reference.outputs_sha256,
            reference.execution_identity_sha256,
            files,
        )
    return out


def test_one_run_writes_the_same_artifacts_as_the_separate_commands(
    world, monkeypatch, tmp_path
):
    """Measures, then their package: the same digests, outputs, execution
    identity and table bytes as ``--artifacts`` then ``--combined``, the
    package bound to the members written in the same run."""
    monkeypatch.setattr(national, "flat_tables_for", fake_rows)
    config = DataConfig(years=YEARS, output_dir=tmp_path / "out")
    common = dict(
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process(VALUES),
    )
    separate = world.artifacts.parent / "separate" / "artifacts"
    # ``generate --artifacts --reforms beta alpha --combined beta alpha``:
    # the members, then their package bound to them as just written.
    old = generate_artifacts(
        measures(),
        config,
        combined_sets=[measures()],
        artifacts_root=separate,
        **common,
    )
    # The national run plans through generate_artifacts with its runner;
    # the stand-in build and process are passed the same way.
    stash, calls = {}, []
    runner = national.LocalNationalRunner(stash, run=stand_in_run(calls))
    monkeypatch.setattr(
        generate_module,
        "_default_build",
        common["build"],
    )
    monkeypatch.setattr(generate_module, "_default_process", common["process"])
    result = run_with_defaults(
        measures(), config, runner, stash, world.artifacts
    )
    new = result.artifacts
    assert new.refused == {} and new.failed == {}
    assert [r.key for r in new.written] == ["beta", "alpha", KEY]
    # Members first, the package only after both were written.
    assert calls == ["beta", "alpha", KEY]
    assert artifacts_by_key(new) == artifacts_by_key(old)
    package = read_receipt(new.written[2].path)["dashboard"]
    assert set(package["member_outputs_sha256"]) == {"alpha", "beta"}
    assert sorted(stash) == ["alpha", "beta", KEY]


def run_with_defaults(reforms, config, runner, stash, root, **extra):
    """``run_national`` with generate_artifacts' build and process read at
    call time (the tests patch the module's defaults)."""
    original = generate_module.generate_artifacts

    def patched(*args, **kwargs):
        kwargs.setdefault("build", generate_module._default_build)
        kwargs.setdefault("process", generate_module._default_process)
        return original(*args, **kwargs)

    import uk_budget_data.publication.generate as module

    module.generate_artifacts = patched
    try:
        return national.run_national(
            reforms,
            config,
            runner,
            stash,
            artifacts_root=root,
            generator_argv=["test"],
            on_progress=lambda line: None,
            **extra,
        )
    finally:
        module.generate_artifacts = original


def test_the_package_is_still_refused_for_mismatched_members(
    world, monkeypatch, tmp_path
):
    """Two measures that set one parameter differently: the package is
    refused before it is simulated, as ``--combined`` refuses it, and no
    flat file is written."""
    monkeypatch.setattr(national, "flat_tables_for", fake_rows)
    monkeypatch.setattr(
        generate_module,
        "_default_build",
        lambda dataset, scenario=None: world.sim(),
    )
    values = {"alpha": VALUES["alpha"], "beta": VALUES["alpha"]}
    monkeypatch.setattr(
        generate_module, "_default_process", fake_process(values)
    )
    config = DataConfig(years=YEARS, output_dir=tmp_path / "out")
    stash = {}
    result = run_with_defaults(
        [reform("alpha", 0.21), reform("beta", 0.22)],
        config,
        national.LocalNationalRunner(stash),
        stash,
        world.artifacts,
    )
    assert KEY in result.artifacts.refused
    assert result.flat_files == []
    assert "not every artifact was written" in result.flat_skipped
    assert not (tmp_path / "out").exists()


def write_old_way(config, reforms):
    """The two ``--only ... --published-package`` commands' files, from
    whole units answered with the stand-in rows."""

    class Whole:
        jobs = 1
        in_process = True

        def map(self, function, units, on_result=lambda i, r: None):
            assert function is pipeline.run_flat_unit
            out = []
            for index, unit in enumerate(units):
                assert unit.years is None
                out.append(rows_for(unit.reform.id))
                on_result(index, out[-1])
            return out

    ordered = sorted(reforms, key=lambda r: r.id)
    pipeline.generate_income_distribution(
        ordered, config, runner=Whole(), combined_sets=[ordered]
    )
    pipeline.generate_income_growth(
        ordered, config, runner=Whole(), combined_sets=[ordered]
    )


FLAT = (
    pipeline.INCOME_DISTRIBUTION_FILE,
    pipeline.INCOME_MOBILITY_FILE,
    pipeline.INCOME_GROWTH_FILE,
)


def test_the_flat_files_are_the_published_package_commands_bytes(
    world, monkeypatch, tmp_path
):
    monkeypatch.setattr(national, "flat_tables_for", fake_rows)
    monkeypatch.setattr(
        generate_module,
        "_default_build",
        lambda dataset, scenario=None: world.sim(),
    )
    monkeypatch.setattr(
        generate_module, "_default_process", fake_process(VALUES)
    )
    new_dir, old_dir = tmp_path / "new", tmp_path / "old"
    stash = {}
    result = run_with_defaults(
        measures(),
        DataConfig(years=YEARS, output_dir=new_dir),
        national.LocalNationalRunner(stash),
        stash,
        world.artifacts,
    )
    assert result.flat_skipped is None
    assert result.flat_files == [new_dir / name for name in FLAT]
    write_old_way(DataConfig(years=YEARS, output_dir=old_dir), measures())
    for name in FLAT:
        assert (new_dir / name).read_bytes() == (old_dir / name).read_bytes()
    # Measures by id, then the package.
    text = (new_dir / pipeline.INCOME_DISTRIBUTION_FILE).read_text()
    assert text.index("alpha") < text.index("beta,") < text.index(KEY)


def test_flat_files_are_left_alone_without_a_package_or_when_asked(
    world, monkeypatch, tmp_path
):
    monkeypatch.setattr(national, "flat_tables_for", fake_rows)
    monkeypatch.setattr(
        generate_module,
        "_default_build",
        lambda dataset, scenario=None: world.sim(),
    )
    monkeypatch.setattr(
        generate_module, "_default_process", fake_process(VALUES)
    )
    config = DataConfig(years=YEARS, output_dir=tmp_path / "out")
    stash = {}
    one = run_with_defaults(
        [reform("alpha")],
        config,
        national.LocalNationalRunner(stash),
        stash,
        world.artifacts,
    )
    assert one.package_key is None and "no package" in one.flat_skipped
    stash = {}
    asked = run_with_defaults(
        measures(),
        config,
        national.LocalNationalRunner(stash),
        stash,
        world.artifacts,
        write_flat=False,
    )
    assert asked.flat_skipped == "--no-flat-files"
    assert not (tmp_path / "out").exists()


def test_the_stash_answers_only_whole_units_of_the_runs_it_holds():
    from uk_budget_data.pipeline import FlatUnit

    stash = {"alpha": rows_for("alpha")}
    runner = national.StashRunner(stash)
    unit = FlatUnit(
        reform("alpha"), DataConfig(years=YEARS), None, pipeline.DISTRIBUTION
    )
    [first] = runner.map(pipeline.run_flat_unit, [unit])
    [second] = runner.map(pipeline.run_flat_unit, [unit])
    assert first.distribution_rows == stash["alpha"].distribution_rows
    # A measure's lines are said once, with the first file.
    assert first.messages == ["done alpha"] and second.messages == []
    with pytest.raises(national.NationalError, match="per-year"):
        runner.map(pipeline.run_flat_unit, [replace(unit, years=(2027,))])
    with pytest.raises(national.NationalError, match="no package-file rows"):
        runner.map(
            pipeline.run_flat_unit,
            [replace(unit, reform=reform("beta"))],
        )
    stash["beta"] = rows_for("alpha")
    with pytest.raises(national.NationalError, match="alpha's"):
        runner.map(
            pipeline.run_flat_unit,
            [replace(unit, reform=reform("beta"))],
        )


def test_the_capturing_build_returns_what_it_built_in_order():
    built = []
    sims = iter(["baseline-sim", "reform-sim"])
    build = national.CapturingBuild(lambda d, s=None: next(sims), built)
    assert build(None, "b") == "baseline-sim"
    assert build(None, "r") == "reform-sim"
    assert built == [("b", "baseline-sim"), ("r", "reform-sim")]


class Job:
    def __init__(self, uses_config_baseline, config=None):
        self.uses_config_baseline = uses_config_baseline
        self.config = config or DataConfig(years=YEARS)
        self.dataset_path = None


def test_rows_reuse_the_artifacts_simulations_only_on_the_same_baseline():
    built = [("b", "baseline-sim"), ("r", "reform-sim")]
    fresh = []

    def build(dataset, scenario=None):
        fresh.append(scenario)
        return f"fresh-{len(fresh)}"

    plain = reform("alpha")  # no baseline of its own: uses the configured
    assert national.flat_simulations(Job(True), plain, built, build) == (
        "baseline-sim",
        "reform-sim",
        True,
    )
    assert fresh == []
    # A configured baseline the flat path would use and the artifact did
    # not: built again, on the flat path's scenarios.
    config = DataConfig(
        years=YEARS,
        baseline_parameter_changes={HIGHER_RATE_PATH: {"2027": 0.4}},
    )
    baseline, reformed, reused = national.flat_simulations(
        Job(False, config), plain, built, build
    )
    assert (baseline, reformed, reused) == ("fresh-1", "fresh-2", False)
    assert fresh[0] == plain.baseline_scenario_for(config)
    # The artifact built nothing (refused before its builds): built again.
    assert national.flat_simulations(Job(True), plain, [], build)[2] is False


@dataclass
class JobStub:
    """Enough of an ArtifactRun for ``run_national_job``."""

    key: str = "alpha"
    build: object = None


def test_a_refused_artifact_reads_no_rows(monkeypatch):
    from uk_budget_data.publication.generate import ArtifactOutcome

    monkeypatch.setattr(
        generate_module,
        "run_artifact",
        lambda job: ArtifactOutcome(key="alpha", refused="no"),
    )
    monkeypatch.setattr(
        national,
        "flat_tables_for",
        lambda *a: pytest.fail("no rows for a refused run"),
    )
    outcome, rows = national.run_national_job(JobStub())
    assert outcome.refused == "no" and rows is None


# --- the Modal runner ------------------------------------------------------


def returned(job, rows_key=None):
    """What a national container sends back, for the runner."""
    from tests.test_modal_artifacts import FILES, _returned

    outcome, relative, files = _returned(job.key, FILES)
    return outcome, relative, files, rows_for(rows_key or job.key)


class ModalJob:
    def __init__(self, key, root):
        self.key = key
        self.artifacts_root = root
        self.dataset_path = None


def test_the_modal_runner_keeps_each_containers_rows(tmp_path):
    jobs = [ModalJob("alpha", tmp_path), ModalJob("beta", tmp_path)]
    stash = {}
    runner = NationalModalRunner(
        stash,
        lambda sent, smoke: [returned(job) for job in sent],
        say=lambda line: None,
    )
    results = runner.map(run_artifact, jobs)
    assert [r.key for r in results] == ["alpha", "beta"]
    assert sorted(stash) == ["alpha", "beta"]
    assert (tmp_path / "beta" / "abcd1234abcd1234" / "receipt.json").exists()
    with pytest.raises(ModalUnavailable, match="artifacts only"):
        runner.map(pipeline.run_flat_unit, [])


def test_the_modal_runner_refuses_rows_of_another_run(tmp_path):
    runner = NationalModalRunner(
        {},
        lambda sent, smoke: [returned(sent[0], rows_key="beta")],
        say=lambda line: None,
    )
    with pytest.raises(ModalUnavailable, match="beta's rows"):
        runner.map(run_artifact, [ModalJob("alpha", tmp_path)])


def test_a_failed_container_keeps_the_others_and_writes_no_flat_file(
    tmp_path,
):
    stash = {}
    runner = NationalModalRunner(
        stash,
        lambda sent, smoke: [
            returned(sent[0]),
            RuntimeError("out of memory"),
        ],
        say=lambda line: None,
    )
    with pytest.raises(ModalRunsFailed) as error:
        runner.map(
            run_artifact,
            [ModalJob("alpha", tmp_path), ModalJob("beta", tmp_path)],
        )
    assert list(error.value.failed) == ["beta"] and list(stash) == ["alpha"]


# --- the command -----------------------------------------------------------

PACKAGE = [
    "carers_allowance_earnings_taper",
    "domestic_electricity_zero_vat",
    "fuel_duty_rise_deferral",
    "household_energy_payment_2026",
    "property_income_rates_up",
    "state_pension_income_tax_protection",
    "trading_allowance_raise",
]
# The release's seven (savings rates held back), and their package.
RELEASE_KEY = "combined--f91fe847275730cb"
MANIFEST_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "src/test/fixtures/publication/manifest.json"
)


def test_dry_run_prints_the_plan_and_runs_nothing(monkeypatch, capsys):
    monkeypatch.setattr(
        national, "run_national", lambda *a, **k: pytest.fail("ran")
    )
    from uk_budget_data.publication.combine import combined_key

    key = combined_key(PACKAGE)
    code = cli.main(
        [
            "generate",
            "--national",
            "--backend",
            "modal",
            "--dry-run",
            "--combined-key",
            key,
            "--reforms",
            *PACKAGE,
        ]
    )
    out = capsys.readouterr().out
    assert code == 0
    assert key == RELEASE_KEY
    assert f"7 measures and their package {key}" in out
    assert "prime the dataset cache" in out and "30 min limit" in out
    assert "total: about 13-17 min" in out
    assert "Dry run: nothing was run." in out


@pytest.mark.parametrize(
    "arguments, message",
    [
        (["--reforms", *PACKAGE, "--combined-key", "combined--x"], "not"),
        (["--manifest", "/nonexistent/manifest.json"], "no publication"),
        (["--reforms", *PACKAGE, "--artifacts"], "leave out --artifacts"),
        (
            ["--reforms", *PACKAGE, "--only", "income_growth"],
            "leave out --only",
        ),
        (["--reforms", "no_such_measure"], "unknown reform ids"),
    ],
)
def test_the_command_refuses_what_it_cannot_run(
    monkeypatch, capsys, arguments, message
):
    monkeypatch.setattr(
        national, "run_national", lambda *a, **k: pytest.fail("ran")
    )
    code = cli.main(["generate", "--national", "--dry-run", *arguments])
    assert code == 1
    assert message in capsys.readouterr().out


def test_the_manifests_published_set_is_its_displayable_measures():
    from uk_budget_data.publication import manifest as m

    ids = cli.manifest_measures(MANIFEST_FIXTURE)
    manifest = m.parse_manifest(MANIFEST_FIXTURE.read_bytes())
    assert ids == sorted(
        key
        for key, entry in manifest.measures.items()
        if entry.status in m.DISPLAYABLE
    )
    with pytest.raises(ValueError, match="no publication manifest"):
        cli.manifest_measures("/nonexistent/manifest.json")


def test_without_reforms_the_measures_are_the_manifests_published_set(
    monkeypatch, capsys
):
    seen = []
    monkeypatch.setattr(
        national, "run_national", lambda *a, **k: pytest.fail("ran")
    )
    monkeypatch.setattr(
        cli, "manifest_measures", lambda path: seen.append(path) or PACKAGE
    )
    code = cli.main(
        [
            "generate",
            "--national",
            "--dry-run",
            "--manifest",
            "release/manifest.json",
            "--combined-key",
            RELEASE_KEY,
        ]
    )
    out = capsys.readouterr().out
    assert code == 0 and seen == [Path("release/manifest.json")]
    assert "Measures from the publication manifest's published measures" in out
    assert f"7 measures and their package {RELEASE_KEY}" in out


def test_the_national_flags_need_national(capsys):
    assert cli.main(["generate", "--dry-run", "--reforms", PACKAGE[0]]) == 1
    assert "--dry-run goes with --national" in capsys.readouterr().out


def test_the_local_command_runs_measures_then_package_then_files(
    monkeypatch, capsys
):
    seen = {}

    def run_national(reforms, config, runner, stash, **kwargs):
        seen["ids"] = [r.id for r in reforms]
        seen["runner"] = runner
        return national.NationalReport(
            artifacts=generate_module.GenerationReport(),
            package_key="k",
            flat_files=[Path("public/data/income_distribution.csv")],
        )

    monkeypatch.setattr(national, "run_national", run_national)
    code = cli.main(
        ["generate", "--national", "--reforms", PACKAGE[1], PACKAGE[0]]
    )
    assert code == 0
    assert seen["ids"] == [PACKAGE[1], PACKAGE[0]]
    assert isinstance(seen["runner"], national.LocalNationalRunner)
    assert "flat file written" in capsys.readouterr().out


def test_the_cost_guards():
    """Read as the app's own guards are: ephemeral, capped, timed out, no
    retries, idle containers released."""
    from uk_budget_data import modal_limits

    assert modal_limits.NATIONAL_TIMEOUT_S == 30 * 60
    assert modal_limits.PRIME_TIMEOUT_S == 15 * 60
    assert modal_limits.MAX_CONTAINERS == 16
    assert modal_limits.NATIONAL_SCALEDOWN_S <= 300
    source = (
        Path(modal_limits.__file__).with_name("modal_generate.py").read_text()
    )
    national_part = source.split("# --- The national run")[1]
    for guard in (
        "timeout=modal_limits.NATIONAL_TIMEOUT_S",
        "timeout=modal_limits.PRIME_TIMEOUT_S",
        "max_containers=modal_limits.MAX_CONTAINERS",
        "scaledown_window=modal_limits.NATIONAL_SCALEDOWN_S",
        "retries=0",
    ):
        assert guard in national_part, guard
    assert "min_containers" not in national_part
    assert "keep_warm" not in national_part


# --- the real engine on the invented dataset ------------------------------


@pytest.mark.slow
def test_rows_read_after_the_artifact_are_the_flat_paths_bytes(
    monkeypatch, tmp_path
):
    """The engine on the invented dataset: each artifact is run in full
    (simulations, tables, floor, checks, up to the receipt, which refuses
    the uncertified dataset), its rows are then read from the same two
    simulations, and the three files are byte-identical to the
    ``--only ... --published-package`` path's, which builds its own."""
    from uk_budget_data import calculators, synthetic_dataset
    from uk_budget_data.reforms import get_reform

    dataset = synthetic_dataset.write(tmp_path / "synthetic.h5", 600, 2026)

    def own_ids(simulation, dataset_path):
        return np.asarray(simulation.calculate("household_id", 2026).values)

    monkeypatch.setattr(pipeline, "scatter_survey_households", own_ids)
    monkeypatch.setattr(
        calculators,
        "distribution_points",
        functools.partial(calculators.distribution_points, min_households=5),
    )
    reforms = [
        get_reform("trading_allowance_raise"),
        get_reform("savings_income_rates_up"),
    ]
    years = [2026, 2027, 2028]
    new_dir, old_dir = tmp_path / "new", tmp_path / "old"
    stash, reused = {}, []

    class AfterEachArtifact:
        """The national container's steps, here: the artifact (refused at
        its receipt on this dataset, after everything else), then its
        rows from the simulations it built."""

        jobs = 1
        in_process = True

        def map(self, function, jobs, on_result=lambda i, r: None):
            out = []
            for index, job in enumerate(jobs):
                built = []
                outcome = run_artifact(
                    replace(
                        job, build=national.CapturingBuild(job.build, built)
                    )
                )
                assert len(built) == 2, outcome.progress
                rows = national.flat_tables_for(job, built)
                reused.append("artifact's simulations" in rows.messages[0])
                stash[job.key] = rows
                out.append(outcome)
                on_result(index, outcome)
            return out

    config = DataConfig(output_dir=new_dir, dataset_path=dataset, years=years)
    generate_artifacts(
        reforms,
        config,
        combined_sets=[reforms],
        artifacts_root=tmp_path / "artifacts",
        generator_argv=["test"],
        runner=AfterEachArtifact(),
    )
    assert reused == [True, True, True]
    ordered = sorted(reforms, key=lambda r: r.id)
    answer = national.StashRunner(stash)
    pipeline.generate_income_distribution(
        ordered, config, runner=answer, combined_sets=[ordered]
    )
    pipeline.generate_income_growth(
        ordered, config, runner=answer, combined_sets=[ordered]
    )
    old = DataConfig(output_dir=old_dir, dataset_path=dataset, years=years)
    for generate in (
        pipeline.generate_income_distribution,
        pipeline.generate_income_growth,
    ):
        generate(ordered, old, runner=SerialRunner(), combined_sets=[ordered])
    for name in FLAT:
        whole = (old_dir / name).read_bytes()
        assert whole.count(b"\n") > 5, name
        assert (new_dir / name).read_bytes() == whole, name
