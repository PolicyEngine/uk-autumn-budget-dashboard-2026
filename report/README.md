# Budget-day PDF report

`build_report.py` builds an A4 PDF report from a publication: `public/data/manifest.json` and the artifacts it names. It never reads the flat CSVs beside the manifest. It follows the dashboard's rules (`src/utils/publication/select.js`):

- only displayable entries (`approved`, `provisional`) are shown; the others are listed with their reason;
- figures for the measures together come only from a combined run of exactly the displayed measures with their current outputs, never from adding up measures;
- each artifact's files are checked against its `receipt.json` before use;
- when any displayed entry is provisional, the cover band and every footer carry the dashboard's provisional label, and every page a faint "Provisional" watermark behind the content.

Nothing in the report is typed in by hand: measure names and descriptions come from the manifest, versions and dataset from `manifest.execution`, example households from `src/utils/publication/contract.json`. Every printed figure is written to `figures.json` with its file, row and column.

## Build

`--data` must point at a publication: a `public/data` that holds `manifest.json` and `artifacts/` (the Budget-day release branch, or `publish-candidates-pre-budget` for the sample). `main`'s own `public/data` has no manifest yet, so the default fails with a message saying so. Every artifact needs its `receipt.json`, and every table the receipt names must be present and match it; otherwise the build stops.

From the repository root, with Google Chrome installed (or pass `--chrome <executable>`):

```bash
uv run --no-project --with matplotlib==3.10.1 --with playwright==1.52.0 --with pymupdf \
  python -I report/build_report.py build --data public/data --out build/report --pdf
```

