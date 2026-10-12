"""Load approved artifacts for briefing exports.

Every chart and table in the briefing is built from artifacts the manifest
lists as approved, and is stamped with the manifest revision and digest it
was built from. A key that is unapproved, stale, withdrawn or missing is
refused, never silently skipped.
"""

from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt, read_tables
from uk_budget_data.publication.publish import PublishError, check
from uk_budget_data.publication.tables import sha256_bytes


def load_approved(
    keys: list[str],
    *,
    data_root: Path = m.DATA_ROOT,
    inputs: Path = Path("data_inputs/treasury"),
) -> dict:
    """Tables and receipts for approved entries, with the manifest stamp.

    Returns ``{"stamp": {"manifest_revision", "manifest_sha256",
    "execution_identity_sha256"}, "entries": {key: {"entry", "tables",
    "receipt"}}}``.

    Raises PublishError if any requested key is not approved, or if the
    manifest as a whole fails its checks.
    """
    path = m.manifest_path(data_root)
    if not path.exists():
        raise PublishError("manifest", ["there is no publication manifest"])
    manifest = m.load_manifest(data_root)
    problems = []
    for key in keys:
        entry = manifest.entries().get(key)
        if entry is None:
            problems.append(f"{key} is not in the manifest")
        elif entry.status != m.APPROVED:
            problems.append(f"{key} is {entry.status}, not approved")
    problems += check(manifest, data_root=data_root, inputs=inputs)
    if problems:
        raise PublishError("export", problems)
    entries = {}
    for key in keys:
        entry = manifest.entries()[key]
        directory = data_root / entry.artifact
        entries[key] = {
            "entry": entry,
            "tables": read_tables(directory),
            "receipt": read_receipt(directory),
        }
    return {
        "stamp": {
            "manifest_revision": manifest.revision,
            "manifest_sha256": sha256_bytes(path.read_bytes()),
            "execution_identity_sha256": (
                manifest.execution.execution_identity_sha256
            ),
        },
        "entries": entries,
    }
