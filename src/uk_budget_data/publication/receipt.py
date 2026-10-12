"""Receipts for published artifacts.

Every artifact carries ``receipt.json`` with two parts:

- ``execution_receipt``: policyengine.py's execution receipt (schema v1). It
  names the installed wrapper, model and core, the data release and the bytes
  simulated, whether that pair is certified, the reform and baseline
  identities, the fiscal-year convention, the years and a digest of the
  artifact's outputs.
- ``dashboard``: what only this repository knows: the measures, the files,
  the commit and whether the tree was clean, the forecast and calibration
  basis, the years the dataset supports, and whether the artifact is
  publishable.

The receipt code is policyengine's own. Until the release that carries it is
pinned, a verbatim copy is vendored and used instead; this module never
reimplements a digest.
"""

import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any, Optional

from uk_budget_data.certified_data import load_bundle_manifest

REPOSITORY = "PolicyEngine/uk-autumn-budget-dashboard-2026"
SCHEMA = "uk-budget-dashboard/artifact-receipt/v1"
VENDORED_SOURCE = "vendored-w4-pr588@1ec7c76"
BASIS_PATH = Path("data_inputs/publication_basis.json")
BASIS_STATUSES = ("pre_budget", "updated")

# Paths the publication commands write; changes there do not make a tree
# dirty for receipt purposes.
# Paths the publication commands themselves write, which a clean tree may
# differ in: anything under the artifacts directory, and exactly the
# manifest file.
ARTIFACTS_PREFIX = "public/data/artifacts/"
MANIFEST_PATH = "public/data/manifest.json"
# Dashboard fields that describe one generation run rather than what was
# generated, left out of the artifact digest.
VOLATILE_DASHBOARD_FIELDS = ("generated_at", "generator_argv")

_REQUIRED_API = (
    "ExecutionReceipt",
    "ReceiptError",
    "build_execution_receipt_for_microsimulation",
    "composed_reform_identity",
    "content_sha256",
    "reform_identity",
    "scenario_reform_identity",
    "verify_certificate",
)


class ReceiptUnavailable(RuntimeError):
    """Raised when something cannot be bound by a receipt.

    Publication never works around this: a measure that cannot be receipted
    is not published.
    """

    def __init__(self, subject: str, reason: str):
        super().__init__(f"{subject}: cannot be receipted: {reason}")
        self.subject = subject
        self.reason = reason


def receipt_api() -> tuple[Any, str]:
    """policyengine's receipt module and a label saying which copy it is.

    The released module is used when it has everything this package needs;
    otherwise the vendored copy.
    """
    try:
        from policyengine.provenance import receipt as released
    except ImportError:
        released = None
    if released is not None and all(
        hasattr(released, name) for name in _REQUIRED_API
    ):
        return released, f"policyengine=={metadata.version('policyengine')}"
    from uk_budget_data.publication._vendor_w4 import receipt as vendored

    return vendored, VENDORED_SOURCE


@dataclass(frozen=True)
class CodeRevision:
    """The commit that defines the measures, and whether the tree matches."""

    git_sha: str
    tree_clean: bool
    dirty_paths: tuple[str, ...] = ()

    def as_binding(self) -> dict:
        return {"repository": REPOSITORY, "git_sha": self.git_sha}


def code_revision(repo_root: Path = Path(".")) -> CodeRevision:
    """Read HEAD and the working-tree state from git."""

    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    sha = git("rev-parse", "HEAD").strip()
    dirty = sorted(
        {
            path
            for path in porcelain_paths(git("status", "--porcelain", "-z"))
            if not is_publication_path(path)
        }
    )
    return CodeRevision(sha, not dirty, tuple(dirty))


def porcelain_paths(output: str) -> list[str]:
    """Every path in ``git status --porcelain -z`` output.

    A rename or copy entry names two paths, the new one and then the old
    one as the next NUL-separated field; both count.
    """
    fields = output.split("\0")
    paths = []
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if not entry:
            continue
        status, path = entry[:2], entry[3:]
        paths.append(path)
        if "R" in status or "C" in status:
            if index < len(fields) and fields[index]:
                paths.append(fields[index])
            index += 1
    return paths


def is_publication_path(path: str) -> bool:
    """Whether a changed path is one the publication commands write."""
    return path == MANIFEST_PATH or (
        path.startswith(ARTIFACTS_PREFIX) and ".." not in path.split("/")
    )


