// Forecast series by section, as charts or tables (pre-Budget grey solid,
// post-Budget teal dashed). Ported from PolicyEngine/uk-living-standards-outlook;
// text and figures unchanged.

import LsCard from "../LsCard";
import SectionHeading from "../../SectionHeading";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { changeClass, pctLabel, percentAxis, ppLabel, toRows } from "../../../utils/livingStandards/forecast";
import { formatOneDp } from "../../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../../utils/chartCsv";
import { CSV_SOURCES, ObrSource, PeDerivedSource } from "../sources";

// CPI after housing costs and social rent are PolicyEngine derivations, not OBR series.
const DERIVED = new Set(["cpi_ahc", "social_rent"]);
const sourceFor = (series) => (DERIVED.has(series.key) ? <PeDerivedSource /> : <ObrSource />);
// Line names for derived series: they follow the OBR forecast but are not OBR's.
const DERIVED_LABEL = "PolicyEngine derivation from the OBR March 2026 forecast";

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;

function seriesFor(published, preLabel, postLabel) {
  // While unpublished only the pre line is drawn: teal, so it does not read
  // as a greyed-out comparison line.
  if (!published) return [{ key: "previous", name: preLabel, colour: "#319795" }];
  return [
    { key: "previous", name: preLabel, colour: "#9CA3AF" },
    { key: "updated", name: postLabel, colour: "#319795", dashed: true },
  ];
}

/** The series' CSV: calendar years, pre and post (blank until published), change. */
function forecastCsv(series, rows, published, preLabel, postLabel) {
  return buildChartCsv({
    title: series.label,
    units: "Annual growth (%); calendar years",
    source: DERIVED.has(series.key) ? CSV_SOURCES.peDerived : CSV_SOURCES.obr,
    columns: [
      { key: "year", label: "Year" },
      { key: "previous", label: preLabel, decimals: 4 },
      { key: "updated", label: postLabel, decimals: 4 },
      { key: "change", label: "Change (pp)", decimals: 4 },
    ],
    rows,
    notes: published ? [] : [`${postLabel}: Not yet published`],
  });
}

function ForecastCard({ series, published, preLabel, postLabel, view }) {
  const rows = toRows(series, published);
  if (!rows.length) return null;
  const derived = DERIVED.has(series.key);
  const lines = seriesFor(
    published,
    derived ? DERIVED_LABEL : preLabel,
    derived ? `PolicyEngine derivation from the ${postLabel}` : postLabel,
  );
  const csv = () =>
    forecastCsv(series, rows, published, derived ? "PolicyEngine derivation (pre-Budget)" : preLabel, postLabel);

  if (view === "table") {
    return (
      <LsCard
        title={series.label}
        summary="Annual growth rate (%)."
        source={sourceFor(series)}
        download={{ filename: `forecast-${series.key}`, image: false, csv }}
      >
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>{derived ? "PolicyEngine derivation (pre-Budget)" : preLabel}</th>
                <th>{postLabel}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{pctLabel(row.previous)}</td>
                  {published ? <td>{pctLabel(row.updated)}</td> : <td className="pending">Not yet published</td>}
                  <td className={changeClass(row.change)}>{ppLabel(row.change)}</td>
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
    <LsCard
      title={series.label}
      source={sourceFor(series)}
      download={{ filename: `forecast-${series.key}`, legendItems: lineLegendItems(lines), csv }}
    >
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

const pairs = (items) =>
  items.reduce((rows, item, i) => (i % 2 ? rows[rows.length - 1].push(item) : rows.push([item]), rows), []);

/** One section per forecast group (inflation, incomes, housing), with its title on the page. */
export default function ForecastSeriesSection({ data, view, subtitles = {} }) {
  const forecast = data.forecast;
  const published = Boolean(forecast.post_published);

  return forecast.sections.map((section) => [
    <SectionHeading key={`${section.title}-heading`} title={section.title} subtitle={subtitles[section.title]} />,
    <section key={section.title} className="report-section ls-section">
      {/* Two cards a row, so each pair lines up */}
      {pairs(section.series).map((pair) => (
        <div className="charts-grid" key={pair[0].key}>
          {pair.map((series) => (
            <ForecastCard
              key={series.key}
              series={series}
              published={published}
              preLabel={forecast.pre_label}
              postLabel={forecast.post_label}
              view={view}
            />
          ))}
        </div>
      ))}
    </section>,
  ]);
}
