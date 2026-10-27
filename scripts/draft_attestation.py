"""Draft the two-person attestation for a held hand-written modifier.

Run after G2 generates the artifact, from the repository root:

    uv run python scripts/draft_attestation.py public/data/artifacts/<key>/<id>/

It writes data_inputs/publication/attestations/<key>.json with the
measure id, the whole receipt document's digest (the one
``attestations.receipt_document_sha256`` computes) and a drafted reason.
``checker``, ``second`` and ``released_at`` are left empty: the file does
not validate, so nothing is released, until the two people who checked
this exact receipt fill them in and commit it through the measure's PR.
A regeneration changes the digest and needs a fresh draft and review.
"""

import json
import sys
from pathlib import Path

from uk_budget_data.publication.artifacts import RECEIPT_FILE
from uk_budget_data.publication.attestations import (
    ATTESTATIONS_ROOT,
    receipt_document_sha256,
)

# Factual reasons only: what was checked, never survey-level values.
REASONS = {
    "employer_ni_relief_under_25s": (
        "Checked budget_measures.employer_ni_relief_ages_21_to_24 against "
        "HMRC's 2026-27 employer rates and thresholds: it zero-rates "
        "employer Class 1 NI between the secondary threshold and the upper "
        "secondary threshold (the upper earnings limit) for employees aged "
        "21 to 24 from April 2027, changes only ni_class_1_employer, and "
        "leaves earnings fixed. Apprentices are not identified in the data "
        "and under-21s are charged in full by the engine (policyengine-uk "
        "#2505); both are stated in the measure's notes. The receipt's "
        "outputs were compared with issue #111's checks."
    ),
    "plan_2_threshold_unfreeze": (
        "Checked budget_measures.connect_student_loan_repayments, applied "
        "on both sides: it replaces reported Plan 2 repayments with "
        "modelled ones in baseline and reform alike, so the measure's "
        "effect is the threshold change alone (RPI uprating from April "
        "2027 instead of the freeze at £29,385). The receipt's outputs "
        "were compared with the published revenue path."
    ),
}


def main(artifact_dir: str) -> None:
    receipt = Path(artifact_dir) / RECEIPT_FILE
    document = json.loads(receipt.read_bytes())
    key = document["dashboard"]["key"]
    if key.startswith("combined--"):
        # A package holding a hand-written modifier is held too: its
        # reason names the members' own reviews, which must come first.
        held = sorted(set(document["dashboard"]["measure_ids"]) & set(REASONS))
        REASONS[key] = (
            "Checked that this combined run composes its members as "
            "published, with no change to any member's modifier: it holds "
            "the hand-written " + " and ".join(held) + ", each released "
            "by its own attestation for its own receipt."
        )
    if key not in REASONS:
        raise SystemExit(f"no drafted reason for {key}; write one first")
    record = {
        "measure_id": key,
        "receipt_sha256": receipt_document_sha256(document),
        "reason": REASONS[key],
        "checker": "",
        "second": "",
        "released_at": "",
    }
    path = ATTESTATIONS_ROOT / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    print(f"Drafted {path}. Before committing, two different people must:")
    print("  1. read the modifier's code at the receipt's commit;")
    print("  2. check the reason is true for this receipt;")
    print('  3. fill "checker" and "second" with their own names and')
    print('     "released_at" with an ISO 8601 time and timezone.')


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