def scenario_identity(scenario, *, name: str, revision: CodeRevision):
    """Bind one side of a measure: a Scenario, or None for current law."""
    api, _ = receipt_api()
    if scenario is None:
        return api.reform_identity(None, name=name)
    try:
        return api.scenario_reform_identity(
            scenario, code_revision=revision.as_binding(), name=name
        )
    except (api.ReceiptError, ValueError) as error:
        raise ReceiptUnavailable(name, str(error)) from error


def measure_identities(reform, config, revision: CodeRevision):
    """The (baseline, reform) identities of one measure.

    The baseline is the measure's own baseline when it has one, otherwise
    the configured baseline, otherwise current law: the same precedence the
    pipeline uses to build the simulations.
    """
    baseline = reform.to_baseline_scenario() or config.get_baseline_scenario()
    return (
        scenario_identity(
            baseline, name=f"{reform.id} baseline", revision=revision
        ),
        scenario_identity(
            reform.to_scenario(), name=reform.id, revision=revision
        ),
    )


def combined_identities(
    members,
    config,
    revision: CodeRevision,
    *,
    reform_applied_before_data_load: bool,
    baseline_applied_before_data_load: bool,
):
    """The (baseline, reform) identities of a combined run, its members and
    how they were composed.

    Each side is the ordered composition of the members' own identities,
    bound with the phase (before or after data load) that side's combined
    Scenario runs in. ``members`` must already be in application order.

    Each member record says whether its baseline is one of the composed
    baselines (``baseline_bound``), and the returned ``composition`` gives
    each side's phase, so the gate can rebuild both identities from the
    records alone (:func:`composition_problems`).
    """
    api, _ = receipt_api()
    baselines, reforms, records = [], [], []
    configured_included = False
    for member in members:
        baseline, reform = measure_identities(member, config, revision)
        # Members without a baseline of their own share the configured one,
        # which the combined run applies once, so it is bound once.
        bound = member.has_custom_baseline() or not configured_included
        if bound:
            baselines.append(baseline)
            configured_included |= not member.has_custom_baseline()
        reforms.append(reform)
        records.append(
            {
                "id": member.id,
                "baseline": json.loads(baseline.model_dump_json()),
                "reform": json.loads(reform.model_dump_json()),
                "baseline_bound": bound,
            }
        )
    name = "+".join(member.id for member in members)
    composition = {
        "reform_applied_before_data_load": reform_applied_before_data_load,
        "baseline_applied_before_data_load": (
            baseline_applied_before_data_load
        ),
    }
    try:
        return (
            api.composed_reform_identity(
                baselines,
                applied_before_data_load=baseline_applied_before_data_load,
                name=f"{name} baseline",
            ),
            api.composed_reform_identity(
                reforms,
                applied_before_data_load=reform_applied_before_data_load,
                name=name,
            ),
            records,
            composition,
        )
    except (api.ReceiptError, ValueError) as error:
        raise ReceiptUnavailable(name, str(error)) from error


# The fields of an identity its digest depends on (``name`` is a label).
_IDENTITY_FIELDS = ("kind", "representation", "reform_sha256", "binding")


def _identity_core(identity) -> Optional[tuple]:
    if not isinstance(identity, dict):
        return None
    return tuple(identity.get(field) for field in _IDENTITY_FIELDS)


