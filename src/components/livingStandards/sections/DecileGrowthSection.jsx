// Growth across the distribution: real change in each income group's own
// median, over the whole period between the two chosen years or year by
// year, by quintile, decile or vigintile, before or after housing costs,
// for all people or non-pensioners. Read from income_growth_by_group; a
// file without it falls back to income_by_decile's quintiles and deciles
// (all people). The view of the Growth across the distribution card.

import { housingOption, yearsOption } from "../controlOptions";
import { LsBarChart } from "../LsCharts";
import { divergingAxis, fittedAxis, incomeGroupColours, useNarrowViewport } from "../../../utils/chartTheme";
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
import { METHOD_ANCHORS } from "../../methodology/anchors";

// Axis ticks to the step's own precision: a 0.25 step reads "0.25%", not
// "0.3%" (tightAxis's steps go down to 0.01)
const pctTickFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

// Both ends round to under 0.15 (one of them shown as 0): neither "grow" nor
// "fall" describes it, and "about as fast" beside a 0 reads as an error
const nearZero = (bottom, top) => Math.max(Math.abs(bottom), Math.abs(top)) < 0.15;

// Current law, in words, from the signs of the two ends (rounded means, as shown)
export function trendWords(bottom, top) {
  if (nearZero(bottom, top)) return "barely change at either end";
  if (Math.abs(top - bottom) < 0.15) return bottom >= 0 && top >= 0 ? "grow about as fast at the bottom as at the top" : bottom <= 0 && top <= 0 ? "fall about as fast at the bottom as at the top" : "barely change at either end";
  if (bottom >= 0 && top >= 0) return top > bottom ? "grow faster at the top than at the bottom" : "grow faster at the bottom than at the top";
  if (bottom <= 0 && top <= 0) return top > bottom ? "fall faster at the bottom than at the top" : "fall faster at the top than at the bottom";
  return top > bottom ? "grow at the top and fall at the bottom" : "grow at the bottom and fall at the top";
}

// The policies' change, in words (rounded means, as shown)
export function changeWords(bottom, top) {
  if (nearZero(bottom, top)) return "barely change income growth at either end on average";
  if (Math.abs(top - bottom) < 0.15) return "change income growth about equally at both ends";
  return top > bottom ? "change income growth more at the top" : "change income growth more at the bottom";
}

export const pctTick = (v) => `${pctTickFormat.format(v)}%`;
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

/**
 * A y axis close to the data: the nice step (2 to 4 ticks a side) whose
 * end is nearest the largest value, from 0 when the values have one sign;
 * fitted to each side, never forced symmetric, when they fall on both
 * (−0.46 to +0.13 → −0.5 to +0.15 by 0.1s; chartTheme.fittedAxis).
 */
