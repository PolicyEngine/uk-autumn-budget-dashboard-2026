# Budget-day PDF report

`build_report.py` builds an A4 PDF report from a publication: `public/data/manifest.json` and the artifacts it names. It never reads the flat CSVs beside the manifest. It follows the dashboard's rules (`src/utils/publication/select.js`):

- only displayable entries (`approved`, `provisional`) are shown; the others are listed with their reason;
- figures for the measures together come only from a combined run of exactly the displayed measures with their current outputs, never from adding up measures;
- each artifact's files are checked against its `receipt.json` before use;
- when any displayed entry is provisional, every page carries a "Provisional" watermark and the dashboard's provisional label.

Nothing in the report is typed in by hand: measure names and descriptions come from the manifest, versions and dataset from `manifest.execution`, example households from `src/utils/publication/contract.json`. Every printed figure is written to `figures.json` with its file, row and column.

## Build

`--data` must point at a publication: a `public/data` that holds `manifest.json` and `artifacts/` (the Budget-day release branch, or `publish-candidates-pre-budget` for the sample). `main`'s own `public/data` has no manifest yet, so the default fails with a message saying so. Every artifact needs its `receipt.json`, and every table the receipt names must be present and match it; otherwise the build stops.

From the repository root, with Google Chrome installed (or pass `--chrome <executable>`):

```bash
uv run --no-project --with matplotlib==3.10.1 --with playwright==1.52.0 \
  python -I report/build_report.py build --data public/data --out build/report --pdf
```

This writes `build/report/report.html`, `report.pdf` and `figures.json`. Options: `--year 2028` for 2028-29 (default 2027, the dashboard's default year), `--title`.

## Check

```bash
uv run --no-project python -I report/build_report.py check build/report/figures.json --data public/data
```

recomputes every figure in `figures.json` from the CSVs and prints any that differ. It needs no extra packages.

## Tests

```bash
uv run --no-project --with matplotlib==3.10.1 --with pytest \
  python -I -m pytest report/test_build_report.py -q
```

Small synthetic publications: several measures, one, fifteen, no combined run, a stale member, an unsupported or missing year, approved and provisional mixed, a staged measure, a missing manifest, receipt or table, and `check` catching a changed figure. They build the HTML and `figures.json` only, so they need no Chrome. The repository's own `pytest` run (testpaths `tests/`) does not collect them.

## Sections

Summary; public finances; households by income decile; better and worse off; poverty and inequality; by age; regions and constituencies (once the manifest names `constituency.csv` or `regional.csv`, otherwise a "not yet published" notice); example households; the measures; method, data and caveats with each artifact's digests.

Inter (SIL Open Font License, `fonts/OFL.txt`) is embedded so the build needs no network.
