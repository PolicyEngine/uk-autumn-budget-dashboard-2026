# Colours

One colour template for the dashboard. Every colour has a role, and each role has one colour on every tab.

- **CSS** takes the `--c-*`, `--ramp-*` and `--income-ramp-*` tokens in [`src/app/globals.css`](../src/app/globals.css) (over `@policyengine/ui-kit/theme.css`).
- **JS and charts** take the mirror in [`src/utils/chartTheme.js`](../src/utils/chartTheme.js) (`CHART_COLOURS`, `POLICY_RAMPS`, `INCOME_RAMP`), because SVG and PNG exports need literal values. `chartTheme.test.js` keeps the two equal.
- **Measures** take their colour from the measure catalogue ([`src/utils/measureCatalogue.jsx`](../src/utils/measureCatalogue.jsx), #104): within each budgetary direction, the published measures ranked by size (total absolute £bn over the published years, ties by id) take evenly spaced OKLab steps along that direction's ramp, largest darkest (`measureRamp` in `chartTheme.js`: ambers for raising revenue, teals for costing it, grey for no published costing). With more than eight measures in a direction, every second step turns slightly in hue (cost: blue-teal; revenue: brown) so neighbours stay apart. The catalogue is built once from the publication's manifest snapshot, so a measure keeps one colour on every tab and selection of a publication; a measure added in a later revision can re-shade the others in its direction.

## Roles

| Role | CSS token | JS name | Hex |
| --- | --- | --- | --- |
| Gain (better off, a rise in income) | `--c-gain` | `CHART_COLOURS.gain` | ![](swatches/319795.svg) `#319795` |
| Gain as text / a small gain | `--c-gain-text` / `--c-gain-light` | `.gainText` / `.gainLight` | ![](swatches/0F766E.svg) `#0F766E` / ![](swatches/81E6D9.svg) `#81E6D9` |
| Loss (worse off, a fall in income) | `--c-loss` | `CHART_COLOURS.loss` | ![](swatches/D97706.svg) `#D97706` |
| Loss as text / a small loss | `--c-loss-text` / `--c-loss-light` | `.lossText` / `.lossLight` | ![](swatches/B45309.svg) `#B45309` / ![](swatches/FBBF24.svg) `#FBBF24` |
| Loss chip background / banner border | `--c-loss-soft` / `--c-loss-border` | `.lossSoft` / `.lossBorder` | ![](swatches/FDF0E1.svg) `#FDF0E1` / ![](swatches/FDE68A.svg) `#FDE68A` |
| No change | `--c-no-change` | `CHART_COLOURS.noChange` | ![](swatches/9CA3AF.svg) `#9CA3AF` |
| Before the Budget / baseline (dashed, `BEFORE_DASH`) | `--c-before` | `CHART_COLOURS.before` | ![](swatches/9CA3AF.svg) `#9CA3AF` |
| After the Budget (solid) | `--c-after` | `CHART_COLOURS.after` | ![](swatches/319795.svg) `#319795` |
| Net line and its dots | `--c-net` | `CHART_COLOURS.net` | ![](swatches/000000.svg) `#000000` |
| Official figure / outturn | `--c-before` | `OUTTURN_COLOUR` (= `.before`) | ![](swatches/9CA3AF.svg) `#9CA3AF` |
| Projection | `--c-after` | `PROJECTION_COLOUR` (= `.after`) | ![](swatches/319795.svg) `#319795` |
| OBR figure (a ring) / its label | `--c-obr` / `--c-obr-text` | `.obr` / `.obrText` | ![](swatches/9CA3AF.svg) `#9CA3AF` / ![](swatches/6B7280.svg) `#6B7280` |
| Reference series, such as "All ages" (dashed, `REFERENCE_DASH`) | `--c-reference` | `CHART_COLOURS.reference` | ![](swatches/6B7280.svg) `#6B7280` |
| Zero line | `--c-zero-line` | `CHART_COLOURS.zeroLine` | ![](swatches/374151.svg) `#374151` |
| Grid | `--c-grid` | `CHART_COLOURS.grid` | ![](swatches/E5E7EB.svg) `#E5E7EB` |
| Axis line | `--c-axis` | `CHART_COLOURS.axis` | ![](swatches/D1D5DB.svg) `#D1D5DB` |
| Tick label | `--c-tick` | `CHART_COLOURS.tick` | ![](swatches/6B7280.svg) `#6B7280` |
| Axis title | `--c-axis-title` | `CHART_COLOURS.axisTitle` | ![](swatches/4B5563.svg) `#4B5563` |
| Text / dark ink | `--c-text` / `--c-ink` | `.text` / `.ink` | ![](swatches/374151.svg) `#374151` / ![](swatches/1F2937.svg) `#1F2937` |
| Surface (cards, tooltips, exports) | `--c-surface` | `CHART_COLOURS.surface` | ![](swatches/FFFFFF.svg) `#FFFFFF` |
| Area with no data | `--c-muted-fill` | `CHART_COLOURS.mutedFill` | ![](swatches/F3F4F6.svg) `#F3F4F6` |
| Accent (links, buttons) / hover / dark | `--pe-accent` / `--pe-accent-hover` / `--pe-accent-dark` (ui-kit) | — (CSS only) | ![](swatches/319795.svg) `#319795` / ![](swatches/0D9488.svg) `#0D9488` / ![](swatches/0F766E.svg) `#0F766E` |
| Each measure's accent on its card | `--policy-accent` (set inline) | the catalogue's `measure.color` | its ramp step, below |
| Selection / highlight (the selected group, the title band) | `--c-highlight` (`--band-teal`) | `CHART_COLOURS.highlight` | ![](swatches/285E61.svg) `#285E61` |
| "Your household" tint (behind your group) | `--c-highlight-band` | `CHART_COLOURS.highlightBand` | ![](swatches/EAF5F4.svg) `#EAF5F4` |
| "Your household" marker | `--c-net` | `YOU_COLOUR` (= `.net`) | ![](swatches/000000.svg) `#000000` |
| Hover cursor behind a bar or row | `--c-hover` | `HOVER_CURSOR` (= `.hover`) | ![](swatches/EEF6F6.svg) `#EEF6F6` |
| Measure ramp, raise revenue (largest darkest) | `--ramp-raise-1…3` | `POLICY_RAMPS.raise` | ![](swatches/78350F.svg) ![](swatches/B45309.svg) ![](swatches/F59E0B.svg) `#78350F #B45309 #F59E0B` |
| Measure ramp, cost revenue (largest darkest) | `--ramp-cost-1…7` | `POLICY_RAMPS.cost` | ![](swatches/0D4359.svg) ![](swatches/016768.svg) ![](swatches/088075.svg) ![](swatches/00997F.svg) ![](swatches/28B084.svg) ![](swatches/4AC685.svg) ![](swatches/75D987.svg) `#0D4359 … #75D987` |
| Each published measure (rank by size within its direction) | set inline | `measureRamp(direction, n)` over `POLICY_RAMPS`; `MEASURE_RAMPS.neutral` | computed steps of the two ramps above; no costing ![](swatches/9CA3AF.svg) `#9CA3AF` |
| Income groups, low (amber) → high (teal) | `--income-ramp-1…7` | `INCOME_RAMP`, `incomeGroupColours(n)` | ![](swatches/8A3A0C.svg) ![](swatches/B8641C.svg) ![](swatches/E0954A.svg) ![](swatches/9CA3AF.svg) ![](swatches/5FB3AA.svg) ![](swatches/2A8C84.svg) ![](swatches/0F5F59.svg) `#8A3A0C … #9CA3AF … #0F5F59` |
| Poverty / inequality change | a fall `--c-gain`, a rise `--c-loss` | `.gain` / `.loss`; other years at `UNSELECTED_OPACITY` (0.5) | the selected year full strength, other years the same colour tinted |

`--c-hover` and `--c-highlight-band` stay apart on purpose: if they were one colour, the hover cursor would vanish on the highlighted group's bar.

### Other chart series

Single-purpose series, each in one chart; their tokens and JS names follow the same pattern (`--c-age-children` is `CHART_COLOURS.ageChildren`):

- Age bands: `age-children`, `age-young-adults`, `age-adults`, `age-older`, `age-pension` (blues to purple; 16 to 24 is `gain`).
- Household breakdown: `market-income`, `pension-contributions`.
- Marginal tax rate parts: `mtr-income-tax`, `mtr-child-benefit`, `mtr-allowance-taper`, `mtr-national-insurance`, `mtr-student-loan`, `mtr-universal-credit`, `mtr-other-benefits`, `mtr-other`.
- Size of a difference: `diff-small`, `diff-medium`, `diff-large` (green, yellow, red: a traffic light, off the teal/amber palette by design).
- Notices: `notice-bg`, `notice-text`.

### Interface (CSS only)

Page chrome, never drawn in a chart, so these have no JS name. All in the `:root` block of `globals.css`.

| Role | CSS token | Value |
| --- | --- | --- |
| Text and chips on the teal band and teal buttons | `--band-ink` | ![](swatches/FFFFFF.svg) `#FFFFFF` |
| …muted, border, border on hover, hover, pressed | `--band-ink-muted`, `--band-ink-border`, `--band-ink-border-hover`, `--band-ink-hover`, `--band-ink-active` | `--band-ink` at 70%, 60%, 80%, 12%, 20% |
| Footer gradient | `--footer-start` → `--footer-end` | ![](swatches/234E52.svg) `#234E52` → ![](swatches/2C7A7B.svg) `#2C7A7B` |
| Shadow: a card's edge / a tooltip or lifted card / a popover or menu | `--shadow-faint` / `--shadow-soft` / `--shadow-strong` | ![](swatches/111827.svg) `#111827` at 4% / 8% / 12% |
| Focus ring around a field or pill | `--focus-ring` | `--c-gain-text` at 25% |
| Search field magnifier (a data URI, stroked in `--c-tick`) | `--icon-search` | — |

## The rule, and how it is enforced

Colour literals (`#hex`, `rgb()`/`rgba()`/`hsl()`, and named colours such as `white` or `black`) are written in two places only: a `:root` block of `src/app/globals.css`, and `src/utils/chartTheme.js`. Everywhere else takes a token: `var(--c-…)` in CSS, `CHART_COLOURS.…` / `POLICY_RAMPS` / `INCOME_RAMP` / `measureRamp` (through the catalogue) in JS. `transparent`, `currentColor`, `inherit`, `none` and masks are always allowed.

- `src/colourGuard.test.js` (run by `bun run test`) scans every `.js`, `.jsx`, `.ts`, `.tsx` and `.css` file under `src/`, tests included, and fails with each `file:line`. It also rejects inline `fill="…"` / `stroke="…"` literals in JSX.
- ESLint (`no-restricted-syntax` in `eslint.config.mjs`) flags the same literals in JS/JSX as you type.

### Adding a colour

1. Check the table: if the role exists, use its token.
2. If it is a genuinely new role, add a `--c-*` token with a comment in `globals.css`, its mirror in `CHART_COLOURS` (`chartTheme.test.js` fails until both match), and a row here. Interface-only colours go in the "Interface" block instead.