def composition_problems(document: dict) -> list[str]:
    """Ways a combined receipt's identities are not its members' composition.

    Rebuilds each side's composed identity from the member records, in
    record order, with the recorded phases, and compares it with the
    execution receipt. A member whose baseline is not composed must share
    one that is (the configured baseline, applied once).
    """
    dashboard = document["dashboard"]
    members = dashboard.get("members") or []
    composition = dashboard.get("composition")
    if not members:
        return []
    if not isinstance(composition, dict) or set(composition) != {
        "reform_applied_before_data_load",
        "baseline_applied_before_data_load",
    }:
        return ["it does not record how its members were composed"]
    api, _ = receipt_api()
    name = "+".join(str(record.get("id")) for record in members)
    try:
        reforms = [
            api.ReformIdentity.model_validate(record["reform"])
            for record in members
        ]
        # Every member baseline is a valid identity, applied or not.
        own_baselines = [
            api.ReformIdentity.model_validate(record["baseline"])
            for record in members
        ]
        if any(
            type(record["baseline_bound"]) is not bool for record in members
        ):
            return ["its member records do not say which baselines it applied"]
        bound = [record for record in members if record["baseline_bound"]]
        baselines = [
            identity
            for identity, record in zip(own_baselines, members)
            if record["baseline_bound"]
        ]
        rebuilt = {
            "reform": api.composed_reform_identity(
                reforms,
                applied_before_data_load=composition[
                    "reform_applied_before_data_load"
                ],
                name=name,
            ),
            "baseline": api.composed_reform_identity(
                baselines,
                applied_before_data_load=composition[
                    "baseline_applied_before_data_load"
                ],
                name=f"{name} baseline",
            ),
        }
    except (api.ReceiptError, ValueError, KeyError, TypeError) as error:
        return [f"its member records cannot be composed: {error}"]
    problems = []
    execution = document["execution_receipt"]
    for side, identity in rebuilt.items():
        if _identity_core(execution.get(side)) != _identity_core(
            json.loads(identity.model_dump_json())
        ):
            problems.append(
                f"its {side} identity is not the composition of its "
                "member records"
            )
    # Only the configured baseline is shared, so applied once for every
    # member that uses it. A member's own baseline is applied for that
    # member: it may never be left out, even when another member's is the
    # same (a modifier applied twice is not a modifier applied once).
    configured = _identity_core(dashboard.get("config_baseline"))
    composed = {_identity_core(record["baseline"]) for record in bound}
    for record in members:
        if record["baseline_bound"]:
            continue
        own = _identity_core(record["baseline"])
        if configured is None or own != configured:
            problems.append(
                f"member {record['id']} has its own baseline, which the "
                "run must apply"
            )
        elif own not in composed:
            problems.append(
                f"member {record['id']}'s baseline is not part of the run"
            )
    return problems


def dataset_years(sim) -> Optional[list[int]]:
    """Years the loaded dataset was projected to, or None if unknown.

    policyengine-uk extends a single-year dataset to a fixed end year
    (``extend_single_year_dataset`` in ``policyengine_uk/data/
    economic_assumptions.py``) and keeps the result as ``sim.dataset``, whose
    ``years`` lists them. Years beyond that range have no projected data.
    """
    years = getattr(getattr(sim, "dataset", None), "years", None)
    if not years:
        return None
    return sorted(int(year) for year in years)


def load_basis(path: Path = BASIS_PATH) -> dict:
    """The declared forecast and calibration basis for this publication."""
    basis = json.loads(path.read_text())
    for part in ("forecast", "calibration"):
        declared = basis.get(part) or {}
        if declared.get("status") not in BASIS_STATUSES:
            raise ValueError(
                f"{path}: {part}.status must be one of {BASIS_STATUSES}"
            )
        for key in ("source", "vintage"):
            if not declared.get(key):
                raise ValueError(f"{path}: {part}.{key} is required")
    return basis


def ci_run_url() -> Optional[str]:
    if not os.environ.get("GITHUB_RUN_ID"):
        return None
    return (
        f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/"
        f"{os.environ.get('GITHUB_REPOSITORY', REPOSITORY)}/actions/runs/"
        f"{os.environ['GITHUB_RUN_ID']}"
    )


def certificate_problems(receipt) -> list[str]:
    """Why a receipt's certificate cannot be trusted (empty when it can).

    The certificate is rebuilt from the installed wheel's own bundle
    manifest, which must be the bundle the certificate names.
    """
    api, _ = receipt_api()
    if receipt.certification_status != "certified":
        return ["the model and data pair is not certified"]
    installed = metadata.version("policyengine")
    if receipt.certificate.bundle_version != installed:
        return [
            f"the certificate is for policyengine "
            f"{receipt.certificate.bundle_version}, but {installed} is "
            "installed"
        ]
    return list(api.verify_certificate(receipt, load_bundle_manifest()))


