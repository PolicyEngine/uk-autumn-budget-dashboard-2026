// The forecast series by group (prices, pay and other income, housing),
// as comparable charts or tables: one card per group of series on a shared
// axis (forecastWords.FORECAST_GROUPS), each line named at its end, with
// one plain sentence leading with the finding. Once a later OBR forecast
// is loaded (forecast.post_published), each series it carries is drawn
// twice, the earlier forecast (pre, March 2026) faded and the later one
// (post, October 2026) full, with a second row of chips to show either; a
// series the later source lacks (post null) keeps its one line and says so.
// The source is said once, in the panel's intro, and in each card's "About
// this chart" and downloads.

import LsCard from "../LsCard";
import { useState } from "react";
import ViewToggle from "../../ViewToggle";
import SeriesToggle from "../../SeriesToggle";
import ControlBar from "../../ControlBar";
import { forecastsOption } from "../controlOptions";
import { useNarrowViewport } from "../../../utils/chartTheme";
import SectionHeading from "../../SectionHeading";
import { LsLineChart, lineLegendItems } from "../LsCharts";
import { DASH } from "../../../utils/livingStandards/baseline";
import { CHART_COLOURS, SERIES_COLOURS } from "../../../utils/chartTheme";
import { forecastChip, hasPost, pctLabel, percentAxis, toRows } from "../../../utils/livingStandards/forecast";
import { FORECAST_GROUPS, SERIES_NAMES, cardSentence, seriesName } from "../../../utils/livingStandards/forecastWords";
import { formatOneDp } from "../../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../../utils/chartCsv";
import { CSV_SOURCES, ForecastSource, forecastSourceText, forecastSources } from "../sources";
import { METHOD_ANCHORS } from "../../methodology/anchors";
import ObrPriceCategoriesCard from "../ObrPriceCategoriesCard";
import FrozenThresholdsCard from "../FrozenThresholdsCard";

// A section's extra card, drawn beside its forecast card in the shared pair
// (keyed by the forecast section's title): the OBR's prices by spending
// category beside the inflation measures, and the frozen thresholds beside
// earnings and other income
const HISTORY_CARDS = {
  "Inflation and price indices": ObrPriceCategoriesCard,
  "Income and earnings": FrozenThresholdsCard,
};

// CPI after housing costs and social rent are not OBR series
const NOT_OBR = {
  cpi_ahc: "CPI after housing costs is a PolicyEngine derivation from the OBR's CPI and rents forecast, not an OBR series.",
  social_rent: "The social rent cap is England's rent policy for social housing (CPI plus 1%), not an OBR forecast.",
};

// What each inflation measure is, one line each, first in its card's
// "About this chart" (the derivation caveat stays in NOT_OBR)
const MEASURES = {
  cpi: "Price rises across a typical basket; the Bank of England's 2% target.",
  cpih: "CPI plus owner-occupiers' housing costs and Council Tax.",
  cpi_ahc: "CPI without housing costs; used to adjust incomes after housing costs.",
  rpi: "Older measure including mortgage interest; still used for some charges such as fuel duty.",
};

// Notes on a series' years, said once in its card's "About this chart"
const SERIES_NOTES = {
  mortgage_interest:
    "The OBR stops forecasting mortgage interest after early 2030, so 2030 carries over policyengine-uk's November 2025 assumption.",
};

// Each line's colour and pattern: on one chart they differ in both
const LINE_STYLE = {
  cpi: { colour: SERIES_COLOURS[0] },
  cpih: { colour: SERIES_COLOURS[3], dash: DASH.long },
  cpi_ahc: { colour: SERIES_COLOURS[1], dash: DASH.short },
  rpi: { colour: CHART_COLOURS.reference, dash: DASH.dashDot },
  earnings: { colour: SERIES_COLOURS[0] },
  non_labour_income: { colour: SERIES_COLOURS[1], dash: DASH.long },
  house_prices: { colour: SERIES_COLOURS[3] },
  rent: { colour: SERIES_COLOURS[0], dash: DASH.long },
  social_rent: { colour: SERIES_COLOURS[1], dash: DASH.short },
  mortgage_interest: { colour: SERIES_COLOURS[0] },
};
const FALLBACK_STYLES = [SERIES_COLOURS[0], SERIES_COLOURS[3], SERIES_COLOURS[1], CHART_COLOURS.reference];

