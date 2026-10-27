# Constituency map on 6.11.1: a measured run (27 October)

The constituency run on Modal (`uk-budget-data constituencies --backend modal`), timed on the release the dashboard adopts tonight. Nothing was published: the receipts, the manifest and the table stayed in a private directory outside the repository. This note gives times, memory and costs only, no figure from the data.

## What ran

- **Code:** `main` at `d8d0d6be` with #237's lock applied on top (policyengine 6.11.1, policyengine-uk 2.151.0, core 3.33.3). That commit carries #138's runner, #181's Modal route, #226's timings and #234's default.
  - #238 and #242 change only the limits, wording and tests on this path, so the times stand for `main` once #237 merges.
- **Data:** the local-area cut the 6.11.1 bundle routes constituencies to, `microcosm-uk-2024-25-dense-20261026T105309Z-c9df4b86`.
- **Measures:** seven, for 2026 to 2031:
  - `badr_lifetime_limit_cut`;
  - `domestic_electricity_zero_vat`;
  - `employer_ni_relief_under_25s`;
  - `plan_2_threshold_unfreeze`;
  - `state_pension_income_tax_protection`;
  - `threshold_freeze_2031_32`;
  - `warm_home_discount_top_up`.
- **Options:** `--fresh`, and a `--run-id` of its own.
- **Receipts:** the area run checks each measure against its approved receipt. So the seven receipts were generated on Modal first (`generate --artifacts --backend modal`) into a scratch data root, and a scratch manifest marked every entry "TIMING ONLY, not an approval". The command refuses to write a scratch manifest's tables into a repository.

## Phases

- **Image: about 8 seconds.** The image for 6.11.1's lock was already built, so only two small layers were added. The constituency smoke test passed in 59 s.
- **Planning on the laptop:**
  - Resolving and downloading the cut took 35 s for 0.76 GB, the first time on a machine. The Modal route still fetches and hashes the cut on the laptop before the fan-out.
  - With the cut cached, the dry run took 5.7 s, receipt checks included.
  - The laptop peaked at 0.36 GB over the whole run.
- **Units, one container each, all seven at once** (4 CPU, 64 GiB; no preemption):
  - `badr_lifetime_limit_cut` 7:40, `threshold_freeze_2031_32` 7:56, `state_pension_income_tax_protection` 11:30, `employer_ni_relief_under_25s` 12:44, `domestic_electricity_zero_vat` 13:16, `plan_2_threshold_unfreeze` 29:02, `warm_home_discount_top_up` 38:44.
  - Building the two simulations took 3:05 to 5:52 (9:26 for WHD).
  - The six years took 4:22 to 9:42, then 23:01 for Plan 2 and 29:08 for WHD, at 3 to 6 minutes a year.
  - Peak memory was 42 to 54 GiB a container, against 33 to 42 GB on the old pair, so keep 64 GiB.
  - No measure touched a data or model limit, the electricity VAT measure included.
- **Release, one container: 10:27.** Estimating took 8:39, about 1:15 a measure, and resolving 20 s. Nothing was demoted, and `validate_public` found 0 problems.
- **Back on the laptop:** about 7 s.
- **End to end: 49:46.**
- **Modal cost:** $1.65 for the area run, $0.46 to generate the seven receipts and $0.01 for the smoke test.

## Against earlier runs

- **26 October, the old pair** (policyengine-uk 2.132.6, cut `…-ee5c2dbe`), the six measures other than electricity VAT: 13:50. Units took 3:35 to 6:47, the release 6:40.
- **Drill 5, the new pair**, with its own fifteen measures: 45:02, including a 12-minute image build and two waves of containers. Units took 5:26 to 16:32, the release 22:17.
- **Most measures roughly doubled on the new pair**, as #144 expected. WHD and Plan 2 took at least 5.7 and 4.3 times as long as on 26 October, and why is open.
  - On this cut WHD's yearly calculation takes about three times employer NI's; on the national file, in generation, the two took about the same.
  - Generation on 6.11.1 shows the same order: 5:35 to 10:00 a container for the other five measures, 9:43 for WHD and 16:28 for Plan 2.

## For Budget day

- **Units:** they run in one wave up to 16 measures, so their time is the slowest unit's.
- **Release:** it is serial, about 1:15 a measure plus about 2 minutes. That makes about 14 minutes for ten measures and 20 for fifteen.
- **Budget for the area run, with the image prebuilt:**
  - about 55 to 60 minutes if `warm_home_discount_top_up` is among the approved measures;
  - 45 to 50 with `plan_2_threshold_unfreeze` but not WHD;
  - 30 to 35 with neither.

  The checklist and runbook still say 14–21 minutes, the old pair's figure.
- **Then about 20 to 25 minutes to the live map:**
  - review the table;
  - `publish index` and `publish check` (seconds; `publish check` took 4.7 s over seven entries here);
  - the review rows;
  - CI, about 9 minutes on today's `main`;
  - the deploy, about 1.5 minutes after the merge.
