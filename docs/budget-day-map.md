# Budget day at a glance (28 October 2026)

**Shareable page: [Budget day at a glance](https://claude.ai/artifact/WxoUKQFN5D6TAFVhmfm3iU).** It draws the day on a timeline and the data line as a flow, with how long each step takes and where each time comes from. This file is its text version.

A one-page map of the day for people: what happens, in what order, and who acts. The steps' detail is in the [checklist](budget-day-checklist.md) and the [runbook](budget-day-runbook.md), the agents' commands are in [`budget-day-agents.md`](budget-day-agents.md), and every signature is in [`budget-day-people.md`](budget-day-people.md). Times are UTC, which is UK time this week.

## The four PRs

The day's dashboard work goes in four PRs, in this order ([Vahid, 27 October](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6451621671)). Each holds one kind of change, so the code, the Treasury's figures, the national results and the map are each reviewed, signed and merged without holding up the others. Small hotfix PRs are opened only if something breaks.
1. **Measures: the code.** The announced measures in `reforms.py` (parametric where possible), their expected-effect rows, and the policy names and summaries.
   - It merges at about 14:30, once the documents have landed and CI is green, so the code matches what the documents say.
   - Its merged commit is the one every published figure is generated from.
   - The Integrator reviews it; the second signer attests any hand-written modifier.
2. **Treasury figures (G3): what the results are checked against.** The Treasury's costings in `data_inputs/treasury/`. The reconciliation compares each measure with them, and they fill the "Official costings" card.
   - It merges any time after 13:40. With #174 merged, it doesn't touch the code the receipts bind.
   - The Integrator signs it off.
3. **Publication: the national results.** The single measures, the package, the flat files and the example households, generated on Modal from #1's merged commit, with their review rows and attestations.
   - It merges at about 16:00, after `publish approve`, so only approved figures go out.
   - It is the day's first publication: there is no separate provisional one.
   - The Integrator signs the review rows and the second signer the attestations.
4. **Map: the results by constituency.** The area run takes about an hour, so the map follows the national results instead of holding them up.
   - It carries its own disclosure sign-off, from the Integrator and the licence holder.
   - It merges at about 17:30.

Between the start of #3's generation and its merge, nothing that touches a calculation path merges, because receipts bind the commit they were made at.

## The day

Vahid's decisions of 27 October also shape the day: preview runs don't wait for CI, each measure runs in a Modal call of its own, and the disclosure floor settles the package before it runs ([decisions](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6448563927), [to repeat on Budget day](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6449275288), [run order and timings](https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/251#issuecomment-6449473328)).

1. **Tuesday evening.**
   - At 17:30 calculation code freezes (#222).
   - At 18:00 the Coordinator regenerates the pre-Budget candidates on Modal. The 18:01 run on the seven was superseded, and the regeneration restarted from `9cfbdb4e` on #261's eight at about 19:20. #222 records what was staged and what the floor held.
   - Two people then attest each hand-written receipt that was staged, and the package that holds one.
   - Tonight the Integrator redeploys the production household calculator (Cloud Run and Modal) from `main` at `9cfbdb4e`, and #264's warm schedule starts at 07:00 on 28 October (Vahid). Cloud Run's deploy takes 6–7 min (#231).
2. **Wednesday morning.**
   - The final cut is confirmed by 06:00, and the Coordinator holds the go/no-go at 07:00. After it, only an emergency revert changes the release.
   - By 11:30 the start receipt records the code, data, versions and limits (G0): about 15 min.
   - **A newer build may be on offer.** A new data build will probably be published, with an open policyengine.py PR.
     - The Coordinator runs the UK hub on it and compares it with the current versions: policyengine 6.11.1, with policyengine-uk 2.151.0 and the a6299504 and c9df4b86 cuts.
     - The Coordinator then decides whether to bump. The decision weighs the data's quality and the new policyengine-uk's runtime against what the build brings: it carries gambling and some other fixes the current one doesn't.
     - #262 has the bump's checklist.
   - #174, #260, and #207 or its rerun are on `main` (Vahid's list).
   - The team test link is ready, with someone named to send it (#247; the script is in #260).
3. **The speech, 12:30, and the measures PR (#1).** Agents list every measure and sort it: parameter change, template, hand-written code, ledger only, or not computable (G1, 15 min).
   - A measure is coded only if the data carries every input its formula reads and current law doesn't already have it. Parameter changes come first: they need no attestation.
   - Agents encode the coded ones in #1, with their expected-effect rows and their names and summaries: 5–10 min each, 30–60 min if hand-written (#247, not yet measured).
   - The expected-effects reviewer signs each new measure's direction before it is staged.
   - Preview runs start from #1's pushed commit while CI runs, one Modal call per measure (7–14 min each on 6.11.1). The measure that decides the package runs first, and its floor check settles the package's members. Nothing from a preview is published; the team test link shows them, and never an artifact the floor flagged.
4. **Documents and the Treasury figures (#2), from about 13:40** (G3).
   - Agents fetch the Red Book, the Treasury's policy costings and the OBR's outlook, recording each file's time and hash: 2–5 min (#246).
   - Agents enter the Treasury costings (about 20 min, not yet timed), and the Integrator checks them. With #174 on `main`, #2 merges any time after 13:40.
   - The Integrator loads the OBR forecast. The import takes seconds; its PR merges before #1, or after #3 once the map run has started.
   - Once those inputs are in, agents also write the official costings comparison and the OBR's effect on CPI.
5. **Publication (#3), from about 14:30.**
   - #1 merges once the documents have landed and CI is green. The household calculator is redeployed from its merged commit: the test app, then production (6–7 min).
   - One Modal call per measure from #1's merged commit: 7–14 min each, so the wait is about the slowest. From here until #3 merges, nothing on a calculation path merges.
   - Two people attest each hand-written measure once its receipt is written: 30–60 min (#247, not yet measured). The package waits for them, then runs: 10–12 min on 6.11.1.
   - Agents reconcile each measure against the static costing, and the Integrator approves it. Nothing can be approved before the Treasury figures.
   - The package's two files follow after the last manifest change: 5–10 min each with one container per measure (Vahid, 27 Oct). #267 now splits them by year as well, which hasn't been timed yet. The eight example households take about 11 min.
   - Review rows, checks and CI, then #3 merges at about 16:00. The first cut goes to media at 15:45, from #3's approved manifest revision.
6. **The map (#4), from #3's approvals.**
   - The area run takes about an hour (Vahid's plan; #250 measured 49:46 with Plan 2 and the Warm Home Discount top-up, and a rehearsal on 27 October took about 14 min).
   - Agents bind the map; the Integrator and the licence holder sign off; #4 merges at about 17:30.
7. **Afternoon and night.**
   - The first cut goes to media at 15:45: approved figures from one manifest revision only, after a comparables review.
   - From 16:30 the webinar presents the dashboard's results: approved national figures only, from the first cut. The map follows at about 17:30.
   - Overnight, the PDF report (#227, a draft) and the briefing are built from approved entries, by 07:00 on Thursday.
8. **Any time: a correction.** Withdraw the measure, fix it, redeploy the API, regenerate, attest again, and republish (G5): about 1.5 to 3 hours. If the page itself breaks, roll back.

With the documents at about 13:40, approved national figures are live at about 16:00 (#3) and the map at about 17:30 (#4), in Vahid's four-PR plan. A measure that appears only in the documents goes into #1 if it is ready before #1 merges; after that, it waits for #3 to merge.

## How data reaches the dashboard

Each step feeds the next: Microcosm builds the data, policyengine.py certifies and releases it with the model, and the dashboard adopts the release. Build times come from the calibration dashboard's Build progress page for the UK. The K-exact selection and the release gates are not on that page, so their times come from past runs and the certifier's runs.

### 1. Microcosm builds the data: about 5.5–8.5 h when the gates pass first time

The UK hub builds it on its build host.

- **FRS spine:** about 30 min (14–49 min across the last nine finished runs).
- **From the same spine, at the same time:**
  - the national calibration: about 25–60 min (the a6299504 cut in use took 1 h 3 min, 25 Oct);
  - the local-area dense build: about 2.5 h (c9df4b86, behind the cut in use, took 2 h 22 min on 26 Oct; runs the gates stopped took 1.5–13 h).
- **K-exact selection:** draws 150,000 households from the dense pool. A size-search probe takes about 1.5 h and it often takes three, so about 1.5–4.5 h, then the draw and refit.
- **Release gates:** about 1 h (the certifier's release-cut gates took 52 min on 12 Oct and 71 min in September, microcosm#823).
  - Only if they fail: re-sign, then one last probe, about 1.5 h more.
- **Upload:** both files go to the private Hugging Face repository `policyengine/populace-uk-private`, each under its own tag (minutes).

### 2. policyengine.py certifies and releases them: about 7.5–11 h

The UK hub, the Coordinator and an independent reviewer.

- **Evidence run on the certification PR:** about 5.5–9 h. A policyengine.py pull request pins the cut to the policyengine-uk version it was built with, and the UK hub runs the certification gates on its host: about 5.5 h for a133, and 8 h 37 min for 6.11.1 under host load (policyengine.py#720).
- **Coordinator decision and independent review:** about 30 min (22:48–23:19Z on 26 Oct, policyengine.py#720). The Coordinator accepts the gates that need review, and an independent review of the evidence approves it.
- **Merge and release to PyPI:** about 1.5 h, with the model and data bound by one certificate. 6.11.1 merged at 00:06Z and the dashboard's bot picked it up at 01:32Z; with busy runners it took about 3 h (6.10.0).

### 3. The dashboard adopts the release: about 1.5–2 h

The bot, then the Integrator.

- **Adoption PR:** 10–80 min after the release, the bot opens a draft "Adopt policyengine X" pull request, as for #237.
- **Regenerate on the branch:** about 20–30 min on Modal (20:09 for the full set on 6.10.2, #225).
  - The limits the new pair lifts or adds are updated.
  - The published files (the outlook, the examples, the policy table) and every published measure are regenerated.
  - Review rows are signed, and approvals are made before the merge.
- **CI, review and merge:** about 30 min (CI about 9 min a run, #219). The Integrator merges with a merge commit, and its revert PR is opened as a draft at once.
- **Redeploy the household API and check it:** about 25 min, on Cloud Run and Modal, with one breakdown timed under 200 s (runbook, "Adopting a release").

**End to end:** about 15–22 hours when every gate passes first time, and about 1.5 h more if the release gates fail. In practice policyengine 6.11.1 took about two days: the national cut was built on 25 Oct from 09:14Z, the local-area cut on 26 Oct, the certification merged on 27 Oct at 00:06Z, and it was on the dashboard on 27 Oct at 13:11Z.

**Budget day itself:** no adoption after the 07:00 go/no-go. Only an emergency revert to the previous release (runbook, "Rolling re-cuts").
