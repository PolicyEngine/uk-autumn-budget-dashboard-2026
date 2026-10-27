// Prices by category since 2021 (July 2021 base): ONS price indices for a few
// spending categories, all prices (CPI) and average weekly earnings, each
// as its change since July 2021. History up to the latest ONS release,
// drawn beside the OBR's inflation forecast (ForecastSeriesSection); all
// prices (CPI) and earnings carry on, lighter and dashed, with that
// forecast (OBR March 2026, from the outlook file the Pre-measures
// forecast reads), to the end of its last year. The data are
// public/data/price_categories.json (tools/fetch-ons-price-categories.mjs)
// and public/data/living_standards_outlook.json; the changes and the
// chained forecast are computed in priceCategories.js.

import { useEffect, useState } from "react";
import LsCard from "./LsCard";
import ViewToggle from "../ViewToggle";
import SeriesToggle from "../SeriesToggle";
import { LsLineChart, lineLegendItems } from "./LsCharts";
import { CHART_COLOURS, useNarrowViewport } from "../../utils/chartTheme";
import { DASH } from "../../utils/livingStandards/baseline";
import { percentAxis } from "../../utils/livingStandards/forecast";
import { formatOneDp } from "../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../utils/chartCsv";
import { useOutlook } from "./useOutlook";
import {
  changeRows,
  forecastKey,
  forecastRates,
  loadPriceCategories,
  monthLabel,
  monthShort,
  monthYear,
  priceCategoriesSentence,
  withForecast,
  yearTicks,
} from "../../utils/livingStandards/priceCategories";

export const PRICE_CATEGORIES_TITLE = "Prices by category since 2021";

// Each line: its name, chip and end-label name where room is short, colour
// and pattern, and what it covers (About this chart). Styled as the
// dashboard's other line charts: 2.5px lines, each category a solid line in
// its own hue from the chart tokens; the two benchmarks keep one treatment
// of their own: all prices (CPI) the dark reference line, a little thicker,
// and earnings (not a price) a dashed neutral grey.
const LINES = {
  energy: { name: "Energy", colour: CHART_COLOURS.loss, meaning: "Electricity, gas and other household fuels (CPI class 04.5)." },
  food: { name: "Food", colour: CHART_COLOURS.gain, meaning: "Food and non-alcoholic drinks (CPI division 01)." },
  water: { name: "Water", colour: CHART_COLOURS.ageAdults, meaning: "Household water supply (CPI class 04.4.1)." },
  services: { name: "Services", colour: CHART_COLOURS.netStatePension, meaning: "All services in the CPI basket, such as rents, travel, eating out and insurance." },
  rents: { name: "Rents", colour: CHART_COLOURS.ageOlder, meaning: "Rents paid by tenants (CPI class 04.1)." },
  rail: { name: "Rail fares", short: "Rail", colour: CHART_COLOURS.diffLarge, meaning: "Passenger transport by railway (CPI class 07.3.1)." },
  cpi: { name: "All prices (CPI)", short: "CPI", colour: CHART_COLOURS.ink, width: 3, meaning: "The whole CPI basket." },
  earnings: {
    name: "Earnings",
    colour: CHART_COLOURS.reference,
    dash: DASH.long,
    meaning: "Average weekly earnings, whole economy, total pay in pounds (not a price; for comparison).",
  },
};
// The benchmarks first, then the categories
const ORDER = ["cpi", "earnings", "energy", "food", "water", "services", "rents", "rail"];
// Drawn at first: the two the sentence names against the two benchmarks;
// the rest are a chip away, so the lines below 30% do not tangle
export const DEFAULT_SHOWN = ["cpi", "earnings", "energy", "food"];
// A forecast line: its outturn line's colour, lighter, in a pattern of its
// own (CPI's solid line dashed; earnings' long dash dotted)
const FORECAST_DASH = { cpi: DASH.short, earnings: DASH.dot };
const FORECAST_OPACITY = 0.7;
// End labels in a half-width card: short names in a narrow right margin
const END_LABELS = { width: 84, minWidth: 420 };

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;
const ukDay = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : undefined;

