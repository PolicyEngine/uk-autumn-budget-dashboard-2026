// Pay growth: public and private sector. ONS average weekly earnings,
// regular pay, year-on-year growth of the three-month average, for the
// public sector, the private sector and the whole economy (the reference
// line). History up to the latest ONS release, drawn beside the OBR's
// earnings forecast (ForecastSeriesSection). The data are
// public/data/pay_growth_sectors.json (tools/fetch-ons-pay-growth.mjs),
// loaded in paySectors.js.

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
import { monthLabel, monthShort, monthYear, yearTicks } from "../../utils/livingStandards/priceCategories";
import { growthRows, loadPaySectors, paySectorsSentence } from "../../utils/livingStandards/paySectors";

export const PAY_SECTORS_TITLE = "Pay growth: public and private sector";

// The ONS bulletin whose note on public-sector pay awards the caveats cite
export const AWE_BULLETIN = {
  label: "ONS, Average weekly earnings in Great Britain: October 2026",
  href: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/bulletins/averageweeklyearningsingreatbritain/october2026",
  date: "20 October 2026",
};

// Each line: its name, chip name on a phone, colour and pattern. As on the
// prices card, each sector is a solid line in its own hue and the benchmark
// (the whole economy) a dashed neutral grey.
const LINES = {
  public: { name: "Public sector", short: "Public", colour: CHART_COLOURS.highlight },
  private: { name: "Private sector", short: "Private", colour: CHART_COLOURS.marketIncome },
  whole: { name: "Whole economy", short: "Whole", colour: CHART_COLOURS.reference, dash: DASH.long },
};
const ORDER = ["public", "private", "whole"];

const pctTick = (v) => `${formatOneDp(v).replace(/\.0$/, "")}%`;
const pctText = (v) => `${formatOneDp(v)}%`;
const ukDay = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : undefined;

/** The file as { loading, data, error, unavailable }, loaded once per page. */
function usePaySectors() {
  const [state, setState] = useState({ loading: true, data: null, error: null, unavailable: false });
  useEffect(() => {
    let live = true;
    loadPaySectors().then((r) => {
      if (live) setState({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The source line for the downloads: the ONS dataset and its CDIDs. */
export function paySourceText(series) {
  return `ONS, Labour market statistics (LMS: ${series.map((s) => s.cdid).join(", ")}); average weekly earnings, regular pay, Great Britain`;
}

export default function PaySectorsCard({ view = "chart", onViewChange }) {
  const { loading, data, error, unavailable } = usePaySectors();
  const narrow = useNarrowViewport();
  const [shown, setShown] = useState(ORDER);
  const [hovered, setHovered] = useState(null);

  const base = { id: "forecast-pay-sectors", title: PAY_SECTORS_TITLE, icon: "briefcase" };
  if (!data) {
    // The card holds its place while the file loads, or before it is
    // published, so the pair beside the earnings forecast never jumps
    return (
      <LsCard {...base}>
        <div className="chart-plot">
          <p className="view-status" role={error ? "alert" : undefined}>
            {error
              ? `Could not load the ONS pay data: ${error}`
              : unavailable
                ? "ONS pay growth by sector is not yet available."
                : loading
                  ? "Loading ONS pay data…"
                  : null}
          </p>
        </div>
      </LsCard>
    );
  }

  const series = ORDER.map((key) => data.series.find((s) => s.key === key)).filter(Boolean);
  const rows = growthRows(data);
  const allLines = series.map((s) => ({ key: s.key, ...LINES[s.key] }));
  const lines = allLines.filter((l) => shown.includes(l.key));
  const sentence = paySectorsSentence(rows);
  const sourceText = paySourceText(series);
  const units = "Year-on-year growth of the three-month average (%); monthly, each month ending its three-month window";
  const first = monthLabel(rows[0].month);
  const last = monthLabel(rows[rows.length - 1].month);

  const csv = () =>
    buildChartCsv({
      title: PAY_SECTORS_TITLE,
      units,
      source: sourceText,
      columns: [{ key: "month", label: "Three months to" }, ...allLines.map((l) => ({ key: l.key, label: `${l.name} (${series.find((s) => s.key === l.key).cdid})`, decimals: 1 }))],
      rows,
      notes: [`Public sector annual pay growth continues to be affected by variations in the timing of some pay awards this year (${AWE_BULLETIN.label}, ${AWE_BULLETIN.date}).`],
    });

  const common = {
    ...base,
    summary: sentence,
    about: "Year-on-year growth in average weekly regular pay, three-month average, in percent, from monthly ONS data.",
    sourceText,
    info: {
      shows: `How fast average weekly regular pay grew on a year earlier in the public sector, the private sector and the whole economy (grey), each month from ${first} to ${last}. This is history to the latest ONS release, not the OBR forecast.`,
      how: [
        "Regular pay is pay before tax, excluding bonuses and arrears, in cash terms (not adjusted for prices), seasonally adjusted.",
        "Each month's value is the average of the three months ending in that month, compared with the same three months a year earlier, as the ONS publishes it; the page computes nothing from it.",
      ],
      caveats: [
        `The ONS notes that public sector annual pay growth "continues to be affected by variations in the timing of some pay awards this year", so the 2026 public-sector rate partly reflects when awards were paid (${AWE_BULLETIN.label}).`,
        "Growth in 2021 is distorted by the pandemic: it compares with 2020, when furlough held pay down and fewer lower-paid employees were in work.",
        "Average weekly earnings cover employees in Great Britain, not Northern Ireland.",
      ],
      sources: [
        ...series.map((s) => ({ label: `ONS, ${s.title} (${s.cdid}, ${s.dataset})`, href: s.source_url, date: ukDay(s.release_date) })),
        AWE_BULLETIN,
      ],
    },
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={PAY_SECTORS_TITLE} />,
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
      <LsCard {...common} download={{ filename: "pay-growth-sectors", image: false, csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Three months to</th>
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

  const values = rows.flatMap((r) => lines.map((l) => r[l.key])).filter((v) => v != null);
  const axis = percentAxis([0, ...values]);
  return (
    <LsCard {...common} download={{ filename: "pay-growth-sectors", legendItems: lineLegendItems(lines), csv }}>
      <LsLineChart
        data={rows}
        series={lines}
        xKey="month"
        xFormat={(m) => `Three months to ${monthShort(m)}`}
        xTickValues={yearTicks(rows)}
        xTickFormat={monthYear}
        dots={false}
        yFormat={pctTick}
        tooltipFormat={pctText}
        yLabel="Annual growth, three-month average (%)"
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
