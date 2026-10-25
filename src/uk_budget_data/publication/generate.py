"""Generate receipted artifacts: one per measure, one per combined set.

This is the artifact counterpart of ``DataPipeline.run``. It builds the same
baseline and reform simulations and runs the same calculators, but instead
of rewriting shared CSVs it writes each measure's tables and receipt to its
own write-once directory. A combined set is one simulation of all its
members, checked beforehand to contain each member's changes.

A measure that cannot be receipted is refused and reported; the others are
still written. One that leaves out a scored year of an uprated amount
(``uk_budget_data.scored_years``), or changes one of the engine's
wealth-tax scales in its ``parameter_changes``, is refused the same way,
before any simulation is built; one whose two built simulations differ in a
wealth-tax scale (a modifier that edits it) is refused once they are built,
before any figure is made. A measure or combined run the certified data
cannot cost (its run records a data limit) is still processed, since the
limits are observed while it runs, but its artifact is receipt-only: it is
listed as not computable and binds no figure, so no table is written.
"""

import atexit
import hashlib
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from pydantic import ValidationError

from uk_budget_data import data_limits, model_limits
from uk_budget_data.measure_templates import (
    wealth_tax_paths,
    wealth_tax_paths_differing,
    wealth_tax_refusal,
)
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication.artifacts import (
    ARTIFACTS_ROOT,
    COMBINED_PREFIX,
    ArtifactRef,
    write_artifact,
)
from uk_budget_data.publication.manifest import load_manifest
from uk_budget_data.publication.receipt import (
    BASIS_PATH,
    CodeRevision,
    ReceiptInputs,
    ReceiptUnavailable,
    build_receipt_document,
    code_revision,
    combined_identities,
    is_code_defect,
    load_basis,
    measure_identities,
    scenario_identity,
)
from uk_budget_data.publication.tables import bin_scatter
from uk_budget_data.publication.template_proof import (
    combined_templates_proof,
    measure_templates_proof,
)
from uk_budget_data.scored_years import missing_scored_years


@dataclass
class GenerationReport:
    """What a generation run wrote and what it refused."""

    written: list[ArtifactRef] = field(default_factory=list)
    refused: dict[str, str] = field(default_factory=dict)


def result_tables(
    result: ReformResult, years: Optional[list[int]] = None
) -> dict[str, list[dict]]:
    """An artifact's tables from one processed reform.

    Artifacts are published, so they carry no household-level rows and no
    constituency tables without disclosure control: the household scatter
    goes in binned only, and results by area come from the disclosure layer
    (#24). ``years`` is kept for callers.
    """
    return {
        "budgetary_impact": result.budgetary_impact,
        "distributional_impact": result.distributional_impact,
        "winners_losers": result.winners_losers,
        "metrics": result.metrics,
        "income_curve": result.income_curve,
        "household_scatter_binned": bin_scatter(result.household_scatter),
        "age_impact": result.age_impact,
    }


def _config_baseline_identity(config: DataConfig, revision: CodeRevision):
    """The configured baseline, bound exactly as a member that uses it binds
    its baseline (``receipt.measure_identities``), so the gate can tell a
    shared configured baseline from a member's own."""
    return scenario_identity(
        config.get_baseline_scenario(),
        name="configured baseline",
        revision=revision,
    )


def _default_process(
    reform: Reform, config: DataConfig, baseline, reformed, baseline_scenario
):
    from uk_budget_data.pipeline import ReformProcessor

    return ReformProcessor(reform, config).process(
        baseline, reformed, baseline_scenario
    )


_PRIVATE_COPIES: Optional[Path] = None