/** The file as { loading, data, error }, loaded once per page. */
function usePriceCategories() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    loadPriceCategories().then((r) => {
      if (live) setState({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The source line for the downloads: the ONS datasets and their CDIDs. */
export function priceSourceText(series) {
  const by = (dataset) => series.filter((s) => s.dataset === dataset).map((s) => s.cdid);
  const parts = [
    by("MM23").length && `ONS, Consumer price inflation (MM23: ${by("MM23").join(", ")})`,
    by("LMS").length && `ONS, Labour market statistics (LMS: ${by("LMS").join(", ")})`,
  ].filter(Boolean);
  return `${parts.join("; ")}; change since July 2021 calculated by PolicyEngine`;
}

/** Where the series end, when they end in different months: "The price indices run to September 2026; earnings to August 2026." */
export function endsNote(series, latest) {
  if (new Set(series.map(latest)).size < 2) return null;
  const prices = series.filter((s) => s.key !== "earnings");
  const earnings = series.find((s) => s.key === "earnings");
  const priceEnds = [...new Set(prices.map(latest))];
  if (priceEnds.length === 1 && earnings) return `The price indices run to ${priceEnds[0]}; earnings to ${latest(earnings)}.`;
  return `The series end in different months: ${series.map((s) => `${LINES[s.key].name} to ${latest(s)}`).join("; ")}.`;
}

export default function PriceCategoriesCard({ view = "chart", onViewChange }) {
  const { loading, data, error } = usePriceCategories();
  // The OBR forecast for CPI and earnings; until it loads (or if it cannot)
  // the lines stop at the ONS outturn
  const outlook = useOutlook();
  const narrow = useNarrowViewport();
  const [shown, setShown] = useState(DEFAULT_SHOWN);
  const [hovered, setHovered] = useState(null);

  const base = { id: "forecast-price-categories", title: PRICE_CATEGORIES_TITLE, icon: "tag" };
  if (!data) {
    // The card holds its place while the file loads, so the pair beside the
    // inflation measures never jumps
    return (
      <LsCard {...base}>
        <div className="chart-plot">
          <p className="view-status" role={error ? "alert" : undefined}>
            {error ? `Could not load the ONS price data: ${error}` : loading ? "Loading ONS price data…" : null}
          </p>
        </div>
      </LsCard>
    );
  }

  const series = ORDER.map((key) => data.series.find((s) => s.key === key)).filter(Boolean);
  // Drawn from the base month on, so every line starts at 0 (the file
  // holds the months before it too)
  const outturn = changeRows(data).filter((r) => r.month >= data.base_month);
  const rates = forecastRates(outlook.data);
  const rows = rates ? withForecast(outturn, data, rates) : outturn;
  const forecastKeys = rates ? series.map((s) => s.key).filter((k) => rates[k]) : [];
  const forecastYears = rates ? Object.values(rates).flat().map((g) => g.year) : [];
  const forecastEnd = forecastYears.length ? Math.max(...forecastYears) : null;
  const allLines = series.map((s) => ({ key: s.key, endLabel: LINES[s.key].short, ...LINES[s.key] }));
  // Each shown line with a forecast is followed by its forecast line, which
  // takes the end label (the outturn line ends inside the forecast)
  const lines = allLines
    .filter((l) => shown.includes(l.key))
    .flatMap((l) =>
      forecastKeys.includes(l.key)
        ? [
            { ...l, endLabel: false },
            {
              key: forecastKey(l.key),
              name: `${l.name}, forecast`,
              endLabel: l.short ?? l.name,
              colour: l.colour,
              width: l.width,
              dash: FORECAST_DASH[l.key],
              opacity: FORECAST_OPACITY,
              forecastOf: l.key,
            },
          ]
        : [l],
    );
  const tableLines = allLines.filter((l) => shown.includes(l.key));
  // The value shown for a line in a month: the ONS figure, else the forecast
  const valueOf = (row, key) => row[key] ?? (row.forecast?.includes(key) ? row[forecastKey(key)] : null);
  const isForecast = (row, key) => row[key] == null && Boolean(row.forecast?.includes(key));
  // Shaded from the last ONS month of the forecast lines (CPI's September)
  const lastOutturn = forecastKeys.map((k) => series.find((s) => s.key === k).values.at(-1).month).sort().at(-1);
  const forecastRegion = forecastKeys.length ? { from: lastOutturn, to: rows.at(-1).month, label: "OBR forecast" } : null;
  const forecastNames = (row) => tableLines.filter((l) => isForecast(row, l.key)).map((l) => l.name).join("; ");
  const baseMonth = monthLabel(data.base_month);
  // The sentence is the ONS outturn only, never the forecast
  const sentence = priceCategoriesSentence(outturn, data.base_month);
  const preSource = outlook.data?.forecast?.pre_source;
  const sourceText = `${priceSourceText(series)}${forecastKeys.length ? `; forecast from ${preSource?.release ?? "the OBR"}, chained by PolicyEngine` : ""}`;
  const units = `Change in level since ${baseMonth} (%); monthly`;
  const latest = (s) => monthLabel(s.values[s.values.length - 1].month);
  const sa = series.filter((s) => s.seasonally_adjusted).map((s) => LINES[s.key].name);

  const csv = () =>
    buildChartCsv({
      title: PRICE_CATEGORIES_TITLE,
      units,
      source: sourceText,
      columns: [
        { key: "month", label: "Month" },
        ...allLines.map((l) => ({ key: l.key, label: `${l.name} (${series.find((s) => s.key === l.key).cdid})`, decimals: 2 })),
        ...(forecastKeys.length ? [{ key: "forecast", label: "Forecast (OBR, not ONS outturn)" }] : []),
      ],
      rows: rows.map((r) => ({
        ...Object.fromEntries(allLines.map((l) => [l.key, valueOf(r, l.key)])),
        month: r.month,
        forecast: allLines.filter((l) => isForecast(r, l.key)).map((l) => l.name).join("; "),
      })),
      notes: forecastKeys.length
        ? [`Rows with a Forecast entry: the named series are the OBR March 2026 forecast chained from the last ONS month, not outturn; other series have no forecast.`]
        : [],
    });

  const common = {
    ...base,
    summary: sentence,
    about: `Change in each series' level since ${baseMonth}, in percent, from monthly ONS data${forecastKeys.length ? `; all prices (CPI) and earnings then follow the OBR March 2026 forecast to ${forecastEnd}` : ""}.`,
    sourceText,
    info: {
      shows: forecastKeys.length
        ? `How much higher each price index, and average weekly earnings, stood each month than in ${baseMonth}, to the latest ONS release; after it (the shaded period), all prices (CPI) and earnings follow the OBR's March 2026 forecast to December ${forecastEnd}, drawn lighter and dashed.`
        : `How much higher each price index, and average weekly earnings, stood each month than in ${baseMonth}. This is history to the latest ONS release, not the OBR forecast.`,
      how: [
        `Each month's level divided by its ${baseMonth} level, minus one; calculated on this page from the levels the ONS publishes.`,
        forecastKeys.length &&
          `Forecast: the OBR (March 2026) gives CPI inflation and average earnings growth for each calendar year, as growth in the annual average (${forecastYears.length ? `${Math.min(...forecastYears)} to ${forecastEnd}` : ""}). From the last ONS month, each month's level is the month before's times (1 + g)^(1/12), g that calendar year's growth; months before ${Math.min(...forecastYears)}, for which the forecast here has no rate, use ${Math.min(...forecastYears)}'s. A constant monthly rate gives each year's annual-average growth only approximately. The level is then turned into its change since ${baseMonth} as above.`,
      ].filter(Boolean),
      definitions: allLines.map((l) => ({ term: l.name, meaning: l.meaning })),
      caveats: [
        endsNote(series, latest),
        sa.length > 0 && `${sa.join(" and ")} ${sa.length > 1 ? "are" : "is"} seasonally adjusted; the price indices are not.`,
        forecastKeys.length > 0 &&
          "There is no official forecast for the categories (energy, food, water, services, rents, rail fares), so their lines stop at the latest ONS month; only all prices (CPI) and earnings are carried on.",
        forecastKeys.includes("earnings") &&
          "The OBR forecasts wages and salaries per employee; the earnings line is ONS average weekly earnings (total pay), so its forecast applies the OBR's growth to a related, not identical, measure.",
        forecastKeys.length > 0 &&
          "The forecast is the OBR's March 2026 one, from before the Autumn Budget. Its growth rates are applied from the last ONS month, so the level follows the latest outturn rather than the level the OBR expected for that month.",
      ].filter(Boolean),
      sources: series.map((s) => ({
        label: `ONS, ${s.title.replace(/ 2015=100$/, "")} (${s.cdid}, ${s.dataset})`,
        href: s.source_url,
        date: ukDay(s.release_date),
      })).concat(
        forecastKeys.length && preSource
          ? [{ label: `${preSource.release}: CPI inflation and average earnings growth (calendar years)`, href: preSource.url }]
          : [],
      ),
    },
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={PRICE_CATEGORIES_TITLE} />,
  };

  const chips = (
    <SeriesToggle
      series={allLines.map((l) => ({ key: l.key, label: l.name, short: l.short, colour: l.colour, dash: l.dash }))}
      shown={shown}
      onChange={setShown}
      onHover={setHovered}
      label="Lines"
      narrow={narrow}
    />
  );

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: "price-categories", image: false, csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Month</th>
                {tableLines.map((l) => (
                  <th key={l.key}>{l.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} title={forecastNames(row) ? `Forecast: ${forecastNames(row)}` : undefined}>
                  <td>{monthShort(row.month)}</td>
                  {tableLines.map((l) => {
                    const v = valueOf(row, l.key);
                    return <td key={l.key}>{v == null ? "–" : isForecast(row, l.key) ? `${pctText(v)} forecast` : pctText(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="chart-legend">{chips}</div>
      </LsCard>
    );
  }

  // The axis from 0 up: a line a fraction of a point below its July 2021
  // level in the first months would otherwise add a whole step below 0
  const values = rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null);
  const axis = percentAxis(values.map((v) => (v > -1 ? Math.max(v, 0) : v)));
  return (
    <LsCard {...common} download={{ filename: "price-categories", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xKey="month"
        xFormat={monthShort}
        // Every other January on a phone, where nine years' labels collide
        xTickValues={narrow ? yearTicks(rows).filter((m) => Number(m.slice(0, 4)) % 2 === 0) : yearTicks(rows)}
        xTickFormat={monthYear}
        dots={false}
        yFormat={pctTick}
        tooltipFormat={pctText}
        yLabel={`Change since ${baseMonth} (%)`}
        yDomain={axis.domain}
        yTicks={axis.ticks}
        endLabels={END_LABELS}
        forecastRegion={forecastRegion}
        legend={false}
        focusKey={hovered}
        onLineHover={setHovered}
        keyContent={chips}
      />
    </LsCard>
  );
}
