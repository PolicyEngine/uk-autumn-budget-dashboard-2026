"""Generate receipted artifacts: one per measure, one per combined set.

This is the artifact counterpart of ``DataPipeline.run``. It builds the same
baseline and reform simulations and runs the same calculators, but instead
of rewriting shared CSVs it writes each measure's tables and receipt to its
own write-once directory. A combined set is one simulation of all its
members, checked beforehand to contain each member's changes.

A measure that cannot be receipted is refused and reported; the others are
still written.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

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
    ReceiptInputs,
    ReceiptUnavailable,
    build_receipt_document,
    code_revision,
    combined_identities,
    load_basis,
    measure_identities,
    receipt_api,
)
from uk_budget_data.publication.tables import (
    bin_scatter,
)


@dataclass
class GenerationReport:
    """What a generation run wrote and what it refused."""

    written: list[ArtifactRef] = field(default_factory=list)
    refused: dict[str, str] = field(default_factory=dict)


def result_tables(result: ReformResult) -> dict[str, list[dict]]:
    """An artifact's tables from one processed reform."""
    return {
        "budgetary_impact": result.budgetary_impact,
        "distributional_impact": result.distributional_impact,
        "winners_losers": result.winners_losers,
        "metrics": result.metrics,
        "income_curve": result.income_curve,
        "household_scatter_binned": bin_scatter(result.household_scatter),
        "constituency": result.constituency,
        "demographic_constituency": result.demographic_constituency,
    }


def _config_baseline_identity(config: DataConfig):
    api, _ = receipt_api()
    return api.reform_identity(
        config.baseline_parameter_changes or None,
        (
            "policyengine-uk.reform_dict/v1"
            if config.baseline_parameter_changes
            else None
        ),
        name="configured baseline",
    )


def _default_process(reform: Reform, config: DataConfig, baseline, reformed):
    from uk_budget_data.pipeline import ReformProcessor

    return ReformProcessor(reform, config).process(baseline, reformed)


def _default_build(dataset_path: Optional[str], scenario=None):
    """Build a microsimulation, recording the dataset's hash at load.

    A bundle dataset loaded by name has its hash recorded by policyengine's
    materializer. A dataset given as a local path does not, so it is hashed
    here immediately before the simulation reads it, never later: a hash
    taken at receipt time could describe bytes put in place after others
    ran.
    """
    from policyengine.utils.hashing import sha256_file

    from uk_budget_data.pipeline import build_microsimulation

    load_hash = (
        sha256_file(dataset_path)
        if dataset_path and Path(dataset_path).is_file()
        else None
    )
    sim = build_microsimulation(dataset_path, scenario)
    bundle = getattr(sim, "policyengine_bundle", None)
    if (
        load_hash is not None
        and isinstance(bundle, dict)
        and not bundle.get("runtime_dataset_sha256")
    ):
        bundle["runtime_dataset_sha256"] = load_hash
    return sim


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
            simulation) and returns a ReformResult.
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
    config_baseline = _config_baseline_identity(config)
    dataset_path = str(config.dataset_path) if config.dataset_path else None
    argv = list(generator_argv) if generator_argv is not None else None

    def run(
        reform: Reform,
        key: str,
        identities,
        members,
        measure_ids,
        member_outputs=None,
    ):
        baseline_identity, reform_identity = identities
        baseline_scenario = (
            reform.to_baseline_scenario() or config.get_baseline_scenario()
        )
        baseline = build(dataset_path, baseline_scenario)
        reformed = build(dataset_path, reform.to_scenario())
        result = process(reform, config, baseline, reformed)

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
                config_baseline_identity=config_baseline,
                members=members,
                member_outputs=member_outputs,
            )
            if argv is not None:
                inputs.generator_argv = argv
            return build_receipt_document(baseline, reformed, inputs)

        reference = write_artifact(
            result_tables(result), key, build_receipt, artifacts_root
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
            identities = measure_identities(reform, config, revision)
            run(reform, reform.id, identities, None, [reform.id])
        except ReceiptUnavailable as error:
            report.refused[reform.id] = error.reason
            on_progress(f"{reform.id}: REFUSED: {error.reason}")

    for members in combined_sets or []:
        from uk_budget_data.publication import combine

        ordered = combine.member_order(members)
        ids = [member.id for member in ordered]
        key = combine.combined_key(ids)
        try:
            combined = combine.combine_measures(ordered, config)
            combine.check_consistency(
                combined, ordered, config, list(config.years)
            )
            # Bind each side with the phase its combined Scenario runs in.
            combined_baseline = (
                combined.to_baseline_scenario()
                or config.get_baseline_scenario()
            )
            baseline_identity, reform_identity, records = combined_identities(
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
            )
        except ReceiptUnavailable as error:
            report.refused[key] = error.reason
            on_progress(f"{key}: REFUSED: {error.reason}")
        except (combine.CombineConflict, combine.CombineInconsistent) as error:
            report.refused[key] = str(error)
            on_progress(f"{key}: REFUSED: {error}")
    return report
