"""Release a held modifier only for the exact receipt two people checked.

The coordinator's ruling on #51 holds hand-written simulation modifiers
while a data limit is active. A committed attestation is a factual review
record, with no survey-level values. Its ``receipt_sha256`` is the released
receipt API's canonical digest of the *whole dashboard receipt document*,
including its generation fields, rather than the execution receipt digest
or the output digest. Regeneration therefore requires a fresh review.

The gate requires the file's exact bytes in the local Git HEAD. Requiring
the commit to pass through a reviewed PR remains the repository's process;
a local gate cannot prove that process occurred.

Nothing is held while sign-off is off (``uk_budget_data.sign_off``, off
since 28 October 2026): no attestation is read or required.
"""

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from uk_budget_data import data_limits, sign_off

ATTESTATIONS_ROOT = Path("data_inputs/publication/attestations")
ATTESTATION_REPOSITORY = Path(".")
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class Attestation(BaseModel):
    """Two distinct reviewers releasing one exact generation."""

    model_config = ConfigDict(extra="forbid", strict=True)

    measure_id: str
    receipt_sha256: str
    reason: str
    checker: str
    second: str
    released_at: str

    @field_validator("reason", "checker", "second")
    @classmethod
    def _nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()

    @field_validator("receipt_sha256")
    @classmethod
    def _sha256(cls, value: str) -> str:
        if not _DIGEST.fullmatch(value):
            raise ValueError("must be a SHA-256 digest")
        return value

    @field_validator("released_at")
    @classmethod
    def _timestamp(cls, value: str) -> str:
        # A date alone is not a release timestamp; a timezone makes the
        # review record unambiguous across reviewers and deployments.
        if "T" not in value and " " not in value:
            raise ValueError("must be an ISO 8601 timestamp with a timezone")
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("must record a timezone")
        try:
            return timestamp.astimezone(timezone.utc).isoformat()
        except OverflowError as error:
            raise ValueError(
                "timestamp cannot be represented in UTC"
            ) from error

    @model_validator(mode="after")
    def _distinct_reviewers(self):
        if self.checker.casefold() == self.second.casefold():
            raise ValueError("checker and second must be distinct people")
        return self


def receipt_document_sha256(document: dict) -> str:
    """The whole receipt, including the generation this review releases."""
    from uk_budget_data.publication.receipt import receipt_api

    api, _ = receipt_api()
    return api.content_sha256(document)


def requires_attestation(document: dict) -> bool:
    """Whether a recorded modifier is hand-written under an active limit.

    Never while sign-off is off. Malformed or absent proofs are
    independently refused by receipt validation; the gate never tries to
    reconstruct a template proof.
    """
    if not sign_off.REQUIRED:
        return False
    if not data_limits.DATA_LIMITS:
        return False
    proofs = (document.get("dashboard") or {}).get("modifier_templates")
    if not isinstance(proofs, dict):
        return True
    if any(
        not isinstance(proofs.get(side), list)
        for side in ("baseline", "reform")
    ):
        return True
    return any(
        proof is None
        for side in ("baseline", "reform")
        for proof in proofs.get(side, [])
    )


def hold_reason(key: str) -> str:
    return (
        "held: a hand-written modifier while a data limit is active "
        "(coordinator's ruling on #51); attest it in "
        f"data_inputs/publication/attestations/{key}.json"
    )


def validate_attestation(document: dict, record) -> Attestation:
    """Validate the review's shape, identities and exact receipt binding."""
    attestation = Attestation.model_validate(record)
    if attestation.measure_id != document["dashboard"]["key"]:
        raise ValueError("attestation measure_id does not match the key")
    if attestation.receipt_sha256 != receipt_document_sha256(document):
        raise ValueError("attestation does not match the current receipt")
    return attestation


def _committed_bytes(path: Path, contents: bytes) -> None:
    """Require the exact input blob in HEAD, including unstaged changes.

    Reading the index alone would accept a staged replacement that nobody
    committed. Git environment overrides must not redirect this local
    repository check to another checkout or index. The requested path must
    itself name a regular committed file: a symlink may not substitute
    another file's reviewed bytes, even when it stays in the repository.
    """
    repository = ATTESTATION_REPOSITORY.resolve()
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("GIT_")
    }

    def git(*arguments):
        return subprocess.run(
            ["git", "--no-optional-locks", "-C", str(repository), *arguments],
            check=True,
            capture_output=True,
            env=environment,
        ).stdout

    try:
        found = Path(git("rev-parse", "--show-toplevel").decode().strip())
        if found.resolve() != repository:
            raise ValueError(
                "attestation repository is not the dashboard Git root"
            )
        relative = path.absolute().relative_to(
            ATTESTATION_REPOSITORY.absolute()
        )
        requested = repository / relative
        if requested.resolve() != requested:
            raise ValueError("attestation path contains a symbolic link")
        relative = relative.as_posix()
        entry = git("ls-tree", "-z", "HEAD", "--", relative)
        if not entry.startswith((b"100644 blob ", b"100755 blob ")) or (
            entry.partition(b"\t")[2] != relative.encode() + b"\0"
        ):
            raise ValueError("attestation is not a regular committed file")
        committed = git("show", f"HEAD:{relative}")
    except (subprocess.CalledProcessError, ValueError) as error:
        raise ValueError(
            "attestation is not committed in local Git HEAD"
        ) from error
    if committed != contents:
        raise ValueError(
            "attestation differs from its committed Git HEAD version"
        )


def load_attestation(
    document: dict,
) -> tuple[Optional[Attestation], list[str]]:
    """Read the review afresh and require its exact bytes in local Git HEAD.

    Untracked, modified and only-staged files cannot release a hold. PR
    review of that commit is enforced by the repository's review process.
    """
    from uk_budget_data.publication.artifacts import check_key

    key = document["dashboard"]["key"]
    try:
        check_key(key)
        path = ATTESTATIONS_ROOT / f"{key}.json"
        contents = path.read_bytes()
        _committed_bytes(path, contents)
        record = json.loads(contents)
        return validate_attestation(document, record), []
    except (OSError, ValueError, TypeError) as error:
        return None, [f"{hold_reason(key)} ({error})"]