// Chip labels on a phone, for the long names
const SHORT_NAMES = { cpi_ahc: "CPI after housing", non_labour_income: "Non-labour", social_rent: "Social rent" };

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;

// The later forecast's line for a series: its key in the joined rows
const POST_SUFFIX = "__post";
const postKey = (key) => `${key}${POST_SUFFIX}`;
// The earlier forecast's lines, faded, beside the later one's
const PRE_OPACITY = 0.4;

/**
 * One row per year with each series' growth in percent, keyed by series key,
 * and with the later forecast as `<key>__post` for each series in `withPost`.
 */
function joinRows(seriesList, withPost = []) {
  const years = [...new Set(seriesList.flatMap((s) => (s.pre || []).map((p) => p.year)))].sort();
  const rowsOf = (s) => Object.fromEntries(toRows(s, true).map((r) => [r.year, r]));
  const byKey = Object.fromEntries(seriesList.map((s) => [s.key, rowsOf(s)]));
  return years.map((year) => ({
    year,
    ...Object.fromEntries(seriesList.map((s) => [s.key, byKey[s.key][year]?.previous ?? null])),
    ...Object.fromEntries(withPost.map((s) => [postKey(s.key), byKey[s.key][year]?.updated ?? null])),
  }));
}

/** The card's source, as plain text for the downloads. */
function cardSourceText(forecast, seriesList) {
  const obr = forecastSourceText(forecast);
  const other = seriesList.filter((s) => NOT_OBR[s.key]).map(seriesName);
  return other.length ? `${obr}; ${other.join(" and ")}: ${CSV_SOURCES.peDerived}` : obr;
}

// A forecast card's x axis title and its year basis in "About this chart",
// where it sits beside the OBR prices by spending category, by financial year
const CALENDAR_YEAR = { term: "Calendar year", meaning: "January to December, as the OBR publishes these measures; the spending categories beside them are by financial year." };

