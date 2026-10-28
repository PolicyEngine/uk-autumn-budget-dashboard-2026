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

## Layout

A cover (title, Budget date, provisional label, logo, contents, each package version on its own line); a one-page summary (a key findings box of four to seven numbered findings generated from traced figures, each fact once; when the last year's average household change differs in sign from the report year's, a "Later years" finding names it and the measure that takes effect); 1 an introduction (what PolicyEngine is, what the report compares, how to read the figures, the dashboard link, and Table 1, the measures as modelled in the order used throughout, with any modelled but left out); short numbered sections that flow from page to page: 2 public finances, 3 households by income decile (opening with the combined average change for every year), 4 gainers and losers, 5 poverty and inequality, 6 by age, regions and constituencies (only once the manifest names `constituency.csv` or `regional.csv`; until then the method annex says they are not yet published), example households; then, from a new page, Annex A methodology and caveats with each artifact's digests, Annex B glossary. Each fact has one home: static costing and "combined, not a sum" in the introduction and glossary; the year on the cover and in subtitles (the running header names the Budget date).

Charts are drawn at the column width (6.85in) with constrained layout and are not cropped, so their text prints at its set size. A withheld cell (too few survey households) is never plotted, ranked or described as £0: it prints "withheld" with a note, and a gainers-and-losers row with any share withheld is withheld whole.

Results figures and tables are followed, where the data support one, by a paragraph that says how to read them (direction, rank, which measure drives a pattern); it prints no new untraced number. Every chart is a numbered figure: "Figure n:" and a title saying what it shows, generated from the data in neutral words (direction and rank, no evaluative words), a subtitle with units, area and year, then "Notes:" and "Source:" lines (the model version and dataset from `manifest.execution`, which run: combined or each measure's own, and the publication revision). Tables are numbered the same way, with light rules and right-aligned tabular figures. Footnotes are numbered through the report and printed at the end of their section. The running header (title, report year) and footer (provisional label, "Page n of N") are `@page` margin boxes, so the PDF needs Chrome 131 or later; the cover has none.

Inter (SIL Open Font License, `fonts/OFL.txt`) is embedded so the build needs no network.
