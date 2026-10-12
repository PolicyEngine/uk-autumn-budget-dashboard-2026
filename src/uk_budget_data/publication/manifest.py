"""The publication manifest.

``public/data/manifest.json`` is the one entry point the browser and every
briefing export read. It lists each measure and each combined run with the
artifact it points to, that artifact's digests and its status. A number that
is not in a displayable manifest entry is not shown.

Only ``publish`` writes the manifest: it validates, then replaces the file in
one step and raises the revision.
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

SCHEMA = "uk-budget-dashboard/publication-manifest/v1"
DATA_ROOT = Path("public/data")
MANIFEST_FILE = "manifest.json"

STAGED = "staged"
PROVISIONAL = "provisional"
APPROVED = "approved"
STALE = "stale"
WITHDRAWN = "withdrawn"
Status = Literal["staged", "provisional", "approved", "stale", "withdrawn"]

# Statuses the page may show. Provisional entries are labelled.
DISPLAYABLE = (APPROVED, PROVISIONAL)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Approval(_Strict):
    """Who approved which exact outputs."""

    by: str
    at: str
    outputs_sha256: str
    artifact_sha256: str
    carried_from_receipt: Optional[str] = None


class ReconciliationSummary(_Strict):
    summary_status: str
    responsiveness_status: str


class Entry(_Strict):
    """One measure, or one combined run, in the manifest."""

    name: str
    status: Status
    artifact: str
    outputs_sha256: str
    receipt_sha256: str
    execution_identity_sha256: str
    # The artifact's own digest (receipt.artifact_sha256): the entry names
    # exactly these bytes, and the gates check the directory still holds
    # them.
    artifact_sha256: str
    years: list[int]
    unsupported_years: list[int] = Field(default_factory=list)
    reconciliation: Optional[ReconciliationSummary] = None
    household_checks: Optional[dict] = None
    approval: Optional[Approval] = None
    reason: Optional[str] = None
    # Combined runs only.
    measures: Optional[list[str]] = None
    member_outputs_sha256: Optional[dict[str, str]] = None

    @field_validator("artifact")
    @classmethod
    def _artifact_stays_inside_the_data_root(cls, value: str) -> str:
        parts = Path(value).parts
        if Path(value).is_absolute() or ".." in parts or not parts:
            raise ValueError(
                f"artifact path {value!r} must be relative to the data root"
            )
        return value


class Superseded(_Strict):
    """An entry that a later stage replaced, kept for audit."""

    key: str
    superseded_at: str
    entry: Entry


class Execution(_Strict):
    """The one execution identity every current entry shares."""

    execution_identity_sha256: str
    identity: dict


class Manifest(_Strict):
    schema_id: str = Field(default=SCHEMA, alias="schema")
    revision: int = 0
    updated_at: Optional[str] = None
    basis: Optional[dict] = None
    execution: Optional[Execution] = None
    measures: dict[str, Entry] = Field(default_factory=dict)
    combined: dict[str, Entry] = Field(default_factory=dict)
    superseded: list[Superseded] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _keys_are_distinct_across_groups(self):
        shared = set(self.measures) & set(self.combined)
        if shared:
            raise ValueError(
                f"keys used as both a measure and a combined run: "
                f"{sorted(shared)}"
            )
        misplaced = [k for k in self.measures if k.startswith("combined--")]
        misplaced += [
            k for k in self.combined if not k.startswith("combined--")
        ]
        if misplaced:
            raise ValueError(f"keys in the wrong group: {sorted(misplaced)}")
        return self

    def entries(self) -> dict[str, Entry]:
        """Every entry by key (measure ids and combined keys never clash)."""
        return {**self.measures, **self.combined}

    def group(self, key: str) -> dict[str, Entry]:
        return self.combined if key in self.combined else self.measures


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def manifest_path(data_root: Path = DATA_ROOT) -> Path:
    return data_root / MANIFEST_FILE


def load_manifest(data_root: Path = DATA_ROOT) -> Manifest:
    """Read the manifest, or an empty one if none has been written."""
    path = manifest_path(data_root)
    if not path.exists():
        return Manifest()
    manifest = Manifest.model_validate(json.loads(path.read_text()))
    if manifest.schema_id != SCHEMA:
        raise ValueError(f"{path}: schema is {manifest.schema_id!r}")
    return manifest


def save_manifest(manifest: Manifest, data_root: Path = DATA_ROOT) -> Manifest:
    """Write the manifest in one step, raising the revision."""
    manifest.revision += 1
    manifest.updated_at = now()
    data_root.mkdir(parents=True, exist_ok=True)
    text = (
        json.dumps(
            manifest.model_dump(by_alias=True, exclude_none=True),
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    handle, temporary = tempfile.mkstemp(
        prefix=".manifest-", suffix=".json", dir=data_root
    )
    try:
        with os.fdopen(handle, "w") as stream:
            stream.write(text)
        os.replace(temporary, manifest_path(data_root))
    except BaseException:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise
    return manifest
