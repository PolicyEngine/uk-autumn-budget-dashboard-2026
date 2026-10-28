// Frozen thresholds against pay: the personal allowance and the higher
// rate threshold under current law, relative to the OBR's average earnings
// (2026-27 = 100), and the trading allowance the Budget sets, relative to
// earnings from its first year.
// Drawn beside "Earnings and other income" (ForecastSeriesSection). The
// thresholds are the current-law values in policy_parameters.json's
// current_law block (the engine's parameters) and its trading allowance
// measure, earnings the OBR October 2026
// growth the runs use; the index is computed in frozenThresholds.js.

import { useEffect, useState } from "react";
import LsCard from "./LsCard";
import ViewToggle from "../ViewToggle";
import SeriesToggle from "../SeriesToggle";
import { LsLineChart, lineLegendItems } from "./LsCharts";
import { CHART_COLOURS, SERIES_COLOURS, useNarrowViewport } from "../../utils/chartTheme";
import { DASH } from "../../utils/livingStandards/baseline";
import { fyLabel, formatOneDp } from "../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../utils/chartCsv";
import { loadPolicyParameters } from "../../utils/policyParameters";
import { SOURCES } from "../../utils/sources";
import { METHOD_ANCHORS } from "../methodology/anchors";
import {
  BASE_YEAR,
  TRADING,
  relativeAxis,
  sameThresholds,
  thresholdRows,
  thresholdsSentence,
  tradingAllowance,
} from "../../utils/livingStandards/frozenThresholds";

export const FROZEN_THRESHOLDS_TITLE = "Frozen thresholds against pay";

// Each threshold relative to average earnings. While the personal
// allowance and higher rate threshold move together (both frozen) one line
// draws both (sameThresholds); the trading allowance has its own, from
// its first year. Average earnings is the
// flat dashed reference at 100: keeping pace with pay. The two income tax
// thresholds lie almost on one another once they part (2031-32), so the
// personal allowance is a wide teal band and the higher rate threshold a
// thin dark blue dash drawn on top of it: both stay visible. The trading
// allowance takes the amber chart token, apart from the blues and teals.
const PA = {
  key: "personal_allowance",
  name: "Personal allowance",
  short: "Allowance",
  colour: SERIES_COLOURS[0],
  width: 5,
  meaning: "The income on which no income tax is paid.",
};
const HR = {
  key: "higher_rate",
  name: "Higher rate threshold",
  short: "Higher rate",
  colour: SERIES_COLOURS[1],
  dash: DASH.short,
  width: 2,
  meaning: "The income above which income tax is paid at the higher rate (the personal allowance plus the basic rate band).",
};
const BOTH = { ...PA, width: undefined, name: "Personal allowance and higher rate threshold", short: "Income tax" };
const TA = {
  key: TRADING.key,
  name: "Trading allowance",
  short: "Trading",
  colour: CHART_COLOURS.loss,
  meaning:
    "Trading income up to this amount a year is free of income tax and Class 4 National Insurance. The line is the level the Budget sets, held in cash, from the year it takes effect.",
};
const PAY = {
  key: "pay",
  name: "Keeps pace with pay",
  short: "Pay",
  colour: CHART_COLOURS.reference,
  dash: DASH.long,
  meaning: "A threshold that rises with the OBR's forecast of average earnings (wages and salaries per employee) stays at 100.",
};
/**
 * The lines to draw: one for both income tax thresholds while they are
 * equal, else one each; the trading allowance when its measure is in the
 * file.
 */
const linesFor = (rows) => [
  ...(sameThresholds(rows) ? [BOTH] : [PA, HR]),
  ...(rows.some((r) => r[TA.key] != null) ? [TA] : []),
  PAY,
];

const indexText = (v) => (v == null ? "–" : formatOneDp(v));
const indexTick = (v) => String(v);

