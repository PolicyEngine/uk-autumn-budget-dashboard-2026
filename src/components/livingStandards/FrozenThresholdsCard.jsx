// Frozen thresholds against pay: the personal allowance, the higher rate
// threshold and the Plan 2 student loan repayment threshold under current
// law, against the OBR's average earnings, each indexed to 2026-27 = 100.
// Drawn beside "Earnings and other income" (ForecastSeriesSection). The
// thresholds are the current-law values the Policies tab reads
// (public/data/policy_parameters.json), earnings the outlook file's OBR
// March 2026 growth; the index is computed in frozenThresholds.js. The
// pound values are not repeated here: Policies lists them.

import { useEffect, useState } from "react";
import LsCard from "./LsCard";
import ViewToggle from "../ViewToggle";
import SeriesToggle from "../SeriesToggle";
import { LsLineChart, lineLegendItems } from "./LsCharts";
import { CHART_COLOURS, useNarrowViewport } from "../../utils/chartTheme";
import { DASH } from "../../utils/livingStandards/baseline";
import { fyLabel, formatOneDp } from "../../utils/livingStandards/outlook";
import { buildChartCsv } from "../../utils/chartCsv";
import { loadPolicyParameters } from "../../utils/policyParameters";
import { OPEN_VIEW_EVENT } from "../../utils/methodLink";
import { SOURCES } from "../../utils/sources";
import { METHOD_ANCHORS } from "../methodology/anchors";
import { BASE_YEAR, indexAxis, thresholdRows, thresholdsSentence } from "../../utils/livingStandards/frozenThresholds";

export const FROZEN_THRESHOLDS_TITLE = "Frozen thresholds against pay";

// Each line, in drawing order. The thresholds are solid lines in their own
// hues; while frozen they lie on one another at 100, so each is drawn a
// little narrower than the one under it and all three show as nested
// stripes. Earnings, the comparison, is the dashed neutral reference line.
const LINES = [
  {
    key: "personal_allowance",
    name: "Personal allowance",
    short: "Allowance",
    colour: CHART_COLOURS.gain,
    width: 11,
    meaning: "The income on which no income tax is paid.",
  },
  {
    key: "higher_rate",
    name: "Higher rate threshold",
    short: "Higher rate",
    colour: CHART_COLOURS.marketIncome,
    width: 5,
    meaning: "The income above which income tax is paid at the higher rate (the personal allowance plus the basic rate band).",
  },
  {
    key: "plan_2",
    name: "Plan 2 student loan threshold",
    short: "Plan 2",
    colour: CHART_COLOURS.ageOlder,
    width: 2.5,
    meaning: "The income above which Plan 2 student loan repayments are made (9% of income over it).",
  },
  {
    key: "earnings",
    name: "Average earnings",
    short: "Earnings",
    colour: CHART_COLOURS.reference,
    dash: DASH.long,
    meaning: "The OBR's forecast of average earnings (wages and salaries per employee).",
  },
];
// End labels in a half-width card: short names in a narrow right margin
const END_LABELS = { width: 92, minWidth: 420 };

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

/** A link to the Policies view: a real link, switched in place on a plain click. */
function PoliciesLink() {
  return (
    <a
      href="?tab=policies"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: { tab: "policies" } }));
      }}
    >
      Policies
    </a>
  );
}

export default function FrozenThresholdsCard({ data, view = "chart", onViewChange }) {
  const { loading, document } = usePolicyParameters();
  const narrow = useNarrowViewport();
  const [shown, setShown] = useState(() => LINES.map((l) => l.key));
  const [hovered, setHovered] = useState(null);
  const base = { id: "forecast-frozen-thresholds", title: FROZEN_THRESHOLDS_TITLE, icon: "briefcase" };
  const rows = document && thresholdRows(document, data);

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
  const lines = LINES.filter((l) => shown.includes(l.key)).map((l) => ({ ...l, endLabel: l.short }));

  const csv = () =>
    buildChartCsv({
      title: FROZEN_THRESHOLDS_TITLE,
      units: `Index, ${fyLabel(BASE_YEAR)} = 100; fiscal years`,
      source: sourceText,
      columns: [{ key: "year", label: "Year" }, ...LINES.map((l) => ({ key: l.key, label: l.name, decimals: 2 }))],
      rows: rows.map((r) => ({ ...r, year: fyLabel(r.year) })),
      notes: [],
    });

  const common = {
    ...base,
    period,
    summary: thresholdsSentence(rows),
    about: `Each line indexed to ${fyLabel(BASE_YEAR)} = 100, under current law.`,
    sourceText,
    info: {
      shows: (
        <>
          How the personal allowance, the higher rate threshold and the Plan 2 student loan repayment threshold move under
          current law against average earnings, each as an index with {fyLabel(BASE_YEAR)} = 100. A threshold that stays
          flat while earnings rise takes a larger share of income into tax or repayments. The pound values are on{" "}
          <PoliciesLink />.
        </>
      ),
      how: [
        "Each threshold's current-law value for a year divided by its 2026-27 value, times 100; the values are policyengine-uk's parameters at 6 April of each year.",
        "Earnings: the OBR gives growth in each calendar year's average. As the baseline does, a fiscal year takes the growth of the calendar year it starts in (2027-28 grows on 2026-27 by 2027's rate), chained from 2026-27 = 100.",
      ],
      definitions: LINES.map((l) => ({ term: l.name, meaning: l.meaning })),
      caveats: [
        `The OBR's March 2026 earnings forecast ends in 2030, so the chart ends in ${fyLabel(end)}; 2031-32, when current law uprates the thresholds again and a candidate measure would freeze them for one more year, is not shown.`,
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
      series={LINES.map((l) => ({ key: l.key, label: l.name, short: l.short, colour: l.colour, dash: l.dash }))}
      shown={shown}
      onChange={setShown}
      onHover={setHovered}
      label="Lines"
      narrow={narrow}
    />
  );

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: "frozen-thresholds", image: false, csv }}>
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

  const axis = indexAxis(rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null));
  return (
    <LsCard {...common} download={{ filename: "frozen-thresholds", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        baseYear={BASE_YEAR}
        yFormat={indexTick}
        tooltipFormat={indexText}
        yLabel={`Index, ${fyLabel(BASE_YEAR)} = 100`}
        yDomain={axis.domain}
        yTicks={axis.ticks}
        endLabels={END_LABELS}
        legend={false}
        focusKey={hovered}
        onLineHover={setHovered}
        keyContent={chips}
      />
    </LsCard>
  );
}
