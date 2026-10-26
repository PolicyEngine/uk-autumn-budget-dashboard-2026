// Forecast series by section, as charts or tables. Before the Budget
// forecast is published only the pre-Budget line is drawn (teal, solid);
// afterwards the pre-Budget line is grey and dashed and the Budget forecast
// teal and solid, with a legend. Labels and sources come from the outlook
// data (forecast.pre_label, post_label, pre_source, post_source).

import LsCard from "../LsCard";
import ControlBar from "../../ControlBar";
import SectionHeading from "../../SectionHeading";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH, OUTTURN_COLOUR, PROJECTION_COLOUR } from "../../../utils/livingStandards/baseline";
import {
  changeClass,
  forecastSeriesLabel,
  pctLabel,
  percentAxis,
  ppLabel,
  toRows,
} from "../../../utils/livingStandards/forecast";
import { formatOneDp, rowsPeriod } from "../../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../../utils/chartCsv";
import { ForecastSource, forecastSourceText } from "../sources";

// CPI after housing costs and social rent are PolicyEngine derivations, not OBR series.
const DERIVED = new Set(["cpi_ahc", "social_rent"]);

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;

/** Line and column names: the forecasts' labels, or for a derived series what it is derived from. */
export function forecastNames(forecast, derived) {
  const pre = forecastSeriesLabel(forecast.pre_label) || "OBR forecast";
  const post = forecastSeriesLabel(forecast.post_label) || "Latest OBR forecast";
  if (!derived) return { pre, post };
  return {
    pre: `PolicyEngine, from ${pre}`,
    post: `PolicyEngine, from ${post}`,
  };
}

function seriesFor(published, names) {
  // While unpublished only the pre line is drawn: teal, so it does not read
  // as a greyed-out comparison line.
  if (!published) return [{ key: "previous", name: names.pre, colour: PROJECTION_COLOUR }];
  return [
    { key: "previous", name: names.pre, colour: OUTTURN_COLOUR, dash: DASH.long },
    { key: "updated", name: names.post, colour: PROJECTION_COLOUR, dash: DASH.solid },
  ];
}

/** The series' CSV: calendar years, pre and post (blank until published), change. */
function forecastCsv(series, rows, published, names, source) {
  return buildChartCsv({
    title: series.label,
    units: "Annual growth (%); calendar years",
    source,
    columns: [
      { key: "year", label: "Year" },
      { key: "previous", label: names.pre, decimals: 4 },
      { key: "updated", label: names.post, decimals: 4 },
      { key: "change", label: "Difference (pp)", decimals: 4 },
    ],
    rows,
    notes: published ? [] : [`${names.post}: not yet published`],
  });
}

// Each forecast series' title icon, as the headline tiles' are
const SERIES_ICONS = {
  cpi: "tag",
  cpih: "tag",
  cpi_ahc: "tag",
  rpi: "receipt",
  earnings: "briefcase",
  non_labour_income: "coins",
  house_prices: "house",
  rent: "key",
  social_rent: "key",
  mortgage_interest: "percent",
};

function ForecastCard({ series, forecast, published, view, onViewChange }) {
  const rows = toRows(series, published);
  if (!rows.length) return null;
  const derived = DERIVED.has(series.key);
  const names = forecastNames(forecast, derived);
  const lines = seriesFor(published, names);
  const sourceText = forecastSourceText(forecast, derived);
  const csv = () => forecastCsv(series, rows, published, names, sourceText);
  const period = rowsPeriod(rows);
  // The basis and the source are said once, in the section's intro; a card
  // says only what is its own: a series PolicyEngine derives
  // One plain sentence on the card: the forecast's first and last years.
  // Whether it is a PolicyEngine derivation is in About this chart.
  const shown = (row) => (published && row.updated != null ? row.updated : row.previous);
  const firstRow = rows.find((row) => shown(row) != null);
  const lastRow = [...rows].reverse().find((row) => shown(row) != null);
  const summary =
    firstRow && lastRow && firstRow !== lastRow ? (
      <>
        The forecast has {series.label.charAt(0).toLowerCase() + series.label.slice(1)} growing by{" "}
        <strong>{pctText(shown(firstRow))}</strong> in {firstRow.year} and <strong>{pctText(shown(lastRow))}</strong> in{" "}
        {lastRow.year}.
      </>
    ) : null;
  const common = {
    title: series.label,
    icon: SERIES_ICONS[series.key],
    period,
    summary,
    notes: [derived && "A PolicyEngine derivation from the OBR forecast, not an OBR series."],
    sourceText,
    // Charts or tables: one choice for every card, offered in each card's
    // Options pill
    controls: onViewChange && (
      <ControlBar
        name={series.label}
        options={[
          {
            label: "Show as",
            value: view,
            onChange: onViewChange,
            options: [
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ],
          },
        ]}
      />
    ),
  };

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: `forecast-${series.key}`, image: false, csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>{names.pre}</th>
                <th>{names.post}</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{pctLabel(row.previous)}</td>
                  {published ? <td>{pctLabel(row.updated)}</td> : <td className="pending">Not yet published</td>}
                  <td className={changeClass(row.shownChange)}>{ppLabel(row.shownChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LsCard>
    );
  }

  const values = rows.flatMap((d) => [d.previous, published ? d.updated : null]).filter((v) => v != null);
  const axis = percentAxis(values);
  return (
    <LsCard {...common} download={{ filename: `forecast-${series.key}`, legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xFormat={String}
        yFormat={pctTick}
        tooltipFormat={pctText}
        yLabel="Annual growth (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
      />
    </LsCard>
  );
}

// Each forecast group's icon, by its title in the data; "trend" otherwise
const SECTION_ICONS = {
  "Inflation and price indices": "tag",
  "Income and earnings": "briefcase",
  "Housing and rent": "key",
};

const pairs = (items) =>
  items.reduce((rows, item, i) => (i % 2 ? rows[rows.length - 1].push(item) : rows.push([item]), rows), []);

/** One section per forecast group (inflation, incomes, housing), with its title on the page. */
export default function ForecastSeriesSection({ data, view, onViewChange, subtitles = {} }) {
  const forecast = data.forecast;
  const published = Boolean(forecast.post_published);

  return forecast.sections.map((section) => [
    <SectionHeading
      key={`${section.title}-heading`}
      icon={SECTION_ICONS[section.title] ?? "trend"}
      title={section.title}
      subtitle={subtitles[section.title]}
    />,
    <section key={section.title} className="report-section ls-section">
      {/* Two cards a row, so each pair lines up */}
      {pairs(section.series).map((pair) => (
        <div className="charts-grid" key={pair[0].key}>
          {pair.map((series) => (
            <ForecastCard key={series.key} series={series} forecast={forecast} published={published} view={view} onViewChange={onViewChange} />
          ))}
        </div>
      ))}
    </section>,
  ]);
}