- **To show most of the map sooner:**
  - Run the measures other than WHD and Plan 2 first, with their own `--run-id` and an `--out-dir` outside the checkout, and publish that table.
  - Start a second run with every measure at the same time, from the same clean commit, with another run id and out-dir. Publish it when it lands.
  - This costs the fast measures twice, about $0.10 to $0.15 each.
  - Commit the first table before copying the second in (item 1 below).
- **Generation (G2) times are also old-pair figures in the checklist:** "about 8–9 min" for the shared call and "about 7 min" for each hand-written measure. On 6.11.1 a container took up to 16:28 (Plan 2). One container was preempted and restarted.

## What the run showed about the path to the page

1. **A second area run refuses every code-bound measure while the first run's files are uncommitted.**
   - The receipt check counts anything uncommitted as uncommitted code, except `manifest.json` and `artifacts/`.
   - So `constituency.csv`, `area_provenance.json` or `release-index.json` left in `public/data`, or an edited `public_data_review.csv`, stop the run with "`<measure>`: current reform code is not committed". Five of these seven measures are code-bound.
   - Tested: an untracked, header-only `constituency.csv` stopped a dry run at once.
   - Commit or move the first run's files before any rerun.
2. **The provenance's shape is checked only at the end.**
   - Here the last step failed with "area provenance: invalid manifest revision", after 50 minutes on Modal. The scratch manifest was at revision 0; a real one is at 1 or more once anything is staged or approved.
   - The plan builds the provenance before simulating but doesn't validate it.
   - On a copy at revision 1, the same provenance bound in `publish index`. That command refused only what a timing manifest lacks (reconciliation and attestations).
3. **A late failure leaves `constituency.csv` in `--out-dir` without its provenance.** In `public/data` that also triggers item 1.
4. **The private summary stays on the Volume.** The runbook's first step after the run (review `summary.json`) needs this on Modal, into the private directory and never into the checkout:

   ```sh
   uvx --from modal==1.6.2 modal volume get uk-budget-2026-constituencies-private geography/<run id>/microcosm-<stamp>/summary.json "$UK_BUDGET_DISCLOSURE_AUDIT_DIR/"
   ```

5. **Nothing removes the run's household-level arrays from the Volume.** Once the table is merged, remove the run's `units/` and `datasets/`:

   ```sh
   uvx --from modal==1.6.2 modal volume rm -r uk-budget-2026-constituencies-private geography/<run id>/units
   ```

   ```sh
   uvx --from modal==1.6.2 modal volume rm -r uk-budget-2026-constituencies-private geography/<run id>/datasets
   ```

6. **An open page doesn't show the first map until it is reloaded.**
   - The build fixes which area files the page requests (`NEXT_PUBLIC_PUBLISHED_GEOGRAPHY`), and an open page swaps the manifest in place.
   - So a page opened before the first map deploy keeps "Results by constituency are not yet published.", with no hint to reload.
   - A page-only fix, outside `src/uk_budget_data/`: fetch a file the manifest binds even when the build didn't ship it, or show the hook's existing "reload" notice.
7. **Every later `stage`, `approve` or `withdraw` unbinds the map until `publish index` runs again.**
   - `publish check` and the Public data check fail until it does.
   - A rerun keeps the old tables while the entries they cover are unchanged.
8. **Two runs on one cut share `geography/constituencies-<cut>/` unless `--run-id` says otherwise**, and the release reads the units' files by name. Pass `--run-id constituencies-c9df4b86-<HHMM>`, one per run.
9. **Noise:** after the last unit, Modal's client prints a traceback ending "RuntimeError: aclose(): asynchronous generator is already running". The run carries on to the release.
10. **Wording still written for the local route:**
    - "each measure simulated in a process of its own";
    - refusal and Ctrl-C messages that promise reuse, though Modal reuses nothing;
    - the audit path printed as `../__modal/volumes/vo-…`;
    - `ModalUnavailable` ending in a traceback.

## Suggested runbook and checklist edits (not made here)

- **Checklist, area run:** replace "14–21 min" with about an hour with WHD, 45–50 minutes with Plan 2, and 30–35 with neither.
- **Runbook, "Results by constituency on Modal":**
  - add this run to the measured runs;
  - replace "Peaks are under 43 GB, so 48 GiB containers would do": peaks reach 54 GiB on the new pair;
  - add the summary fetch, the retention step, the per-run id and the rerun rule (items 1, 4, 5 and 8).
- **Checklist, G2:** update the generation times for the new pair.

## Results

Not in this PR. To show on the page, the table needs the seven measures' national artifacts beside it, as provisional or approved entries. Those need tonight's regeneration on the final `main` and the Treasury figures. The table and its provenance would then come from an area run on those entries.
