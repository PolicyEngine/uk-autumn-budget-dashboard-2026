// The forecast series by group (prices, pay and other income, housing),
// as comparable charts or tables: one card per group of series on a shared
// axis (forecastWords.FORECAST_GROUPS), each line named at its end, with
// one plain sentence leading with the finding. The Budget-day forecast is
// held (ForecastPanel), so the cards draw the one published forecast. The
// source is said once, in the panel's intro, and in each card's "About
// this chart" and downloads.

import LsCard from "../LsCard";
import ViewToggle from "../../ViewToggle";
import SectionHeading from "../../SectionHeading";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH } from "../../../utils/livingStandards/baseline";
import { CHART_COLOURS } from "../../../utils/chartTheme";
import { pctLabel, percentAxis, toRows } from "../../../utils/livingStandards/forecast";
import { FORECAST_GROUPS, SERIES_NAMES, cardSentence, seriesName } from "../../../utils/livingStandards/forecastWords";
import { formatOneDp } from "../../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../../utils/chartCsv";
import { CSV_SOURCES, ForecastSource, forecastSourceText } from "../sources";

// CPI after housing costs and social rent are not OBR series
const NOT_OBR = {
  cpi_ahc: "CPI after housing costs is a PolicyEngine derivation from the OBR's CPI and rents forecast, not an OBR series.",
  social_rent: "The social rent cap is England's rent policy for social housing (CPI plus 1%), not an OBR forecast.",
};

// Notes on a series' years, said once in its card's "About this chart"
const SERIES_NOTES = {
  mortgage_interest:
    "The OBR stops forecasting mortgage interest after early 2030, so 2030 carries over policyengine-uk's November 2025 assumption.",
};

// Each line's colour and pattern: on one chart they differ in both
const LINE_STYLE = {
  cpi: { colour: CHART_COLOURS.gain },
  cpih: { colour: CHART_COLOURS.highlight, dash: DASH.long },
  cpi_ahc: { colour: CHART_COLOURS.marketIncome, dash: DASH.short },
  rpi: { colour: CHART_COLOURS.reference, dash: DASH.dashDot },
  earnings: { colour: CHART_COLOURS.gain },
  non_labour_income: { colour: CHART_COLOURS.marketIncome, dash: DASH.long },
  house_prices: { colour: CHART_COLOURS.highlight },
  rent: { colour: CHART_COLOURS.gain, dash: DASH.long },
  social_rent: { colour: CHART_COLOURS.marketIncome, dash: DASH.short },
  mortgage_interest: { colour: CHART_COLOURS.gain },
};
const FALLBACK_STYLES = [CHART_COLOURS.gain, CHART_COLOURS.highlight, CHART_COLOURS.marketIncome, CHART_COLOURS.reference];

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;

/** One row per year with each series' growth in percent, keyed by series key. */
function joinRows(seriesList) {
  const years = [...new Set(seriesList.flatMap((s) => (s.pre || []).map((p) => p.year)))].sort();
  const byKey = Object.fromEntries(
    seriesList.map((s) => [s.key, Object.fromEntries(toRows(s, false).map((r) => [r.year, r.previous]))]),
  );
  return years.map((year) => ({
    year,
    ...Object.fromEntries(seriesList.map((s) => [s.key, byKey[s.key][year] ?? null])),
  }));
}

/** The card's source, as plain text for the downloads. */
function cardSourceText(forecast, seriesList) {
  const obr = forecastSourceText(forecast);
  const other = seriesList.filter((s) => NOT_OBR[s.key]).map(seriesName);
  return other.length ? `${obr}; ${other.join(" and ")}: ${CSV_SOURCES.peDerived}` : obr;
}