/** The current-law parameters file, once per page; null while loading or if absent. */
function usePolicyParameters() {
  const [state, setState] = useState({ loading: true, document: null });
  useEffect(() => {
    let live = true;
    loadPolicyParameters().then((document) => {
      if (live) setState({ loading: false, document });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export default function FrozenThresholdsCard({ view = "chart", onViewChange }) {
  const { loading, document } = usePolicyParameters();
  const narrow = useNarrowViewport();
  const [hidden, setHidden] = useState([]);
  const [hovered, setHovered] = useState(null);
  const base = { id: "forecast-frozen-thresholds", title: FROZEN_THRESHOLDS_TITLE, icon: "briefcase" };
  const rows = document && thresholdRows(document)?.map((r) => ({ ...r, pay: 100 }));

  if (!rows) {
    // The card holds its place in the pair while the file loads
    return (
      <LsCard {...base}>
        <div className="chart-plot">
          <p className="view-status">{loading ? "Loading thresholds…" : "The threshold values are not available."}</p>
        </div>
      </LsCard>
    );
  }

  const end = rows.at(-1).year;
  const period = `${fyLabel(BASE_YEAR)} to ${fyLabel(end)}`;
  // Earnings growth comes from the detailed forecast tables, Table 1.6
  const obr = SOURCES.obr_efo_october_2026_tables;
  const obrName = obr.label;
  const engine = document.engine?.policyengine_uk;
  const trading = tradingAllowance(document);
  const sourceText = `${obrName}, Table 1.6: average earnings growth; policyengine-uk${engine ? ` ${engine}` : ""} parameters (current law${trading ? "; the trading allowance as the Budget sets it" : ""}); indexed by PolicyEngine`;
  const lineSet = linesFor(rows);
  const shown = lineSet.map((l) => l.key).filter((k) => !hidden.includes(k));
  const setShown = (keys) => setHidden(lineSet.map((l) => l.key).filter((k) => !keys.includes(k)));
  const lines = lineSet.filter((l) => shown.includes(l.key));
  // Drawn in reverse, so the income tax lines lie on top, the higher rate
  // threshold's dash last of all, over the personal allowance's band (and
  // the tooltip lists the lines top to bottom, as they end)
  const drawn = [...lines].reverse().sort((a, b) => (a.key === HR.key) - (b.key === HR.key));
  const earningsColumn = { key: "earnings", label: `Average earnings (index, ${fyLabel(BASE_YEAR)} = 100)` };
  const thresholdLines = lineSet.filter((l) => l.key !== "pay");

  const csv = () =>
    buildChartCsv({
      title: FROZEN_THRESHOLDS_TITLE,
      units: `Thresholds: value relative to average earnings, ${fyLabel(BASE_YEAR)} = 100; average earnings: index, ${fyLabel(BASE_YEAR)} = 100; fiscal years`,
      source: sourceText,
      columns: [
        { key: "year", label: "Year" },
        { ...earningsColumn, decimals: 2 },
        ...thresholdLines.map((l) => ({ key: l.key, label: `${l.name} (relative to average earnings)`, decimals: 2 })),
      ],
      rows: rows.map((r) => ({ ...r, year: fyLabel(r.year) })),
      notes: [],
    });

  const common = {
    ...base,
    period,
    summary: thresholdsSentence(rows, trading),
    about: `Each threshold's value relative to average earnings, ${fyLabel(BASE_YEAR)} = 100${trading ? ` (the trading allowance from ${fyLabel(trading.start)} = 100)` : ""}.`,
    sourceText,
    info: {
      shows: (
        <>
          The personal allowance and the higher rate threshold under current law, each relative to average earnings with{" "}
          {fyLabel(BASE_YEAR)} = 100
          {trading && (
            <>
              , and the trading allowance at the level the Budget sets, relative to average earnings with its first
              year, {fyLabel(trading.start)}, = 100
            </>
          )}
          . A threshold that keeps pace with pay stays at 100; one that falls below it takes a larger share of income
          into tax.
        </>
      ),
      how: [
        "Each income tax threshold's current-law value for a year divided by its 2026-27 value, times 100; the values are policyengine-uk's parameters at 6 April of each year.",
        ...(trading
          ? [
              `The trading allowance starts in ${fyLabel(trading.start)}, the year the Budget's new level takes effect, rather than in ${fyLabel(BASE_YEAR)}: indexed to ${fyLabel(BASE_YEAR)} its rise would dwarf the rest of the chart. Its value and average earnings are both indexed to ${fyLabel(trading.start)} = 100, so the line shows how far the cash level falls behind pay from then.`,
            ]
          : []),
        "Earnings: the OBR gives growth in each calendar year's average. As the baseline does, a fiscal year takes the growth of the calendar year it starts in (2027-28 grows on 2026-27 by 2027's rate), chained from 2026-27 = 100.",
        "Each threshold's index divided by the earnings index, times 100, is its value relative to average earnings: 100 while it keeps pace with pay, below 100 when it falls behind. A frozen threshold in a year when the earnings index is 110 is at 100 / 110 × 100 = 90.9.",
        "Where the personal allowance and higher rate threshold have the same value relative to earnings in every year, one line draws both.",
      ],
      definitions: [PA, HR, ...(trading ? [TA] : []), PAY].map((l) => ({ term: l.name, meaning: l.meaning })),
      caveats: [
        `The OBR's October 2026 earnings forecast ends in ${end}, so the chart ends in ${fyLabel(end)}.`,
        "Taking a calendar year's growth for the fiscal year starting in it is an approximation: the fiscal year runs from April to March.",
      ],
      sources: [
        { label: `${obrName}, Table 1.6: average earnings growth (calendar years)`, href: obr.url },
        {
          label: `policyengine-uk${engine ? ` ${engine}` : ""} parameters`,
          // The parameters at the release the outlook was built with (tags are
          // the bare version); the main branch when it is not recorded
          href: engine
            ? `https://github.com/PolicyEngine/policyengine-uk/tree/${engine}/policyengine_uk/parameters`
            : SOURCES.policyengine_uk_parameters.url,
          note: "gov.hmrc.income_tax.allowances.personal_allowance.amount, gov.hmrc.income_tax.rates.uk[1].threshold, gov.hmrc.income_tax.allowances.trading_allowance (as the Budget sets it)",
        },
      ],
      method: { anchor: METHOD_ANCHORS.forecastFeed, label: "How the forecast feeds the baseline" },
    },
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={FROZEN_THRESHOLDS_TITLE} />,
  };

  const chips = (
    <SeriesToggle
      series={lineSet.map((l) => ({ key: l.key, label: l.name, short: l.short, colour: l.colour, dash: l.dash }))}
      shown={shown}
      onChange={setShown}
      onHover={setHovered}
      label="Lines"
      narrow={narrow}
    />
  );

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: "frozen-thresholds", csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Average earnings (index)</th>
                {thresholdLines
                  .filter((l) => shown.includes(l.key))
                  .map((l) => (
                    <th key={l.key}>{l.name}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td className="ls-nowrap">{fyLabel(row.year)}</td>
                  <td>{indexText(row.earnings)}</td>
                  {thresholdLines
                    .filter((l) => shown.includes(l.key))
                    .map((l) => (
                      <td key={l.key}>{indexText(row[l.key])}</td>
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

  const axis = relativeAxis(rows.flatMap((r) => lines.map((l) => r[l.key])));
  return (
    <LsCard {...common} download={{ filename: "frozen-thresholds", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={drawn}
        baseYear={BASE_YEAR}
        yFormat={indexTick}
        tooltipFormat={indexText}
        yLabel={`Value relative to average earnings (${fyLabel(BASE_YEAR)} = 100)`}
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