@dataclass
class ReceiptInputs:
    """Everything the dashboard adds around the execution receipt."""

    key: str
    measure_ids: list[str]
    years: list[int]
    baseline_identity: Any
    reform_identity: Any
    file_digests: dict[str, str]
    basis: dict
    revision: CodeRevision
    config_baseline_identity: Any = None
    members: Optional[list[dict]] = None
    # Combined runs: each member's published outputs when the run was made.
    member_outputs: Optional[dict[str, str]] = None
    # Combined runs: each side's phase (see combined_identities).
    composition: Optional[dict] = None
    generator_argv: list[str] = field(default_factory=lambda: list(sys.argv))


def build_receipt_document(
    sim_baseline, sim_reform, inputs: ReceiptInputs
) -> dict:
    """Build ``receipt.json`` for an artifact from its two simulations.

    Raises ReceiptUnavailable if the simulations cannot be receipted, and
    ValueError if the baseline and reform ran on different execution
    identities.
    """
    api, source = receipt_api()
    years = sorted(set(int(year) for year in inputs.years))
    outputs = dict(sorted(inputs.file_digests.items()))
    supported = dataset_years(sim_reform)
    try:
        receipt = api.build_execution_receipt_for_microsimulation(
            sim_reform,
            years=years,
            reform=inputs.reform_identity,
            baseline=inputs.baseline_identity,
            outputs=outputs,
            ci_run_url=ci_run_url(),
        )
        baseline_receipt = api.build_execution_receipt_for_microsimulation(
            sim_baseline,
            years=years,
            reform=inputs.baseline_identity,
            baseline=inputs.baseline_identity,
        )
    except api.ReceiptError as error:
        raise ReceiptUnavailable(inputs.key, str(error)) from error
    if (
        receipt.execution_identity_sha256
        != baseline_receipt.execution_identity_sha256
    ):
        raise ValueError(
            f"{inputs.key}: baseline and reform ran on different execution "
            "identities"
        )

    reasons = certificate_problems(receipt)
    if not inputs.revision.tree_clean:
        reasons.append(
            "the working tree had uncommitted changes: "
            + ", ".join(inputs.revision.dirty_paths[:5])
        )
    dashboard = {
        "key": inputs.key,
        "measure_ids": list(inputs.measure_ids),
        "members": inputs.members,
        "member_outputs_sha256": inputs.member_outputs,
        "composition": inputs.composition,
        "config_baseline": (
            json.loads(inputs.config_baseline_identity.model_dump_json())
            if inputs.config_baseline_identity is not None
            else None
        ),
        "files": outputs,
        "digests": {
            "execution_identity_sha256": receipt.execution_identity_sha256,
            "receipt_sha256": receipt.receipt_sha256,
            "outputs_sha256": receipt.outputs_sha256,
        },
        "git_sha": inputs.revision.git_sha,
        "tree_clean": inputs.revision.tree_clean,
        "generator_argv": list(inputs.generator_argv),
        "basis": inputs.basis,
        "dataset_years": supported,
        # The execution receipt records the years the installed model
        # projects the dataset to (policyengine.py#571's supported_years);
        # the years it leaves out are the unsupported ones.
        "unsupported_years": _unsupported(receipt, years, supported),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "receipt_source": source,
        "publishable": not reasons,
        "reasons": reasons,
    }
    return {
        "schema": SCHEMA,
        "execution_receipt": json.loads(receipt.to_canonical_json()),
        "dashboard": dashboard,
    }


def load_execution_receipt(document: dict):
    """Parse and re-validate the execution receipt inside a document."""
    api, _ = receipt_api()
    return api.ExecutionReceipt.model_validate(document["execution_receipt"])


def document_problems(document: dict) -> list[str]:
    """Ways a stored receipt document fails to describe itself consistently.

    Recomputes every digest from the stored execution receipt and compares
    it with what the dashboard block recorded.
    """
    if document.get("schema") != SCHEMA:
        return [f"receipt schema is {document.get('schema')!r}"]
    try:
        receipt = load_execution_receipt(document)
    except Exception as error:  # noqa: BLE001 - any failure is a problem
        return [f"the execution receipt is invalid: {error}"]
    api, _ = receipt_api()
    dashboard = document.get("dashboard") or {}
    recorded = dashboard.get("digests") or {}
    problems = []
    for name in (
        "execution_identity_sha256",
        "receipt_sha256",
        "outputs_sha256",
    ):
        if recorded.get(name) != getattr(receipt, name):
            problems.append(f"recorded {name} does not match the receipt")
    if (
        api.content_sha256(dashboard.get("files") or {})
        != receipt.outputs_sha256
    ):
        problems.append("the listed files do not match outputs_sha256")
    return problems


