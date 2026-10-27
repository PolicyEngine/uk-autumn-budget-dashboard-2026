# Budget day for people: who does what, and every signature (28 October 2026)

What agents do on Budget day, what each person does and when, and every signature: who signs, with which command, and what they check first. The order of the day is the [checklist](budget-day-checklist.md), and each step's detail is in the [runbook](budget-day-runbook.md). Where this page differs from either, they win. The agents' own path is [`budget-day-agents.md`](budget-day-agents.md), and the day at a glance is [`budget-day-map.md`](budget-day-map.md). Times are UTC.

| Role | Name |
|---|---|
| Integrator | Vahid (`vahid-ahmadi`) |
| Coordinator | Max (`MaxGhenis`) |
| Second signer and licence holder | María (`juaristi22`) |
| Media first cut | open |

The rest of this page uses roles, so a missing person changes only the table above. Roles follow the Integrator's table on #247 (27 October, 11:19Z), which the runbook's Roles table now matches. Points marked **open** are not settled yet.

## What agents do, and never do

Agents:
- read the speech and the documents, and record each document's URL, time and SHA-256 as it lands;
- classify each announced measure (parameter-only, template modifier, hand-written modifier, ledger only, not computable), for the Integrator to confirm;
- encode the coded measures on branches, with a test each, and prepare the measures PR;
- enter the Treasury costings for the Integrator to check;
- run the generation, staging, area and check commands the Integrator names, in one release checkout;
- draft attestations, review rows and PR text for people to check and sign;
- keep a UTC time log of every step, with no figure from the data in it.

Agents never:
- merge;
- push, open a PR, comment, deploy or post without the named person's go;
- type a person's name into a signature;
- copy a figure from a private file, an audit or an unpublished table into anything people read.

## Who does what, and when

- **The Integrator:**
  - adopts the final cut by 06:00, and runs G0 by 11:30;
  - from 12:30, confirms the coverage ledger and names the expected-effects reviewer;
  - merges the measures PR, then deploys the household API;
  - runs or delegates G2 at 13:15, and signs its review rows;
  - from 13:40 to 14:10, checks the Treasury costings and approves at G3;
  - loads the OBR forecast;
  - from 14:50, approves the combined run and signs G4's review rows;
  - merges every PR, deploys and rolls back;
  - decides on every correction and withdrawal.
