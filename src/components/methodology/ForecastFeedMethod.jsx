// How the OBR forecast feeds the baseline, folded in the Methodology view's
// Pre-measures forecast section (the Forecast changes sub-tab links here):
// one line, then the basis, the years, and the policyengine-uk parameter
// each series sets, read from the outlook (forecast.sections[].series[].parameter).

import { useEffect, useState } from "react";
import { fyLabel, loadOutlook, outlookForecastSource } from "../../utils/livingStandards/outlook";
import { seriesName } from "../../utils/livingStandards/forecastWords";
import { ExternalLink, SourceLink } from "./MethodUi";

// The yoy_growth parameters live in one file of policyengine-uk, read at the
// version the outlook was built with (checked for 2.132.6, 26 October 2026)
const YOY_GROWTH = "gov.economic_assumptions.yoy_growth.";
const yoyGrowthFile = (version) =>
  `https://github.com/PolicyEngine/policyengine-uk/blob/${version}/policyengine_uk/parameters/gov/economic_assumptions/yoy_growth.yaml`;

export const FORECAST_FEED_ANCHOR = "method-forecast-feed";

export default function ForecastFeedMethod() {
  const [forecast, setForecast] = useState(null);
  const [engine, setEngine] = useState(null);
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live && r.data?.forecast) setForecast(r.data.forecast);
      if (live && r.data?.meta?.policyengine_uk) setEngine(r.data.meta.policyengine_uk);
      if (live && r.data?.meta) setMeta(r.data.meta);
    });
    return () => {
      live = false;
    };
  }, []);
  const series = (forecast?.sections || []).flatMap((s) => s.series).filter((s) => s.parameter);
  const source = outlookForecastSource(meta);
  const note = meta?.headline_end_year_note ?? "";
  // On the October 2026 forecast: its last calendar year ("calendar 2031"),
  // so the projections' last year is inside it
  const lastCalendar = source === "obr_efo_october_2026" ? note.match(/calendar (\d{4})/)?.[1] ?? null : null;
  // On March 2026: "(CPI 2.0%, earnings growth 3.3%)", the long-run
  // assumptions 2031-32 uses, said here once
  const endNote = lastCalendar ? null : note.match(/\(([^)]*)\)\.?$/)?.[1] ?? null;
  return (
    <>
      <p className="method-lead">
        The pre-measures forecast grows wages, benefits, prices and rents at the rates of the{" "}
        <SourceLink id={source} />, so its incomes and poverty figures start from that forecast.
      </p>
      <ul className="method-list">
        <li>
          Each rate is the growth in a calendar year&apos;s average on the year before, except Council Tax&apos;s,
          which is the growth in a fiscal year&apos;s Council Tax receipts.
        </li>
        {lastCalendar ? (
          <li>
            A financial year takes the growth of the calendar year it starts in, so the forecast&apos;s last calendar
            year, {lastCalendar}, covers {fyLabel(Number(lastCalendar))}; later years use{" "}
            <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s long-run assumptions.
          </li>
        ) : (
          <li>
            A financial year takes the growth of the calendar year it starts in. 2031-32 is past the OBR forecast and
            uses <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s assumptions for that year, on
            the path to the OBR&apos;s long-run ones{endNote ? ` (${endNote})` : ""}.
          </li>
        )}
        <li>
          Most benefit rates in the baseline rise each April with the previous September&apos;s CPI on this
          forecast. The State Pension follows the triple lock, and the Universal Credit standard allowance
          adds the above-inflation rises legislated to 2029-30. The model raises the Pension Credit guarantee
          with CPI too, though the law reviews it against earnings.
        </li>
      </ul>
      {series.length > 0 && (
        <>
          <h3 className="method-details-title">The policyengine-uk parameter each series sets</h3>
          <ul className="method-list forecast-feed-params">
            {series.map((s) => (
              <li key={s.key}>
                {seriesName(s)}:{" "}
                {engine && s.parameter.startsWith(YOY_GROWTH) ? (
                  <ExternalLink href={yoyGrowthFile(engine)}>
                    <code>{s.parameter}</code>
                  </ExternalLink>
                ) : (
                  <code>{s.parameter}</code>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
