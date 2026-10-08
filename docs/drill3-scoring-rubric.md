# Drill 3 scoring rubric

MOCK DATA. Freeze this unsealed rubric and its SHA at G0 on Monday 12 October 2026, before the 12:30 statement. The four normalized part scores are between 0 and 1:

`overall score (%) = 30 × H + 40 × N + 15 × L + 15 × P`

The scorer retains the part numerators, denominators and evidence with the final score. Missing required rows or evidence earn zero; they remain in their denominator. Round the final percentage to two decimal places after combining the unrounded parts. Accuracy of national amounts is assessed through reconciliation and basis/class scoring; no additional undisclosed numerical tolerance affects N.

## Complete runs and row versions

At 13:40, the scorer creates an immutable complete run directory containing the household and national sheets, coverage ledger and receipt. Its receipt names the policy-code SHA, engine/core versions, dataset hash, source release, rubric SHA, full row inventory, time and preview deployment. Every row belongs to that code SHA. A later documentation/data commit must include evidence that scored code and inputs match the recorded SHA.

At G5, preserve this run and mark it superseded in the clock table. Create a new complete corrected run with a new receipt and one policy-code SHA. Rerun every affected household and national row. Carry an unchanged row forward only when the receipt identifies its source run/row and proves its code paths, parameter values, household inputs, engine/data and applicable source assumptions unchanged. Record the checked diff and the verifier's name; otherwise rerun the row. Never mix row SHAs in a sheet or deliver a delta-only final run.

At stop, select the complete run matching the stop code and inputs. If later integrator commits affect scored behavior, rerun affected rows and verify carry-forward again. Preserve all earlier runs for the process audit. At 16:00, the scorer verifies all three answer-key hashes before opening them.

Before release, the independent key holder attests the key row inventories, their stable identifiers and which rows are correction versions, without exposing values or policies. At 16:00, map each answer-key entry to a stable `(part, case/measure, year, output)` identifier. Select the latest applicable correction version for accuracy scoring; historical correction entries audit the rerun and do not double-weight a case. Record the resulting H/N denominators. The runbook's physical key row counts do not replace this version-aware inventory. Duplicate identifiers without an explicit version, missing stage mappings or an unreconciled inventory block final score acceptance.

## Household part: H (30%)

`H = household rows within ±£0.01 / required unique final household rows`

Compare the final run's `team_change` with the applicable statutory key using absolute difference at most £0.01. Score all required household/measure/year rows, including combined-measure cases. A missing, nonfinite or wrong-version amount earns zero. Each row contributes one point; historical superseded values remain in the process audit only. This rubric does not infer the unreleased household or measure definitions.

## National part: N (40%)

For every required unique final national measure/year row, award:

- **0.5** for matching all applicable costing-basis dimensions: gross/net, duty-only/VAT-inclusive, fiscal/calendar and stated coverage/geography;
- **0.5** for a correct explanation class, on a matched-basis comparison.

`N = total national points / required unique final national rows`

The basis and explanation fields must be explicit. A basis mismatch earns zero explanation credit because a percentage gap on incompatible figures has no defined comparator. Use `(our matched-basis static figure − costing static figure) / abs(costing static figure)` for the signed percentage gap, and its absolute value for the 10% threshold. The post-behavioural Table 4.1 comparator remains separately labeled.

For an absolute gap at most 10%, including exactly 10%, record `none_expected`; award explanation credit when that matches the key's acceptance set. If the static costing is zero and our figure is also zero, use `none_expected`. If the costing is zero and our figure is nonzero, record percentage gap as undefined and provide an explanation from the closed list; the key's acceptance set determines credit. A missing costing/basis is unresolved evidence and earns no explanation credit.

For gaps over 10%, select one primary class from the runbook's closed list and give a short mechanism/source explanation. Extra classes may be notes; they do not receive points. The independent key holder freezes accepted-class sets and any equivalent classes before 12:30; no new acceptance class can be negotiated after seeing team answers. Each acceptance set must be nonempty and consistent with the small/zero-gap rule above. Contradictions between this rubric and the key block score acceptance pending a logged key-holder correction, rather than being resolved in the team's favour silently.

## Ledger part: L (15%)

`L = correctly classified Table 4.1 lines / 19`

Each of the 19 Table 4.1 lines contributes one point. Award the point only when both `coded`/`ledger` classification and the stated reason match the key-holder's frozen acceptance criteria. For coded lines the reason identifies household coverage/method; for ledger lines it identifies the exclusion or unsupported mechanism. Accept equivalent wording that states the same frozen mechanism. If several key rows map to one Table 4.1 line, every applicable classification/reason must agree before that line earns its point; additional physical key rows do not increase its weight. The key holder attests this mapping before score acceptance.

## Process part: P (15%)

Award the following points out of **15**, then set `P = earned points / 15`:

| Criterion | Points | Required evidence/deadline (BST) |
|---|---:|---|
| G0 | 2 | Complete clean-start SHA, runtime/core, dataset/hash, validation receipt or unvalidated-figure plan and matching live API; by Monday 11:30 |
| G1 | 2 | Complete locked measure list and coverage ledger; by 12:45 |
| G2 | 2 | Provisional reconciliation and one hand-checked household per coded measure with a statement figure; by 13:15 |
| G3 | 2 | Annex A rebase, complete national sheet/bases/classes; by 14:10 |
| G5 | 2 | Correction rerun, complete new receipt and superseded old run; by 14:50 |
| G4 | 2 | Complete drill-only preview with MOCK banner/noindex and both scoring sheets; by 14:50 |
| One-SHA run integrity | 2 | Every complete scoring run has one SHA; carry-forward and stop-code identity proved |
| Release/stop audit | 1 | Packet opened at or after 12:30/13:40/14:20; stop SHA logged at 15:30; keys received/opened at or after 16:00 with matching hashes |

Each criterion is all-or-nothing. The process points treat the runbook's target times as scoring deadlines. The correction process and single-SHA integrity have distinct evidence and each receive their own points. Unsupported timestamps, missing receipts or any premature packet/key access earn zero for the affected criterion. A late gate can still allow work to continue, with zero points for that criterion.

## Basis and terminal-year evidence

The shared policy horizon is 2026–2031. The pinned MOCK household API supports explicit ordered `years` through 2032 for closing-month work. Its annual output retains the engine's mixed fiscal/calendar semantics; no fiscal conversion is automatic. The legacy public-API household adapter is outside drill scoring.

For calendar-only measures with justified even-month incidence, `calendar_to_fiscal_even_months` computes 9/12 of the starting calendar year plus 3/12 of the following year. Fiscal 2031–32 therefore requires a 2032 value. Use released inputs and a measure-specific difference/quantity; never prorate aggregate household net income or native fiscal variables. Nonuniform or dated measures need their actual month schedule, including January–March 2032. Record the method, period and assumptions with the row; extending the displayed year labels alone does not establish fiscal accuracy.

## Acceptance receipt

The final scorer receipt names the selected complete run, stop-code identity, rubric SHA, verified key hashes, version-aware H/N inventories, 19-line ledger mapping, four part scores and overall arithmetic. The independent key holder signs inventory/class-equivalence corrections, if any. Friday's named nonparticipant/custody/release-route sign-off, Monday G0 evidence and authenticated preview acceptance remain required operator actions in `DRILL3.md`.
