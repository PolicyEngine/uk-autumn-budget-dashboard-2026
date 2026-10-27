// Prices by spending category since July 2021: ONS price indices for a few
// spending categories, all prices (CPI) and average weekly earnings, each
// as its change since July 2021. History up to the latest ONS release,
// drawn beside the OBR's inflation forecast (ForecastSeriesSection). The
// data are public/data/price_categories.json (tools/fetch-ons-price-
// categories.mjs); the changes are computed in priceCategories.js.

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
import {
  changeRows,
  loadPriceCategories,
  monthLabel,
  monthShort,
  monthYear,
  priceCategoriesSentence,
  yearTicks,
} from "../../utils/livingStandards/priceCategories";

export const PRICE_CATEGORIES_TITLE = "Prices by spending category since July 2021";

// Each line: its name, chip name on a phone, colour and pattern, and what
// it covers (About this chart). All prices are drawn dark and thicker;
// earnings, not a price, dashed.
const LINES = {
  energy: { name: "Energy", colour: CHART_COLOURS.loss, meaning: "Electricity, gas and other household fuels (CPI class 04.5)." },
  water: { name: "Water", colour: CHART_COLOURS.marketIncome, dash: DASH.short, meaning: "Household water supply (CPI class 04.4.1)." },
  food: { name: "Food", colour: CHART_COLOURS.gain, meaning: "Food and non-alcoholic drinks (CPI division 01)." },
  services: { name: "Services", colour: CHART_COLOURS.highlight, dash: DASH.dashDot, meaning: "All services in the CPI basket, such as rents, travel, eating out and insurance." },
  rents: { name: "Rents", colour: CHART_COLOURS.ageOlder, meaning: "Rents paid by tenants (CPI class 04.1)." },
  rail: { name: "Rail fares", short: "Rail", colour: CHART_COLOURS.pensionContributions, dash: DASH.long, meaning: "Passenger transport by railway (CPI class 07.3.1)." },
  cpi: { name: "All prices (CPI)", short: "CPI", colour: CHART_COLOURS.ink, width: 3.5, meaning: "The whole CPI basket." },
  earnings: {
    name: "Earnings",
    colour: CHART_COLOURS.reference,
    dash: DASH.long,
    meaning: "Average weekly earnings, whole economy, total pay in pounds (not a price; for comparison).",
  },
};
const ORDER = ["energy", "water", "food", "services", "rents", "rail", "cpi", "earnings"];

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
  const narrow = useNarrowViewport();
  const [shown, setShown] = useState(ORDER);
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
  const rows = changeRows(data);
  const allLines = series.map((s) => ({ key: s.key, ...LINES[s.key] }));
  const lines = allLines.filter((l) => shown.includes(l.key));
  const baseMonth = monthLabel(data.base_month);
  const sentence = priceCategoriesSentence(rows, data.base_month);
  const sourceText = priceSourceText(series);
  const units = `Change in level since ${baseMonth} (%); monthly`;
  const latest = (s) => monthLabel(s.values[s.values.length - 1].month);
  const sa = series.filter((s) => s.seasonally_adjusted).map((s) => LINES[s.key].name);

  const csv = () =>
    buildChartCsv({
      title: PRICE_CATEGORIES_TITLE,
      units,
      source: sourceText,
      columns: [{ key: "month", label: "Month" }, ...allLines.map((l) => ({ key: l.key, label: `${l.name} (${series.find((s) => s.key === l.key).cdid})`, decimals: 2 }))],
      rows,
      notes: [],
    });

  const common = {
    ...base,
    summary: sentence,
    about: `Change in each series' level since ${baseMonth}, in percent, from monthly ONS data.`,
    sourceText,
    info: {
      shows: `How much higher each price index, and average weekly earnings, stood each month than in ${baseMonth}. This is history to the latest ONS release, not the OBR forecast.`,
      how: [`Each month's level divided by its ${baseMonth} level, minus one; calculated on this page from the levels the ONS publishes.`],
      definitionsTitle: "What each line covers",
      definitions: allLines.map((l) => ({ term: l.name, meaning: l.meaning })),
      caveats: [
        endsNote(series, latest),
        sa.length > 0 && `${sa.join(" and ")} ${sa.length > 1 ? "are" : "is"} seasonally adjusted; the price indices are not.`,
      ],
      sources: series.map((s) => ({
        label: `ONS, ${s.title.replace(/ 2015=100$/, "")} (${s.cdid}, ${s.dataset})`,
        href: s.source_url,
        date: ukDay(s.release_date),
      })),
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
                {lines.map((l) => (
                  <th key={l.key}>{l.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month}>
                  <td>{monthShort(row.month)}</td>
                  {lines.map((l) => (
                    <td key={l.key}>{row[l.key] == null ? "–" : pctText(row[l.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="chart-legend">{chips}</div>
      </LsCard>
    );
  }

  const axis = percentAxis(rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null));
  return (
    <LsCard {...common} download={{ filename: "price-categories", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xKey="month"
        xFormat={monthShort}
        xTickValues={yearTicks(rows)}
        xTickFormat={monthYear}
        dots={false}
        yFormat={pctTick}
        tooltipFormat={pctText}
        yLabel={`Change since ${baseMonth} (%)`}
        yDomain={axis.domain}
        yTicks={axis.ticks}
        endLabels
        legend={false}
        focusKey={hovered}
        keyContent={chips}
      />
    </LsCard>
  );
}