function ForecastGroupCard({ card, seriesList, forecast, view, onViewChange }) {
  const rows = joinRows(seriesList);
  if (!rows.length) return null;
  const lines = seriesList.map((s, i) => ({
    key: s.key,
    name: seriesName(s),
    colour: LINE_STYLE[s.key]?.colour ?? FALLBACK_STYLES[i % FALLBACK_STYLES.length],
    dash: LINE_STYLE[s.key]?.dash,
  }));
  const sourceText = cardSourceText(forecast, seriesList);
  const period = `${rows[0].year} to ${rows[rows.length - 1].year}`;
  const sentence = cardSentence(
    card.id,
    Object.fromEntries(seriesList.map((s) => [s.key, rows.map((r) => ({ year: r.year, value: r[s.key] }))])),
  );
  const csv = () =>
    buildChartCsv({
      title: card.title,
      units: "Annual growth (%); calendar years",
      source: sourceText,
      columns: [{ key: "year", label: "Year" }, ...lines.map((l) => ({ key: l.key, label: l.name, decimals: 4 }))],
      rows,
      notes: [],
    });
  const common = {
    id: `forecast-${card.id}`,
    title: card.title,
    icon: card.icon,
    period,
    summary: sentence,
    about: forecast.basis ? `${forecast.basis}, in percent.` : undefined,
    notes: seriesList.flatMap((s) => [NOT_OBR[s.key], SERIES_NOTES[s.key]]),
    sourceText,
    source: (
      <>
        <ForecastSource forecast={forecast} />
        {seriesList.some((s) => NOT_OBR[s.key]) &&
          `; ${seriesList.filter((s) => NOT_OBR[s.key]).map(seriesName).join(" and ")}: ${CSV_SOURCES.peDerived}`}
      </>
    ),
    // Chart or table: one choice for every card, as icons in its header
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={card.title} />,
  };

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: `forecast-${card.id}`, image: false, csv }}>
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
                  <td>{row.year}</td>
                  {lines.map((l) => (
                    <td key={l.key}>{pctLabel(row[l.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LsCard>
    );
  }

  const values = rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null);
  const axis = percentAxis(values);
  return (
    <LsCard {...common} download={{ filename: `forecast-${card.id}`, legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xFormat={String}
        yFormat={pctTick}
        tooltipFormat={pctText}
        yLabel="Annual growth (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
        endLabels={lines.length > 1}
      />
    </LsCard>
  );
}

/** The cards a data section is drawn in: the configured ones, then one per series the config does not name. */
function cardsFor(section) {
  const group = FORECAST_GROUPS.find((g) => g.section === section.title);
  const byKey = Object.fromEntries(section.series.map((s) => [s.key, s]));
  const cards = (group?.cards ?? [])
    .map((card) => ({ card, seriesList: card.keys.map((k) => byKey[k]).filter(Boolean) }))
    .filter((c) => c.seriesList.length);
  const named = new Set((group?.cards ?? []).flatMap((c) => c.keys));
  section.series
    .filter((s) => !named.has(s.key))
    .forEach((s) => cards.push({ card: { id: s.key, title: SERIES_NAMES[s.key] ?? s.label, icon: group?.icon ?? "trend" }, seriesList: [s] }));
  return { group, cards };
}

/** One section per forecast group, under its heading: one card a row, or two side by side. */
export default function ForecastSeriesSection({ data, view, onViewChange }) {
  const forecast = data.forecast;
  return forecast.sections.map((section) => {
    const { group, cards } = cardsFor(section);
    return [
      <SectionHeading
        key={`${section.title}-heading`}
        icon={group?.icon ?? "trend"}
        title={group?.title ?? section.title}
        subtitle={group?.subtitle}
      />,
      <section key={section.title} className="report-section ls-section">
        <div className={cards.length > 1 ? "charts-grid" : "charts-grid forecast-single"}>
          {cards.map(({ card, seriesList }) => (
            <ForecastGroupCard
              key={card.id}
              card={card}
              seriesList={seriesList}
              forecast={forecast}
              view={view}
              onViewChange={onViewChange}
            />
          ))}
        </div>
      </section>,
    ];
  });
}