export function tightAxis(values) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  const largest = Math.max(0, ...vals.map(Math.abs)) * 1.02 || 1;
  const both = vals.some((v) => v > 1e-9) && vals.some((v) => v < -1e-9);
  if (both) return fittedAxis(vals);
  const steps = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
  let best = null;
  for (const step of steps) {
    const count = Math.max(1, Math.ceil(largest / step - 1e-9));
    if (count < 2 || count > 4) continue;
    const end = count * step;
    if (!best || end < best.end - 1e-9) best = { step, end };
  }
  if (!best) return divergingAxis(vals, { pad: 0.05 });
  const { step, end } = best;
  const negative = vals.some((v) => v < -1e-9);
  const lo = both || negative ? -end : 0;
  const hi = both || !negative ? end : 0;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6 || 0);
  return { domain: [lo, hi], ticks };
}

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
export default function useQuintileGrowthView(data, range = null, setRange = null, measures = null, selectedYear = null) {
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
  // Tenths, as every other distribution chart on the dashboard (Pavel's
  // review, LS4: the fifths / tenths / twentieths choice is gone); another
  // grouping only where the file has no deciles
  const grouping = offer.groupings.includes("decile") ? "decile" : offer.groupings[0];
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

  // Year by year: on hovering a year, every group's value, compact
  const shortValue = (v) => {
    if (v == null || !Number.isFinite(v)) return "–";
    const text = Math.abs(v).toFixed(diff ? 2 : 1);
    const sign = Number(text) === 0 ? "" : v > 0 ? "+" : "−";
    return `${sign}${text}${diff ? "" : "%"}`;
  };
  const describeYear = (row) => ({
    year: fyLabel(row.year),
    title: diff ? "effect on real growth (pp)" : `real change on ${fyLabel(row.year - 1)}`,
    items: groupSeries.map((s) => ({
      key: s.key,
      label: `${ordinal(Number(s.key.slice(1)))} ${g.share}`,
      value: row[s.key],
      text: shortValue(row[s.key]),
      colour: s.colour,
    })),
  });

  const values = annual ? annualRows.flatMap((r) => groupSeries.map((s) => r[s.key])) : periodRows.map((r) => r.growth);
  const axis = tightAxis(values);
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
  const unitWord = diff ? " points" : "%";
  // The two groups compared, named (LS1): "(lowest tenth: +0.4% a year;
  // top tenth: +0.2%)"
  const bottomName = skip ? `${ordinal(skip + 1)} ${g.share}` : `lowest ${g.share}`;
  const ends = (
    <>
      ({bottomName}: <strong>{num(lowMean)}{unitWord}</strong>
      {per}; top {g.share}: <strong>{num(highMean)}{unitWord}</strong>)
    </>
  );
  const largest = Math.max(...[...lowVals, ...highVals].map((v) => Math.abs(v)));
  const summary = diff ? (
    largest < 0.25 ? (
      <>The policies barely change income growth at either end, under {formatOneDp(Math.max(0.1, Math.ceil(largest * 10 + 1e-9) / 10))} points{per}.</>
    ) : (
      <>The policies {changeWords(lowMean, highMean)} {ends}.</>
    )
  ) : (
    // In the growth view the rows are current law plus the policies (LS1)
    <>{measures ? "With the selected policies" : "Under current law"}, real incomes {trendWords(lowMean, highMean)} {ends}.</>
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
  }, ${diff ? "the policies change their growth by" : "their real income changes by"} ${between(lowVals)}${diff ? " points" : "%"}${per} and ${between(highVals)}${diff ? " points" : "%"} respectively.`;

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
    ? " Without the policies (current law): real growth of each group's median income before any Budget policy."
    : diff
      ? " With the selected policies: each bar is the policies' effect on that growth, in percentage points: real growth with the policies less growth without them, from the same pair of simulations (the policy's own run, or the selected policies' combined run, and its own baseline)."
      : " With the selected policies: current law's growth (the Pre-measures forecast tab's chart) plus the policies' effect on it, from the same pair of simulations (the policy's own run, or the selected policies' combined run, and its own baseline). So with less without is exactly the effect.";
  const about = `${statistic}: each bar is the real change in that ${g.noun}'s median, ${annual ? "on the year before" : "between the two years"}.${measuresAbout} Groups are re-ranked each year, so this compares positions in the distribution, not the same people.${popNote}${skip ? ` ${VIGINTILE_ABOUT}` : ""}${grouping === "decile" && basis === "ahc" ? ` ${DECILE_AHC_ABOUT}` : ""}`;
  const fileStem = `income-growth${measures ? (diff ? "-effect-of-measures" : "-with-measures") : ""}-by-${g.noun}-${basis}${population === "all" ? "" : "-non-pensioners"}`;
  const csvTitle = (t) => (measures ? `${t}${diff ? ": effect of the selected policies" : ", with the selected policies"}` : t);

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
    info: {
      shows: `The real change in the median income of each ${g.share} of people, ${annual ? "on the year before" : "between the two years"}${diff ? ", with the policies less without them, in percentage points" : ""}.`,
      how: [
        measures && "Effect of the policies is growth with them less growth under current law.",
        `Bottom is the ${low}; top the highest-income ${g.share}${who}.`,
        `${annual ? `Each year from ${fyDash(annualYears[0].year)} to ${fyDash(end.year)}` : `From ${fyDash(first.year)} to ${fyDash(end.year)}`}, ${diff ? "the policies change their growth by" : "their real income changes by"} ${between(lowVals)}${diff ? " points" : "%"}${per} and ${between(highVals)}${diff ? " points" : "%"} respectively.`,
        popNote.trim(),
      ],
      caveats: [
        "Groups are re-ranked each year: this compares positions in the distribution, not the same people.",
        skip > 0 &&
          `The lowest-income ${g.share} is left out: incomes there are often temporarily low or under-reported.`,
        grouping === "vigintile" &&
          `The ${low}'s median is ${formatPounds(first.real_median[skip])} a year in ${fyDash(first.year)}, so a small change in pounds is a large percentage.`,
        basis === "ahc" && "Real incomes after housing costs use a PolicyEngine CPI after housing costs, not an OBR series.",
      ],
      method: { anchor: METHOD_ANCHORS.lsNotes, label: "Notes on the income growth data" },
    },
    download: annual
      ? {
          filename: `${fileStem}-yearly`,
          legendItems,
          csv: () =>
            seriesCsv({
              title: csvTitle(`Annual income growth by ${g.noun} (${basisShort})${who}`),
              units: diff
                ? "Percentage points: real growth in median equivalised income on the year before, with the policies less without"
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
                ? `Percentage points: real growth in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}, with the policies less without`
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
        // Each year's cluster fills most of its band (bars touching); only
        // the header-selected year is shaded
        barGap={n > 10 ? 0 : 1}
        maxBarSize={n > 10 ? 18 : n > 5 ? 30 : 44}
        barCategoryGap={n > 10 ? "12%" : "16%"}
        selectedX={selectedYear == null ? null : Number(selectedYear)}
        legendNote={legendNote}
        ramp={ramp}
        describeYear={describeYear}
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
