# Budget-day PDF report

`build_report.py` builds an A4 PDF report from a publication: `public/data/manifest.json` and the artifacts it names. It never reads the flat CSVs beside the manifest. It follows the dashboard's rules (`src/utils/publication/select.js`):

- only displayable entries (`approved`, `provisional`) are shown; the others are listed with their reason;
- figures for the measures together come only from a combined run of exactly the displayed measures with their current outputs, never from adding up measures;
- each artifact's files are checked against its `receipt.json` before use;
- when any displayed entry is provisional, every page carries a "Provisional" watermark and the dashboard's provisional label.

Nothing in the report is typed in by hand: measure names and descriptions come from the manifest, versions and dataset from `manifest.execution`, example households from `src/utils/publication/contract.json`. Every printed figure is written to `figures.json` with its file, row and column.

## Build

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

## Sections

Summary; public finances; households by income decile; better and worse off; poverty and inequality; by age; regions and constituencies (once the manifest names `constituency.csv` or `regional.csv`, otherwise a "not yet published" notice); example households; the measures; method, data and caveats with each artifact's digests.

Inter (SIL Open Font License, `fonts/OFL.txt`) is embedded so the build needs no network.
