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
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

from uk_budget_data import releases
from uk_budget_data.publication.attestations import Attestation

SCHEMA = "uk-budget-dashboard/publication-manifest/v1"
DATA_ROOT = Path("public/data")
MANIFEST_FILE = "manifest.json"
# The default release (uk_budget_data/releases.json): this Budget, served
# from DATA_ROOT. A historical release is served from its own root.
CURRENT_RELEASE = releases.DEFAULT_RELEASE.id
CURRENT_BUDGET = releases.DEFAULT_RELEASE.budget
# One segment of an artifact path: the alphabet artifacts._KEY names keys
# and digests with (and utils/publication/manifest.js ARTIFACT_SEGMENT)
ARTIFACT_SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.+-]*\Z")

STAGED = "staged"
PROVISIONAL = "provisional"
APPROVED = "approved"
STALE = "stale"
WITHDRAWN = "withdrawn"
# A measure the certified data cannot cost (uk_budget_data.data_limits):
# listed with its reason, never with a figure.
NOT_COMPUTABLE = "not_computable"
Status = Literal[
    "staged",
    "provisional",
    "approved",
    "stale",
    "withdrawn",
    "not_computable",
]

# Statuses whose figures the page may show. Provisional entries are
# labelled.
DISPLAYABLE = (APPROVED, PROVISIONAL)
# Statuses the page lists: the displayable ones with their figures, and
# not-computable ones with only their reason.
LISTED = (*DISPLAYABLE, NOT_COMPUTABLE)


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


class PersonalSeries(_Strict):
    """A reviewed per-model response contract, distinct from national scoring.

    Optional fields retain old receipts for inspection. A legacy key-only
    mapping never authorizes figures in either personal frontend.
    """

    key: str = Field(min_length=1)
    policies: Optional[list[str]] = Field(default=None, min_length=1)
    model: Optional[Literal["lifecycle", "personal"]] = None
    reviewed: Optional[StrictBool] = None
    description: Optional[str] = Field(default=None, min_length=1)
    years: Optional[list[StrictInt]] = Field(default=None, min_length=1)
    unsupported_years: Optional[list[StrictInt]] = None

    @field_validator("policies")
    @classmethod
    def _group_ids_are_unique_and_not_empty(cls, value):
        if value is not None and (
            any(not item for item in value) or len(value) != len(set(value))
        ):
            raise ValueError("personal group ids must be unique and nonempty")
        return value

    @field_validator("description")
    @classmethod
    def _description_is_not_blank(cls, value):
        if value is not None and not value.strip():
            raise ValueError("personal model description cannot be blank")
        return value

    @model_validator(mode="after")
    def _years_are_explicit_and_consistent(self):
        if self.model is not None and not re.fullmatch(
            r"impact_[A-Za-z0-9][A-Za-z0-9_]*", self.key
        ):
            raise ValueError("personal mapping key must name an impact series")
        for values in (self.years, self.unsupported_years):
            if values is not None and len(values) != len(set(values)):
                raise ValueError("personal model years must be unique")
        if set(self.years or []) & set(self.unsupported_years or []):
            raise ValueError(
                "personal supported and unsupported years overlap"
            )
        return self


class Entry(_Strict):
    """One measure, or one combined run, in the manifest."""

    name: str
    # Public registry text, copied from the artifact and covered by its
    # digest. Empty keeps manifests written before descriptions compatible.
    description: str = ""
    personal: Optional[PersonalSeries] = None
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
    # The two-person release of a held hand-written modifier, bound to
    # the whole receipt document, including this generation's identity.
    attestation: Optional[Attestation] = None
    reason: Optional[str] = None
    # The data limits the artifact touches (their keys); its entry can only
    # be not computable.
    data_limits: list[str] = Field(default_factory=list)
    # Combined runs only.
    measures: Optional[list[str]] = None
    member_outputs_sha256: Optional[dict[str, str]] = None

    @model_validator(mode="after")
    def _a_data_limited_entry_has_no_figures(self):
        if self.status == NOT_COMPUTABLE and not (
            self.data_limits and self.reason and self.approval is None
        ):
            raise ValueError(
                "a not-computable entry names its data limits and reason, "
                "and has no approval"
            )
        if self.data_limits and self.status not in (
            NOT_COMPUTABLE,
            STALE,
            WITHDRAWN,
        ):
            raise ValueError(
                f"an entry with data limits cannot be {self.status}: its "
                "figures cannot be shown"
            )
        return self

    @field_validator("artifact")
    @classmethod
    def _artifact_stays_inside_the_data_root(cls, value: str) -> str:
        # Each segment in the writer's alphabet (artifacts._KEY), as the page
        # requires (isSafeArtifactPath): no URL encoding or delimiter, no
        # "." or "..", so the path the page requests is the path checked
        if not value or not all(
            ARTIFACT_SEGMENT.fullmatch(part) for part in value.split("/")
        ):
            raise ValueError(
                f"artifact path {value!r} must be relative to the data root"
            )
        if releases.enters_releases_dir(value):
            raise ValueError(
                f"artifact path {value!r} enters {releases.RELEASES_DIR}/, "
                "which holds other releases' files"
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
    release: str = CURRENT_RELEASE
    budget: dict[str, str] = Field(
        default_factory=lambda: dict(CURRENT_BUDGET)
    )
    # A flat table may only be read through the separately verified release
    # index. These digests are part of this exact publication snapshot.
    flat_files: dict[str, str] = Field(default_factory=dict)
    # The ids the bound area tables use for manifest keys (a package alias
    # for its combined run), as the area run recorded them
    flat_aliases: dict[str, str] = Field(default_factory=dict)
    # The area sidecar is part of the same snapshot as the flat CSVs.
    flat_provenance_sha256: Optional[str] = None
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


def parse_manifest(raw: bytes, where: str = "manifest") -> Manifest:
    """Parse manifest bytes, checking the schema."""
    manifest = Manifest.model_validate(json.loads(raw))
    if manifest.schema_id != SCHEMA:
        raise ValueError(f"{where}: schema is {manifest.schema_id!r}")
    return manifest


def load_manifest(data_root: Path = DATA_ROOT) -> Manifest:
    """Read the manifest, or an empty one if none has been written.

    An empty manifest carries the identity of the release its root serves
    (releases.release_for_root), so a historical root's first manifest is
    never stamped as this Budget's.
    """
    path = manifest_path(data_root)
    if not path.exists():
        release = releases.release_for_root(data_root)
        return Manifest(release=release.id, budget=release.budget)
    return parse_manifest(path.read_bytes(), str(path))


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
