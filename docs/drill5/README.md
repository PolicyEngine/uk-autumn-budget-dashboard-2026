# Drill 5 (26 October 2026): everything it produced (MOCK DATA)

Every number, approval, Treasury figure and attestation here is MOCK. The
full write-up, timings and Wednesday gaps are in #144.

| Folder | What it holds |
|---|---|
| `drill5-report-DRAFT-MOCK.pdf` | Draft A4 report of the new pair's results, 11 pages |
| `report/` | What made the report (`build_report.py`, `print.mjs`) and the flat files (`build_flat.py`, from the new pair's approved artifacts) |
| `tabs/` | Screenshots of every tab of this branch's preview |
| `old-pair/` | Screenshots of the old pair's preview (policyengine-uk 2.132.6) |
| `old-pair/pipeline/` | The old pair's run: receipted artifacts, `manifest.json`, release index, constituency table, area provenance, mock attestations, mock Treasury figures, review rows |
| `new-pair/pipeline/` | The same for the new pair (policyengine-uk 2.151.0), whose results this branch shows |

The `pipeline/` folders are snapshots. The runs themselves, with the code
they ran on, are the branches `drill5-wednesday-path` (old pair) and
`drill5-wednesday-path-newpair` (new pair); `publish index` and
`publish check` run there. The drill's household app was deployed from
`drill5-household`.
