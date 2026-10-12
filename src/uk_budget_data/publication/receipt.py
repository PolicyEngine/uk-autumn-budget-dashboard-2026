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
VENDORED_SOURCE = "vendored-w4-pr579@9672ad3"
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
    """The (baseline, reform) identities of a combined run, and its members.

    Each side is the ordered composition of the members' own identities,
    bound with the phase (before or after data load) that side's combined
    Scenario runs in. ``members`` must already be in application order.
    """
    api, _ = receipt_api()
    baselines, reforms, records = [], [], []
    for member in members:
        baseline, reform = measure_identities(member, config, revision)
        baselines.append(baseline)
        reforms.append(reform)
        records.append(
            {
                "id": member.id,
                "baseline": json.loads(baseline.model_dump_json()),
                "reform": json.loads(reform.model_dump_json()),
            }
        )
    name = "+".join(member.id for member in members)
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
        )
    except (api.ReceiptError, ValueError) as error:
        raise ReceiptUnavailable(name, str(error)) from error


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
    generator_argv: list[str] = field(default_factory=lambda: list(sys.argv))


def _with_dataset_hash(sim):
    """The simulation, with the SHA-256 of the dataset it loaded recorded.

    policyengine.py's receipt (from PR #571) refuses a simulation whose
    managed loader recorded no hash of the dataset bytes at load time
    (``policyengine_bundle["runtime_dataset_sha256"]``). Installed releases
    before that PR record none. In that case the file is hashed here, now,
    and the receipt document says so (``dataset_sha256_taken``): the receipt
    still names the exact bytes on disk, but not as checked at load time.

    Returns (simulation, "at load" or "at receipt").
    """
    from types import SimpleNamespace

    from policyengine.utils.hashing import sha256_file

    bundle = dict(getattr(sim, "policyengine_bundle", None) or {})
    if bundle.get("runtime_dataset_sha256"):
        return sim, "at load"
    source = bundle.get("runtime_dataset_source")
    if not source or not Path(source).exists():
        return sim, "at load"
    bundle["runtime_dataset_sha256"] = sha256_file(source)
    return SimpleNamespace(policyengine_bundle=bundle), "at receipt"


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
    sim_reform, hashed_at = _with_dataset_hash(sim_reform)
    sim_baseline, _ = _with_dataset_hash(sim_baseline)
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
        "unsupported_years": (
            years
            if supported is None
            else [y for y in years if y not in supported]
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "receipt_source": source,
        "dataset_sha256_taken": hashed_at,
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


def dashboard_problems(document: dict) -> list[str]:
    """Ways the dashboard block's derived fields disagree with their sources.

    The dashboard is written by the generator, but nothing signs it, so
    every field a gate relies on is recomputed or cross-checked here:

    - ``publishable`` and ``reasons`` follow from the certificate and the
      tree state;
    - the dataset years run without gaps to the installed model's
      projection end, and the unsupported years are exactly the reported
      years beyond them.
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
    elif supported[-1] != end:
        problems.append(
            f"its dataset years end in {supported[-1]}, but the installed "
            f"model projects to {end}"
        )
    if unsupported != [year for year in years if year not in supported]:
        problems.append(
            "its unsupported years are not the reported years beyond the "
            "dataset's"
        )
    return problems
