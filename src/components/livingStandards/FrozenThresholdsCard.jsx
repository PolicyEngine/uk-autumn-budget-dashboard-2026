// Frozen thresholds against pay: the personal allowance, the higher rate
// threshold and the Plan 2 student loan repayment threshold under current
// law, each relative to the OBR's average earnings (2026-27 = 100).
// Drawn beside "Earnings and other income" (ForecastSeriesSection). The
// thresholds are the current-law values in policy_parameters.json's
// current_law block (the engine's parameters), earnings the outlook file's OBR
// March 2026 growth; the index is computed in frozenThresholds.js.

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
import { BASE_YEAR, relativeAxis, sameThresholds, thresholdRows, thresholdsSentence } from "../../utils/livingStandards/frozenThresholds";

export const FROZEN_THRESHOLDS_TITLE = "Frozen thresholds against pay";

// Each threshold relative to average earnings. While the personal
// allowance and higher rate threshold move together (both frozen) one line
// draws both (sameThresholds); Plan 2 has its own. Average earnings is the
// flat dashed reference at 100: keeping pace with pay.
const PA = {
  key: "personal_allowance",
  name: "Personal allowance",
  short: "Allowance",
  colour: SERIES_COLOURS[0],
  meaning: "The income on which no income tax is paid.",
};
const HR = {
  key: "higher_rate",
  name: "Higher rate threshold",
  short: "Higher rate",
  colour: SERIES_COLOURS[2],
  meaning: "The income above which income tax is paid at the higher rate (the personal allowance plus the basic rate band).",
};
const BOTH = { ...PA, name: "Personal allowance and higher rate threshold", short: "Income tax" };
const PLAN_2 = {
  key: "plan_2",
  name: "Plan 2 student loan threshold",
  short: "Plan 2",
  colour: SERIES_COLOURS[1],
  meaning: "The income above which Plan 2 student loan repayments are made (9% of income over it).",
};
const PAY = {
  key: "pay",
  name: "Keeps pace with pay",
  short: "Pay",
  colour: CHART_COLOURS.reference,
  dash: DASH.long,
  meaning: "A threshold that rises with the OBR's forecast of average earnings (wages and salaries per employee) stays at 100.",
};
/** The lines to draw: one for both income tax thresholds while they are equal, else one each. */
const linesFor = (rows) => (sameThresholds(rows) ? [BOTH, PLAN_2, PAY] : [PA, HR, PLAN_2, PAY]);

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

export default function FrozenThresholdsCard({ data, view = "chart", onViewChange }) {
  const { loading, document } = usePolicyParameters();
  const narrow = useNarrowViewport();
  const [hidden, setHidden] = useState([]);
  const [hovered, setHovered] = useState(null);
  const base = { id: "forecast-frozen-thresholds", title: FROZEN_THRESHOLDS_TITLE, icon: "briefcase" };
  const rows = document && thresholdRows(document, data)?.map((r) => ({ ...r, pay: 100 }));

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
  const preSource = data?.forecast?.pre_source;
  const obrName = preSource?.release ?? "OBR, Economic and fiscal outlook (March 2026)";
  const engine = document.engine?.policyengine_uk;
  const sourceText = `${obrName}: average earnings growth; policyengine-uk${engine ? ` ${engine}` : ""} parameters (current law); indexed by PolicyEngine`;
  const lineSet = linesFor(rows);
  const shown = lineSet.map((l) => l.key).filter((k) => !hidden.includes(k));
  const setShown = (keys) => setHidden(lineSet.map((l) => l.key).filter((k) => !keys.includes(k)));
  const lines = lineSet.filter((l) => shown.includes(l.key));
  // Drawn in reverse: Plan 2 is frozen too until it is uprated, so it lies
  // under the income tax line until it parts from it (and the tooltip lists
  // the lines top to bottom, as they end)
  const drawn = [...lines].reverse();
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
    summary: thresholdsSentence(rows),
    about: `Each threshold's value relative to average earnings, ${fyLabel(BASE_YEAR)} = 100, under current law.`,
    sourceText,
    info: {
      shows: (
        <>
          The personal allowance, the higher rate threshold and the Plan 2 student loan repayment threshold under current
          law, each relative to average earnings with {fyLabel(BASE_YEAR)} = 100. A threshold that keeps pace with pay
          stays at 100; one that falls below it takes a larger share of income into tax or repayments.
        </>
      ),
      how: [
        "Each threshold's current-law value for a year divided by its 2026-27 value, times 100; the values are policyengine-uk's parameters at 6 April of each year.",
        "Earnings: the OBR gives growth in each calendar year's average. As the baseline does, a fiscal year takes the growth of the calendar year it starts in (2027-28 grows on 2026-27 by 2027's rate), chained from 2026-27 = 100.",
        "Each threshold's index divided by the earnings index, times 100, is its value relative to average earnings: 100 while it keeps pace with pay, below 100 when it falls behind. A frozen threshold in a year when the earnings index is 110 is at 100 / 110 × 100 = 90.9.",
        "Where the personal allowance and higher rate threshold have the same value relative to earnings in every year, one line draws both.",
      ],
      definitions: [PA, HR, PLAN_2, PAY].map((l) => ({ term: l.name, meaning: l.meaning })),
      caveats: [
        `The OBR's March 2026 earnings forecast ends in 2030, so the chart ends in ${fyLabel(end)}; 2031-32, when current law uprates the thresholds again, is not shown.`,
        "Taking a calendar year's growth for the fiscal year starting in it is an approximation: the fiscal year runs from April to March.",
        "The earnings forecast is the OBR's from before the Autumn Budget.",
      ],
      sources: [
        { label: `${obrName}: average earnings growth (calendar years)`, href: preSource?.url },
        {
          label: `policyengine-uk${engine ? ` ${engine}` : ""} parameters`,
          href: SOURCES.policyengine_uk_parameters.url,
          note: "gov.hmrc.income_tax.allowances.personal_allowance.amount, gov.hmrc.income_tax.rates.uk[1].threshold, gov.hmrc.student_loans.thresholds.plan_2",
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
