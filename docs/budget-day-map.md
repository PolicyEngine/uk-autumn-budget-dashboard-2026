# Budget day at a glance (28 October 2026)

**Shareable page: [Budget day at a glance](https://claude.ai/artifact/WxoUKQFN5D6TAFVhmfm3iU).** It draws the day on a timeline and the data line as a flow, with how long each step takes and where each time comes from. This file is its text version.

A one-page map of the day for people: what happens, in what order, and who acts. The steps' detail is in the [checklist](budget-day-checklist.md) and the [runbook](budget-day-runbook.md), the agents' commands are in [`budget-day-agents.md`](budget-day-agents.md), and every signature is in [`budget-day-people.md`](budget-day-people.md). Times are UTC, which is UK time this week.

## The day

1. **Tuesday evening.**
   - At 17:30 calculation code freezes (#222).
   - At 18:00 the Coordinator regenerates the seven candidates and their package on Modal: about 20–30 min (#225 measured 20:09).
   - The second signer then attests the three hand-written receipts: Plan 2, the pensioner allowance and the package.
   - The household calculator is redeployed from the same commit before 08:00: 6–7 min (#231).
2. **Wednesday morning.**
   - The final cut is confirmed by 06:00, and the Coordinator holds the go/no-go at 07:00. After it, only an emergency revert changes the release.
   - By 11:30 the start receipt records the code, data, versions and limits (G0): about 15 min.
3. **The speech, 12:30.** Agents list every measure and sort it: parameter change, template, hand-written code, ledger only, or not computable (G1, 15 min).
   - They encode the coded ones in one measures PR: 5–10 min each, 30–60 min if hand-written (#247, not yet measured).
   - The expected-effects reviewer signs each new measure's direction before it merges.
   - The Integrator merges the PR (about 10 min, CI 9 min), then redeploys the household API so the calculator knows the new measures (6–7 min).
4. **Provisional figures, 13:15** (G2).
   - Each measure runs in its own Modal container: 6 to 16 min on 6.11.1 (#250).
   - Agents reconcile and stage the measures as provisional: about 13 min, CI 9 min.
   - The Integrator signs the review rows and merges, and the page shows "statement figures, awaiting Treasury costing".
5. **Documents, from about 13:40** (G3).
   - Agents fetch the Red Book, the Treasury's policy costings and the OBR's outlook, recording each file's time and hash: 2–5 min (#246).
   - Agents enter the Treasury costings (about 20 min, not yet timed), and the Integrator checks them.
   - Agents reconcile each measure against the static costing, and the Integrator approves it, between 13:40 and 14:10.
   - Two people attest each hand-written measure before it is approved: 30–60 min (#247, not yet measured).
   - The Integrator loads the OBR forecast. The import takes seconds; its PR waits until the map runs have started.
   - Once those inputs are in, agents also write the official costings comparison and the OBR's effect on CPI.
6. **Package and map, from 14:50** (G4).
   - The combined run (about 7 min) and the area run (about 55–60 min with the Warm Home Discount top-up and Plan 2) start together on Modal.
   - Then agents bind the map, and the Integrator signs the review rows and merges. The map is live about 20–25 min after the area run ends (#250).
7. **Afternoon and night.**
   - The first cut goes to media at 15:45: approved figures from one manifest revision only, after a comparables review.
   - From 16:30 the webinar presents the dashboard's results: approved figures only, from the first cut.
   - Overnight, the PDF report (#227, a draft) and the briefing are built from approved entries, by 07:00 on Thursday.
8. **Any time: a correction.** Withdraw the measure, fix it, redeploy the API, regenerate, attest again, and republish (G5): about 1.5 to 3 hours. If the page itself breaks, roll back.

With the documents at about 13:40, approved national figures are live in about 45–60 min and the map in about 80–95 min (Vahid, #247), later if the Warm Home Discount top-up and Plan 2 are both approved (#250). A measure that appears only in the documents adds a regeneration and an attestation.

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
