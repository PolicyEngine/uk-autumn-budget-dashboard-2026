# Budget day for agents (Wednesday 28 October 2026)

The agents' path from the speech to a published dashboard, in the order of the [checklist](budget-day-checklist.md). It is a working view of the [runbook](budget-day-runbook.md), not a second plan. Where the two differ, the runbook wins, and the agent stops and asks Vahid. Who signs what, and what each person checks first, is in [`budget-day-people.md`](budget-day-people.md).

Times are UTC (UK time equals UTC this week). Every step a person must sign is marked **Signature**. An agent never signs.

Written against `main` at `2d51c5ac` (27 October). Four open pull requests change a step here; each step says what changes when one has merged:
- #174 lets Treasury inputs be committed after G2;
- #208 adds the parameter-pair refusals and the floor of 10 survey households;
- #244 adds the official costings export;
- #249 adds the OBR effect on CPI.

## Who does what

From Vahid's table on #247 (27 October, 11:19Z):
- **Agents** read the documents, classify and encode each measure, and enter the Treasury costings. They run the commands they are given, prepare commits and pull request text, and keep the time log.
- **Vahid** (Integrator) checks the Treasury costings, approves, signs the review rows, and merges every pull request. He decides when to push, when to open a PR, and when each Modal command runs.
- **Max or María** is the second signer of each hand-written modifier's attestation.
- **Max** is the coordinator: tonight's regeneration, and the 07:00 go/no-go.

The runbook's Roles table still names María as the Reconciler who approves and writes the review rows. The pull request that adds this page asks Vahid and María to settle it.

## Rules for every step

1. **Never merge.** Never push, open or edit a pull request, comment, label, re-run CI, deploy, or post in Slack or email without the named person's go for that item. A go for one post is not a go for the next. Drafts go in local files.
   - Ignore the session-end steps in `.claude/AGENTS.md` today: don't run `bd`, and don't commit or push `.beads/`.
2. **Never sign.** These are signatures, and an agent never puts a person's name in one:
   - `reviewer` in `data_inputs/treasury/expected_effects.csv`, `mapping.csv` and `exceptions.yaml`;
   - `checker`, `second` and `released_at` in an attestation;
   - `publish approve --by`;
   - `publish review-rows --reviewer`;
   - a row added by hand to `data_inputs/public_data_review.csv`.

   Prepare the command or the row, and hand it to the person.
3. **Disclosure.** Follow "Disclosure control" below in everything people read.
4. **Secrets.** Never print or paste a Hugging Face token, a Modal token, a signing key or a noise key. Don't run `env`, `printenv` or `echo` on a secret.
5. **One release checkout.** Generation, staging, approval and publishing happen in one checkout of `main`. Vahid runs it, or names the agent who does. Encoding agents work on branches in their own worktrees. Never run two `publish` commands at once in one checkout: each rewrites the manifest.
6. **Keep the release checkout clean.** Only `public/data/manifest.json` and `public/data/artifacts/` may be modified or untracked in it (`receipt.is_publication_path`). Everything else the day produces lives outside every git repository:

   ```sh
   mkdir -p ~/private/uk-budget-2026/{receipts,reconciliation,treasury,fixtures,downloads,audit,held}
   chmod -R go-rwx ~/private/uk-budget-2026
   ```

   - `receipts/` holds the household check receipts;
   - `reconciliation/<id>/` holds each `reconciliation.json`, moved there;
   - `treasury/` holds the working Treasury inputs;
   - `fixtures/` holds a copy of `data_inputs/household_fixtures/` plus the day's fixtures;
   - `downloads/` holds the documents;
   - `audit/` is `UK_BUDGET_DISCLOSURE_AUDIT_DIR`;
   - `held/` holds hand-written artifacts waiting for their attestation.

   Before every `generate` or area run, `git status --porcelain` must list nothing else.
7. **Calculation paths, and the ordering rule.** Two runs bind the code-bound receipts again: `generate --combined` and the area run. Code-bound means any measure with a `simulation_modifier`, made from templates or written by hand. Both runs refuse every such measure once anything that could change a calculation has been committed after the commit G2 generated from. Check paths with:

   ```sh
   uv run python -c "import sys; from uk_budget_data.publication.receipt import is_non_calculation_path as f; [print(f(p), p) for p in sys.argv[1:]]" <path> ...
   ```

   - Safe to commit after G2: attestations, `public/` and `docs/` (not Python), `data_inputs/public_data_review.csv`, top-level Markdown, and the page's files under `src/` outside `src/uk_budget_data/`.
   - Not safe:
     - `data_inputs/household_fixtures/`;
     - `data_inputs/living_standards/`, which the OBR forecast import writes;
     - `tests/`, `scripts/`, `.github/`, `uv.lock` and `.beads/`;
     - `data_inputs/treasury/`, until #174 merges.
   - If something unsafe must go in after G2, every measure with a modifier is regenerated before the next combined or area run, and every hand-written one is attested again.
8. **Never, from the checklist:**
   - put a hand-written modifier in a shared `generate` call;
   - run `--artifacts` without `--reforms`;
   - run `publish review-rows` while a `generate` is running, or before every artifact you mean to keep is staged or moved to `held/`;
   - interrupt a Modal run that has gone quiet;
   - mix local and Modal artifacts in one release.
