// Growth across the distribution: real change in each income group's own
// median, over the whole period between the two chosen years or year by
// year, by quintile, decile or vigintile, before or after housing costs,
// for all people or non-pensioners. Read from income_growth_by_group; a
// file without it falls back to income_by_decile's quintiles and deciles
// (all people). The view of the Growth across the distribution card.

import { housingOption, yearsOption } from "../controlOptions";
import { LsBarChart } from "../LsCharts";
import { divergingAxis, incomeGroupColours, useNarrowViewport } from "../../../utils/chartTheme";
import {
  changeVerb,
  fyDash,
  fyLabel,
  fyShortLabel,
  fyStart,
  formatOneDp,
  formatPounds,
  headlineStartYear,
  headlineYear,
  periodLabel,
  round1,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { useUrlChoice } from "../../../utils/livingStandards/urlChoice";
import { offerFor, seriesFor, withMeasuresRows } from "../../../utils/livingStandards/growthWithMeasures";
import { CSV_SOURCES, PeSource } from "../sources";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pct = (v) => `${formatOneDp(v)}%`;
// The measures' effect on growth, in percentage points (two decimals: it is
// often a few hundredths)
const pp2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ppTick = (v) => `${pp2.format(v)}pp`;
const pp = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pp2.format(Math.abs(v))}pp`;
/** "+0.02pp to +0.10pp a year", "nil" for a group's annual effects (in pp). */
export function ppRange(values) {
  const r = values.map((v) => Math.round(v * 100) / 100);
  const lo = Math.min(...r);
  const hi = Math.max(...r);
  if (lo === 0 && hi === 0) return "nil each year";
  return lo === hi ? `${pp(lo)} each year` : `${pp(lo)} to ${pp(hi)} a year`;
}
/** "+0.12pp", "nil" for one effect (in pp). */
const ppOne = (v) => (Math.round(v * 100) === 0 ? "nil" : pp(v));

// Each grouping: its pill label, the noun and the share in the sentence
export const GROUPINGS = {
  // Worded plainly on the page (fifths, tenths, twentieths); the technical
  // names (quintile, decile, vigintile) only in About this chart
  quintile: { label: "Fifths", noun: "quintile", share: "fifth" },
  decile: { label: "Tenths", noun: "decile", share: "tenth" },
  vigintile: { label: "Twentieths", noun: "vigintile", share: "twentieth" },
};
const POPULATIONS = { all: "All people", non_pensioners: "Non-pensioners" };

// Vigintile 1, the lowest-income 5%, is left out of the chart, sentence and
// CSV: incomes at the very bottom of the survey are often temporarily low
// (self-employment losses, students, people living off savings) or
// under-reported, so they say little about living standards, and with few
// households their growth swings from year to year. Quintiles and deciles
// keep their bottom group, which is wider and steadier.
const SKIPPED = { vigintile: 1 };
const VIGINTILE_ABOUT =
  "Vigintile 1, the lowest-income 5% of people, is left out. Incomes at the very bottom of the survey are often temporarily low (self-employment losses, students, people living off savings) or under-reported, so they say little about living standards, and with few households behind them their growth swings from year to year. The chart starts at vigintile 2, the 5th to 10th percentile.";
// Decile 1 after housing costs is kept, but its growth swings: a short
// line under the key, the fuller one in About this chart
export const DECILE_AHC_NOTE =
  "The lowest-income tenth after housing costs swings from year to year: incomes at the very bottom of the survey are often temporarily low or under-reported.";
const DECILE_AHC_ABOUT =
  "Decile 1 after housing costs, the lowest-income tenth, is shown, but read it with care: incomes at the very bottom of the survey are often temporarily low (self-employment losses, students, people living off savings) or under-reported, while housing costs are not, so income after housing costs there is small and its growth swings from year to year.";
const VIEWS = { period: "Whole period", annual: "Year by year" };

/** "−0.9%" or "+0.1%"; an unsigned "0.0" for a change that rounds to zero. */
const signed = (v, unit) => {
  const r = round1(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${formatOneDp(Math.abs(r))}${unit}`;
};

/**
 * One series' rows, { year, real_median: [...], cumulative: [...],
 * annual: [...] | null }, growth as fractions; null when the file has none.
 */
