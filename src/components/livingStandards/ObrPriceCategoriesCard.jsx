// Prices by spending category: the OBR's March 2026 forecast
// of CPI inflation for its five spending categories, by fiscal year, drawn
// beside the inflation measures (ForecastSeriesSection). The data are
// public/data/obr_price_categories.json (tools/extract-obr-price-categories.mjs,
// from Table 1.19 of the OBR's economy detailed forecast tables); if the
// file is missing the card says it is not yet available. The y axis is
// fitted to the data (chartTheme.fittedAxis, always with 0); the x axis is
// titled "Financial year", beside the inflation measures' "Calendar year".

import { useEffect, useState } from "react";
import LsCard from "./LsCard";
import ViewToggle from "../ViewToggle";
import SeriesToggle from "../SeriesToggle";
import { LsLineChart, lineLegendItems } from "./LsCharts";
import { SERIES_COLOURS, fittedAxis, useNarrowViewport } from "../../utils/chartTheme";
import { formatOneDp, fyLabel } from "../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../utils/chartCsv";
import { METHOD_ANCHORS } from "../methodology/anchors";
import { categoryRows, loadObrPriceCategories, obrPriceCategoriesSentence } from "../../utils/livingStandards/obrPriceCategories";

export const OBR_PRICE_CATEGORIES_TITLE = "Prices by spending category";

// Each line: the OBR's name for it, a short chip name where room is short,
// its name in a sentence, colour, and what it covers (About this chart).
// Styled as the other line cards: 2.5px solid lines, each category in its
// own hue from the chart tokens. The chips under the plot are the key, so
// the lines carry no end labels.
const LINES = {
  food: {
    name: "Food, beverages and tobacco",
    short: "Food",
    inSentence: "food, beverages and tobacco",
    colour: SERIES_COLOURS[0],
    meaning: "Food, drinks (including alcohol) and tobacco.",
  },
  utilities: {
    name: "Utilities",
    inSentence: "utilities",
    colour: SERIES_COLOURS[1],
    meaning: "Household energy bills, mainly gas and electricity.",
  },
  fuels: {
    name: "Fuels",
    inSentence: "fuels",
    colour: SERIES_COLOURS[2],
    meaning: "Petrol and diesel for vehicles.",
  },
  other_tradables: {
    name: "Other tradables",
    short: "Tradables",
    inSentence: "other tradables",
    colour: SERIES_COLOURS[3],
    meaning: "Other goods that are traded internationally, such as clothing, cars and household goods.",
  },
  other_non_tradables: {
    name: "Other non-tradables",
    short: "Non-tradables",
    inSentence: "other non-tradables",
    colour: SERIES_COLOURS[4],
    meaning: "Mostly services, such as rents, eating out, travel and insurance.",
  },
};
const ORDER = Object.keys(LINES);

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;
const ukDay = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : undefined;

