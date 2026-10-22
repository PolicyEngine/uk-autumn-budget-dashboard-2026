# W5 handover: the publication pipeline for 28 October

W5 is the workstream for the dashboard's deploy and rollback, receipts, reconciliation, the certified bundle, the briefing gate and the runbook. This file records where it stands as of 22 October 2026, about 17:35Z. Read `docs/budget-day-runbook.md` first; this file only adds what's in flight.

## Two W5 sessions
- **A Claude Code cloud session has run W5 since about 12:50Z,** at Max's request. Its takeover note is on #88. It pushes from one branch, so its PRs come one at a time, starting with #90.
- **The local session carries on alongside it.** Its own move to a cloud session was refused.
- **The split,** confirmed by the coordinator on #90 (17:26Z), with one writer per PR:
  - **Cloud:** #90, option (d), the model limits (including the VAT limit below), the hub's model-gap figures and Friday's step-5 timing report.
  - **Local:** #91, #92, #93, the Subfleet builds and **every bundle adoption**: dispatching the adopt workflow, regenerating and staging measures on certified data, merging, deploying the household API, the memory read, and keeping the revert PR green. The local session has the credentials, Subfleet and compute that adoption needs.
- **Merge order where they overlap:** #90 → #91 → (d) → #92 and #93.
  - (d) rebases on #91, because both touch `publish.py`, `review_rows.py`, `generate.py` and `receipt.py`.
  - Whichever lands second merges `main` in (a merge, never a rebase) and re-runs CI. Neither session pushes to the other's branch.
- **The next bundle's adoption** (the rehearsal or fallback cut, or any re-cut) waits until #90 is on `main`. Any pair with #2336 but without #2557 needs its CPI and State Pension limits.
- **The two sessions talk** through comments on #90 and #88, and Fleet ops relays.

## Where things stand
- **`main` runs policyengine 6.10.0** (policyengine-uk 2.132.6, Microcosm data 0.1.0), from #72.
- **The household API** serves `uk-budget-api-2026-00020-pal` (`ff217d3`), and the rollback target is `00018-xuv` (6.6.0). Timings and memory are in the runbook.
- **Merged since #51 (21 October),** each with green CI and an audit comment, and each on an independent review. The review was at the exact head, except for #51 and #80: they were reviewed one commit earlier, and their final heads only merge `main` in, with the PR's diff unchanged.
  - #51, data limits: a measure the data can't cost is published as not computable;
  - #74, the access check hashes plain-git files;
  - #72, 6.10.0;
  - #73 and #80, the State Pension model limit, browser-held too;
  - #76, results by area gated on data limits;
  - #83, results by area: approved ids only, packages as the approved composition, UNCERTIFIED on Microcosm;
  - #75, the zsh-safe runbook and macro keys;
  - #78, the runbook after #51;
  - #79, the upgrade order and rollback steps;
  - #81, rolling re-cuts, the 07:00Z go/no-go, the fast revert and the back-computed schedule;
  - #82, README and Makefile on bun and `uv run`;
  - #84, the model gaps the UK hub found;
  - #85, the model limit for policyengine-uk #2533: 2027-28 benefit levels need the September 2026 CPI outturn;
  - #86, `publish review-rows`: public-file review rows for the gated publication (coordinator's option (c));
  - #87, the runbook on uprating inputs: a change to one projects the data on 6.10.0 (pe-uk #2405);
  - #88, this file;
  - #89, the templates follow the engine: `UC_REBALANCED_YEARS` from its export, the HVCTS band on its index, the #2430 scored-year check, and the wealth-tax refusal.

## Open pull requests
Each is a draft with an independent review in progress or done. The audit comment on each merged PR shows the pattern to follow.

| PR | What | State |
|---|---|---|
| #90 | Model limits: the Pension Credit minimum guarantee follows earnings; the add-on after #2336 (cloud) | AGREE at `05a2ed0`; CI queued |
| #91 | Data-limit hardening (families 1 and 2), the automatic hold for hand-written modifiers while a data limit is active, and release attestations | Reviewed. The round-1 changes are building on the local Subfleet daemon (`20261022-104658-w5-hardening-r1`, waiting for a lane) |
| #92 | Generation refuses the engine's two wealth-tax scales, in `parameter_changes` or in what the built simulations run; runbook corrections after #89; this refresh | Round 2 under review |
| #93 | Vercel builds with `bun run build`, as CI does; `.env.example` drops `VITE_API_URL` | Waiting on CI and the Vercel preview |

## Subfleet builds
The local session's hand-off of its two builds to the UK hub never reached the hub, so the local session kept them: the templates build landed as #89, and the hardening build as #91. Separately, the hub salvaged the hardening build to `hub/w5-hardening-v2-salvage`. #91 contains all of it: merged into #91 file by file, it adds nothing. So #91 supersedes the branch. Codex-lane builds return their commits as a git bundle in the build's worktree, because their sandbox can't write the shared repository. A local session imports the bundle, fixes the commit trailer (it names the model actually used), pushes and opens or updates the PR. Briefs and outputs are in W5's local drafts folder, under `builds/`.

## Decisions and questions with the coordinator
The coordinator answered this file's open questions on #88 (12:03Z):
- **Not-computable artifacts: option (d).** A not-computable entry's directory holds exactly `receipt.json`, and its review row reads "not computable, staged by <stager>". The cloud session builds it after #90. Until it lands, the rehearsal keeps not-computable measures out of the manifest (option (b)).
- **The area-results caveat.** Show approved ids only, labelled as estimates from Microcosm's local-area file, which the national certificate doesn't cover (policyengine.py#685). Vahid and María choose the wording and placement.
- **Regeneration time (A in the schedule).** Time step 5 (regenerate, stage, reconcile) at Friday's rehearsal and post it on #88. The coordinator then sets the final-cut times (#81's formula). The cloud session has no HuggingFace token, so whoever runs the regeneration times it, unless Max approves access.
- **The hub's figures.** The hub posts its re-measured aggregates on GitHub, and the cloud session adds them to the model-gap list.
- **S4's wealth-tax measure** is in W6's scorecard registry, not this repository.

- **The VAT model limit** (the coordinator on #88, 17:00Z): `vat_consumption_coverage`, held until the adopted pair has policyengine-uk #2187. The cloud session owns it.

## Known follow-ups (not blocking)
- Record who staged an entry in the manifest, so `--staged-by` isn't needed. Wait for the hardening PR, which may change the manifest schema.
- #59 (María's Microcosm area runs) will need to rebase onto #83. #83's body lists the integration points: always compose packages (replacing #59's `build_package`), `--package` through approval, and the `microcosm-national` kind with the label.

## How W5 works
- **Every PR:**
  - branch from `origin/main`, and open a draft PR at the first commit;
  - get an independent review at the exact head;
  - merge only when `gh pr checks` exits 0, the PR is MERGEABLE and out of draft;
  - post an audit comment;
  - merge with `gh pr merge --merge --match-head-commit <head>`. Use merge commits, never squash, so `git revert -m 1` works.
- **Merging main into a PR:** a merge commit, never a rebase.
- **Never:**
  - download data without Max's approval;
  - quote a single record's value;
  - raise the API's CPU, memory or timeout;
  - publish anything public without Max's go.
- **The GitHub API limit** is shared with every session on the account. Poll CI no more than every few minutes.