export function growthRows(data, population, basis, grouping) {
  const block = data.income_growth_by_group;
  if (block && Object.keys(block.groupings).length) {
    const rows = block.series?.[population]?.[basis]?.[grouping]?.by_year;
    return rows?.map((r) => ({ year: r.year, real_median: r.real_median, cumulative: r.cumulative_growth, annual: r.annual_growth })) ?? null;
  }
  // An older file: income_by_decile's quintiles and deciles, all people
  if (population !== "all") return null;
  const key = { quintile: "quintile_by_year", decile: "by_year" }[grouping];
  const rows = key && data.income_by_decile?.[basis]?.[key];
  if (!rows?.length) return null;
  return rows.map((r, i) => ({
    year: r.year,
    real_median: r.real_median,
    cumulative: r.real_median.map((v, k) => v / rows[0].real_median[k] - 1),
    annual: i === 0 ? null : r.real_median.map((v, k) => v / rows[i - 1].real_median[k] - 1),
  }));
}

/** The groupings, populations and bases the file offers. */
function available(data) {
  const block = data.income_growth_by_group;
  if (block && Object.keys(block.groupings).length) {
    return {
      groupings: Object.keys(block.groupings).filter((g) => GROUPINGS[g]),
      populations: Object.keys(block.populations).filter((p) => POPULATIONS[p]),
      bases: Object.keys(block.bases),
    };
  }
  const dec = data.income_by_decile;
  return { groupings: ["quintile", "decile"], populations: ["all"], bases: Object.keys(dec?.bases || {}) };
}

/** "rises 0.2% to 0.5% a year" for a group's annual changes (in %). */
export function annualRange(values) {
  const r = values.map(round1);
  const lo = Math.min(...r);
  const hi = Math.max(...r);
  if (r.length === 1) return changeVerb(r[0], "%") || "stays flat";
  const span = (a, b) => (a === b ? `${formatOneDp(a)}%` : `${formatOneDp(a)}% to ${formatOneDp(b)}%`);
  if (lo === 0 && hi === 0) return "stays flat each year";
  if (lo >= 0) return `rises ${span(lo, hi)} a year`;
  if (hi <= 0) return `falls ${span(-hi, -lo)} a year`;
  const sign = (v) => (v > 0 ? `+${formatOneDp(v)}` : v < 0 ? `−${formatOneDp(-v)}` : "0.0");
  return `changes by ${sign(lo)}% to ${sign(hi)}% a year`;
}

/**
 * Card parts for the Growth across the distribution card. A file without
 * the groups gives no view.
 *
 * `measures` ({ rows, reformId, mode }) makes it the card with the
 * selected measures: rows from income_growth_with_measures.csv, the run
 * that stands for the selection, and mode "growth" (growth with the
 * measures: current law's plus the run's effect, withMeasuresRows) or
 * "difference" (the effect itself, in percentage points). The choices are
 * the same pills, kept in the same address parameters.
 */
