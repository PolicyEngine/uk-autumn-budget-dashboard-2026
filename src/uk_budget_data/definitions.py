"""Each measure's definition as its publication receipt binds it.

Personal impact asks the household API live, so the page has to know the
API computes each selected measure from the definition its published
figures were approved on. A receipt binds a measure's two sides with
policyengine.py's reform identities (``publication.receipt.
measure_identities``, recorded as ``execution_receipt.baseline`` and
``.reform``):

- parameter changes by their content;
- a simulation modifier by its source, its module's source, its default
  arguments and the commit the receipt was made at (``dashboard.git_sha``).

The commit is a label in that digest; the sources are read from the
running code. So recomputing a measure's identities at the approved
receipt's own commit gives the receipt's exactly when the measure's
parameter changes and modifier code are the ones approved, and the API
needs no git history to do it. The household API reports them beside its
answers (``?definition=<id>:<commit>``), and the page compares them with
the approved receipt.

Not covered, since a receipt binds them only through the commit: code a
modifier calls in another module (the registered templates in
``measure_templates``, say), and the household calculation itself.
"""

import copy
import functools
import json
import re
from collections.abc import Iterable
from pathlib import Path

from uk_budget_data.models import DataConfig
from uk_budget_data.publication.receipt import (
    CodeRevision,
    ReceiptUnavailable,
    measure_identities,
)
from uk_budget_data.reforms import get_reform

# The fields of an identity its digest depends on, the ones the receipt
# gate compares (``receipt._IDENTITY_FIELDS``); ``name`` is a label.
IDENTITY_FIELDS = ("kind", "representation", "reform_sha256", "binding")
# A full commit sha, as ``scenario_reform_identity`` requires one.
FULL_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
# A request names a measure and its approved commit: "<id>:<commit>".
SEPARATOR = ":"


def identity_core(identity) -> dict:
    """An identity's digest fields, from a ReformIdentity or its JSON."""
    if not isinstance(identity, dict):
        identity = json.loads(identity.model_dump_json())
    return {name: identity.get(name) for name in IDENTITY_FIELDS}


def parse_requested(values: Iterable[str], known: Iterable[str]) -> dict:
    """``<id>:<commit>`` values as ``{id: commit}``.

    Raises ValueError for a value of another form, a commit that is not a
    full sha, a measure the calculation doesn't know, or a measure named
    twice.
    """
    known = set(known)
    requested = {}
    for value in values:
        measure_id, separator, git_sha = value.partition(SEPARATOR)
        if not separator or not measure_id:
            raise ValueError(
                f"definition {value!r}: write it as <measure id>:<commit>"
            )
        if not FULL_COMMIT.fullmatch(git_sha):
            raise ValueError(
                f"definition {value!r}: the commit must be a full "
                "lowercase sha (40 or 64 hex digits)"
            )
        if measure_id not in known:
            raise ValueError(
                f"definition {value!r}: not a measure the calculation knows"
            )
        if measure_id in requested:
            raise ValueError(f"definition: {measure_id} is named twice")
        requested[measure_id] = git_sha
    return requested


@functools.lru_cache(maxsize=256)
def _definition(measure_id: str, git_sha: str) -> dict:
    reform = get_reform(measure_id)
    if reform is None:
        raise ValueError(f"{measure_id} is not a registered measure")
    try:
        # Generation's configuration names no baseline of its own (the
        # CLI's DataConfig sets paths and years only), and neither does the
        # household calculation's (household_impact.measure_sides).
        baseline, own = measure_identities(
            reform, DataConfig(), CodeRevision(git_sha, tree_clean=True)
        )
    except ReceiptUnavailable as error:
        return {"git_sha": git_sha, "error": error.reason}
    return {
        "git_sha": git_sha,
        "baseline": identity_core(baseline),
        "reform": identity_core(own),
    }


