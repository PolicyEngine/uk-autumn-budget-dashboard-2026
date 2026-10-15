"""Load approved artifacts for briefing exports.

Every chart and table in the briefing is built from artifacts the manifest
lists as approved, and is stamped with the manifest revision and digest it
was built from. A key that is unapproved, stale, withdrawn or missing is
refused, never silently skipped.

The manifest is read once, and its stamp is the digest of exactly the bytes
that were checked. Each artifact's receipt and files are read once into
memory, checked against the entry's digests, and parsed from those same
bytes, so nothing written between the check and the export can reach it.
"""

import json
from pathlib import Path

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import RECEIPT_FILE
from uk_budget_data.publication.publish import PublishError, check
from uk_budget_data.publication.receipt import artifact_sha256
from uk_budget_data.publication.tables import TABLES, parse_csv, sha256_bytes


def _capture(key: str, entry: m.Entry, data_root: Path) -> dict:
    """An approved entry's receipt and tables, read once and verified."""
    directory = data_root / entry.artifact
    receipt = json.loads((directory / RECEIPT_FILE).read_bytes())
    problems = []
    if artifact_sha256(receipt) != entry.artifact_sha256:
        problems.append("its receipt is not the one the manifest names")
    files = (receipt.get("dashboard") or {}).get("files") or {}
    tables = {}
    for name, spec in TABLES.items():
        if spec.filename not in files:
            continue
        data = (directory / spec.filename).read_bytes()
        if sha256_bytes(data) != files[spec.filename]:
            problems.append(f"{spec.filename} does not match its receipt")
            continue
        tables[name] = parse_csv(name, data)
    if problems:
        raise PublishError(key, problems)
    return {"entry": entry, "tables": tables, "receipt": receipt}


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
    raw = path.read_bytes()
    manifest = m.parse_manifest(raw, str(path))
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
    entries = {
        key: _capture(key, manifest.entries()[key], data_root) for key in keys
    }
    return {
        "stamp": {
            "manifest_revision": manifest.revision,
            "manifest_sha256": sha256_bytes(raw),
            "execution_identity_sha256": (
                manifest.execution.execution_identity_sha256
            ),
        },
        "entries": entries,
    }
