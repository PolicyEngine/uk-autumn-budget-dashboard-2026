"""Generate receipted artifacts: one per measure, one per combined set.

This is the artifact counterpart of ``DataPipeline.run``. It builds the same
baseline and reform simulations and runs the same calculators, but instead
of rewriting shared CSVs it writes each measure's tables and receipt to its
own write-once directory. A combined set is one simulation of all its
members, checked beforehand to contain each member's changes.

A measure that cannot be receipted is refused and reported; the others are
still written.
"""

import atexit
import hashlib
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from pydantic import ValidationError

from uk_budget_data import data_limits
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

    A combined run records the outputs each member had when it was made:
    the member's artifact from this run if it was generated here, otherwise
    its entry in the manifest beside ``artifacts_root``. A combined run
    whose members are in neither can be written but never staged.
    """
    report = GenerationReport()
    manifest = load_manifest(artifacts_root.parent)
    written_outputs: dict[str, str] = {}
    revision = code_revision(repo_root)
    basis = load_basis(repo_root / BASIS_PATH)
    configured_identity: list = []

    def baseline_for(reform: Reform, uses_config_baseline: bool):
        return reform.baseline_scenario_for(config, uses_config_baseline)

    def config_baseline():
        # Bound when a run first records it, so a configured baseline that
        # no requested run uses cannot stop the others.
        if not configured_identity:
            try:
                configured_identity.append(
                    _config_baseline_identity(config, revision)
                )
            except ValueError as error:  # a malformed Scenario included
                if is_code_defect(error):
                    raise
                raise ReceiptUnavailable(
                    "configured baseline", str(error).splitlines()[0]
                ) from error
        return configured_identity[0]

    dataset_path = str(config.dataset_path) if config.dataset_path else None
    argv = list(generator_argv) if generator_argv is not None else None

    def run(
        reform: Reform,
        key: str,
        identities,
        members,
        measure_ids,
        member_outputs=None,
        composition=None,
        uses_config_baseline=False,
    ):
        baseline_identity, reform_identity = identities
        baseline_scenario = _scenarios(
            key, lambda: baseline_for(reform, uses_config_baseline)
        )
        reform_scenario = _scenarios(key, reform.to_scenario)
        baseline = build(dataset_path, baseline_scenario)
        reformed = build(dataset_path, reform_scenario)
        # What the code that differs reads is watched while the run makes
        # the figures; a measure the data cannot cost is then published as
        # not computable.
        with data_limits.observing(baseline, reformed) as observed:
            result = process(
                reform, config, baseline, reformed, baseline_scenario
            )
        limits = _limits(
            baseline, reformed, baseline_scenario, reform_scenario, observed
        )

        def build_receipt(file_digests):
            inputs = ReceiptInputs(
                key=key,
                measure_ids=measure_ids,
                years=list(config.years),
                baseline_identity=baseline_identity,
                reform_identity=reform_identity,
                file_digests=file_digests,
                basis=basis,
                revision=revision,
                config_baseline_identity=(
                    config_baseline() if uses_config_baseline else None
                ),
                members=members,
                member_outputs=member_outputs,
                composition=composition,
                data_limits=limits,
            )
            if argv is not None:
                inputs.generator_argv = argv
            return build_receipt_document(baseline, reformed, inputs)

        reference = write_artifact(
            result_tables(result, list(config.years)),
            key,
            build_receipt,
            artifacts_root,
        )
        report.written.append(reference)
        written_outputs[key] = reference.outputs_sha256
        on_progress(
            f"{key}: {'wrote' if reference.created else 'unchanged'} "
            f"{reference.path}"
        )

    for reform in reforms:
        if reform.id.startswith(COMBINED_PREFIX):
            report.refused[reform.id] = (
                f"a measure id may not start with {COMBINED_PREFIX!r}"
            )
            continue
        try:
            identities = _scenarios(
                reform.id,
                lambda: measure_identities(reform, config, revision),
            )
            run(
                reform,
                reform.id,
                identities,
                None,
                [reform.id],
                uses_config_baseline=not reform.has_custom_baseline(),
            )
        except ReceiptUnavailable as error:
            report.refused[reform.id] = error.reason
            on_progress(f"{reform.id}: REFUSED: {error.reason}")

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
            combine.check_consistency(
                combined, ordered, config, list(config.years)
            )
            # Bind each side with the phase its combined Scenario runs in.
            combined_baseline = baseline_for(combined, uses_config)
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
            combined = combined.model_copy(update={"id": key})
            snapshot = {
                member: written_outputs.get(member)
                or (
                    manifest.measures[member].outputs_sha256
                    if member in manifest.measures
                    else None
                )
                for member in ids
            }
            run(
                combined,
                key,
                (baseline_identity, reform_identity),
                records,
                ids,
                member_outputs=(snapshot if all(snapshot.values()) else None),
                composition=composition,
                uses_config_baseline=uses_config,
            )
        except ReceiptUnavailable as error:
            report.refused[key] = error.reason
            on_progress(f"{key}: REFUSED: {error.reason}")
        except (combine.CombineConflict, combine.CombineInconsistent) as error:
            report.refused[key] = str(error)
            on_progress(f"{key}: REFUSED: {error}")
    return report