/** The file as { loading, data, error, unavailable }, loaded once per page. */
function useObrPriceCategories() {
  const [state, setState] = useState({ loading: true, data: null, error: null, unavailable: false });
  useEffect(() => {
    let live = true;
    loadObrPriceCategories().then((r) => {
      if (live) setState({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The source line for the downloads: "OBR, Economic and fiscal outlook, March 2026, Table 1.19 (CPI category inflation)". */
export function obrPriceSourceText(source) {
  return `OBR, ${source.release}, ${source.table} (${source.table_title})`;
}

export default function ObrPriceCategoriesCard({ view = "chart", onViewChange }) {
  const { loading, data, error, unavailable } = useObrPriceCategories();
  const narrow = useNarrowViewport();
  const [shown, setShown] = useState(ORDER);
  const [hovered, setHovered] = useState(null);

  const base = { id: "forecast-obr-price-categories", title: OBR_PRICE_CATEGORIES_TITLE, icon: "tag" };
  if (!data) {
    // The card holds its place while the file loads, or before it is
    // published, so the pair beside the inflation measures never jumps
    return (
      <LsCard {...base}>
        <div className="chart-plot">
          <p className="view-status" role={error ? "alert" : undefined}>
            {error
              ? `Could not load the OBR price forecast: ${error}`
              : unavailable
                ? "The OBR forecast of prices by spending category is not yet available."
                : loading
                  ? "Loading the OBR price forecast…"
                  : null}
          </p>
        </div>
      </LsCard>
    );
  }

  const keys = ORDER.filter((k) => data.series.some((s) => s.key === k));
  const rows = categoryRows(data);
  const allLines = keys.map((key) => ({ key, ...LINES[key] }));
  const lines = allLines.filter((l) => shown.includes(l.key));
  const sentence = obrPriceCategoriesSentence(rows, Object.fromEntries(keys.map((k) => [k, LINES[k].inSentence])));
  const src = data.source;
  const sourceText = obrPriceSourceText(src);
  const period = `${fyLabel(rows[0].year)} to ${fyLabel(rows[rows.length - 1].year)}`;
  const units = "Year-on-year growth (%); fiscal years";

  const csv = () =>
    buildChartCsv({
      title: OBR_PRICE_CATEGORIES_TITLE,
      units,
      source: sourceText,
      columns: [{ key: "fy", label: "Fiscal year" }, ...allLines.map((l) => ({ key: l.key, label: l.name, decimals: 4 }))],
      rows: rows.map((r) => ({ ...r, fy: fyLabel(r.year) })),
      notes: [`${data.vintage}.`],
    });

  const common = {
    ...base,
    period,
    summary: sentence,
    about: `Year-on-year CPI inflation in each of the OBR's spending categories, by fiscal year, in percent.`,
    sourceText,
    info: {
      shows: `How fast the OBR expects prices in each of its five CPI spending categories to rise each fiscal year, ${period}.`,
      how: [
        `The OBR's figures as published (${src.table}, ${src.table_title}), read from its spreadsheet by tools/extract-obr-price-categories.mjs; nothing is calculated on this page.`,
        "A fiscal year's value (April to March) is the average of its four quarters' year-on-year growth, as the OBR's table gives it.",
      ],
      definitions: [
        ...allLines.map((l) => ({ term: l.name, meaning: l.meaning })),
        { term: "Financial year", meaning: "April to March, as the OBR publishes this table; the inflation measures beside it are by calendar year." },
      ],
      caveats: [
        "This is the OBR's March 2026 forecast, made before the Autumn Budget 2026, so it leaves out the Budget's fuel duty cut and zero VAT on domestic electricity, which act directly on these prices.",
        "The OBR publishes no all-items CPI in this table; CPI and the other inflation measures are in the inflation measures card, by calendar year.",
      ],
      sources: [{ label: `${src.publisher}, ${src.workbook}, ${src.table}: ${src.table_title}`, href: src.url, date: ukDay(src.release_date) }],
      method: { anchor: METHOD_ANCHORS.forecastFeed, label: "How the forecast feeds the baseline" },
    },
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={OBR_PRICE_CATEGORIES_TITLE} />,
  };

  const chips = (
    <SeriesToggle
      series={allLines.map((l) => ({ key: l.key, label: l.name, short: l.short, colour: l.colour }))}
      shown={shown}
      onChange={setShown}
      onHover={setHovered}
      label="Lines"
      narrow={narrow}
    />
  );

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: "obr-price-categories", csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Year</th>
                {lines.map((l) => (
                  <th key={l.key}>{l.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>{fyLabel(row.year)}</td>
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

  const values = rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null);
  const axis = fittedAxis(values);
  return (
    <LsCard {...common} download={{ filename: "obr-price-categories", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xFormat={fyLabel}
        yFormat={pctTick}
        tooltipFormat={pctText}
        xLabel="Financial year"
        yLabel="Annual growth (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
        legend={false}
        focusKey={hovered}
        onLineHover={setHovered}
        keyContent={chips}
      />
    </LsCard>
  );
}