- **The Coordinator:** runs Tuesday's 18:00 regeneration, and holds the go/no-go at 07:00 on Wednesday.
- **The second signer and licence holder:**
  - is the second of the two people on every hand-written modifier's attestation. After tonight's regeneration that means three: Plan 2, the pensioner allowance and the seven-measure package ([#207 comment](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/207#issuecomment-6441807159));
  - checks the map before a corrected measure's results by area are republished;
  - answers the disclosure questions the UK Data Service licence raises.
- **Media first cut** (open: who) sends the 15:45 figures and the webinar slides, from approved entries of one manifest revision only, after the comparables review.
- **Still open:**
  - who checks first on each attestation;
  - who signs a reconciliation exception, since the Roles table bars the Integrator from approving his own;
  - who stands in if someone is missing.

## Every signature

### 1. Expected effects
- **Who:** the expected-effects reviewer (open: named by the Integrator).
- **How:** fill `reviewer` (GitHub username) on the measure's row in `data_inputs/treasury/expected_effects.csv`, on the measures PR branch before the Integrator merges it.
- **Check first:**
  - `direction` (`positive` improves the government balance) and the years match the measure's code and the announcement;
  - the note says only what the code changes.
- **When:** before the merge G2 generates from.
  - While any row has no reviewer, every gate-running `publish` command fails for every measure.
  - The file is a calculation path until #174 merges, so a later signature stales the receipts.
  - The seven candidates' rows are signed already (#213). Only measures added on the day need one.

### 2. Data-limits check of a hand-written modifier
- **Who:** the person who reviews that modifier's code.
- **How:** a line in the measures PR: "Data-limits check, <name>, <date>: no other simulation or system; no state changed mid-run; no metaclass; changes purchase pricing: no." (runbook, "Held by default").
- **Check first:** the modifier's own code, item by item.

### 3. Measures PR merge
- **Who:** the Integrator.
- **How:** a merge commit, never a squash: the area run needs each receipt's commit to be an ancestor of `main`.
- **Check first:**
  - the six required checks are green;
  - every measure's class and data-limits line are in the body;
  - nothing is in it but the measures, their tests, expected effects and fixtures.

### 4. Household API deploy (after the measures merge, and after each correction)
- **Who:** the Integrator.
- **How:**
  - the "Deploy the household API" workflow, action `deploy`, on `main` (live 6 to 7 min after dispatch);
  - then `uv run --with modal==1.6.2 modal deploy src/uk_budget_data/modal_household.py`, from a clean checkout of the same commit.
- **Check after:**
  - both `/api/version` answers name that commit;
  - the household check passes;
  - `uv run uk-budget-data publish definitions --api <API URL>` prints `same` for every displayed measure;
  - `python -m uk_budget_data.page_measures_check` exits 0;
  - one breakdown answers in under 200 s (runbook, "Adopting a release").

  Without the deploy, the page's Household impact refuses the new measures.

### 5. Treasury costings
- **Who:** the Integrator checks what agents enter.
- **How:**
  - `sources/AB2026-T4.1.csv`, from `python -m uk_budget_data.treasury_import`, which checks the printed totals;
  - `sources/AB2026-static.csv`, with the static costings entered by hand;
  - `mapping.csv`, where the Integrator fills `reviewer` on any row scaled or marked `not_comparable`.
- **Check first:**
  - every figure against its page and table in the document;
  - in £ billion, with the Exchequer sign (positive improves the public finances);
  - by fiscal year;
  - static figures in the static sheet, since only those are gated;
  - no scale used to flip a sign.

### 6. Reconciliation exceptions
- **Who:** open (see "Who does what").
- **How:** an entry in `data_inputs/treasury/exceptions.yaml`, with `reviewer` and `accepted_at`.
- **Check first:**
  - the residual matches `reconciliation.json`;
  - the explanation is quantified, and its class fits;
  - `outputs_sha256` and `comparator_sha256` are the current ones. A changed figure, mapping or output makes the exception lapse.

### 7. Approval
- **Who:** the Integrator.
- **How:** `uv run uk-budget-data publish approve <id> --by "<name>" --household-receipt <receipt>`, and the same for the combined run (no household receipt).
- **The gate enforces:**
  - a passed or accepted reconciliation;
  - responsiveness;
  - no model limit;
  - the tables;
  - a matching attestation;
  - for a combined run, every member approved.
- **Check first** the one thing no gate can: the measure is what was announced (rates, dates, years). Then the household check's result.

### 8. Attestation of a hand-written modifier
- **Who:** two different people: the second is the second signer, and who checks first is open.
- **How:**
  - `uv run python scripts/draft_attestation.py <artifact dir>` drafts the file for the two hand-written measures (`plan_2_threshold_unfreeze`, `state_pension_income_tax_protection`) and the combined runs that hold them, such as `combined--5c77771791661e11.json`. For a new hand-written measure, the agents' page has the one-line draft.
  - The signers fill `checker`, `second` and `released_at` (ISO 8601 with a timezone), then the file is committed.
- **Check first:**
  - both read the modifier's code at the receipt's commit;
  - the reason is true for this receipt, and holds no survey-level value;
  - the file names the receipt being staged.
- **When:** every regeneration. A hand-written receipt changes each time it is made, so each needs a fresh attestation.

### 9. Review rows
- **Who:** the Integrator. Open: whether the licence holder reads the bytes of new public tables first.
- **How:**
  - `uv run uk-budget-data publish review-rows --reviewer <name> --staged-by <name>`, never while a `generate` is running;
  - then, by hand in `data_inputs/public_data_review.csv`, the rows the command doesn't write:
    - `income_distribution.csv`, `income_mobility.csv` and `income_growth_with_measures.csv`;
    - `constituency.csv` (kind `disclosure_table`);
    - `household_presets.json`;
    - the outlook after the OBR import;
    - `official_costings.json` (#244, kind `national_table`);
    - `obr_cpi_policy_effect.json`, once #249 merges.
- **Check first:**
  - each new public file's bytes, against the disclosure rules on the agents' page: no unit record, no cell resting on fewer than 10 survey households, no difference that isolates fewer;
  - each file is the one the gate bound (`publish check` passes);
  - no artifact that #208's floor flagged (its `WARNING: cells resting on fewer than 10 survey households` line) is among them. Such an artifact is never staged: leave it out, never sign around it;
  - for `constituency.csv`, the private summary of its run, fetched to the private audit directory, never the checkout.

  Copy no figure from any of them anywhere.

### 10. Publication PR merge
- **Who:** the Integrator.
- **Check first:**
  - the required checks and the Publication gate are green;
  - `page_measures_check` passed against the deployed API;
  - every new file has its signed row.
- **Check after:** the live `manifest.json` shows the new revision, and the household check passes.

### 11. OBR forecast import
- **Who:** the Integrator loads it and merges its PR.
- **Check first:** the printout against the runbook's step 3, and the file's SHA-256 against the download.
- **When to merge:** not before G4's combined run and area run have started. It writes a calculation-path file.

### 12. Withdrawal and correction
- **Who:** the Integrator decides. The licence holder checks before a corrected measure's results by area are republished.
- **How:** `uv run uk-budget-data publish withdraw <id> --reason "<why>"` in the fix's PR, then the runbook's G5.
- **Check first:** `publish definitions` lists the affected measures.

### 13. Go/no-go (07:00)
- **Who:** the Coordinator.
- **Check:** the final cut's gates are green, and its change since the previous cut is attributed (runbook, "Rolling re-cuts").

### 14. The first cut (15:45)
- **Who:** Media first cut (open).
- **Check first:**
  - approved entries of one manifest revision only;
  - a comparables review dated within 7 days;
  - any unexplained gap of more than 25% pulled or explained (runbook, "First cut").

### 15. Rollback
- **Who:** the Integrator (the Roles table's "Deploy and rollback").
- **How** (runbook, "Rollback"):
  - the dashboard: Vercel Instant Rollback to the recorded previous production deployment, then a revert of the merge through a PR (`git revert -m 1 <merge>`), then `vercel promote`;
  - the household API: the deploy workflow's `rollback` action, never past `00024-lir`.
- **Check after:** the live `manifest.json` and `/api/version` show what was rolled back to, and the household check passes.