export default function useQuintileGrowthView(data, range = null, setRange = null, measures = null) {
  const own = available(data);
  const run = measures && offerFor(measures.rows, measures.reformId);
  const offer = run
    ? {
        groupings: own.groupings.filter((x) => run.groupings.includes(x)),
        populations: own.populations.filter((x) => run.populations.includes(x)),
        bases: own.bases.filter((x) => run.bases.includes(x)),
      }
    : own;
  const narrow = useNarrowViewport();
  const [view, setView] = useUrlChoice("ls_growth", Object.keys(VIEWS), "annual");
  // Vigintiles by default, the finest split; deciles where the file has no
  // vigintiles, then whatever it offers
  const defaultGrouping = ["vigintile", "decile"].find((g) => offer.groupings.includes(g)) ?? offer.groupings[0];
  const [grouping, setGrouping] = useUrlChoice("ls_groups", offer.groupings, defaultGrouping);
  const [basis, setBasis] = useUrlChoice("ls_housing", offer.bases, "bhc");
  const [population, setPopulation] = useUrlChoice("ls_pop", offer.populations, "all");

  const twinRows = growthRows(data, population, basis, grouping);
  const byYear =
    (measures
      ? withMeasuresRows(twinRows, seriesFor(measures.rows, { reformId: measures.reformId, population, basis, grouping }))
      : twinRows) || [];
  const diff = measures?.mode === "difference";
  const [fromYear, toYear] = range ?? [headlineStartYear(data), headlineYear(data)];
  const firstIndex = Math.max(0, byYear.findIndex((r) => r.year === fromYear));
  const endIndex = byYear.findIndex((r) => r.year === toYear);
  const lastIndex = endIndex >= 0 ? endIndex : byYear.length - 1;
  const first = byYear[firstIndex];
  const end = byYear[lastIndex];
  if (!first || !end || !GROUPINGS[grouping]) return null;

  const g = GROUPINGS[grouping];
  const n = first.real_median.length;
  // The groups shown: all, or from vigintile 2 (SKIPPED)
  const skip = SKIPPED[grouping] ?? 0;
  const shown = Array.from({ length: n - skip }, (_, k) => k + skip);
  // The ramp's ends stay on the lowest and highest group shown
  const colours = incomeGroupColours(shown.length);
  const colourOf = (i) => colours[i - skip];
  const ordinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] ?? "th"}`;
  const groupName = (i) =>
    `${ordinal(i + 1)} ${g.share}${
      i === skip ? (skip ? " (lowest shown, 5th–10th percentile)" : " (lowest income)") : i === n - 1 ? " (highest income)" : ""
    }`;
  // "15th of 20 (70th–75th percentile)", for one bar's tooltip
  const step = 100 / n;
  const groupSpan = (i) => `${ordinal(i + 1)} of ${n} (${ordinal(Math.round(i * step)).replace(/^0th$/, "0")}–${ordinal(Math.round((i + 1) * step))} percentile)`;
  const lowest = skip ? `second-lowest-income ${g.share} (5th–10th percentile)` : `lowest-income ${g.share}`;
  const basisShort = basis.toUpperCase();
  const who = population === "all" ? "" : " among non-pensioners";
  const say = (v) => changeVerb(v, "%") || "stays flat";
  const axisLabel = `Income ${g.share} (1 = lowest)`;

  // Whole period: one bar per group, the change from the first to the end year
  const periodRows = shown.map((i) => ({
    group: i + 1,
    growth:
      ((1 + end.cumulative[i]) / (1 + first.cumulative[i]) - 1) * 100 -
      (diff ? ((1 + end.twin_cumulative[i]) / (1 + first.twin_cumulative[i]) - 1) * 100 : 0),
  }));
  // Year by year: one group of bars per year after the first, each group's
  // change on the year before
  const annualYears = byYear.slice(firstIndex + 1, lastIndex + 1);
  const annualRows = annualYears.map((r) => ({
    year: fyStart(r.year),
    ...Object.fromEntries(shown.map((i) => [`g${i + 1}`, (diff ? r.difference[i] : r.annual[i]) * 100])),
  }));
  const groupSeries = shown.map((i) => ({ key: `g${i + 1}`, name: groupName(i), colour: colourOf(i) }));
  const annual = view === "annual" && annualRows.length > 0;
  // The ramp's ends name it; year by year with five groups, every group
  // (whole period, the axis numbers the groups)
  const legendItems = (annual && groupSeries.length <= 5 ? groupSeries : [groupSeries[0], groupSeries.at(-1)]).map((s) => ({ label: s.name, color: s.colour, type: "rect" }));
  // More than five groups: one light-to-dark key, so every bar is explained
  const ramp = groupSeries.length > 5 ? { colours: groupSeries.map((s) => s.colour), from: "Lowest income", to: "Highest income" } : null;
  // Year by year: a tooltip for the one bar hovered
  const describeBar = (key, row) => {
    const i = Number(key.slice(1)) - 1;
    const value = row[key];
    return {
      label: `${fyLabel(row.year)} · ${groupSpan(i)}`,
      value: `${diff ? pp(value) : pct(value)}${diff ? "" : ` on ${fyLabel(row.year - 1)}`}`.replace(/^(?=\d)/, value > 0 ? "+" : ""),
      colour: colourOf(i),
    };
  };

  const values = annual ? annualRows.flatMap((r) => groupSeries.map((s) => r[s.key])) : periodRows.map((r) => r.growth);
  const axis = divergingAxis(values, { pad: 0.1 });
  const lowAnnual = annualYears.map((r) => (diff ? r.difference : r.annual)[skip] * 100);
  const highAnnual = annualYears.map((r) => (diff ? r.difference : r.annual)[n - 1] * 100);
  const income = `real median income growth (${basisShort})${who}`;

  // One short sentence, led by the finding: growth at the bottom (the
  // lowest group shown) against the top, one average number each. The
  // ranges and the exact groups are in About this chart.
  const lowVals = annual ? lowAnnual : [periodRows[0].growth];
  const highVals = annual ? highAnnual : [periodRows.at(-1).growth];
  const mean = (vals) => vals.reduce((sum, v) => sum + v, 0) / vals.length;
  const lowMean = round1(mean(lowVals));
  const highMean = round1(mean(highVals));
  const num = (v) => signed(v, "").replace(/^0\.0$/, "0");
  const per = annual ? " a year" : "";
  const gap = Math.abs(highMean - lowMean);
  const unitWord = diff ? " points" : "%";
  const ends = (
    <>
      (<strong>{num(lowMean)}{unitWord}</strong>
      {per} at the bottom, <strong>{num(highMean)}{unitWord}</strong> at the top)
    </>
  );
  const largest = Math.max(...[...lowVals, ...highVals].map((v) => Math.abs(v)));
  // The finding in words, from the signs of the two ends
  const trend = (bottom, top) => {
    if (Math.abs(top - bottom) < 0.15) return bottom >= 0 && top >= 0 ? "grow about as fast at the bottom as at the top" : bottom <= 0 && top <= 0 ? "fall about as fast at the bottom as at the top" : "barely change at either end";
    if (bottom >= 0 && top >= 0) return top > bottom ? "grow faster at the top than at the bottom" : "grow faster at the bottom than at the top";
    if (bottom <= 0 && top <= 0) return top > bottom ? "fall faster at the bottom than at the top" : "fall faster at the top than at the bottom";
    return top > bottom ? "grow at the top and fall at the bottom" : "grow at the bottom and fall at the top";
  };
  const summary = diff ? (
    largest < 0.25 ? (
      <>The measures barely change income growth at either end, under {formatOneDp(Math.max(0.1, Math.ceil(largest * 10 + 1e-9) / 10))} points{per}.</>
    ) : (
      <>The measures change income growth {gap < 0.15 ? "about equally at both ends" : highMean > lowMean ? "more at the top" : "more at the bottom"} {ends}.</>
    )
  ) : (
    <>Under current law, real incomes {trend(lowMean, highMean)} {ends}.</>
  );
  // The ranges and exact groups, for About this chart
  const low = skip ? `second-lowest-income ${g.share}` : `lowest-income ${g.share}`;
  const between = (vals) => {
    const r = vals.map(round1);
    const lo = Math.min(...r);
    const hi = Math.max(...r);
    return lo === hi ? `${num(lo)}` : `between ${num(lo)} and ${num(hi)}`;
  };
  const rangesNote = `Bottom is the ${low}, top the highest-income ${g.share}${who}. ${
    annual ? `Each year from ${fyDash(annualYears[0].year)} to ${fyDash(end.year)}` : `From ${fyDash(first.year)} to ${fyDash(end.year)}`
  }, ${diff ? "the measures change their growth by" : "their real income changes by"} ${between(lowVals)}${diff ? " points" : "%"}${per} and ${between(highVals)}${diff ? " points" : "%"} respectively.`;

  // Under the key only the short decile-1 (AHC) caution; the vigintile
  // note is in About this chart, with the key starting at vigintile 2
  const legendNote = grouping === "decile" && basis === "ahc" ? DECILE_AHC_NOTE : null;

  // The years compared are the section's (CurrentLawSection); the view is
  // the card's pill and the rest sits under Options (ControlBar)
  const controls = {
    // One Options pill: the view first, then the groups, housing costs and
    // population ("Year by year · Vigintiles · Before housing costs · All people")
    options: [
      yearsOption(twinRows?.map((r) => r.year) ?? [], range, setRange),
      {
        label: "View",
        value: view,
        onChange: setView,
        options: Object.entries(VIEWS).map(([value, label]) => ({ value, label })),
      },
      offer.groupings.length > 1 && {
        label: "Income groups",
        value: grouping,
        onChange: setGrouping,
        options: offer.groupings.map((id) => ({ value: id, label: GROUPINGS[id].label })),
      },
      housingOption(basis, setBasis, offer.bases),
      offer.populations.length > 1 && {
        label: "Population",
        value: population,
        onChange: setPopulation,
        options: offer.populations.map((id) => ({ value: id, label: POPULATIONS[id] })),
      },
    ].filter(Boolean),
  };

  const block = data.income_growth_by_group?.groupings && Object.keys(data.income_growth_by_group.groupings).length ? data.income_growth_by_group : null;
  const statistic = (block?.statistic || data.income_by_decile.statistic).replace(/decile/, "group");
  const popNote = population === "non_pensioners" ? ` ${block.populations.non_pensioners}, ranked among themselves.` : "";
  const measuresAbout = !measures
    ? " Without the measures (current law): real growth of each group's median income before any Budget measure."
    : diff
      ? " With the selected measures: each bar is the measures' effect on that growth, in percentage points: real growth with the measures less growth without them, from the same pair of simulations (the measure's or the package's run and its own baseline)."
      : " With the selected measures: current law's growth (the Pre-measures forecast tab's chart) plus the measures' effect on it, from the same pair of simulations (the measure's or the package's run and its own baseline). So with less without is exactly the effect.";
  const about = `${statistic}: each bar is the real change in that ${g.noun}'s median, ${annual ? "on the year before" : "between the two years"}.${measuresAbout} Groups are re-ranked each year, so this compares positions in the distribution, not the same people.${popNote}${skip ? ` ${VIGINTILE_ABOUT}` : ""}${grouping === "decile" && basis === "ahc" ? ` ${DECILE_AHC_ABOUT}` : ""}`;
  const fileStem = `income-growth${measures ? (diff ? "-effect-of-measures" : "-with-measures") : ""}-by-${g.noun}-${basis}${population === "all" ? "" : "-non-pensioners"}`;
  const csvTitle = (t) => (measures ? `${t}${diff ? ": effect of the selected measures" : ", with the selected measures"}` : t);

  return {
    period: periodLabel(first.year, end.year),
    summary,
    about,
    notes: [
      rangesNote,
      basis === "ahc" && data.meta.cpi_ahc_note,
      grouping === "vigintile" &&
        `The second-lowest-income twentieth's median is ${formatPounds(first.real_median[skip])} a year in ${fyDash(first.year)}, so a small change in pounds is a large percentage.`,
    ],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: annual
      ? {
          filename: `${fileStem}-yearly`,
          legendItems,
          csv: () =>
            seriesCsv({
              title: csvTitle(`Annual income growth by ${g.noun} (${basisShort})${who}`),
              units: diff
                ? "Percentage points: real growth in median equivalised income on the year before, with the measures less without"
                : "% real change in median equivalised income on the year before",
              source: CSV_SOURCES.pe,
              rows: annualRows,
              xKey: "year",
              xFormat: fyLabel,
              series: groupSeries,
            }),
        }
      : {
          filename: fileStem,
          legendItems,
          csv: () =>
            seriesCsv({
              title: csvTitle(`Income growth by ${g.noun} (${basisShort})${who}`),
              units: diff
                ? `Percentage points: real growth in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}, with the measures less without`
                : `% real change in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}`,
              source: CSV_SOURCES.pe,
              rows: periodRows,
              xKey: "group",
              xLabel: axisLabel,
              xFormat: String,
              series: [{ key: "growth", name: `${diff ? "Effect on real change" : "Real change"}, ${fyDash(first.year)} to ${fyDash(end.year)}` }],
            }),
        },
    controls,
    chart: annual ? (
      <LsBarChart
        data={annualRows}
        xKey="year"
        // On a phone "28-29", so every year is labelled
        xFormat={narrow ? fyShortLabel : fyLabel}
        series={groupSeries}
        legendItems={legendItems}
        yFormat={diff ? ppTick : pctTick}
        tooltipFormat={diff ? pp : pct}
        tooltipLabelFormat={(y) => `${fyLabel(y)}, change on ${fyLabel(y - 1)}`}
        showPlus
        yLabel={diff ? "Effect on real growth (pp)" : "Real change on the year before (%)"}
        yDomain={axis.domain}
        yTicks={axis.ticks}
        // Clear space between years, bars close within a year, and a faint
        // band behind every other year
        barGap={n > 10 ? 0 : 1}
        maxBarSize={n > 5 ? 14 : 24}
        barCategoryGap={n > 10 ? "30%" : "35%"}
        categoryBands
        legendNote={legendNote}
        ramp={ramp}
        describeBar={describeBar}
      />
    ) : (
      <LsBarChart
        data={periodRows}
        xKey="group"
        xFormat={String}
        xLabel={axisLabel}
        series={[{ key: "growth", name: `${diff ? "Effect on real change" : "Real change"}, ${fyDash(first.year)} to ${fyDash(end.year)}`, colour: colours.at(-1) }]}
        cellColours={colours}
        legendNote={legendNote}
        legendItems={legendItems}
        ramp={ramp}
        yFormat={diff ? ppTick : pctTick}
        tooltipFormat={diff ? pp : pct}
        tooltipLabelFormat={(i) => groupName(i - 1)}
        showPlus
        yLabel={diff ? "Effect on real growth (pp)" : "Real change (%)"}
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}