def _private_copy(dataset_path: str) -> tuple[str, str]:
    """A private, read-only copy of a local dataset, and its bytes' SHA-256.

    The file is read once: those bytes are both hashed and written to the
    copy the simulation loads, so a change to the original while (or after)
    the simulation reads it cannot make the hash describe other bytes. The
    copy keeps the original's file name and lives in a private directory
    until the process exits, because the receipt re-reads the loaded file.
    """
    global _PRIVATE_COPIES
    data = Path(dataset_path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if _PRIVATE_COPIES is None:
        _PRIVATE_COPIES = Path(tempfile.mkdtemp(prefix="uk-budget-datasets-"))
        atexit.register(shutil.rmtree, _PRIVATE_COPIES, ignore_errors=True)
    target = _PRIVATE_COPIES / digest / Path(dataset_path).name
    if not target.exists():
        target.parent.mkdir(mode=0o700, exist_ok=True)
        partial = target.with_name(target.name + ".part")
        partial.write_bytes(data)
        partial.chmod(0o400)
        partial.rename(target)
    return str(target), digest


def _default_build(dataset_path: Optional[str], scenario=None):
    """Build a microsimulation, recording the dataset's hash at load.

    A bundle dataset loaded by name has its hash recorded by policyengine's
    materializer. A dataset given as a local path does not, so the
    simulation loads a private copy of exactly the bytes hashed here
    (:func:`_private_copy`): a hash taken from the path at any other moment
    could describe bytes other than those that ran.
    """
    from uk_budget_data.pipeline import build_microsimulation

    load_hash = None
    if dataset_path and Path(dataset_path).is_file():
        dataset_path, load_hash = _private_copy(dataset_path)
    sim = build_microsimulation(dataset_path, scenario)
    bundle = getattr(sim, "policyengine_bundle", None)
    if (
        load_hash is not None
        and isinstance(bundle, dict)
        and not bundle.get("runtime_dataset_sha256")
    ):
        bundle["runtime_dataset_sha256"] = load_hash
    return sim


def _limits(
    baseline, reformed, baseline_scenario, reform_scenario, observation=None
):
    """The data limits a measure touches: from the two built parameter
    trees, which show what actually ran (modifiers included, a declared
    change undone, a respelled path), and from what the code that differs
    read while the run made the figures (``observation``); from the
    scenarios' parameter changes only for stand-in simulations with no tree
    (tests)."""
    if all(hasattr(sim, "tax_benefit_system") for sim in (baseline, reformed)):
        return data_limits.limits_touched(baseline, reformed, observation)
    return data_limits.limits_for_scenarios(baseline_scenario, reform_scenario)


def _model_limits(baseline, reformed, baseline_scenario, reform_scenario):
    """The model limits a measure touches: from the two built parameter
    trees and the models they run, as :func:`_limits` reads data limits;
    from the scenarios' parameter changes, against the installed model,
    only for stand-in simulations with no tree (tests)."""
    if all(hasattr(sim, "tax_benefit_system") for sim in (baseline, reformed)):
        return model_limits.limits_touched(baseline, reformed)
    return model_limits.limits_for_scenarios(
        baseline_scenario, reform_scenario
    )


def _scenarios(subject: str, build_them: Callable):
    """Run a step that builds scenarios, refusing the run (not stopping the
    generation) when the configuration cannot build one. Only a Scenario or
    Reform that fails validation is caught: a calculator failure, or a
    receipt model failing its own validation (``is_code_defect``), still
    raises."""
    try:
        return build_them()
    except ValidationError as error:
        if is_code_defect(error):
            raise
        raise ReceiptUnavailable(
            subject, f"invalid scenario: {str(error).splitlines()[0]}"
        ) from error


def _refuse_unscored_years(
    subject: str, baseline_scenario, reform_scenario, years: list[int]
) -> None:
    """Refuse a run whose either side leaves out a scored year of an
    uprated amount: after a bounded change the engine returns it to the
    old path (policyengine-uk #2430)."""
    from policyengine_uk.system import system

    gaps = missing_scored_years(
        getattr(baseline_scenario, "parameter_changes", None),
        getattr(reform_scenario, "parameter_changes", None),
        years,
        system,
    )
    if gaps:
        raise ReceiptUnavailable(subject, " ".join(gap.reason for gap in gaps))


@dataclass
class ArtifactRun:
    """One artifact's run: everything needed to make it, here or in a
    worker process (``--jobs``). The measure is carried as
    ``parallel.portable`` gives it; a combined run carries its members and
    is composed again where it runs, since a composed measure's modifiers
    cannot be pickled."""

    reform: object
    key: str
    identities: tuple
    members: Optional[list]
    measure_ids: list
    config: DataConfig
    revision: CodeRevision
    basis: object
    argv: Optional[list]
    artifacts_root: Path
    dataset_path: Optional[str]
    build: Callable
    process: Callable
    member_outputs: Optional[dict] = None
    composition: object = None
    uses_config_baseline: bool = False
    modifier_templates: object = None
    combine_members: Optional[list] = None


@dataclass
class ArtifactOutcome:
    """What one run wrote, or why it was refused, and its progress line."""

    key: str
    reference: Optional[ArtifactRef] = None
    refused: Optional[str] = None
    progress: list = field(default_factory=list)


def _run_reform(job: ArtifactRun) -> Reform:
    from uk_budget_data.parallel import resolve_reform

    if job.combine_members is None:
        return resolve_reform(job.reform)
    from uk_budget_data.publication import combine

    ordered = [resolve_reform(member) for member in job.combine_members]
    combined = combine.combine_measures(ordered, job.config)
    return combined.model_copy(update={"id": job.key})


def run_artifact(job: ArtifactRun) -> ArtifactOutcome:
    """Build one run's two simulations, process them under the data-limit
    watch, check the model limits and write its artifact. A run that cannot
    be receipted is refused, not raised; any other failure raises."""
    outcome = ArtifactOutcome(key=job.key)
    try:
        reference, limited = _write_run(job)
    except ReceiptUnavailable as error:
        outcome.refused = error.reason
        outcome.progress.append(f"{job.key}: REFUSED: {error.reason}")
        return outcome
    outcome.reference = reference
    note = " (not computable on current data: receipt only)"
    outcome.progress.append(
        f"{job.key}: {'wrote' if reference.created else 'unchanged'} "
        f"{reference.path}{note if limited else ''}"
    )
    return outcome


def _write_run(job: ArtifactRun) -> tuple[ArtifactRef, bool]:
    config = job.config
    reform = _run_reform(job)
    key = job.key
    baseline_identity, reform_identity = job.identities
    baseline_scenario = _scenarios(
        key,
        lambda: reform.baseline_scenario_for(config, job.uses_config_baseline),
    )
    reform_scenario = _scenarios(key, reform.to_scenario)
    _refuse_wealth_tax_base(key, baseline_scenario, reform_scenario)
    _refuse_unscored_years(
        key, baseline_scenario, reform_scenario, config.years
    )
    # Built under data_limits.building: a modifier that reads a limited
    # input while its simulation is built carries it past the watch, so
    # the build is watched too.
    baseline = data_limits.watched_build(
        job.build, job.dataset_path, baseline_scenario
    )
    reformed = data_limits.watched_build(
        job.build, job.dataset_path, reform_scenario
    )
    _refuse_wealth_tax_built(key, baseline, reformed)
    # What the code that differs reads is watched while the run makes the
    # figures; a measure the data cannot cost is then published as not
    # computable.
    with data_limits.observing(baseline, reformed) as observed:
        result = job.process(
            reform, config, baseline, reformed, baseline_scenario
        )
    limits = _limits(
        baseline, reformed, baseline_scenario, reform_scenario, observed
    )
    # A measure the installed model mis-costs is held at provisional.
    held = _model_limits(
        baseline, reformed, baseline_scenario, reform_scenario
    )
    configured_identity: list = []

    def config_baseline():
        # Bound when a run first records it, so a configured baseline that
        # no requested run uses cannot stop the others.
        if not configured_identity:
            try:
                configured_identity.append(
                    _config_baseline_identity(config, job.revision)
                )
            except ValueError as error:  # a malformed Scenario included
                if is_code_defect(error):
                    raise
                raise ReceiptUnavailable(
                    "configured baseline", str(error).splitlines()[0]
                ) from error
        return configured_identity[0]

    def build_receipt(file_digests):
        inputs = ReceiptInputs(
            key=key,
            measure_ids=job.measure_ids,
            years=list(config.years),
            baseline_identity=baseline_identity,
            reform_identity=reform_identity,
            file_digests=file_digests,
            basis=job.basis,
            revision=job.revision,
            config_baseline_identity=(
                config_baseline() if job.uses_config_baseline else None
            ),
            members=job.members,
            member_outputs=job.member_outputs,
            composition=job.composition,
            data_limits=limits,
            model_limits=held,
            name=reform.name,
            modifier_templates=(
                job.modifier_templates
                if job.modifier_templates is not None
                else measure_templates_proof(reform, config, job.revision)
            ),
        )
        if job.argv is not None:
            inputs.generator_argv = job.argv
        return build_receipt_document(baseline, reformed, inputs)

    # A run the data cannot cost writes its receipt alone: its tables hold
    # no figure the page may show, so none is published.
    reference = write_artifact(
        None if limits else result_tables(result, list(config.years)),
        key,
        build_receipt,
        job.artifacts_root,
    )
    return reference, bool(limits)


def _refuse_wealth_tax_base(
    subject: str, baseline_scenario, reform_scenario
) -> None:
    """Refuse a run whose either side changes one of the engine's
    wealth-tax scales in its ``parameter_changes``: they tax gross wealth,
    the wrong base for a wealth tax on net assets (the UK hub's
    budget-triage/JUDGED.md, S4). The templates refuse the path; this
    refuses it written as plain ``parameter_changes``."""
    paths = wealth_tax_paths(baseline_scenario, reform_scenario)
    if paths:
        raise ReceiptUnavailable(subject, wealth_tax_refusal(*paths))


def _refuse_wealth_tax_built(subject: str, baseline, reformed) -> None:
    """Refuse a run whose two built simulations differ in a wealth-tax
    scale, as a modifier that edits one leaves them with no
    ``parameter_changes``. Only for simulations with parameter trees, as
    :func:`_model_limits` reads them (stand-ins in tests have none)."""
    if not all(
        hasattr(sim, "tax_benefit_system") for sim in (baseline, reformed)
    ):
        return
    paths = wealth_tax_paths_differing(baseline, reformed)
    if paths:
        raise ReceiptUnavailable(subject, wealth_tax_refusal(*paths))


def generate_artifacts(
    reforms: list[Reform],
    config: DataConfig,
    *,
    combined_sets: Optional[list[list[Reform]]] = None,
    artifacts_root: Path = ARTIFACTS_ROOT,
    repo_root: Path = Path("."),
    generator_argv: Optional[list[str]] = None,
    build: Callable = _default_build,
    process: Callable = _default_process,
    on_progress: Callable[[str], None] = lambda message: None,
    runner=None,
) -> GenerationReport:
    """Write one artifact per measure and per combined set.

    Args:
        reforms: Measures to generate standalone.
        config: Years, dataset and paths, as for the flat pipeline.
        combined_sets: Lists of measures to simulate together.
        artifacts_root: Where artifact directories are written.
        repo_root: The repository, for the commit and tree state.
        generator_argv: The command line, recorded in each receipt.
        build: Builds a microsimulation from (dataset path, scenario).
        process: Runs the calculators for (reform, config, baseline, reform
            simulation, baseline scenario) and returns a ReformResult.
        on_progress: Called with a line of progress text.
        runner: Runs the artifacts (``parallel.SerialRunner`` by default).
            Each run is one unit; the standalone measures run first, then
            the combined sets, which record their members' outputs. Lines
            and the report come in the same order whatever the runner.

    A combined run records the outputs each member had when it was made:
    the member's artifact from this run if it was generated here, otherwise
    its entry in the manifest beside ``artifacts_root``. A combined run
    whose members are in neither can be written but never staged.
    """
    from uk_budget_data.parallel import SerialRunner, portable

    runner = runner or SerialRunner()
    report = GenerationReport()
    manifest = load_manifest(artifacts_root.parent)
    written_outputs: dict[str, str] = {}
    revision = code_revision(repo_root)
    basis = load_basis(repo_root / BASIS_PATH)
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    argv = list(generator_argv) if generator_argv is not None else None
    common = dict(
        config=config,
        revision=revision,
        basis=basis,
        argv=argv,
        artifacts_root=artifacts_root,
        dataset_path=dataset_path,
        build=build,
        process=process,
    )

    def run_all(slots: list) -> None:
        """Run the jobs among ``slots`` (a job, or an outcome already
        decided), reporting each slot in order as soon as it and every slot
        before it are done, so a serial run reports as it goes."""
        positions = [
            i for i, slot in enumerate(slots) if isinstance(slot, ArtifactRun)
        ]
        done = {
            i: slot
            for i, slot in enumerate(slots)
            if not isinstance(slot, ArtifactRun)
        }
        reported = 0

        def report_ready():
            nonlocal reported
            while reported < len(slots) and reported in done:
                outcome = done[reported]
                if outcome.reference is not None:
                    report.written.append(outcome.reference)
                    written_outputs[outcome.key] = (
                        outcome.reference.outputs_sha256
                    )
                if outcome.refused is not None:
                    report.refused[outcome.key] = outcome.refused
                for line in outcome.progress:
                    on_progress(line)
                reported += 1

        def finished(index, outcome):
            done[positions[index]] = outcome
            report_ready()

        report_ready()
        runner.map(
            run_artifact, [slots[i] for i in positions], on_result=finished
        )
        report_ready()

    slots: list = []
    for reform in reforms:
        if reform.id.startswith(COMBINED_PREFIX):
            slots.append(
                ArtifactOutcome(
                    key=reform.id,
                    refused=(
                        f"a measure id may not start with {COMBINED_PREFIX!r}"
                    ),
                )
            )
            continue
        try:
            identities = _scenarios(
                reform.id,
                lambda: measure_identities(reform, config, revision),
            )
        except ReceiptUnavailable as error:
            slots.append(
                ArtifactOutcome(
                    key=reform.id,
                    refused=error.reason,
                    progress=[f"{reform.id}: REFUSED: {error.reason}"],
                )
            )
            continue
        slots.append(
            ArtifactRun(
                reform=portable(reform, runner),
                key=reform.id,
                identities=identities,
                members=None,
                measure_ids=[reform.id],
                uses_config_baseline=not reform.has_custom_baseline(),
                **common,
            )
        )
    run_all(slots)

    slots = []
    for members in combined_sets or []:
        from uk_budget_data.publication import combine

        ordered = combine.member_order(members)
        ids = [member.id for member in ordered]
        key = combine.combined_key(ids)
        uses_config = any(
            not member.has_custom_baseline() for member in ordered
        )

        def prepare():
            combined = combine.combine_measures(ordered, config)
            # Before the consistency check builds its parameter snapshots.
            _refuse_wealth_tax_base(
                key,
                combined.baseline_scenario_for(config, uses_config),
                combined.to_scenario(),
            )
            _refuse_unscored_years(
                key,
                combined.baseline_scenario_for(config, uses_config),
                combined.to_scenario(),
                config.years,
            )
            combine.check_consistency(
                combined, ordered, config, list(config.years)
            )
            # Bind each side with the phase its combined Scenario runs in.
            combined_baseline = combined.baseline_scenario_for(
                config, uses_config
            )
            return combined, combined_identities(
                ordered,
                config,
                revision,
                reform_applied_before_data_load=(
                    combined.to_scenario().applied_before_data_load
                ),
                baseline_applied_before_data_load=(
                    combined_baseline.applied_before_data_load
                    if combined_baseline is not None
                    else False
                ),
            )

        try:
            combined, (
                baseline_identity,
                reform_identity,
                records,
                composition,
            ) = _scenarios(key, prepare)
            snapshot = {
                member: written_outputs.get(member)
                or (
                    manifest.measures[member].outputs_sha256
                    if member in manifest.measures
                    else None
                )
                for member in ids
            }
            slots.append(
                ArtifactRun(
                    reform=None,
                    combine_members=[portable(m, runner) for m in ordered],
                    key=key,
                    identities=(baseline_identity, reform_identity),
                    members=records,
                    measure_ids=ids,
                    member_outputs=(
                        snapshot if all(snapshot.values()) else None
                    ),
                    composition=composition,
                    uses_config_baseline=uses_config,
                    modifier_templates=combined_templates_proof(
                        ordered, config, revision
                    ),
                    **common,
                )
            )
        except ReceiptUnavailable as error:
            slots.append(
                ArtifactOutcome(
                    key=key,
                    refused=error.reason,
                    progress=[f"{key}: REFUSED: {error.reason}"],
                )
            )
        except (combine.CombineConflict, combine.CombineInconsistent) as error:
            slots.append(
                ArtifactOutcome(
                    key=key,
                    refused=str(error),
                    progress=[f"{key}: REFUSED: {error}"],
                )
            )
    run_all(slots)
    return report
