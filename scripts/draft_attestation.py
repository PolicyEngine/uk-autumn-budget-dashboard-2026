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
from uk_budget_data.reforms import (
    STATE_PENSION_ALLOWANCE_ID,
    STATE_PENSION_PROTECTION_DESIGN,
)

# Factual reasons only: what was checked, never survey-level values.
# The employer NI relief for under-25s is withdrawn (27 October 2026) and
# unregistered, so it has no reason: nothing drafts it.
REASONS = {
    "plan_2_threshold_unfreeze": (
        "Checked budget_measures.connect_student_loan_repayments, applied "
        "on both sides: it replaces reported Plan 2 repayments with "
        "modelled ones in baseline and reform alike, so the measure's "
        "effect is the threshold change alone (RPI uprating from April "
        "2027 instead of the freeze at £29,385). The receipt's outputs "
        "were compared with the published revenue path."
    ),
    "carers_allowance_earnings_taper": (
        "Checked budget_measures.carers_allowance_earnings_taper against "
        "the 27 October 2026 announcement and policyengine-uk's "
        "carers_allowance_pre_overlap: from 2030-31 a carer outside "
        "Scotland whose weekly net earnings (carers_allowance_earnings / "
        "52, pence floored) are above the £204 earnings limit gets 52 x "
        "max(0, weekly rate - (weekly earnings - limit)) in place of £0, "
        "subject to the native age, hours and take-up conditions; at or "
        "below the limit, and before 2030-31, the native amount stands. It "
        "changes only carers_allowance_pre_overlap and adds no take-up "
        "draw of its own (the data's microcosm#1319 draw stands). The "
        "receipt's outputs were compared with the benchmarks in PR #256."
    ),
}

# The State Pension allowance is hand-written in its total-income design
# (state_pension_only_income_tax_allowance); the tapered design is a
# registered template and is not held.
if STATE_PENSION_PROTECTION_DESIGN == "total_income":
    REASONS[STATE_PENSION_ALLOWANCE_ID] = (
        "Checked budget_measures.state_pension_only_income_tax_allowance: "
        "from April 2027 it raises personal_allowance to the full new State "
        "Pension, rounded up to the pound (the engine's weekly rate x 52), "
        "for people over State Pension age who receive a State Pension and "
        "whose total income (total_income, savings interest included, with "
        "no other-income test) is at or below that allowance; above it the "
        "native allowance stands. It keeps the larger of that and the "
        "native allowance, keeps the native taper above £100,000 of "
        "adjusted net income and changes only personal_allowance. The "
        "receipt's outputs were compared with the hand-computed cases in "
        "tests/test_state_pension_only_income_tax_allowance.py."
    )


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
