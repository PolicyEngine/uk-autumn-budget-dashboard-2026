# Budget day for agents (Wednesday 28 October 2026)

The agents' path from the speech to a published dashboard, in the order of the [checklist](budget-day-checklist.md). It is a working view of the [runbook](budget-day-runbook.md), not a second plan. Where the two differ, the runbook wins, and the agent stops and asks the Integrator. Who signs what, and what each person checks first, is in [`budget-day-people.md`](budget-day-people.md). The day at a glance is in [`budget-day-map.md`](budget-day-map.md).

| Role | Name |
|---|---|
| Integrator | Vahid (`vahid-ahmadi`) |
| Coordinator | Max (`MaxGhenis`) |
| Second signer and licence holder | María (`juaristi22`) |

This page uses roles everywhere else, so a missing person changes only the table above.

Times are UTC (UK time equals UTC this week). Every step a person must sign is marked **Signature**. An agent never signs.

Written against `main` at `9cfbdb4e` (27 October, 19:07Z). `main` runs policyengine 6.11.1 since #237: policyengine-uk 2.151.0 and the certified Microcosm cut a6299504, with #238's limits. It also has:
- #208: the parameter-pair refusals and the floor of 10 survey households;
- #244: the official costings export;
- #258 and #261: the registered candidates, eight since #261;
- #264: the household calculator's warm schedule from Budget day, and a fast 503;
- #265: the page's retry when the calculator is cold;
- #267: the package's two flat files run one Modal container per measure and year.

Open pull requests change some steps, and each step says what changes when one has merged:
- #174 lets Treasury inputs be committed after G2;
- #249 adds the OBR's effect on CPI;
- #260 adds the team test link's script.