This writes `build/report/report.html`, `report.pdf` and `figures.json`. Options: `--year 2028` for 2028-29 (default 2027, the dashboard's default year), `--title` (replaces the whole cover title).

With `--pdf` the report is printed twice: Chrome does not implement `target-counter()`, so the contents' page numbers are read from the first print's outline (pymupdf) and filled in for the second. The build then checks every page but the cover and the last: it fails, naming the pages, if a page's content ends above 40% of its height or a page holds only notes, sources or footnotes. Without pymupdf the contents print without page numbers and the page check is skipped, with a message.

## Check

```bash
uv run --no-project python -I report/build_report.py check build/report/figures.json --data public/data
```

recomputes every figure in `figures.json` from the CSVs and prints any that differ, with the same `FORMATS` the report printed it with. Kinds: a single cell (`value`, `x100`), a sum over rows (`sum`, e.g. the six-year total), a share of one set of rows in another (`share`, Figure 5: `where` names the numerator rows and `of` the denominator), and a row count. It needs no extra packages.

## Tests

```bash
uv run --no-project --with matplotlib==3.10.1 --with pytest \
  python -I -m pytest report/test_build_report.py -q
```

Small synthetic publications: several measures, one, fifteen, no combined run, a stale member, an unsupported or missing year, approved and provisional mixed, a staged measure, a missing manifest, receipt or table, and `check` catching a changed figure. Most build the HTML and `figures.json` only, so they need no Chrome; the page-fill test prints a PDF and is skipped without Chrome, playwright and pymupdf. Others check the decile shape classifier, the example-household spike detector, the text rules (no sentence starts with a measure name, no "changes by −", no forbidden names, "Provisional" only where allowed) and colour parity with `chartTheme.js` and `scale.js`. The repository's own `pytest` run (testpaths `tests/`) does not collect them.

## Layout

An A4 report of 14 to 16 pages (15 with the eight provisional measures of the sample, for 2027-28), single column, 22mm side margins and a 166mm text block. Forced page breaks come only before the key findings, the contents, section 1, Annex A and Annex C; everything else flows, with these keep rules: an exhibit (label, title, subtitle, chart or table, notes, source) is one unbreakable block, so a source line is never stranded; a heading keeps with its first block (and the next, when the first is a paragraph); long annex tables may break with a repeated header.

1. **Cover**: the provisional band (while provisional), the logo, the title (light "Autumn Budget 2026:" from `manifest.budget.id`, then the fixed "effects on households and the public finances"), the Budget date, the report year (its one home), and the model version and dataset. No running header, footer or watermark.
2. **Key findings**: five or six numbered findings from traced figures, in a fixed order (revenue in the report year and the largest single measure; the six-year total from the combined run's own years, and the year the annual effect changes sign, if it does; the average household change and the decile shape; better and worse off; absolute poverty for all people and children; and, only when the last year's average household change differs in sign from the report year's, "later years" with the measure that takes effect), then Figure 1, % of net income by decile. No all-household bar: no all-household % of net income is published.
3. **Contents** and **Box 1, how to read this report**: the one home of "each measure on its own" versus "the measures together", static costing, the colour meanings, deciles, withheld, and the dashboard link.
4. **Sections**, paragraphs numbered per section (2.1, …): 1 the measures (Table 1 at a glance: the first sentence of each description after any status sentence, the years modelled, the report-year revenue effect; left-out entries with their reason); 2 public finances (Figure 2, each measure's own run stacked by year with the combined run as a black dot); 3 households by income (Figure 3 by year, Figure 4 £ by decile stacked by measure with the combined dot and an "All" group, Figure 5 the spread of changes within £5,000 income bands from `household_scatter_binned.csv`, six fixed change categories, bands above the 95th percentile of households merged); 4 gainers and losers, by age (Figure 6 better off / unchanged / worse off by age and for each measure, Figure 7 £ by age); 5 poverty and inequality (Figure 8 absolute BHC poverty by year, Table 2 the four poverty measures and inequality); 6 by constituency, only once the manifest names `constituency.csv` (Figure 9, one map per measure with any non-zero seat; there is no ranked companion chart while only constituency data are published, and a regional bar chart is to be added when `regional.csv` is); 7 example households (Table 3 at three incomes; Figure 10 the curves against earnings, each panel on its own scale, left out while any curve has an isolated point, which Annex A then names in one traced sentence). Without constituency data section 6 is absent, later sections renumber, and Annex A says once that area results are not yet published.
5. **Annexes**: A methodology and caveats (Box 2, what the figures leave out; model and data, ranking, runs; a provenance list: each artifact's short digest, status and years, the manifest revision, and the build commit; full digests stay in `figures.json`); B the measures as modelled (Table B1, full descriptions without the status sentence, and status); C data tables (C1 revenue by measure and year with the combined run and its six-year total, C2 £ by decile, C3 each measure's poverty and Gini, rows of no change collapsed into one line, C4 % by decile); D sources (Table D1, generated from `figures.json`) and the glossary, the single home of definitions.

**Text.** Titles state a direction, rank or shape in neutral words and no number that is a key finding; decile wording comes from a shape classifier over all ten values (rising, falling, peaked at decile k, troughed at decile k, or mixed), never from comparing the two ends. Signed changes in prose are "rises by"/"falls by"; no sentence starts with a measure name ("the {name} measure"); each fact is stated once. Formats are defined once in `FORMATS`: £bn to 1 decimal, £ to the pound, % and shares of people to 1 decimal, percentage points to 2. The Gini coefficient and the 90/10 ratio are published as relative changes (`metrics.gini_change`, `p90_p10_change`), so they print as % changes to 2 decimals. A withheld cell (too few survey households) is never plotted, ranked or printed as 0: it reads "withheld" with a note, and a gainers-and-losers row with any share withheld is withheld whole. "Provisional" appears only in the cover band, the footer, the watermark, and the status columns of Annex B and the provenance list.

**Charts** are drawn with one matplotlib style (`PE_STYLE`) at the 166mm text width (6.54in) with constrained layout, uncropped, on opaque white so the watermark never shows through: Inter 8pt, horizontal gridlines only, a zero line, unit-bearing tick labels, legends in a row above the plot. Colours are the dashboard's: `CHART_COLOURS` and the measure ramps (`measureRamp`, OKLab above eight measures) are ported from `src/utils/chartTheme.js`, and each measure takes its colour by the dashboard catalogue's rule (`measureCatalogue.jsx`: direction from the sum over the published years, the largest total absolute effect darkest), so a measure has the same colour here as on the dashboard. Maps use `scale.js`'s `scaleColour`, ported exactly: amber `#D97706` through `#E5E7EB` to teal `#14B8A6`, RGB, 100 steps, fixed at −1% to +1% and clamped; withheld seats hatched, approximate seats dotted, seats with no row white with a grey outline. Tests parse the JS to keep the two equal.

**Running header and footer** are `@page` margin boxes (Chrome 131 or later): the logo (embedded from `public/assets/logos/policyengine-teal.png`) and "Autumn Budget 2026 · {year}" over a light rule; the provisional label and "Page n of N". Inter (SIL Open Font License, `fonts/OFL.txt`; weights 300, 400, 600, 700) is embedded so the build needs no network.
