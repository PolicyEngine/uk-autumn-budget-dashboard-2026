# Sample: the Budget-day report on tonight's provisional candidates

**SAMPLE, not a publication.** `SAMPLE-provisional-candidates-2026-10-27.pdf` is the report generator (`report/build_report.py`) run on the six candidate measures staged provisional on branch `publish-candidates-pre-budget` at `d14c8633` (publication manifest revision 5, 27 October 2026, 11:55 UTC), with their six-measure combined run `combined--a3e0b4a238c38c09`. Business Asset Disposal Relief and the seven-measure package that held it are withdrawn in that manifest and are listed, not shown. Every entry is provisional, so every page carries the watermark and the label "Provisional: candidate measures modelled before the Budget, not announced policy". None of these measures has been announced.

`SAMPLE-provisional-candidates-2026-10-27.figures.json` lists every figure in the PDF with the artifact file, row and column it came from. To check it, from this branch, with `<candidates>` a checkout of `publish-candidates-pre-budget` at `d14c8633`:

```bash
uv run --no-project python -I report/build_report.py check docs/budget-day-report/SAMPLE-provisional-candidates-2026-10-27.figures.json --data <candidates>/public/data
```

The sample is replaced, not kept, once the Budget-day publication exists. How to build: `report/README.md`.