**Vahid's decisions of 27 October (evening)** change the steps below. They are in four comments on #251: [decisions](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6448563927), [to repeat on Budget day](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6449275288), [run order and timings](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6449473328), and [the four PRs](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6451621671). The test link and the warm schedule are on #247.
- **The day goes in four PRs:** the measures (#1, merged at about 14:30 once the documents have landed and CI is green), the Treasury figures (#2, from 13:40), the publication (#3, about 16:00, after `publish approve`) and the map (#4, about 17:30). There is no separate provisional publication ("The four PRs" below).
- **Preview runs don't wait for CI.** They start from #1's pushed commit once its targeted tests pass. The publishable run comes from #1's merged commit (step 6, G2).
- **One Modal call per measure, all at once.** The measure that decides the package goes first (G2).
- **The floor settles the package's members before the package runs** (G2, G4).
- **Code only what the data can carry,** and nothing current law already has. Parameter changes come first (G1).
- **No approval before the Treasury figures,** so no area run before G3. The area run needs #174 (G3, G4).
- **Redeploy the household calculator from the generation's commit before each generation:** the test app, then production with the Integrator's sign-off (step 7).
- **Preview first, publish second.** The team test link is redeployed after each load (G2, "Disclosure control").

## Who does what

From the Integrator's table on #247 (27 October, 11:19Z), as the runbook's Roles table now has it:
- **Agents:**
  - read the documents, classify and encode each measure, and enter the Treasury costings;
  - run the commands they are given, prepare commits and pull request text, and keep the time log.
- **The Integrator:**
  - checks the Treasury costings, approves, signs the review rows, merges every pull request, deploys, and rolls back;
  - decides when to push, when to open a PR, and when each Modal command runs.
- **The second signer:** the second of the two people on each hand-written modifier's attestation. Who checks first is open. As licence holder, also signs off the map PR (#4) with the Integrator.
- **The Coordinator:** runs tonight's regeneration, and holds the 07:00 go/no-go.

## The four PRs (Vahid, 27 October, 19:32Z)

The day's dashboard work goes in four PRs, in this order ([#251](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6451621671)). Small hotfix PRs are opened only if something breaks. Each holds one kind of change, so the code, the Treasury's figures, the national results and the map are each reviewed, signed and merged without holding up the others.
1. **Measures: the code.** The announced measures in `reforms.py` (parametric where possible), their expected-effect rows, and the policy names and summaries.
   - **Sign-off:** the Integrator reviews; the second signer attests any hand-written modifier. An attestation binds a receipt, so it is signed once #3's generation has written the receipt, and the file goes in #3.
   - **Merge:** about 14:30, once the documents have landed and CI is green, so the code matches what they say. Its merged commit is the one every published figure is generated from.
2. **Treasury figures (G3): what the results are checked against.** The Treasury's costings in `data_inputs/treasury/`. The reconciliation compares each measure with them, and they fill the "Official costings" card.
   - **Sign-off:** the Integrator.
   - **Merge:** any time after 13:40. With #174 merged, this doesn't invalidate receipts.
3. **Publication: the national results.** The single measures, the package, the flat files and the example households, generated on Modal from #1's merged commit, plus the review rows.
   - **Sign-off:** the Integrator (review rows) and the second signer (attestations).
   - **Merge:** about 16:00, after `publish approve`, so only approved figures go out. It is the day's first publication.
4. **Map: the results by constituency.** Constituency results from the area run, which takes about an hour, so the map follows the national results instead of holding them up. It carries its own disclosure sign-off.
   - **Sign-off:** the Integrator and the licence holder.
   - **Merge:** in the evening, about 17:30.

**Ordering rules:**
- Between the start of generation (#3) and its merge, nothing that touches a calculation path merges, because receipts bind the commit.
- Text and UI tweaks go into #1 before the cut, or wait until after #3.
- #207 (the pre-Budget candidates) needs a fresh run from `main`. If the Budget's measures differ, #3 replaces it.

**Needed on `main` before the day:** #174, #260 (part 9 of the page edits), and #207 or its rerun.

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
5. **One release checkout.** Generation, staging, approval and publishing happen in one checkout, at #1's merged commit. Preview runs from #1's pushed commit go in a separate local preview checkout, and nothing from them is committed. The Integrator runs the release checkout, or names the agent who does. Encoding agents work on branches in their own worktrees. Never run two `publish` commands at once in one checkout: each rewrites the manifest.
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
7. **Calculation paths, and the ordering rule.** Two runs bind the code-bound receipts again: `generate --combined` and the area run. Code-bound means any measure with a `simulation_modifier`, made from templates or written by hand. Both runs refuse every such measure once anything that could change a calculation has been committed after the commit G2 generated from.
   - **Safe to commit after G2:**
     - attestations;
     - `public/` and `docs/`, except Python files;
     - `data_inputs/public_data_review.csv`;
     - top-level Markdown;
     - the page's files under `src/` outside `src/uk_budget_data/`, only with the suffixes `.js .jsx .ts .tsx .css .svg .json .csv .geojson` (`receipt.FRONTEND_SUFFIXES`). Anything else there, a font file for example, counts as code.
   - **Not safe:**
     - `data_inputs/household_fixtures/`;
     - `data_inputs/living_standards/`, which the OBR forecast import writes;
     - `tests/`, `scripts/`, `.github/`, `uv.lock` and `.beads/`;
     - `data_inputs/treasury/`, until #174 merges.
   - **When in doubt, check:**

     ```sh
     uv run python -c "import sys; from uk_budget_data.publication.receipt import is_non_calculation_path as f; [print(f(p), p) for p in sys.argv[1:]]" <path> ...
     ```

   If something unsafe must go in after G2, every measure with a modifier is regenerated before the next combined or area run, and every hand-written one is attested again.
8. **Never, from the checklist:**
   - put two measures in one `generate` call. One call per measure, all at once (Vahid, 27 October): the wait is then the slowest measure, not their sum, and a hand-written modifier never shares a process;
   - run `--artifacts` without `--reforms`;
   - run `publish review-rows` while a `generate` is running, or before every artifact you mean to keep is staged or moved to `held/`;
   - interrupt a Modal run that has gone quiet;
   - mix local and Modal artifacts in one release.
9. **The laptop.** Generation, the combined run, the area run and the package flat files run on Modal. Start no Modal app the plan doesn't name. Keep no containers warm, with one exception: the production household app's approved `warm_schedule`. Production runs the schedule it was last deployed with: 25 October's keeps 12 warm on Wednesday from 12:00 to 22:00 UK time. #264's (Vahid, 27 October; merged at 19:06Z) keeps 12 workers and the web endpoint warm from 07:00 to 24:00, Wednesday to Friday, and arrives only with a production Modal redeploy from a commit that has it. Either is expected, so leave it alone. Run only the tests for what you touched. Never run `bun run build` beside a running `next dev`.
10. **Time log.** A UTC start and end for every step (the last section).

**Modal commands.** The checklist writes `MODAL` for `uv run --with modal==1.6.2 python -m uk_budget_data.cli`. Define it once per shell, so its commands paste as written:

```sh
MODAL() { uv run --with modal==1.6.2 python -m uk_budget_data.cli "$@"; }
```

Commands without Modal stay `uv run uk-budget-data …`.

**The candidates and the hand-written modifiers:**
- **The pre-Budget set was settled on the evening of 27 October.** #261 (Vahid, merged at 19:07Z) registers eight, and their package is `combined--894152ce8c83f1d8` ([#251](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6449275288)). Tuesday's 18:01Z run on the seven was superseded: the Integrator restarted the regeneration on the eight from `9cfbdb4e` at about 19:20Z, all measures in parallel on Modal (#222). #222 records what it staged and what the floor held. On Wednesday morning, read the registered list (`uv run uk-budget-data generate --list-reforms`), the package's members (`AUTUMN_BUDGET_2026_COMBINED_COMPONENTS` in `reforms.py`), and what the manifest holds.
- **Withdrawn and unregistered:** BADR and employer NI relief for under-25s (#258). #261 also withdrew the road fuel VAT cut, the Carer's Allowance taper and the LHA unfreeze, the last two because their decile cells rest on fewer than 10 survey households (#263).
- **Two hand-written modifiers,** Plan 2 and the State Pension protection. Since #261 the protection is the total-income design: an allowance of the full new State Pension for people over State Pension age whose total income is at or below it. Each goes in a `generate` call of its own, and needs a two-person attestation for every receipt.
- **The package needs its own attestation** when it binds a hand-written member.
- **Check each receipt for templates** (Vahid, #222): `jq '.dashboard.modifier_templates' public/data/artifacts/<id>/<digest>/receipt.json`. A `null` proof means the modifier counts as hand-written, so it needs an attestation (`attestations.requires_attestation`). This matters for template measures whose module changed, as #261 changes the fuel duty one.
- These rules hold while the data-limit registry isn't empty. On 6.11.1 it lists 25 limits.

## Before the day: what to check on Wednesday morning

These are Tuesday's steps, for the Integrator and the Coordinator. On Wednesday the agent checks they happened and records what it finds. It doesn't redo them.
- **Which calculation-path pull requests merged by the 17:30 freeze** (#222), in particular #174 and #249. #237, #208, #244 and #258 merged before it. #261, #264, #265 and #267 merged at 19:06–19:07Z, when the Integrator lifted the freeze for one batch, and the regeneration restarted from `9cfbdb4e` (#222). Record its commit, what it staged and what the floor held.
- **Both Modal images built** on the final `uv.lock` before 18:00. Measured at 2:40 for the image (#239), and about 12 min after a lock change (#225).
- **The regeneration** (the Coordinator at 18:00; restarted by the Integrator at about 19:20 on the eight): #222 records which measures ran, which were staged, which the floor held, and the package's key and members (`combined--894152ce8c83f1d8` if all eight stage). Record them in the time log.
- **Then fresh two-person attestations** for each hand-written receipt that was staged, and for the package if it holds one. An attestation made before the regeneration no longer matches.
- **The household calculator deployed tonight** (#231): the Integrator redeploys Cloud Run and the production Modal app from `main` at `9cfbdb4e`, with #264's warm schedule from 07:00 on 28 October (Vahid, [#251](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6451621671)).
- **What Vahid needs on `main` before the day:** #174, #260, and #207 or its rerun. Record which are in.
- **The team test link** (#247): its script (#260) works from the local preview checkout, and the Integrator has named who sends the link to the team.

## Set-up, final cut and go/no-go (by 07:00)

- **Who:** the Integrator adopts the final cut by 06:00, and the Coordinator holds the go/no-go at 07:00. An agent then sets up.
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
- **Model limits.** A key printed `False` holds its measures at provisional: approval is refused. On 6.11.1 only `pc_minimum_guarantee_uprating` remains. It holds changes from 2027 to the Pension Credit minimum guarantee, the savings credit threshold and the pension-age Housing Benefit allowances.
- **Data limits.** A measure that changes a listed parameter is "not computable on current data". The page shows it as such, never with a figure. On 6.11.1 the 25 limits include:
  - the PIP points thresholds;
  - uncapped bus single fares;
  - salary sacrifice;
  - annual-allowance death benefits;
  - the defined-benefit pension share;
  - deferred early-years school starts;
  - full-year Category A directors;
  - Housing Benefit residential capital;
  - every gambling duty.

  The SDLT, LBTT and LTT purchase rates are computable again.
- **Stop if:**
  - `main` moved after the go/no-go and the Integrator didn't say so;
  - `uv sync --locked` changes anything;
  - the versions differ from those recorded for the final cut.

## G0: start receipt (by 11:30)

- **Who:** the Integrator, or the agent he names.
- **A newer build may be on offer** (the Coordinator's call). A new data build will probably be published, with an open policyengine.py PR.
  - The Coordinator runs the UK hub on it and compares it with the current versions: policyengine 6.11.1, with policyengine-uk 2.151.0 and the a6299504 and c9df4b86 cuts.
  - The Coordinator then decides whether to bump, weighing the data's quality and the new policyengine-uk's runtime against what the build brings: gambling and some other fixes the current one doesn't have. #262 has the bump's checklist.
  - Agents record which pair is in. They never adopt one themselves.
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

## G1 and encoding (12:30 to about 14:30)

**1. Read the speech (from 12:30).** List every measure the Chancellor announces, with what was said, its start date and its years. Use the official text or broadcast, never another organisation's figures. Log the time each measure was heard.

**2. Classify each measure (G1, 12:30 to 12:45).** Agents draft the coverage ledger, and the Integrator confirms which measures are coded. Before a measure is coded, check three things (Vahid, 27 October):
- **The data carries its inputs.** Check that the dataset has every input its formula reads. Tobacco and alcohol duty read quantities (cigarettes, grams, litres), but Microcosm holds only an aggregate alcohol-and-tobacco spend, so they were dropped. A measure that returns zero everywhere is dropped, not published.
- **Current law doesn't already have it.** policyengine-uk 2.151.0 already has tobacco RPI+2 from 1 October 2026, so modelling it again would show nothing.
- **A parameter change comes first.** It needs no attestation, while a hand-written modifier needs two people. When the design is unclear, or there is no clean parametric route (working-age benefits uprated below CPI, on 27 October), leave the measure out rather than write a broad hack.

Each measure gets exactly one class and a reason:
1. **Parameter-only.** It changes existing parameters in `parameter_changes`, by hand or with `rate_change`, `threshold_change`, `uc_health_element_change`, `allowance_uprating` or `pension_uprating`. Bound by content: no attestation, and no later commit stops it.
2. **Template modifier.** A module-level modifier that only calls `apply_vat_base_change`, `apply_benefit_receipt_payment`, `apply_age_conditioned_allowance` or `apply_property_band_surcharge`. No attestation. Bound by commit.
3. **Hand-written modifier.** Any other code.
   - A named data-limits check in its PR, its own `generate` call, and a two-person attestation of its exact receipt.
   - Bound by commit.
   - Allow 30 to 60 min plus the second signer (#247).
4. **Ledger only.** Announced, but outside what the model covers. No code.
5. **Not computable.** In scope, but the data or model can't cost it. No code, unless the Integrator wants the gate's not-computable entry. Known cases:
   - a measure on a data-limited parameter (the morning's list; on 6.11.1 that includes every gambling duty);
   - a measure whose inputs the data doesn't carry, such as tobacco and alcohol duty (no quantities in Microcosm);
   - a wealth tax on the engine's scales (generation refuses it);
   - the "Your First Home" equity loan, and a LISA replacement (no purchase or subscription data);
   - pension tax relief, the annual allowance, its taper or the MPAA: coded, but held for review by default (runbook).

The runbook's rules for writing a measure apply ("How a measure must be written"):
- UC health element changes in 2026 to 2029 go through `uc_health_element_change`;
- a macro path is never keyed by a bare year;
- an uprated amount gets an explicit value for every scored year through 2031 (policyengine-uk #2430);
- dated keys are bare fiscal years: `"2027"` is 2027-28.

**3. A measure that appears only in the documents** (#247, the Integrator's review, finding 6). #1 merges only once the documents have landed, at about 14:30, so such a measure goes into #1 like the others if it is ready by then.
- Once #1 has merged, it waits. Its commit is a calculation path, and nothing on one merges between the start of #3's generation and #3's merge.
- After that, the Integrator chooses: add it before the map's area run, regenerating every measure with a modifier and attesting every hand-written one again; or hold it until after #4, then add it as a G5-style correction.
- Log its times.

**4. Encode each coded measure** (on a branch, from G1; runbook "Construction"):
1. **Write it.**
   - A parameter-only measure is a `_create_<id>()` factory in `src/uk_budget_data/reforms.py`, returning `Reform(id=…, name=…, description=…, parameter_changes=…)` and added to `_MEASURE_FACTORIES`.
   - A modifier goes in a new module, `src/uk_budget_data/budget_measures/<name>.py`. The module holds only imports, literal constants and one undecorated function named after it, with its numbers as default arguments. Never put it in `reforms.py`, and never add a function to an existing module.
   - A measure that moves capital gains tax holds realisations fixed with `static_capital_gains()`.
   - Copy the nearest existing measure.
2. **Add its expected effect** to `data_inputs/treasury/expected_effects.csv`: `measure_id,direction,from_year,to_year,reviewer,note`. `positive` improves the government balance. Leave `reviewer` empty.
   - **Signature: the expected-effects reviewer**, named by the Integrator. The reviewer fills `reviewer` on the measures PR branch before anything is staged, previews included.
     - `load_expected` refuses the whole file while any row lacks a reviewer, so every gate-running `publish` command fails for every measure.
     - A measure with no signed row can't be staged: staging refuses it with "responsiveness is undeclared" (Vahid, 27 October).
     - The file is a calculation path until #174 merges, so a later signature stales the receipts.
   - The pre-Budget candidates' rows are signed already (`juaristi22`, #213; #261's two new rows too). Only measures added on the day need a reviewer.
3. **Declare the taxes it changes** in `DECLARED` in `tests/test_measure_descriptions.py`. Its name and description name only those, and never say "Candidate measure".
4. **Add one numerical test** on a made-up household, with the arithmetic done by hand.
5. **Its household check fixture** goes in this same commit under `data_inputs/household_fixtures/`, or in `~/private/uk-budget-2026/fixtures/`. It is a calculation path either way, so it never goes into the release checkout after G2.
6. **Set the engine's paired parameters together.** The engine charges each pair together, and since #208 generation refuses a measure, single or combined, that changes the first of a pair in a year without the second (`parameter_companions.py`). So a measure that sets the first sets the second too, in every scored year, to its new or current value:
   - `gov.hmrc.cgt.higher_rate` with `gov.hmrc.cgt.additional_rate`, and the same pair under `gov.hmrc.cgt.residential_property` and `gov.hmrc.cgt.carried_interest`;
   - `gov.hmrc.income_tax.rates.dividends[2].rate` with `[3].rate`, since the dividend scale's fourth bracket starts at £10m;
   - `gov.hmrc.income_tax.rates.uk[2].rate` with `uk[3].rate`, for the same £10m bracket;
   - `gov.dwp.LHA.freeze` with `gov.dfc.LHA.freeze`, and `gov.dwp.LHA.percentile` with `gov.dfc.LHA.percentile`: Northern Ireland follows `gov.dfc`.
7. **Run the tests you touched:**

   ```sh
   uv run pytest tests/test_measure_descriptions.py tests/test_budget_measures.py tests/test_reforms.py <your test> -q
   uv run black --check <changed .py files> && uv run ruff check <changed .py files>
   ```

   CI runs the rest.

**5. The candidates already published.** Each pre-Budget candidate in the manifest is either announced as modelled, or withdrawn in the first manifest write of #3's generation. Agents list them; the Integrator decides.
- If announced as modelled, update its name, description and any parameters in the measures PR, and regenerate it at G2.
- If not, withdraw it: `uv run uk-budget-data publish withdraw <id> --reason "Not in the Autumn Budget 2026"`.
- BADR and employer NI were never staged, and are unregistered since #258, so neither needs a withdrawal.

None stays on the page under the statement label.

**6. #1, the measures PR.** The agent prepares it. The Integrator gives the go to push and open it, and merges it. It holds the measures, their expected-effect rows, and the policy names and summaries ("The four PRs").
- Push and open it in one go: CI starts when the PR opens, not at the push (#246).
- The body names each measure and its class. No figure from the data.
  - **Signature: the data-limits check.** Each hand-written modifier gets its reviewer's line: "Data-limits check, <name>, <date>: no other simulation or system; no state changed mid-run; no metaclass; changes purchase pricing: no." (runbook).
- **The package's members go in this PR.** `AUTUMN_BUDGET_2026_COMBINED_COMPONENTS` in `reforms.py` must list exactly the package you mean to publish: the area run finds the package only when the manifest approves a combined run with exactly those members (#222). Changing it is a calculation-path change, so it goes in with the day's measures, settled from the preview floor check (G2), never after #3's generation has started.
- **Preview runs don't wait for CI** (Vahid, 27 October). Once the pushed commit passes the targeted tests (step 4), the test app is redeployed from it (step 7) and the preview runs start from it (G2), with CI running alongside. The publishable run waits for the merge.
- **Gate:** the six required checks: Python tests, Python lint, Certified data, Frontend build, Frontend tests and Frontend lint.
- **Time:** at most 10 min with #219's ten duration-balanced Python shards; 8:48 to the last check on #246.
- **The Integrator merges it at about 14:30, once the documents have landed and CI is green, with a merge commit, never a squash.** The area run needs each receipt's commit to be an ancestor of `main`. Text and UI tweaks go in before this cut, or wait until after #3.

**7. The household calculator, before each generation, and the examples.** The page sends every displayed measure to the household API, and an API deployed before the measures commit refuses the new ones ("Unknown measures"). Drill 5 hit this (#144). Cloud Run on `f3304ff` also sends no breakdown by tax and benefit, so the household charts show only totals until it is redeployed. So the calculator is redeployed from the generation's commit before each generation (Vahid, 27 October):
1. **Before each generation, the test app,** which the team test link calls, from a clean checkout of that commit: #1's pushed commit for the preview runs, its merged commit for #3:

   ```sh
   HOUSEHOLD_MODAL_APP=uk-budget-household-test uv run --with modal==1.6.2 modal deploy src/uk_budget_data/modal_household.py
   ```

2. **Signature: deploy to production (the Integrator signs it off),** from #1's merged commit, after #1 merges and before #3 does:
   - run the "Deploy the household API" workflow, action `deploy`, with `commit` set to that commit's full SHA (it deploys only a commit on `main`). It is live 6 to 7 min after dispatch (runbook);
   - then deploy the production Modal app from a clean checkout of that commit: `uv run --with modal==1.6.2 modal deploy src/uk_budget_data/modal_household.py`. From any `main` after #264, this also brings the Budget-day warm schedule.
3. **The examples, as soon as the final member list is known** (after the preview floor check), alongside the combined run, for #3. The script recomputes the eight example households in-process, in two jobs: about 11 min (Vahid, 27 October). Without `--policies` it takes the package's measures from `public/data/policy_parameters.json`.

   ```sh
   bun scripts/household-preset-requests.mjs --policies <comma-separated displayable ids> > ~/private/uk-budget-2026/requests.json
   uv run python scripts/precompute_household_presets.py ~/private/uk-budget-2026/requests.json
   ```

   - Choose the examples so each one shows a published measure clearly (Vahid). They are defined in `src/utils/householdPresets.js`, a page file, so changing them is safe after G2 (rule 7). The Integrator decides.
   - It writes `public/data/household_presets.json`, which needs its review row (**Signature: the Integrator**).
4. Check both before the publication PR merges. It exits 1 on a refused measure or a stale example:

   ```sh
   uv run python -m uk_budget_data.page_measures_check --base-url "$HOUSEHOLD_API" --base-url "$HOUSEHOLD_DETAIL_API"
   ```

   `HOUSEHOLD_DETAIL_API` is the Modal household app the production build calls. The Integrator confirms its URL.
5. Then `uv run uk-budget-data publish definitions --api "$HOUSEHOLD_API"` must print `same` for every displayed measure.
6. **A cold service answers slowly.** A cold first request to the test app came back empty after about 150 s on 27 October. #265 (merged) gives the page a "starting up" message and a retry. #264 (merged) gives the Modal app a fast 503 and the schedule, from its next deploy (rule 9).

## G2: preview runs, then #3's generation (from about 14:30)

- **Who:** the Integrator, or the agent the Integrator names.
  - **Preview runs** go in a local preview checkout at #1's pushed commit, while CI runs (step 6). Nothing from them is committed or published.
  - **The publishable run (#3)** goes in the release checkout at #1's merged commit, from about 14:30. From its start until #3 merges, nothing on a calculation path merges.
- **Before:** the checkout is at that commit, and `git status --porcelain` lists nothing. Record HEAD: every receipt names it.
- **First, the measure that decides the package** (Vahid, 27 October): the hand-written one most likely to be thin. Push it as soon as it is encoded, and preview it alone from that commit while the rest are encoded: `MODAL generate --artifacts --backend modal --reforms <id>`.
  - Read its summary for `<id>: WARNING:` lines before anything that depends on it.
  - If it is thin, it stays private and out of the package: leave it out of `AUTUMN_BUDGET_2026_COMBINED_COMPONENTS` before #1 merges (step 6).
  - If it passes, it runs again with the others in #3: a hand-written receipt binds the commit it was made at.
- **Then one call per measure, all at once** (Vahid, 27 October): from the pushed commit for the previews, and from #1's merged commit for #3:
  1. one shell for each measure: `MODAL generate --artifacts --backend modal --reforms <one id>`;
  2. only if a flat file needs re-cutting: `MODAL generate --backend modal --only income_distribution`. Never the package's files here: they wait for the last manifest change (G4).
- **Time:**
  - on 6.11.1, 7–14 min a measure in Vahid's run of 27 October, so the wait is about the slowest measure, not their sum;
  - on 6.11.1 earlier, one container per measure: 5:35 to 10:00, with the Warm Home Discount top-up at 9:43 and Plan 2 at 16:28 (#250).
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
  - `REFUSED <id>: …` lines: a data limit, a scored year left out, a wealth-tax scale, or a parameter pair set alone (#208);
  - staging refuses a measure that doesn't move in its declared direction;
  - `publish check` re-runs every gate.
- **The floor of 10 survey households** (#208; runbook G2). A measure with a decile cell whose change rests on 1 to 9 survey households is written with `<id>: WARNING: cells resting on fewer than 10 survey households: …`. The warning names tables, years and groups, never a figure.
  - Such an artifact can't be staged at any level, so it is never shown. `publish review-rows` deletes it: never commit it by hand.
  - Its figures stay private, its costing included.
  - Leave it out of the combined run, as for a held measure. Wherever the package total appears, say why: too few households in the survey data are affected to publish its effects by income decile.
  - Settle the package's members from these warnings before the combined run (Vahid, 27 October). Each dropped member means a new package key and a new combined run. A thin measure can't be published by decile until cell suppression exists, which is post-Budget work (#263).
  - To stop such a run instead, writing nothing, set `UK_BUDGET_THIN_DECILES=refuse` in the shell that starts `generate`.
  - The age table withholds rather than refuses: a blank single-age or pensioners chart for one measure and year is the floor at work.
- **Preview first, publish second** (Vahid, 27 October). Load each run into a local preview checkout straight away, with placeholder attestations kept in that checkout only, to catch problems before the merge. Nothing from a preview is committed or published.
  - **The team test link** (#247). After each load (the G2 measures, the package, the area run), the person the Integrator names redeploys the preview to `https://ab2026-local-preview.vercel.app/uk/autumn-budget-2026` with `tools/deploy-test-link.sh` (#260), on the Integrator's go. The script refuses unless the preview's manifest has a provisional measure and isn't production's, and it restores the files it edits.
  - **The link is public, with no login, and its build skips `check-public-files`.** So nothing checks what it shows (see "Disclosure control"). Before each deploy, move out of the preview's `public/data` every artifact that printed the floor's `WARNING:` line, and anything from a private file. No package by area goes on it before the licence holder agrees.
  - Real publication is still the signed path: the publication PR, then `main`, then the production deploy.
- **Household check, for each measure,** against the redeployed API:

  ```sh
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" --fixtures ~/private/uk-budget-2026/fixtures --manifest public/data/manifest.json --out ~/private/uk-budget-2026/receipts/<id>-households.json
  ```

- **Signature: review rows (the Integrator).** He runs this himself, never while a `generate` runs:

  ```sh
  uv run uk-budget-data publish review-rows --reviewer <his GitHub username> --staged-by <who staged>
  ```

  It takes about 2 s (#239). It deletes every unstaged artifact, and lists the files it left without a row.
- **Then the publication waits for #3.** On the day there is no separate provisional publication: the checks, `git add` and the PR come once the measures are approved (G3) and the package and its files are in (G4), at about 16:00.
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
- **Early or piecemeal documents.** Start reading as soon as anything lands, and log when each piece did. Publish nothing before the speech has begun, and nothing without the Integrator's word. On 26 November 2025 the OBR's EFO was online before the speech by accident (#247).
- **gov.uk documents** may be fetched by script (runbook, "Treasury tables come from gov.uk by script").
- **obr.uk refuses scripts.** It answers HTTP 200 with an HTML "No Access" page. Use a real browser:
  - go to `https://obr.uk/download/<slug>/` one file at a time, with the slugs read off the EFO page, not guessed;
  - the PDF opens inline, so use Save As;
  - fetch the economy workbook first: it's the one the forecast import needs (#246).
- **Record each file as it lands:** URL, UTC time, size, `shasum -a 256 <file>`, and `file <file>`, which must say "Microsoft Excel 2007+" for a workbook. The OBR can re-upload a file after publication, so the hash at download is the record (#246).
- **Time:** 2:02 for four workbooks and the PDF (#246).

## G3: Treasury costings (#2, from 13:40), reconciliation and approval (during #3)

**No approval before the Treasury figures** (Vahid, 27 October). `publish approve` refuses while a measure's reconciliation is `awaiting_source`, and the area run takes approved entries only, so it can't start before G3.

**1. Where the Treasury inputs live.** This depends on #174. Vahid's decision is that the area run needs #174 merged first: without it, every G3 Treasury commit makes the combined run and the area run refuse. He lists #174 as needed on `main` before the day; with it, #2 merges any time after 13:40 ("The four PRs").
- **#174 merged:** Treasury CSV and YAML files can be committed after G2 without staling anything. Work in `data_inputs/treasury/` and commit as the runbook says. Commit before any generation from that checkout: an uncommitted file still makes the tree dirty.
- **#174 not merged:** keep the inputs out of the release checkout until G4's combined run and area run have both started.
  - Work on a private copy, and put `--inputs` before the action in every gate-running `publish` command (`reconcile`, `stage`, `approve`, `index`, `check`):

    ```sh
    cp -R data_inputs/treasury/. ~/private/uk-budget-2026/treasury/
    uv run uk-budget-data publish --inputs ~/private/uk-budget-2026/treasury reconcile <artifact dir>
    ```

  - Both runs read the tree only when they start: the combined run at once, the area run while it plans. After that, the files can be copied in and committed (G4).

**2. Enter the costings.** Agents enter them. **Signature: the Integrator checks every figure.**

```sh
uv run python -m uk_budget_data.treasury_import ~/private/uk-budget-2026/downloads/<Table 4.1 xlsx> --source-id AB2026-T4.1 --document "Autumn Budget 2026" --out <treasury dir>/sources/AB2026-T4.1.csv --static-template <treasury dir>/sources/AB2026-static.csv
```

- **Totals:** the importer checks every row against the table's printed totals, and stops on a mis-keyed row.
- **Units:** `value_bn` is £ billion. The table prints £ million, and the importer converts.
- **Sign:** the Exchequer's. Positive improves the public finances, so a tax rise is positive and a spending rise negative.
- **Basis:** fill `AB2026-static.csv` from the policy costings document, one static figure per measure and year, with its page and table in `notes`.
  - Table 4.1's figures are post-behavioural: reported, never gated.
  - A blank `value_bn` means "not entered", and reconciles as `awaiting_source`.
- **Years:** fiscal years, such as `2027-28`. Model year 2027 is 2027-28, so `year_offset` is 0.
- **The mapping:** one row of `mapping.csv` (`measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer`) per Treasury row a measure is compared with. Rows are summed.
  - A `scale` other than 1, or `status: not_comparable`, needs a reason and the reviewer's name. **Signature: the Integrator** fills `reviewer`.
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

  **Signature: the exception's reviewer** fills `reviewer` and `accepted_at`. Who that is stays open, because the runbook bars the Integrator from approving his own exceptions. Then reconcile again.
- **Signature: approval (the Integrator):**

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
- **Time:** between #3's generation (from about 14:30) and #3's merge (about 16:00). It hasn't been timed on real documents.

**4. Attestations.** For every hand-written modifier generated today, and every combined run that holds one:
- **Drafting:**
  - `uv run python scripts/draft_attestation.py <artifact dir>` drafts the file for Plan 2, the pensioner allowance and the combined runs that hold them;
  - for a new hand-written measure, the script stops ("no drafted reason"), and editing the script is a calculation path. Draft the file by hand instead, into `data_inputs/publication/attestations/<key>.json`:

    ```sh
    uv run python -c "import json,sys; from pathlib import Path; from uk_budget_data.publication.attestations import receipt_document_sha256 as d; doc=json.loads(Path(sys.argv[1],'receipt.json').read_bytes()); print(json.dumps({'measure_id': doc['dashboard']['key'], 'receipt_sha256': d(doc), 'reason': '', 'checker': '', 'second': '', 'released_at': ''}, indent=2))" <artifact dir>
    ```

- **Signature: attestation (two different people; the second is the second signer; who checks first is open).**
  - Both read the modifier's code at the receipt's commit.
  - They fill `reason` (factual, with no survey-level values), `checker` and `second`, and `released_at` (ISO 8601 with a timezone).
- **Then** commit the file, and stage the artifact back from `held/`. The gate reads the attestation from git HEAD, so an uncommitted file releases nothing.

**5. Official costings for the Public finances card** (#244; runbook G4).
- After the Treasury sheets and the mapping are filled, run `uv run python -m uk_budget_data.publication.official_costings`, with `--inputs <treasury dir>` if they are still private.
- It writes `public/data/official_costings.json`: the sums the reconciliation compares, on both bases, under the manifest's keys, with no PolicyEngine figure. Rerun it after any change to the Treasury sheets or the mapping, not after restaging.
- It needs its review row, kind `national_table`, signed on the final bytes (**Signature: the Integrator**).
- Set `obr_budget_2026_costings.url` in `src/utils/sources.js` to the costings document at the same time.

**6. The OBR's effect on CPI inflation** (once #249 has merged). Write `public/data/obr_cpi_policy_effect.json` from the EFO policy chapter's workbook, as `docs/obr-cpi-policy-effect.md` (added by #249) says. It needs its review row (**Signature: the Integrator**).

## The OBR forecast import (from 13:40)

- **Who:** the Integrator loads it (runbook, "Budget day: OBR forecast"). An agent prepares and checks.

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
- **Merge its pull request before #1 merges, or after #3 has merged and the map's area run has started.** Its file is a calculation path: merged in between, it would make the combined and area runs refuse every measure with a modifier, and Vahid's rule keeps calculation paths out from the start of #3's generation to its merge. Merging it also replaces the March forecast's lines with an unavailable notice, by design.
- **`src/utils/sources.js`:** change `obr_efo_current` and `budget_documents` only as the pull request that adds this page settles (#246, findings 2 and 3).

## G4: the package and its files (#3, about 16:00), then the map (#4, about 17:30)

Vahid's run order (27 October): each step starts when the one before it is done, not at a fixed time. The single measures come first. The package starts once they are staged, and its two flat files and the area run follow. From the first call to every result in place took about 35–40 min on 27 October, plus staging and checks. On Budget day the approvals at G3 sit between them. In the four-PR plan the package and its files go out with the single measures in #3, and the map follows in #4.

- **Before:**
  - the release checkout is clean (rule 6), with no uncommitted Treasury file;
  - every member is staged, the hand-written ones once attested;
  - HEAD is G2's commit, or descends from it through safe commits only (rule 7).
- **The combined run, as soon as every member is staged:** `MODAL generate --combined <member ids> --backend modal`.
  - **Time:** 10–12 min on 6.11.1 (Vahid's run, 27 October).
  - **Members:** leave out any measure that is held, not computable or stopped by the floor, and say so wherever the package total appears. Settle them before the run starts (G2): each change means a new package key and a new combined run.
  - **Staging:** stage it like a measure. The Integrator approves it once every member is approved (**Signature: the Integrator**). A combined run holding a hand-written modifier needs its own attestation.
- **The package's flat files,** after the last `stage`, `approve` or `withdraw`, in two shells at once: about 5–10 min each with one container per measure (Vahid, 27 October; 2:46 for both with two measures, #239):

  ```sh
  MODAL generate --only income_distribution --published-package --backend modal
  MODAL generate --only income_growth --published-package --backend modal
  ```

  - Since #267, each runs one container per measure and year on Modal and writes the same bytes. It hasn't been timed on the package yet. Add `--sequential` for one container per measure, as before (runbook, "The package's rows in the three flat files", which also asks for a one-off `cmp` of the two ways first).

- **What waits on the package** (Vahid, 27 October). Until the package and its two flat files are published, the page shows "not published yet" in several places. In the household calculator these are "Your place (percentile)", "Your tenth's average", "Your place in the distribution" and "How your change compares". The growth-across-the-distribution card and the combined constituency map wait too. That is correct behaviour, not a bug.

- **#3, the publication** (about 16:00, after `publish approve`). After the last `stage`, `approve` or `withdraw`, and the flat files:
  1. `uv run uk-budget-data publish check`. Don't run `publish index` yet: with no area table it refuses ("no flat view file to bind").
  2. **Signature: review rows (the Integrator).** Run `uv run uk-budget-data publish review-rows --reviewer <GitHub username> --staged-by <who staged>`, never while a `generate` runs. Then add, by hand, the rows for `income_distribution.csv`, `income_mobility.csv` and `income_growth_with_measures.csv` (new SHA-256, reviewer, date, and a basis naming the package), and for `household_presets.json`.
  3. `git add` the artifacts, `manifest.json`, the three flat files, `household_presets.json`, the attestations, any Treasury inputs not yet committed, and `data_inputs/public_data_review.csv`.
  4. `uv run python scripts/check_public_data.py` and `bun scripts/check-public-files.mjs`, both at 0 problems, and `page_measures_check` against the deployed household APIs (step 7).
  5. The PR, on the Integrator's go. The Publication gate isn't a required check, but don't merge if it fails. **Signature: merge (the Integrator).**
- **#4, the area run, once #3's approvals are in, started after the package's combined run and from the same clean commit.** Always name the ids.
  - Since #234 the command's default adds the package once the manifest approves it. The package is whatever `AUTUMN_BUDGET_2026_COMBINED_COMPONENTS` lists (step 6).
  - The runbook publishes it by constituency only if the announced measures are exactly those members.
  - Publishing a package by area waits for the licence holder's agreement (open on the PR that adds this page). Until then, name the single measures.

  ```sh
  UK_BUDGET_DISCLOSURE_AUDIT_DIR=~/private/uk-budget-2026/audit MODAL constituencies --backend modal --reforms <the approved single measure ids> --run-id constituencies-<the cut's 8 hex digits>-<HHMM>
  ```

  - Use a new `--run-id` for every run (#250).
  - **Time on 6.11.1:** about an hour in Vahid's four-PR plan, which merges the map at about 17:30.
    - about 14 min in Vahid's rehearsal of 27 October: 3.5–5.5 min a measure, each in its own container, plus about 8 min for the release. It cost about $0.5–1;
    - 49:46 in #250's run of the seven. Its units took 7:40 to 13:16, apart from Plan 2 (29:02) and the Warm Home Discount top-up (38:44). Until a run with those two is timed again, allow up to an hour when either is approved;
    - then about 20–25 min to the live map (#250).
  - While it runs, leave `constituency.csv` and `area_provenance.json` alone, and start no second area run. A second run refuses the code-bound measures while the first run's files are uncommitted (#250).
- **#174 not merged: #2 waits until the area run has started; then bring the Treasury inputs in.**
  - Copy the checked files from the private copy into `data_inputs/treasury/`.
  - `uv run uk-budget-data publish check`, with no `--inputs`, must still pass.
  - From then on, any new combined run or area run refuses the code-bound measures.
- **After the area run (#4):**
  1. Fetch its private summary from the Modal Volume into the audit directory, never the checkout: `uvx --from modal==1.6.2 modal volume get uk-budget-2026-constituencies-private geography/<run id>/microcosm-<stamp>/summary.json ~/private/uk-budget-2026/audit/`.
     - **Signature: the Integrator**, who signs the table's review row, reads it and the table. Whether the licence holder reads them first is open.
     - Nobody copies a figure from either anywhere.
  2. In this order:

     ```sh
     uv run uk-budget-data publish index
     uv run uk-budget-data publish check
     ```

     `publish index` refuses with no area table ("no flat view file to bind").
  3. **Signature: review rows (the Integrator).** Run `uv run uk-budget-data publish review-rows --reviewer <GitHub username> --staged-by <who staged>`. Then add, by hand, the row for `constituency.csv`: kind `disclosure_table`, the row the area run printed.
  4. `git add`:
     - `manifest.json` and `release-index.json`;
     - `constituency.csv` and `area_provenance.json`;
     - any Treasury inputs not yet committed;
     - `data_inputs/public_data_review.csv`.
  5. `uv run python scripts/check_public_data.py` and `bun scripts/check-public-files.mjs`, both at 0 problems.
  6. #4's PR, on the Integrator's go. **Signature: merge (the Integrator), with the licence holder's sign-off,** at about 17:30.
- **Check it is live,** after each merge:

  ```sh
  curl -s https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026/data/manifest.json | head -5
  uv run python -m uk_budget_data.household_route --base-url "$HOUSEHOLD_API" --fixtures ~/private/uk-budget-2026/fixtures --manifest public/data/manifest.json --out ~/private/uk-budget-2026/receipts/g4-households.json
  ```

  An open page shows the first map only after a reload (#250).
- **Every later manifest change unbinds the map** until `publish index` runs again (#250). That includes a late approval, a withdrawal and the package's approval.
- **Stop if:**
  - the combined run refuses a member with "calculation code changed since the approved commit". Something unsafe was committed after G2: tell the Integrator, and don't work round it;
  - the area run stops on a limit, a demotion or a refusal;
  - `publish index` refuses;
  - a public check reports a problem.

## Corrections and rollback (G5)

- **Who:** the Integrator decides on a correction. Agents prepare it.
- **The path** (runbook, G5):
  1. **Commit the fix on a branch.**
     - `uv run uk-budget-data publish definitions` prints `same` or `DIFFERS` for each displayed measure.
     - `git diff --name-only <receipt commit> HEAD -- src pyproject.toml uv.lock data_inputs Dockerfile` lists what else changed.
  2. **Withdraw every affected measure** in the fix's PR: `uv run uk-budget-data publish withdraw <id> --reason "<why>"`.
     - Once results by area are bound, either run `uv run uk-budget-data publish index --without-area`, or rerun the area run with `--reforms` naming the single measures still approved.
     - Then `publish check`, the review rows (**Signature: the Integrator**), and the merge (**Signature: the Integrator**).
  3. **Wait five minutes, then redeploy.** The Integrator redeploys the household API from `main` (**Signature: deploy**). `publish definitions --api "$HOUSEHOLD_API"` must then print `same`.
  4. **Regenerate** every affected measure, and every other measure with a modifier, as at G2. Attest each hand-written one again.
  5. **Rerun the combined run:** regenerate it, stage it, approve it.
  6. **Bring the results by area back:** rerun the area run with explicit `--reforms`, then `publish index`.
  7. **Write the review rows and open a second PR.** The Integrator merges it only after step 3's household check.
- **Disclosure:** never republish a corrected measure's results by area without the licence holder's check of the old table against the new.
- **The correction clock:**
  - about 8–10 min of CI per PR (#219);
  - 7 to 16 min per modifier regeneration on Modal (#225, #250);
  - each attestation;
  - two PRs.
- **Signature: rollback (the Integrator)** (runbook, "Rollback"):
  - **The dashboard:** Vercel Instant Rollback, then a revert of the merge through a PR (`git revert -m 1 <merge>`), then `vercel promote`.
  - **The household API:** the deploy workflow's `rollback` action. Never past `00024-lir`, and never past the first revision deployed with #125 once the page compares definitions.
  - The fast revert stops being fast after G2's first publication PR.

## When Modal or CI fails

**Modal** (#226):
- **A container fails** (an error, the 45-minute timeout, or out of memory). The command writes every other artifact, prints the `FAILED` lines and the steps to rerun, starts no combined run, and exits 1. Then:
  1. stage what was written;
  2. rerun only the printed ids, each in a call of its own, and stage them;
  3. run the combined run.
- **Never rerun the whole set.** A hand-written modifier would get a new artifact, and so need a new attestation.
- **A refusal is not a failure:** a rerun gives the same answer. Fix the measure or leave it out.
- **Results arrive in measure order.** A quiet run is a slow container: never Ctrl-C it, or every artifact not yet written is lost.
- **A `.staging-*` directory** left by a killed run is never staged or committed. `review-rows` deletes it.
- **Spend:** check `uvx --from modal==1.6.2 modal billing report --for today` before and after. On 6.10.2 a full regeneration cost $1.13 and an area run about $0.5 (#225, #235). On 6.11.1 an area run cost $1.65 in #250's run, and about $0.5–1 in Vahid's (27 October).
- **Stop and tell the Integrator** if Modal is down, a secret is missing, or a run fails twice.

**CI** (about 8–10 min: #219's ten duration-balanced Python shards):
- **The only known red check:** the four Forecast changes assertions after the OBR import, until `36e0fef2` is on `main`. The Inter font is self-hosted since #245, and #177 has merged.
- **Anything else red:** report the failing test and its message. Never edit a test to make it pass, and never push a fix without the Integrator's go. A fix under a calculation path stales the receipts (rule 7).

## Disclosure control

The figures derive from UK Data Service safeguarded unit records (the Family Resources Survey and other surveys), through Microcosm UK. The licence (CD137, clause 8) binds every output to the Research data handling and security guide's disclosure rules (CD171, §5.2.1). María is bound by it personally, and her go doesn't waive it.

**What people read.** This covers pull request bodies, comments, commit messages, issues, Slack, email, slides, notes, docs and the dashboard. None of it may contain:
- **a unit record:** a person, household or record; a record id; a per-record value or weight; a maximum, minimum, top-k list, outlier or residual;
- **a small cell:** a number or percentage for a cell resting on one or two cases. CD171's floor is 3, and the working floor is **10 unweighted cases**.
  - Smaller counts print as "<10", with one more cell withheld where a total would give the count back.
  - Cases are distinct survey households: Microcosm's copies of one household count once.
- **a thin aggregate:** a weighted total, mean, share or ratio resting on fewer than 10 cases, unless the licence holder has agreed it with `policyengine.disclosure`'s keyed noise. One or two cases stay withheld whatever happens.
- **a difference:** two figures whose difference isolates fewer than 10 cases;
- **unchecked small areas:** survey-derived figures below Region (GOR) level without a disclosure check;
- **a chart** drawn from any of the above.

**What the code checks:**
- **the area release's disclosure layer** (`policyengine.disclosure`), on `constituency.csv`:
  - a floor of 10 survey households a cell;
  - dominance and p% rules;
  - differencing across levels, and between a package and its members;
  - rounding;
  - `validate_public`;
- **`scripts/check_public_data.py` (CI) and `scripts/check-public-files.mjs` (every build):**
  - every file under `public/` reviewed by its SHA-256;
  - disclosure tables validated;
  - no household, benefit unit or person id or weight columns;
  - the area-code guard;
- **the page,** which never sums across measures;
- **#208's floor in the national household tables:** a decile table with a cell resting on fewer than 10 survey households is never staged, the age table withholds thin ages and bands, and the binned scatter counts survey households.

**What nothing checks, so people must:**
- **everything people write.** Quote no figure from a private file, an audit, `summary.json`, or a cell not already published, and no difference of published figures that isolates few households;
- **the map after a correction, and any package by area.** Never republish a corrected measure's results by area without the licence holder's check. Publish no package by area without the licence holder's agreement;
- **area-run files, audits and arrays.** They never go into any repository.
- **the team test link** (#247, #260). It is public, with no login, and its build skips `check-public-files`, so what it shows counts as published. Deploy it only from a `public/data` with no artifact the floor flagged (the script doesn't look), nothing from a private file, and no package by area the licence holder hasn't agreed.

**Agents never sign review rows.** A review row is a person's statement that they read those exact bytes.

## Posting and the time log

- **Posting.** The agent drafts every PR body, comment and message as a local file, and checks it against the disclosure rules. The named person reads it and gives a go for that item. Only then does the agent post it, or the person does.
- **The time log:** one file, `~/private/uk-budget-2026/time-log.md`, appended as you go. Write one line per step:

  ```text
  <step> | start <HH:MM:SSZ> | end <HH:MM:SSZ> | who | machine or people | SHA | manifest revision | note
  ```

  - **Log:**
    - the speech's start;
    - each document's landing, piece by piece;
    - each measure's classification, and its encoding start and end;
    - each Modal command;
    - each signature, asked for and given;
    - each PR: opened, each check's end, merged;
    - each deploy;
    - the live check.
  - **Split** machine time from people's time.
  - **Record CI per check** with `gh pr checks <n>`.
  - **No figure from the data** goes in the log.
