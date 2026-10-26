// Growth across the distribution: real change in each income group's own
// median, over the whole period between the two chosen years or year by
// year, by quintile, decile or vigintile, before or after housing costs,
// for all people or non-pensioners. Read from income_growth_by_group; a
// file without it falls back to income_by_decile's quintiles and deciles
// (all people). The view of the Growth across the distribution card.

import PillSelect from "../../PillSelect";
import YearRangeSelect from "../YearRangeSelect";
import { LsBarChart } from "../LsCharts";
import { divergingAxis, incomeGroupColours } from "../../../utils/chartTheme";
import {
  changeVerb,
  fyDash,
  fyLabel,
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
import { CSV_SOURCES, PeSource } from "../sources";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pct = (v) => `${formatOneDp(v)}%`;

// Each grouping: its pill label, the noun and the share in the sentence
export const GROUPINGS = {
  quintile: { label: "Quintiles", noun: "quintile", share: "fifth" },
  decile: { label: "Deciles", noun: "decile", share: "tenth" },
  vigintile: { label: "Vigintiles", noun: "vigintile", share: "twentieth" },
};
const POPULATIONS = { all: "All people", non_pensioners: "Non-pensioners" };
const VIEWS = { period: "Whole period", annual: "Year by year" };

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
 */
export default function useQuintileGrowthView(data, range = null, setRange = null) {
  const offer = available(data);
  const [view, setView] = useUrlChoice("ls_growth", Object.keys(VIEWS), "period");
  const [grouping, setGrouping] = useUrlChoice("ls_groups", offer.groupings, offer.groupings[0]);
  const [basis, setBasis] = useUrlChoice("ls_housing", offer.bases, "bhc");
  const [population, setPopulation] = useUrlChoice("ls_pop", offer.populations, "all");

  const byYear = growthRows(data, population, basis, grouping) || [];
  const [fromYear, toYear] = range ?? [headlineStartYear(data), headlineYear(data)];
  const firstIndex = Math.max(0, byYear.findIndex((r) => r.year === fromYear));
  const endIndex = byYear.findIndex((r) => r.year === toYear);
  const lastIndex = endIndex >= 0 ? endIndex : byYear.length - 1;
  const first = byYear[firstIndex];
  const end = byYear[lastIndex];
  if (!first || !end || !GROUPINGS[grouping]) return null;

  const g = GROUPINGS[grouping];
  const n = first.real_median.length;
  const colours = incomeGroupColours(n);
  const groupName = (i) => `${g.noun[0].toUpperCase()}${g.noun.slice(1)} ${i + 1}${i === 0 ? " (lowest income)" : i === n - 1 ? " (highest income)" : ""}`;
  const basisShort = basis.toUpperCase();
  const who = population === "all" ? "" : " among non-pensioners";
  const say = (v) => changeVerb(v, "%") || "stays flat";
  const axisLabel = `Income ${g.noun} (1 = lowest)`;

  // Whole period: one bar per group, the change from the first to the end year
  const periodRows = first.real_median.map((_, i) => ({
    group: i + 1,
    growth: ((1 + end.cumulative[i]) / (1 + first.cumulative[i]) - 1) * 100,
  }));
  // Year by year: one group of bars per year after the first, each group's
  // change on the year before
  const annualYears = byYear.slice(firstIndex + 1, lastIndex + 1);
  const annualRows = annualYears.map((r) => ({
    year: fyStart(r.year),
    ...Object.fromEntries(r.annual.map((v, i) => [`g${i + 1}`, v * 100])),
  }));
  const groupSeries = colours.map((colour, i) => ({ key: `g${i + 1}`, name: groupName(i), colour }));
  // The ends of the ramp (and its middle for five or fewer groups) name it
  const legendItems = (n <= 5 ? groupSeries : [groupSeries[0], groupSeries[n - 1]]).map((s) => ({ label: s.name, color: s.colour, type: "rect" }));

  const annual = view === "annual" && annualRows.length > 0;
  const values = annual ? annualRows.flatMap((r) => groupSeries.map((s) => r[s.key])) : periodRows.map((r) => r.growth);
  const axis = divergingAxis(values, { pad: 0.1 });
  const lowAnnual = annualYears.map((r) => r.annual[0] * 100);
  const highAnnual = annualYears.map((r) => r.annual[n - 1] * 100);

  const summary = annual ? (
    <>
      Each year from {fyDash(annualYears[0].year)} to {fyDash(end.year)}, real median income ({basisShort}){who} in the lowest-income
      {" "}{g.share} <strong>{annualRange(lowAnnual)}</strong>; in the highest-income {g.share} it <strong>{annualRange(highAnnual)}</strong>.
    </>
  ) : (
    <>
      From {fyDash(first.year)} to {fyDash(end.year)}, real median income ({basisShort}){who} in the lowest-income
      {" "}{g.share} <strong>{say(periodRows[0].growth)}</strong>; in the highest-income {g.share} it <strong>{say(periodRows[n - 1].growth)}</strong>.
    </>
  );

  const controls = (
    <>
      <PillSelect
        variant="light"
        prefix="View"
        name="Growth view"
        value={view}
        onChange={setView}
        options={Object.entries(VIEWS).map(([value, label]) => ({ value, label }))}
        stableWidth
      />
      {setRange && <YearRangeSelect years={byYear.map((r) => r.year)} from={first.year} to={end.year} onChange={setRange} />}
      {offer.groupings.length > 1 && (
        <PillSelect
          variant="light"
          prefix="Groups"
          name="Income groups"
          value={grouping}
          onChange={setGrouping}
          options={offer.groupings.map((id) => ({ value: id, label: GROUPINGS[id].label }))}
        />
      )}
      <PillSelect
        variant="light"
        prefix="Housing costs"
        name="Housing costs"
        value={basis}
        onChange={setBasis}
        options={offer.bases.map((id) => ({ value: id, label: id === "bhc" ? "Before (BHC)" : "After (AHC)", badge: id === "bhc" ? "Before" : "After" }))}
      />
      {offer.populations.length > 1 && (
        <PillSelect
          variant="light"
          prefix="People"
          name="Population"
          value={population}
          onChange={setPopulation}
          options={offer.populations.map((id) => ({ value: id, label: POPULATIONS[id] }))}
        />
      )}
    </>
  );

  const block = data.income_growth_by_group?.groupings && Object.keys(data.income_growth_by_group.groupings).length ? data.income_growth_by_group : null;
  const statistic = (block?.statistic || data.income_by_decile.statistic).replace(/decile/, "group");
  const popNote = population === "non_pensioners" ? ` ${block.populations.non_pensioners}, ranked among themselves.` : "";
  const about = `${statistic}: each bar is the real change in that ${g.noun}'s median, ${annual ? "on the year before" : "between the two years"}. Groups are re-ranked each year, so this compares positions in the distribution, not the same people.${popNote}`;
  const fileStem = `income-growth-by-${g.noun}-${basis}${population === "all" ? "" : "-non-pensioners"}`;

  return {
    period: periodLabel(annual ? annualYears[0].year : first.year, end.year),
    summary,
    about,
    notes: [
      basis === "ahc" && data.meta.cpi_ahc_note,
      grouping === "vigintile" &&
        `The lowest-income twentieth's median is ${formatPounds(first.real_median[0])} a year in ${fyDash(first.year)}, so a small change in pounds is a large percentage.`,
    ],
    source: <PeSource />,
    sourceText: CSV_SOURCES.pe,
    download: annual
      ? {
          filename: `${fileStem}-yearly`,
          legendItems,
          csv: () =>
            seriesCsv({
              title: `Annual income growth by ${g.noun} (${basisShort})${who}`,
              units: "% real change in median equivalised income on the year before",
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
              title: `Income growth by ${g.noun} (${basisShort})${who}`,
              units: `% real change in median equivalised income, ${fyDash(first.year)} to ${fyDash(end.year)}`,
              source: CSV_SOURCES.pe,
              rows: periodRows,
              xKey: "group",
              xLabel: axisLabel,
              xFormat: String,
              series: [{ key: "growth", name: `Real change, ${fyDash(first.year)} to ${fyDash(end.year)}` }],
            }),
        },
    controls,
    chart: annual ? (
      <LsBarChart
        data={annualRows}
        xKey="year"
        xFormat={fyLabel}
        series={groupSeries}
        legendItems={legendItems}
        yFormat={pctTick}
        tooltipFormat={pct}
        tooltipLabelFormat={(y) => `${fyLabel(y)}, change on ${fyLabel(y - 1)}`}
        showPlus
        yLabel="Real change on the year before (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
        barGap={n > 10 ? 0 : 1}
        maxBarSize={n > 5 ? 14 : 24}
      />
    ) : (
      <LsBarChart
        data={periodRows}
        xKey="group"
        xFormat={String}
        xLabel={axisLabel}
        series={[{ key: "growth", name: `Real change, ${fyDash(first.year)} to ${fyDash(end.year)}`, colour: colours[n - 1] }]}
        cellColours={colours}
        legendItems={legendItems}
        yFormat={pctTick}
        tooltipFormat={pct}
        tooltipLabelFormat={(i) => groupName(i - 1)}
        showPlus
        yLabel="Real change (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    ),
  };
}