function ForecastGroupCard({ card, seriesList, forecast, view, onViewChange, yearBasis = false }) {
  const narrow = useNarrowViewport();
  // The series shown (chips, at least one on) and the one a chip's hover brings forward
  const [shown, setShown] = useState(() => seriesList.map((s) => s.key));
  // With a later forecast: which forecasts are drawn (the card's Options
  // pill: both, the earlier or the later)
  const [forecastsShown, setForecastsShown] = useState(["pre", "post"]);
  const [hovered, setHovered] = useState(null);
  const withPost = seriesList.filter((s) => hasPost(forecast, s));
  const both = withPost.length > 0;
  const rows = joinRows(seriesList, withPost);
  if (!rows.length) return null;
  const preName = forecastChip(forecast.pre_label);
  const postName = forecastChip(forecast.post_label);
  const styleOf = (s, i) => ({
    colour: LINE_STYLE[s.key]?.colour ?? FALLBACK_STYLES[i % FALLBACK_STYLES.length],
    dash: LINE_STYLE[s.key]?.dash,
  });
  // One line per series, or, with a later forecast, the earlier one (faded)
  // and the later one for each series that has it; `series` is the chip it
  // belongs to and `forecast` the forecast chip
  const allLines = seriesList.flatMap((s, i) => {
    const style = styleOf(s, i);
    const has = withPost.includes(s);
    const pre = {
      key: s.key,
      series: s.key,
      forecast: "pre",
      name: both ? `${seriesName(s)}, ${preName}` : seriesName(s),
      ...style,
      ...(has ? { opacity: PRE_OPACITY, width: 2 } : {}),
    };
    if (!has) return [pre];
    return [pre, { key: postKey(s.key), series: s.key, forecast: "post", group: s.key, name: `${seriesName(s)}, ${postName}`, ...style }];
  });
  // A series with only the earlier forecast keeps its line whatever the
  // forecast chips say: it is the only one it has
  const drawn = (l) =>
    l.forecast === "post" ? forecastsShown.includes("post") : !withPost.some((s) => s.key === l.series) || forecastsShown.includes("pre");
  const lines = allLines.filter((l) => shown.includes(l.series) && drawn(l));
  const sourceText = cardSourceText(forecast, seriesList);
  const period = `${rows[0].year} to ${rows[rows.length - 1].year}`;
  // The sentence reads the latest forecast each series has
  const sentence = cardSentence(
    card.id,
    Object.fromEntries(
      seriesList.map((s) => [
        s.key,
        rows.map((r) => ({ year: r.year, value: withPost.includes(s) ? r[postKey(s.key)] : r[s.key] })),
      ]),
    ),
  );
  // A series the later forecast does not carry yet, said once
  const notYet =
    forecast.post_published && seriesList.some((s) => !withPost.includes(s))
      ? `${seriesList
          .filter((s) => !withPost.includes(s))
          .map(seriesName)
          .join(", ")}: not in the ${postName}'s summary table yet; it follows with the OBR's detailed forecast tables, so only the ${preName} is shown.`
      : null;
  const csv = () =>
    buildChartCsv({
      title: card.title,
      units: "Annual growth (%); calendar years",
      source: sourceText,
      columns: [{ key: "year", label: "Year" }, ...allLines.map((l) => ({ key: l.key, label: l.name, decimals: 4 }))],
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
    notes: [...seriesList.flatMap((s) => [NOT_OBR[s.key], SERIES_NOTES[s.key]]), notYet],
    sourceText,
    source: (
      <>
        <ForecastSource forecast={forecast} />
        {seriesList.some((s) => NOT_OBR[s.key]) &&
          `; ${seriesList.filter((s) => NOT_OBR[s.key]).map(seriesName).join(" and ")}: ${CSV_SOURCES.peDerived}`}
      </>
    ),
    info: {
      definitions: [
        ...seriesList.filter((s) => MEASURES[s.key]).map((s) => ({ term: seriesName(s), meaning: MEASURES[s.key] })),
        yearBasis && CALENDAR_YEAR,
      ].filter(Boolean),
      caveats: [...seriesList.flatMap((s) => [NOT_OBR[s.key], SERIES_NOTES[s.key]]), notYet].filter(Boolean),
      sources: [
        ...forecastSources(forecast),
        seriesList.some((s) => NOT_OBR[s.key]) && {
          label: CSV_SOURCES.peDerived,
          note: seriesList.filter((s) => NOT_OBR[s.key]).map(seriesName).join(" and "),
        },
      ],
      method: { anchor: METHOD_ANCHORS.forecastFeed, label: "How the forecast feeds the baseline" },
    },
    // Chart or table: one choice for every card, as icons in its header
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={card.title} />,
    // With a later forecast, which forecasts are drawn: the Options pill
    // the other tabs' cards have (ControlBar), its face naming the choice
    controls: both && <ControlBar name={card.title} options={[forecastsOption(forecastsShown, setForecastsShown, preName, postName)]} />,
  };
  // One chip per line, in its colour: the card's key, under the plot (as
  // every chart's key), so no legend repeats the names. A card of one line
  // needs none: its title names it.
  const seriesChips = seriesList.length > 1 && (
    <SeriesToggle
      series={seriesList.map((s, i) => ({ key: s.key, label: seriesName(s), short: SHORT_NAMES[s.key], ...styleOf(s, i) }))}
      shown={shown}
      onChange={setShown}
      onHover={setHovered}
      label="Lines"
      narrow={narrow}
    />
  );
  const chips = seriesChips;

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: `forecast-${card.id}`, csv }}>
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
        {chips && <div className="chart-legend">{chips}</div>}
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
        xLabel={yearBasis ? CALENDAR_YEAR.term : undefined}
        yLabel="Annual growth (%)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
        legend={false}
        focusKey={hovered}
        keyContent={chips || null}
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

/**
 * One section per forecast group, under its heading: one card a row, or two
 * side by side, with a section's extra card (HISTORY_CARDS) beside its own.
 */
export default function ForecastSeriesSection({ data, view, onViewChange }) {
  const forecast = data.forecast;
  return forecast.sections.map((section) => {
    const { group, cards } = cardsFor(section);
    const History = HISTORY_CARDS[section.title];
    const count = cards.length + (History ? 1 : 0);
    return [
      <SectionHeading
        key={`${section.title}-heading`}
        icon={group?.icon ?? "trend"}
        title={group?.title ?? section.title}
        subtitle={group?.subtitle}
      />,
      <section key={section.title} className="report-section ls-section">
        <div className={count > 1 ? "charts-grid" : "charts-grid forecast-single"}>
          {cards.map(({ card, seriesList }) => (
            <ForecastGroupCard
              key={card.id}
              card={card}
              seriesList={seriesList}
              forecast={forecast}
              view={view}
              onViewChange={onViewChange}
              yearBasis={History === ObrPriceCategoriesCard}
            />
          ))}
          {History && <History data={data} view={view} onViewChange={onViewChange} />}
        </div>
      </section>,
    ];
  });
}