def measure_definition(measure_id: str, git_sha: str) -> dict:
    """One measure's definition at ``git_sha``: its baseline and reform
    identities' digest fields, or the reason the running code cannot bind
    them (``error``).

    ``git_sha`` is the commit the approved receipt was made at; the running
    code supplies everything else.
    """
    if not FULL_COMMIT.fullmatch(git_sha):
        raise ValueError(f"{git_sha!r} is not a full commit sha")
    return copy.deepcopy(_definition(measure_id, git_sha))


def definitions_for(requested: dict) -> dict:
    """``{id: measure_definition(id, commit)}`` for ``{id: commit}``."""
    return {
        measure_id: measure_definition(measure_id, git_sha)
        for measure_id, git_sha in requested.items()
    }


def receipt_definition(document: dict) -> dict:
    """What a receipt document approved: its commit and both identities'
    digest fields, in ``measure_definition``'s form."""
    execution = document.get("execution_receipt") or {}
    return {
        "git_sha": (document.get("dashboard") or {}).get("git_sha"),
        "baseline": identity_core(execution.get("baseline") or {}),
        "reform": identity_core(execution.get("reform") or {}),
    }


def differences(approved: dict, reported) -> list[str]:
    """How a reported definition differs from an approved one (empty when
    it is the same definition). A missing report or an ``error`` is a
    difference."""
    if not isinstance(reported, dict):
        return ["no definition reported"]
    if "error" in reported:
        return [f"the running code cannot bind it: {reported['error']}"]
    problems = []
    if reported.get("git_sha") != approved.get("git_sha"):
        problems.append(
            f"reported at commit {reported.get('git_sha')!r}, not the "
            f"approved {approved.get('git_sha')!r}"
        )
    for side in ("baseline", "reform"):
        theirs = reported.get(side)
        if not isinstance(theirs, dict):
            problems.append(f"no {side} identity reported")
            continue
        for name in IDENTITY_FIELDS:
            if theirs.get(name) != approved[side].get(name):
                problems.append(f"its {side} {name} differs")
    return problems


def manifest_report(data_root: Path) -> list[dict]:
    """For each single measure the page displays (approved or
    provisional), whether the running code's definition at its receipt's
    commit is the one approved.

    Each row is ``{key, status, git_sha, problems}``. Combined runs are
    left out: the household calculation combines the selected single
    measures, each bound by its own receipt.
    """
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import artifact_dir

    manifest = m.load_manifest(data_root)
    rows = []
    for key, entry in sorted(manifest.measures.items()):
        if entry.status not in m.DISPLAYABLE:
            continue
        row = {"key": key, "status": entry.status, "git_sha": None}
        try:
            document = read_receipt(artifact_dir(entry, data_root))
        except (OSError, ValueError) as error:
            rows.append({**row, "problems": [f"no receipt: {error}"]})
            continue
        approved = receipt_definition(document)
        row["git_sha"] = approved["git_sha"]
        if get_reform(key) is None:
            problems = ["not a measure the running code registers"]
        elif not isinstance(approved["git_sha"], str) or not (
            FULL_COMMIT.fullmatch(approved["git_sha"])
        ):
            problems = ["its receipt records no full commit sha"]
        else:
            problems = differences(
                approved, measure_definition(key, approved["git_sha"])
            )
        rows.append({**row, "problems": problems})
    return rows


def run_check(data_root: Path, out=print) -> int:
    """``publish definitions``: print the report; 1 if any displayed
    measure's definition is not the approved one, else 0."""
    from uk_budget_data.publication import manifest as m

    if not m.manifest_path(data_root).exists():
        out("no manifest yet: no published measure to compare")
        return 0
    rows = manifest_report(data_root)
    for row in rows:
        commit = (row["git_sha"] or "?")[:12]
        if row["problems"]:
            out(f"DIFFERS {row['key']} ({row['status']}, receipt {commit}):")
            for problem in row["problems"]:
                out(f"  - {problem}")
        else:
            out(f"same    {row['key']} ({row['status']}, receipt {commit})")
    unbound = sum(1 for row in rows if row["problems"])
    out(
        f"{len(rows) - unbound} of {len(rows)} displayed measures have the "
        "approved definition in this code"
    )
    return 1 if unbound else 0
