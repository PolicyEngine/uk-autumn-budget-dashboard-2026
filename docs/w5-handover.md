# W5 handover: the publication pipeline for 28 October

W5 is the workstream for the dashboard's deploy and rollback, receipts, reconciliation, the certified bundle, the briefing gate and the runbook. This file records where it stands as of 22 October 2026. The W5 session moved to a Claude Code cloud session that day, at Max's request, so the work survives lid-closes. Read `docs/budget-day-runbook.md` first; this file only adds what's in flight.

## Where things stand
- **`main` runs policyengine 6.10.0** (policyengine-uk 2.132.6, Microcosm data 0.1.0), from #72.
- **The household API** serves `uk-budget-api-2026-00020-pal` (`ff217d3`), and the rollback target is `00018-xuv` (6.6.0). Timings and memory are in the runbook.
- **Merged since 21 October,** each on an independent review at the exact head, with green CI and an audit comment:
  - #51, data limits: a measure the data can't cost is published as not computable;
  - #74, the access check hashes plain-git files;
  - #72, 6.10.0;
  - #73 and #80, the State Pension model limit, browser-held too;
  - #76, results by area gated on data limits;
  - #75, the zsh-safe runbook and macro keys;
  - #78, the runbook after #51;
  - #79, the upgrade order and rollback steps;
  - #81, rolling re-cuts, the 07:00Z go/no-go, the fast revert and the back-computed schedule;
  - #82, README and Makefile on bun and `uv run`;
  - #84, the model gaps the UK hub found.

## Open pull requests
Each is a draft with an independent review in progress or done. The audit comment on each merged PR shows the pattern to follow.

| PR | What | State at hand-over |
|---|---|---|
| #83 | Results by area: approved ids only, packages as the approved composition, UNCERTIFIED on Microcosm, `efrs` refuses Microcosm data | Round 1 fixes in at `bd1293f`; round 2 review running; CI green |
| #85 | Model limit for policyengine-uk #2533: 2027-28 benefit levels need the September 2026 CPI outturn | Review running |
| #86 | `publish review-rows`: public-file review rows for the gated publication (coordinator's option (c)) | Review running. Its builder stopped before reporting, so the review is the verification |
| #87 | Runbook: a change to an uprating input projects the data on 6.10.0 (pe-uk #2405) | AGREE at `9e1fe45`; waiting on CI |

## Builds handed to the UK hub
These two Subfleet builds were still running on the local Subfleet daemon at hand-over. Codex-lane builds return their commits as a git bundle in the build's worktree, because their sandbox can't write the shared repository. Each needs a local session to import the bundle, fix the commit trailer (it names the model actually used), push and open a PR.
- **`w5-templates-hub`** (`20261022-000716-w5-templates-hub`) covers four template fixes:
  - `UC_REBALANCED_YEARS` follows the engine's export;
  - the HVCTS template follows the engine's index, or refuses;
  - generation refuses a measure that leaves a scored year unset on an uprated amount (pe-uk #2430);
  - templates refuse the wealth-tax parameters, which tax gross wealth.
- **`w5-hardening-v2`** (`20261021-192920-w5-hardening-v2`): data-limit hardening (families 1 and 2), the automatic hold for hand-written modifiers while a data limit is active, and release attestations. Its first attempt failed; the second was running.

Their briefs and outputs are in W5's local drafts folder, under `builds/`.

## Decisions and questions with the coordinator
- **Not-computable artifacts (#86).** A not-computable entry's artifact must stay in `public/data` for `publish check`. But it isn't displayed, so `publish review-rows` writes it no row, and the Frontend build then fails on it. Options:
  - a row for it;
  - an exemption in María's check;
  - keep not-computable entries out of the manifest until the day.
- **The page caveat for area results** on Microcosm: Vahid's and María's call. #83 labels the command output and the private audit only.
- **Regeneration time (A in the schedule):** measure it at Friday's rehearsal and report it. The coordinator sets the final build's start from A, B and C.
- **The hub's report figures** for the model-gap list: fill them in when the report exists.
- **S4's wealth-tax measure** is in W6's scorecard registry, not this repository.

## Known follow-ups (not blocking)
- Record who staged an entry in the manifest, so `--staged-by` isn't needed. Wait for the hardening PR, which changes the manifest schema.
- `vercel.json` still builds with the old package manager's build script, and `.env.example` still names `VITE_API_URL`.
- The runbook has one private path, from an earlier PR, in the State Pension annual allowance section.
- #59 (María's Microcosm area runs) will need to rebase onto #83. #83's round 1 review lists the integration points: `--package` through approval, the `microcosm-national` kind with the banner, and one seat default.

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