def artifact_sha256(document: dict) -> str:
    """Digest of everything in a receipt document that publication relies on.

    It covers the execution receipt and every dashboard field except the
    ones describing the generation run itself (VOLATILE_DASHBOARD_FIELDS),
    so two artifacts with the same tables but a different tree state, basis
    or member snapshot never share an identity.
    """
    api, _ = receipt_api()
    dashboard = {
        name: value
        for name, value in (document.get("dashboard") or {}).items()
        if name not in VOLATILE_DASHBOARD_FIELDS
    }
    return api.content_sha256(
        {
            "schema": document.get("schema"),
            "execution_receipt": document.get("execution_receipt"),
            "dashboard": dashboard,
        }
    )


def projection_end_year() -> Optional[int]:
    """The last year policyengine-uk projects a single-year dataset to.

    Read from the installed model: every call to
    ``extend_single_year_dataset`` in ``policyengine_uk/simulation.py``
    uses its default ``end_year``. None if the function is not there.
    """
    import inspect

    try:
        from policyengine_uk.data.economic_assumptions import (
            extend_single_year_dataset,
        )
    except ImportError:
        return None
    default = (
        inspect.signature(extend_single_year_dataset)
        .parameters["end_year"]
        .default
    )
    return default if isinstance(default, int) else None


def _unsupported(receipt, years: list[int], supported) -> list[int]:
    signed = getattr(receipt, "supported_years", None)
    if signed is not None:
        return list(receipt.unsupported_years)
    if supported is None:
        return list(years)
    return [year for year in years if year not in supported]


def dashboard_problems(document: dict) -> list[str]:
    """Ways the dashboard block's derived fields disagree with their sources.

    The dashboard is written by the generator, but nothing signs it, so
    every field a gate relies on is recomputed or cross-checked here:

    - ``publishable`` and ``reasons`` follow from the certificate and the
      tree state;
    - the dataset years run without gaps to the installed model's
      projection end, and the unsupported years are exactly the reported
      years beyond them;
    - the unsupported years are the execution receipt's own, when it
      records the years the dataset is projected to.
    """
    dashboard = document.get("dashboard") or {}
    problems = []
    if not isinstance(dashboard.get("tree_clean"), bool):
        problems.append("its tree state is not recorded")
    try:
        receipt = load_execution_receipt(document)
    except Exception as error:  # noqa: BLE001 - reported as a problem
        return problems + [f"the execution receipt is invalid: {error}"]
    certificate = certificate_problems(receipt)
    expected_publishable = (
        not certificate and dashboard.get("tree_clean") is True
    )
    if dashboard.get("publishable") is not expected_publishable:
        problems.append(
            "its publishable flag does not follow from its certificate and "
            "tree state"
        )
    if expected_publishable and dashboard.get("reasons"):
        problems.append("it is publishable but lists reasons it is not")

    years = sorted(int(year) for year in receipt.years)
    supported = dashboard.get("dataset_years")
    unsupported = dashboard.get("unsupported_years")
    if getattr(receipt, "supported_years", None) is not None and (
        unsupported != list(receipt.unsupported_years)
    ):
        problems.append(
            "its unsupported years are not the execution receipt's"
        )
    if supported is None:
        if unsupported != years:
            problems.append(
                "with no dataset years recorded, every year is unsupported"
            )
        return problems
    supported = sorted(int(year) for year in supported)
    if supported != list(range(supported[0], supported[-1] + 1)):
        problems.append("its dataset years have gaps")
    end = projection_end_year()
    if end is None:
        problems.append("the installed model's projection end is unknown")
        return problems
    if supported[-1] != end:
        problems.append(
            f"its dataset years end in {supported[-1]}, but the installed "
            f"model projects to {end}"
        )
    # Only years beyond the projection end may be unsupported. Every
    # reported year up to it must be in the dataset, so truncating the
    # declared range cannot hide a year.
    beyond = [year for year in years if year > end]
    if unsupported != beyond:
        problems.append(
            "its unsupported years are not exactly the reported years "
            f"beyond {end}"
        )
    missing = [y for y in years if y <= end and y not in supported]
    if missing:
        problems.append(f"its dataset years leave out {missing}")
    return problems