9. **The laptop.** Generation, the combined run, the area run and the package flat files run on Modal. Start no Modal app the plan doesn't name, and keep no containers warm. Run only the tests for what you touched. Never run `bun run build` beside a running `next dev`.
10. **Time log.** A UTC start and end for every step (the last section).

**Modal commands.** The checklist writes `MODAL` for `uv run --with modal==1.6.2 python -m uk_budget_data.cli`. Define it once per shell, so its commands paste as written:

```sh
MODAL() { uv run --with modal==1.6.2 python -m uk_budget_data.cli "$@"; }
```

Commands without Modal stay `uv run uk-budget-data …`.

**The hand-written modifiers on `main`** are:
- `employer_ni_relief_under_25s`;
- `plan_2_threshold_unfreeze`;
- `state_pension_income_tax_protection`: hand-written in its sole-income design, since #182.

Each runs in a `generate` call of its own and needs a two-person attestation for every receipt. That stays true while the data-limit registry isn't empty, which it isn't on `main`, nor with #238.

## Before the day: what to check on Wednesday morning

These are Vahid's and Max's steps on Tuesday. On Wednesday the agent checks they happened and records what it finds. It doesn't redo them.
- **Which calculation-path pull requests merged by the 17:30 freeze** (#222). In particular:
  - #237 and #238, policyengine 6.11.1: policyengine-uk 2.151.0 and the a6299504 cut;
  - #208, #174, #244 and #249.
- **Both Modal images built** on the final `uv.lock` before 18:00: 2:40 for the image (#239), about 12 min after a lock change (#225).
- **The 18:00 regeneration** (Max). Then the hand-written receipts attested afresh: an attestation made before 18:00 no longer matches.
- **The household calculator deployed tonight** (#231): Cloud Run and the production Modal app, from the regeneration's commit, before 08:00.

## Set-up, final cut and go/no-go (by 07:00)

- **Who:** Vahid adopts the final cut by 06:00, and Max holds the go/no-go at 07:00. An agent then sets up.
- **Commands** (about 5 min; not timed):

  ```sh
  git switch main && git pull --ff-only
  uv sync --locked --extra dev
  bun install --frozen-lockfile
  git rev-parse HEAD
  uv run python -c "import importlib.metadata as m; [print(p, m.version(p)) for p in ('policyengine','policyengine-uk','policyengine-core')]"
  uv run python -c "from uk_budget_data.model_limits import MODEL_LIMITS; print({l.key: l.installed_fixed() for l in MODEL_LIMITS})"
  uv run python -c "from uk_budget_data.data_limits import DATA_LIMITS; print([l.key for l in DATA_LIMITS])"
  ```

  Record the SHA, the three versions and both limit lists in the time log.
- **Model limits.** A key printed `False` holds its measures at provisional: approval is refused, and VAT measures get no results by area.
  - On `main`: `vat_consumption_coverage`, `state_pension_add_on_uprating`, `benefit_uprating_september_cpi` and `pc_minimum_guarantee_uprating`.
  - With #238 merged, only `pc_minimum_guarantee_uprating` remains.
- **Data limits.** A measure that changes a listed parameter is "not computable on current data". The page shows it as such, never with a figure.
  - On `main`: the SDLT, LBTT and LTT higher rates for additional dwellings, and the non-residential purchase rates.
  - With #238 merged, those two lift, and 25 others apply. They include:
    - the PIP points thresholds;
    - uncapped bus single fares;
    - salary sacrifice;
    - annual-allowance death benefits;
    - the defined-benefit pension share;
    - deferred early-years school starts;
    - full-year Category A directors;
    - Housing Benefit residential capital;
    - every gambling duty.
- **Stop if:**
  - `main` moved after the go/no-go and Vahid didn't say so;
  - `uv sync --locked` changes anything;
  - the versions differ from those Vahid recorded for the final cut.

## G0: start receipt (by 11:30)

- **Who:** Vahid, or the agent he names.
- **Commands:** the runbook's G0 block, with the household receipt written outside the checkout:

  ```sh
  export HOUSEHOLD_API=https://uk-budget-api-2026-qevs5bboca-ew.a.run.app
  uv run python -m uk_budget_data.certified_data --also enhanced_frs_2024_25_tiny
  REQUIRE_CERTIFIED_DATA=1 uv run pytest tests/ -m certified_data
  curl -s "$HOUSEHOLD_API/api/version"
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" --fixtures data_inputs/household_fixtures --manifest public/data/manifest.json --out ~/private/uk-budget-2026/receipts/g0-households.json
  uv run uk-budget-data publish check
  uv run uk-budget-data publish status
  ```

  - With no `public/data/manifest.json` (#207 not merged), use the runbook's three `--expect-*-version` flags in place of `--manifest`.
  - `HUGGING_FACE_TOKEN` must be in the environment, never echoed.
  - `receipts/` inside the checkout isn't git-ignored, so a receipt written there makes the tree dirty, and the next Modal generation refuses.
- **Gate:** every command exits 0, and `/api/version` reports the installed policyengine, policyengine-uk and policyengine-core.
- **Record:**
  - the start SHA;
  - the manifest revision;
  - the dataset SHA-256;
  - the API revision and versions;
  - `data_inputs/publication_basis.json` (`pre_budget` expected);
  - the active limits.
- **Stop if:** any command fails, or the API's versions differ from the installed ones.

## G1 and encoding (12:30 to 13:15)

**1. Read the speech (from 12:30).** List every measure the Chancellor announces, with what was said, its start date and its years. Use the official text or broadcast, never another organisation's figures. Log the time each measure was heard.

**2. Classify each measure (G1, 12:30 to 12:45).** Agents draft the coverage ledger, and Vahid confirms which measures are coded. Each measure gets exactly one class and a reason:
1. **Parameter-only.** It changes existing parameters in `parameter_changes`, by hand or with `rate_change`, `threshold_change`, `uc_health_element_change`, `allowance_uprating` or `pension_uprating`.
   - Bound by content: no attestation, and no later commit stops it.
2. **Template modifier.** A module-level modifier that only calls `apply_vat_base_change`, `apply_benefit_receipt_payment`, `apply_age_conditioned_allowance` or `apply_property_band_surcharge`.
   - No attestation. Bound by commit.
3. **Hand-written modifier.** Any other code.
   - A named data-limits check in its PR, its own `generate` call, and a two-person attestation of its exact receipt.
   - Bound by commit.
   - Allow 30 to 60 min plus the second signer (#247).
4. **Ledger only.** Announced, but outside what the model covers. No code.
5. **Not computable.** In scope, but the data or model can't cost it. No code, unless Vahid wants the gate's not-computable entry. Known cases:
   - a measure on a data-limited parameter (the morning's list);
   - a wealth tax on the engine's scales (generation refuses it);
   - the "Your First Home" equity loan, and a LISA replacement (no purchase or subscription data);
   - pension tax relief, the annual allowance, its taper or the MPAA: coded, but held for review by default (runbook).

The runbook's rules for writing a measure apply ("How a measure must be written"):
- UC health element changes in 2026 to 2029 go through `uc_health_element_change`;
- a macro path is never keyed by a bare year;
- an uprated amount gets an explicit value for every scored year through 2031 (policyengine-uk #2430);
- dated keys are bare fiscal years: `"2027"` is 2027-28.

**3. A measure that appears only in the documents, after G2** (#247, Vahid's review, finding 6). Its own encoding is the small part. Its commit is a calculation path, so every measure with a modifier must be regenerated, and every hand-written one attested again, before the next combined run or area run.
- Classify it at once, but don't commit it until Vahid chooses:
  - encode it and regenerate; or
  - hold it until after G4's area run, then add it as a G5-style correction.
- Log its times.

**4. Encode each coded measure** (on a branch, from G1; runbook "Construction"):
1. **Write it.**
   - A parameter-only measure is a `_create_<id>()` factory in `src/uk_budget_data/reforms.py`, returning `Reform(id=…, name=…, description=…, parameter_changes=…)` and added to `_MEASURE_FACTORIES`.
   - A modifier goes in a new module, `src/uk_budget_data/budget_measures/<name>.py`. The module holds only imports, literal constants and one undecorated function named after it, with its numbers as default arguments. Never put it in `reforms.py`, and never add a function to an existing module.
   - A measure that moves capital gains tax holds realisations fixed with `static_capital_gains()`.
   - Copy the nearest existing measure.
2. **Add its expected effect** to `data_inputs/treasury/expected_effects.csv`: `measure_id,direction,from_year,to_year,reviewer,note`, where `positive` improves the government balance. Leave `reviewer` empty.
   - **Signature: expected-effects reviewer** (named by Vahid). The reviewer fills `reviewer` before the commit G2 generates from, because:
     - `load_expected` refuses the whole file while any row lacks a reviewer, so every gate-running `publish` command fails for every measure;
     - the file is a calculation path until #174 merges, so signing it after G2 stales the receipts.
3. **Declare the taxes it changes** in `DECLARED` in `tests/test_measure_descriptions.py`. Its name and description name only those, and never say "Candidate measure".
4. **Add one numerical test** on a made-up household, with the arithmetic done by hand.
5. **Its household check fixture** goes in this same commit under `data_inputs/household_fixtures/`, or in `~/private/uk-budget-2026/fixtures/`. It is a calculation path either way, so never add it to the release checkout after G2.
6. **Until #208 merges, check the engine's paired parameters by hand.** The engine charges each pair together, so a measure that sets the first sets the second too, in every scored year, to its new or current value:
   - `gov.hmrc.cgt.higher_rate` with `gov.hmrc.cgt.additional_rate`, and the same pair under `gov.hmrc.cgt.residential_property` and `gov.hmrc.cgt.carried_interest`;
   - `gov.hmrc.income_tax.rates.dividends[2].rate` with `[3].rate`: the dividend scale's fourth bracket starts at £10m;
   - `gov.hmrc.income_tax.rates.uk[2].rate` with `uk[3].rate`, for the same £10m bracket;
   - `gov.dwp.LHA.freeze` with `gov.dfc.LHA.freeze`, and the percentile. This applies only on an engine that has `gov.dfc` (policyengine-uk 2.151.0 does; 2.132.6 doesn't).
7. **Run the tests you touched:**

   ```sh
   uv run pytest tests/test_measure_descriptions.py tests/test_budget_measures.py tests/test_reforms.py <your test> -q
   uv run black --check <changed .py files> && uv run ruff check <changed .py files>
   ```

   CI runs the rest.

**5. The candidates already published.** Each of the nine pre-Budget candidates is either announced as modelled, or withdrawn in G2's first manifest write. Agents list them; Vahid decides.
- If announced as modelled, update its name, description and any parameters in the measures PR, and regenerate it at G2.
- If not, withdraw it: `uv run uk-budget-data publish withdraw <id> --reason "Not in the Autumn Budget 2026"`.

None stays on the page under the statement label.

**6. The measures PR.** The agent prepares it. Vahid gives the go to push and open it, and merges it.
- Push and open it in one go: CI starts when the PR opens, not at the push (#246).
- The body names each measure and its class.
  - **Signature: data-limits check.** Each hand-written modifier gets its reviewer's line: "Data-limits check, <name>, <date>: no other simulation or system; no state changed mid-run; no metaclass; changes purchase pricing: no." (runbook).
  - No figure from the data.
- **Gate:** the six required checks: Python tests, Python lint, Certified data, Frontend build, Frontend tests and Frontend lint.
- **Time:** 8:48 to the last check, or 10:37 with one font flake (#246).
- **Merge with a merge commit, never a squash.** The area run needs each receipt's commit to be an ancestor of `main`.

**7. After the merge: the household API and the examples.** The page sends every displayed measure to the household API, and an API deployed before the measures commit refuses the new ones ("Unknown measures"). Drill 5 hit this (#144).
1. **Signature: deploy (Vahid).** Run the "Deploy the household API" workflow, action `deploy`, from `main`: live 6 to 7 min after dispatch (runbook). Then deploy the Modal household app from a clean checkout of the same commit: `uv run --with modal modal deploy src/uk_budget_data/modal_household.py`.
2. After G2's staging, recompute the examples for the measures the page will show. Without `--policies` the script reuses the measures the current file was made for.

   ```sh
   bun scripts/household-preset-requests.mjs --policies <comma-separated displayable ids> > ~/private/uk-budget-2026/requests.json
   uv run python scripts/precompute_household_presets.py ~/private/uk-budget-2026/requests.json
   ```

   It takes about ten minutes, with no dataset (runbook). It writes `public/data/household_presets.json`, which needs its review row (**Signature: Vahid**).
3. Check both before the publication PR merges. It exits 1 on a refused measure or a stale example:

   ```sh
   uv run python -m uk_budget_data.page_measures_check --base-url "$HOUSEHOLD_API" --base-url "$HOUSEHOLD_DETAIL_API"
   ```

   `HOUSEHOLD_DETAIL_API` is the Modal household app the production build calls; Vahid confirms its URL.
4. Then `uv run uk-budget-data publish definitions --api "$HOUSEHOLD_API"` must print `same` for every displayed measure.

## G2: provisional figures (13:15)

- **Who:** Vahid, or the agent he names, in the release checkout at the merged measures commit.
- **Before:** `git pull --ff-only`, and `git status --porcelain` lists nothing. Record HEAD: every receipt names it.
- **Three shells at once, from the same clean commit:**
  1. `MODAL generate --artifacts --backend modal --reforms <the parameter-only and template ids>`;
  2. one shell for each hand-written modifier: `MODAL generate --artifacts --backend modal --reforms <one id>`;
  3. only if a flat file needs re-cutting: `MODAL generate --backend modal --only income_distribution`. Never the package's files here: they wait for G4.
- **Time:**
  - nine measures in one call: 8:11 for the Modal app (6.10.2, #225);
  - a hand-written measure alone: 6:43 to 6:45 (#225);
  - on 6.11.1: 5:35 to 10:00 a container, with the Warm Home Discount top-up at 9:43 and Plan 2 at 16:28 (#250).
- **For each directory a command prints:**

  ```sh
  uv run uk-budget-data publish reconcile public/data/artifacts/<id>/<digest>/
  mkdir -p ~/private/uk-budget-2026/reconciliation/<id> && mv public/data/artifacts/<id>/<digest>/reconciliation.json ~/private/uk-budget-2026/reconciliation/<id>/
  uv run uk-budget-data publish stage --provisional public/data/artifacts/<id>/<digest>/
  uv run uk-budget-data publish check
  ```

  Reconcile, stage and check take 3, 20 and 3 s (#225).
- **A hand-written modifier can't be staged until it is attested.** Move its artifact directory to `~/private/uk-budget-2026/held/` straight away, so `review-rows` can't delete it. Stage it once its attestation is committed (G3, step 4).
- **Gates:**
  - `REFUSED <id>: …` lines: a data limit, a scored year left out, a wealth-tax scale, and once #208 is in, a parameter pair or a thin decile cell;
  - staging refuses a measure that doesn't move in its declared direction;
  - `publish check` re-runs every gate.
- **Household check, for each measure,** against the redeployed API:

  ```sh
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" --fixtures ~/private/uk-budget-2026/fixtures --manifest public/data/manifest.json --out ~/private/uk-budget-2026/receipts/<id>-households.json
  ```

- **Signature: review rows (Vahid).** He runs this himself, never while a `generate` runs:

  ```sh
  uv run uk-budget-data publish review-rows --reviewer <his name> --staged-by <who staged>
  ```

  It takes about 2 s (#239). It deletes every unstaged artifact, and lists the files it left without a row.
- **Then:**
  1. `uv run python scripts/check_public_data.py` and `bun scripts/check-public-files.mjs`, both at 0 problems;
  2. `git add` the artifacts, `manifest.json`, `household_presets.json` and `data_inputs/public_data_review.csv`;
  3. the publication PR on Vahid's go. **Signature: merge (Vahid).**
- **Stop if:**
  - a line reads `FAILED`;
  - a refusal can't be explained;
  - `review-rows` would delete an artifact you meant to keep;
  - a public check reports a problem;
  - a measure's sign or size looks wrong against the speech. Drill 5 found three that changed less than they said (#145).

## Documents (from about 13:40)

- **What may arrive, together or in pieces:**
  - the Red Book, with its table of policy decisions (the importer's "Table 4.1": read the number off the document);
  - the Treasury's policy costings document, the source of the static costings;
  - the OBR's Economic and fiscal outlook: the PDF and the detailed forecast tables;
  - the EFO's policy chapter, with its charts-and-tables workbook.
- **Early or piecemeal documents.** Start reading as soon as anything lands, and log when each piece did. Publish nothing before the speech has begun, and nothing without Vahid's word. On 26 November 2025 the OBR's EFO was online before the speech by accident (#247).
- **gov.uk documents** may be fetched by script (runbook, "Treasury tables come from gov.uk by script").
- **obr.uk refuses scripts.** It answers HTTP 200 with an HTML "No Access" page. Use a real browser:
  - go to `https://obr.uk/download/<slug>/` one file at a time, with the slugs read off the EFO page, not guessed;
  - the PDF opens inline, so use Save As;
  - fetch the economy workbook first: it's the one the forecast import needs (#246).
- **Record each file as it lands:** URL, UTC time, size, `shasum -a 256 <file>`, and `file <file>`, which must say "Microsoft Excel 2007+" for a workbook. The OBR can re-upload a file after publication, so the hash at download is the record (#246).
- **Time:** 2:02 for four workbooks and the PDF (#246).

## G3: Treasury costings, reconciliation and approval (13:40 to 14:10)

**1. Where the Treasury inputs live.** This depends on #174.
- **#174 merged:** Treasury CSV and YAML files can be committed after G2 without staling anything. Work in `data_inputs/treasury/` and commit as the runbook says. Commit before any generation from that checkout: an uncommitted file still makes the tree dirty.
- **#174 not merged:** keep the inputs out of the release checkout until G4's combined run and area run have both started.
  - Work on a private copy, and put `--inputs` before the action in every gate-running `publish` command (`reconcile`, `stage`, `approve`, `index`, `check`):

    ```sh
    cp -R data_inputs/treasury/. ~/private/uk-budget-2026/treasury/
    uv run uk-budget-data publish --inputs ~/private/uk-budget-2026/treasury reconcile <artifact dir>
    ```

  - Both runs read the tree only when they start: the combined run at once, the area run while it plans. After that, the files can be copied in and committed (G4).

**2. Enter the costings.** Agents enter them; **Signature: Vahid checks every figure.**

```sh
uv run python -m uk_budget_data.treasury_import ~/private/uk-budget-2026/downloads/<Table 4.1 xlsx> --source-id AB2026-T4.1 --document "Autumn Budget 2026" --out <treasury dir>/sources/AB2026-T4.1.csv --static-template <treasury dir>/sources/AB2026-static.csv
```

- **The importer** checks every row against the table's printed totals, and stops on a mis-keyed row.
- **Units:** `value_bn` is £ billion. The table prints £ million, and the importer converts.
- **Sign:** the Exchequer's. Positive improves the public finances, so a tax rise is positive and a spending rise negative.
- **Basis:**
  - fill `AB2026-static.csv` from the policy costings document, one static figure per measure and year, with its page and table in `notes`;
  - Table 4.1's figures are post-behavioural: reported, never gated;
  - a blank `value_bn` is "not entered", and reconciles as `awaiting_source`.
- **Years:** fiscal years, `2027-28`. Model year 2027 is 2027-28, so `year_offset` is 0.
- **The mapping:** one row of `mapping.csv` (`measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer`) per Treasury row a measure is compared with. Rows are summed.
  - A `scale` other than 1, or `status: not_comparable`, needs a reason and the reviewer's name.
  - **Signature: Vahid** fills `reviewer`.
  - A scale is always above zero: never flip a sign with it.
- **The tolerance** (`policy.yaml`, still a proposal): a year passes within the larger of 10% of the Treasury figure and £50m. A Treasury zero tolerates £2.5m.

**3. Reconcile, then approve.**

```sh
uv run uk-budget-data publish [--inputs <treasury dir>] reconcile public/data/artifacts/<id>/<digest>/
```

- Move `reconciliation.json` out after every reconcile.
- **A failed year** is fixed, or accepted with an exception in `exceptions.yaml`. The exception gives:
  - one of the nine explanation classes;
  - a quantified explanation;
  - `residual_bn` to £1m;
  - the artifact's `outputs_sha256`;
  - the failed row's `comparator.sha256`.

  **Signature: the exception's reviewer** fills `reviewer` and `accepted_at`. Who that is when Vahid also approves is open on the PR that adds this page: the runbook bars the Integrator from approving his own exceptions. Then reconcile again.
- **Signature: approval (Vahid):**

  ```sh
  uv run uk-budget-data publish [--inputs <treasury dir>] stage public/data/artifacts/<id>/<digest>/
  uv run uk-budget-data publish [--inputs <treasury dir>] approve <id> --by "<his name>" --household-receipt ~/private/uk-budget-2026/receipts/<id>-households.json
  ```

  Approval is refused unless:
  - the reconciliation passes or is accepted;
  - the measure is responsive;
  - no model limit is recorded;
  - the tables pass;
  - any attestation it needs matches.
- **Stop if:**
  - a year fails and nobody has accepted an exception;
  - someone asks to approve a measure a model limit holds;
  - the Treasury figure's sign contradicts the expected effect.
- **Time:** the checklist allows 13:40 to 14:10. It hasn't been timed on real documents.

**4. Attestations.** For every hand-written modifier generated today, and every combined run that holds one:
- `uv run python scripts/draft_attestation.py <artifact dir>` drafts the file for the three hand-written measures on `main` and their combined runs.
- For a new hand-written measure, the script stops ("no drafted reason"), and editing the script is a calculation path. Draft the file by hand instead, into `data_inputs/publication/attestations/<key>.json`:

  ```sh
  uv run python -c "import json,sys; from pathlib import Path; from uk_budget_data.publication.attestations import receipt_document_sha256 as d; doc=json.loads(Path(sys.argv[1],'receipt.json').read_bytes()); print(json.dumps({'measure_id': doc['dashboard']['key'], 'receipt_sha256': d(doc), 'reason': '', 'checker': '', 'second': '', 'released_at': ''}, indent=2))" <artifact dir>
  ```

- **Signature: attestation (two different people; the second is Max or María).** Both read the modifier's code at the receipt's commit. They fill:
  - `reason`, in factual terms and with no survey-level values;
  - `checker` and `second`;
  - `released_at` (ISO 8601 with a timezone).
- Commit the file, then stage the artifact back from `held/`. The gate reads the attestation from git HEAD, so an uncommitted file releases nothing.

**5. Official costings for the Public finances card** (once #244 has merged). After the Treasury sheets and mapping are filled, run `uv run python -m uk_budget_data.publication.official_costings`, with `--inputs <treasury dir>` if they are still private.
- It writes `public/data/official_costings.json`, which needs its review row (**Signature: Vahid**).
- Set `obr_budget_2026_costings.url` in `src/utils/sources.js`.
- If #244 hasn't merged, its own description gives a route that leaves every receipt valid.

**6. The OBR's effect on CPI inflation** (once #249 has merged). Write `public/data/obr_cpi_policy_effect.json` from the EFO policy chapter's workbook, as `docs/obr-cpi-policy-effect.md` (added by #249) says. It needs its review row (**Signature: Vahid**).

## The OBR forecast import (from 13:40)

- **Who:** Vahid loads it (runbook, "Budget day: OBR forecast"). An agent prepares and checks.

  ```sh
  uv run uk-budget-data obr-forecast --efo ~/private/uk-budget-2026/downloads/<economy tables>.xlsx --label "OBR October 2026 (Autumn Budget)" --url <the EFO page>
  ```

- **Time:** 3.1 s (#246).
- **What it writes:**
  - `data_inputs/living_standards/obr_forecast_post.json`, a calculation path;
  - the `forecast` block of `public/data/living_standards_outlook.json`;
  - that file's pending review row.
- **Check its printout** against the runbook's step 3. If a table, column or year is missing, it stops: never fill a value by hand.
- **Tests:**

  ```sh
  uv run pytest tests/test_living_standards.py -q
  uv run python scripts/check_public_data.py
  bun run test src/components/livingStandards src/utils/livingStandards src/tabsSmoke.test.jsx
  ```

  Four assertions fail until #246's `36e0fef2` is on `main` (#246, finding 1).
- **Hold its pull request until G4's runs have started.** Its calculation-path file would otherwise make them refuse every measure with a modifier. Merging it also replaces the March forecast's lines with an unavailable notice, by design.
- **`src/utils/sources.js`:** change `obr_efo_current` and `budget_documents` only as the PR that adds this page settles (#246, findings 2 and 3).

## G4: combined run, results by area, publication (from 14:50)

- **Before:**
  - the release checkout is clean (rule 6), with no uncommitted Treasury file;
  - every member is staged;
  - HEAD is G2's commit, or descends from it through safe commits only (rule 7).
- **The combined run first:** `MODAL generate --combined <member ids> --backend modal`.
  - **Time:** 6:13 for the app, plus about 1 min of planning (#225).
  - **Members:** leave out any measure that is held, not computable or stopped by the floor, and say so wherever the package total appears.
  - **Stage it** like a measure. Vahid approves it once every member is approved (**Signature: Vahid**). A combined run holding a hand-written modifier needs its own attestation.
- **The area run, once G3's approvals are in, alongside the combined run and from the same clean commit:**

  ```sh
  UK_BUDGET_DISCLOSURE_AUDIT_DIR=~/private/uk-budget-2026/audit MODAL constituencies --backend modal --run-id constituencies-<the cut's 8 hex digits>-<HHMM>
  ```

  - Approved single measures only. No package by constituency on the day (#235).
  - A new `--run-id` for every run (#250).
  - **Time:**
    - 6.10.2: 13:53 and 14:32 for six measures; 21:18 for ten (#225).
    - 6.11.1 (#250): 49:46 for seven, the Warm Home Discount unit at 38:44 and Plan 2's at 29:02. Plan about 55–60 min with the Warm Home Discount top-up, 45–50 with Plan 2 but not it, and 30–35 with neither. Then about 20–25 min to the live map.
  - While it runs, leave `constituency.csv` and `area_provenance.json` alone, and start no second area run. A second run refuses the code-bound measures while the first run's files are uncommitted (#250).
- **#174 not merged: once both runs have started, bring the Treasury inputs in.**
  - Copy the checked files from the private copy into `data_inputs/treasury/`.
  - `uv run uk-budget-data publish check`, with no `--inputs`, must still pass.
  - From then on, any new combined run or area run refuses the code-bound measures.
  - Vahid chooses when to publish approved national figures. Either they ride in G4's publication PR with the map (as the checklist has it), or they go first in their own PR. That PR waits until the combined run has finished and been staged.
- **The package's flat files, after the last `stage`, `approve` or `withdraw`, in two shells at once** (2:17 for both, #239):

  ```sh
  MODAL generate --only income_distribution --published-package --backend modal
  MODAL generate --only income_growth --published-package --backend modal
  ```

- **After the area run:**
  1. Fetch its private summary from the Modal Volume into the audit directory, never the checkout: `uvx --from modal==1.6.2 modal volume get uk-budget-2026-constituencies-private geography/<run id>/microcosm-<stamp>/summary.json ~/private/uk-budget-2026/audit/`. **Signature: the table's reviewer** reads it and the table, and copies no figure from either anywhere.
  2. In this order:

     ```sh
     uv run uk-budget-data publish index
     uv run uk-budget-data publish check
     ```

     `publish index` refuses with no area table ("no flat view file to bind").
  3. **Signature: review rows (Vahid):** `uv run uk-budget-data publish review-rows --reviewer <his name> --staged-by <who staged>`. Then, by hand, the rows for:
     - `income_distribution.csv`, `income_mobility.csv` and `income_growth_with_measures.csv`: new SHA-256, reviewer, date, and a basis naming the package;
     - `constituency.csv`: kind `disclosure_table`, the row the area run printed.
  4. `git add`:
     - the artifacts, `manifest.json` and `release-index.json`;
     - `constituency.csv` and `area_provenance.json`;
     - the three flat files;
     - any Treasury inputs not yet committed;
     - `data_inputs/public_data_review.csv`.
  5. `uv run python scripts/check_public_data.py` and `bun scripts/check-public-files.mjs`, both at 0 problems.
  6. The publication PR on Vahid's go. The Publication gate isn't a required check, but don't merge if it fails. **Signature: merge (Vahid).**
- **Check it is live:**

  ```sh
  curl -s https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026/data/manifest.json | head -5
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" --fixtures ~/private/uk-budget-2026/fixtures --manifest public/data/manifest.json --out ~/private/uk-budget-2026/receipts/g4-households.json
  ```

  An open page shows the first map only after a reload (#250).
- **Every later manifest change unbinds the map** until `publish index` runs again (#250). That includes a late approval, a withdrawal and the package's approval.
- **Stop if:**
  - the combined run refuses a member with "calculation code changed since the approved commit". Something unsafe was committed after G2: tell Vahid, and don't work round it;
  - the area run stops on a limit, a demotion or a refusal;
  - `publish index` refuses;
  - a public check reports a problem.

## Corrections and rollback (G5)

- **Who:** Vahid decides on a correction. Agents prepare it.
- **The path** (runbook, G5):
  1. **Commit the fix on a branch.**
     - `uv run uk-budget-data publish definitions` prints `same` or `DIFFERS` for each displayed measure.
     - `git diff --name-only <receipt commit> HEAD -- src pyproject.toml uv.lock data_inputs Dockerfile` lists what else changed.
  2. **Withdraw every affected measure in the fix's PR:** `uv run uk-budget-data publish withdraw <id> --reason "<why>"`.
     - Once results by area are bound, also run `uv run uk-budget-data publish index --without-area`, or rerun the area run over what is still approved.
     - Then `publish check`, the review rows (**Signature: Vahid**), and the merge (**Signature: Vahid**).
  3. **Wait five minutes, then redeploy.** Vahid redeploys the household API from `main` (**Signature: deploy**). `publish definitions --api "$HOUSEHOLD_API"` must then print `same`.
  4. **Regenerate.** Every affected measure, and every other measure with a modifier, as at G2. Each hand-written measure is attested again.
  5. **The combined run:** regenerate, stage, approve.
  6. **Results by area:** rerun the area run, then `publish index`.
  7. **Review rows and a second PR.** Vahid merges only after step 3's household check.
- **Disclosure:** never republish a corrected measure's results by area without María's check of the old table against the new.
- **The correction clock:**
  - about 9 min of CI per PR (#246);
  - 7 to 16 min per modifier regeneration on Modal (#225, #250);
  - each attestation;
  - two PRs.
- **Rollback** (runbook, "Rollback"):
  - **The dashboard:** Vercel Instant Rollback, then the merge reverted through a PR (`git revert -m 1 <merge>`), then `vercel promote`.
  - **The household API:** the deploy workflow's `rollback`. Never past `00024-lir`, and never past the first revision deployed with #125 once the page compares definitions.
  - The fast revert stops being fast after G2's first publication PR.

## When Modal or CI fails

**Modal** (#226):
- **A container fails** (an error, the 45-minute timeout, out of memory). The command writes every other artifact, prints the `FAILED` lines and the steps to rerun, starts no combined run, and exits 1. Then:
  1. stage what was written;
  2. rerun only the printed ids, each hand-written one in a call of its own, and stage them;
  3. run the combined run.
- **Never rerun the whole set.** A hand-written modifier would get a new artifact, and so need a new attestation.
- **A refusal is not a failure:** a rerun gives the same answer. Fix the measure or leave it out.
- **Results arrive in measure order.** A quiet run is a slow container: never Ctrl-C it, or every artifact not yet written is lost.
- **A `.staging-*` directory** left by a killed run is never staged or committed. `review-rows` deletes it.
- **Spend:** `uvx --from modal modal billing report --for today`, before and after. On 6.10.2 a full regeneration cost $1.13 and an area run about $0.5 (#225, #235). On 6.11.1 an area run cost $1.65 (#250).
- **Stop and tell Vahid** if Modal is down, a secret is missing, or a run fails twice.

**CI** (about 9 min; the ten Python shards set the pace, #246):
- **Known red checks** (Vahid decides on a re-run):
  - Frontend build failing on the Inter font fetch: re-run it once the whole run has finished (+1:49, #246);
  - the four Forecast changes assertions, after the OBR import, until `36e0fef2` is on `main`.
- **Anything else red:** report the failing test and its message. Never edit a test to make it pass, and never push a fix without Vahid's go. A fix under a calculation path stales the receipts (rule 7).

## Disclosure control

The figures derive from UK Data Service safeguarded unit records (the Family Resources Survey and other surveys), through Microcosm UK. The licence (CD137, clause 8) binds every output to the Research data handling and security guide's disclosure rules (CD171, §5.2.1). María is bound by it personally, and her go doesn't waive it.

**What people read.** This covers pull request bodies, comments, commit messages, issues, Slack, email, slides, notes, docs and the dashboard. None of it may contain:
- **a unit record:** a person, household or record; a record id; a per-record value or weight; a maximum, minimum, top-k list, outlier or residual;
- **a small cell:** a number or percentage for a cell resting on one or two cases.
  - CD171's floor is 3, and the working floor is **10 unweighted cases**. Smaller counts print as "<10", with one more cell withheld where a total would give the count back.
  - Cases are distinct survey households: Microcosm's copies of one household count once.
- **a thin aggregate:** a weighted total, mean, share or ratio resting on fewer than 10 cases, unless María has agreed it with `policyengine.disclosure`'s keyed noise. One or two cases stay withheld whatever happens.
- **a difference:** two figures whose difference isolates fewer than 10 cases;
- **unchecked small areas:** survey-derived figures below Region (GOR) level without a disclosure check;
- **a chart** drawn from any of the above.

**What the code checks:**
- the area release's disclosure layer (`policyengine.disclosure`) on `constituency.csv`: a floor of 10 survey households a cell, dominance and p% rules, differencing across levels and between a package and its members, rounding, and `validate_public`;
- `scripts/check_public_data.py` (CI) and `scripts/check-public-files.mjs` (every build):
  - every file under `public/` reviewed by its SHA-256;
  - disclosure tables validated;
  - no household, benefit unit or person id or weight columns;
  - the area-code guard;
- the page, which never sums across measures;
- once #208 merges, a floor of 10 survey households in the national household tables.

**What nothing checks, so people must:**
- **Everything people write.** Quote no figure from a private file, an audit, `summary.json`, or a cell not already published. Quote no difference of published figures that isolates few households.
- **The national household tables until #208 merges.** The person signing their review rows checks them by hand.
- **The map after a correction.** Never republish a corrected measure's results by area without María's check, and publish no package by area.
- **Area-run files, audits and arrays.** These never go into any repository.

**Agents never sign review rows.** A review row is a person's statement that they read those exact bytes.

## Posting and the time log

- **Posting.** The agent drafts every PR body, comment and message as a local file, and checks it against the disclosure rules. The named person reads it and gives a go for that item. Only then does the agent post it, or the person does.
- **The time log:** one file, `~/private/uk-budget-2026/time-log.md`, appended as you go, one line per step:

  ```text
  <step> | start <HH:MM:SSZ> | end <HH:MM:SSZ> | who | machine or people | SHA | manifest revision | note
  ```

  Log:
  - the speech's start;
  - each document's landing, piece by piece;
  - each measure's classification, and its encoding start and end;
  - each Modal command;
  - each signature, asked for and given;
  - each PR (opened, each check's end, merged);
  - each deploy;
  - the live check.

  Split machine time from people's time. Record CI per check (`gh pr checks <n>`). No figure from the data goes in the log.
