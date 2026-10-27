// How the OBR forecast feeds the baseline, folded in the Methodology view's
// Pre-measures forecast section (the Forecast changes sub-tab links here):
// one line, then the basis, the years, and the policyengine-uk parameter
// each series sets, read from the outlook (forecast.sections[].series[].parameter).

import { useEffect, useState } from "react";
import { loadOutlook } from "../../utils/livingStandards/outlook";
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
  const [endNote, setEndNote] = useState(null);
  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live && r.data?.forecast) setForecast(r.data.forecast);
      if (live && r.data?.meta?.policyengine_uk) setEngine(r.data.meta.policyengine_uk);
      // "(CPI 2.0%, earnings growth 3.3%)": the long-run assumptions, said
      // here once; the incomes and inequality charts link here
      if (live) setEndNote(r.data?.meta?.headline_end_year_note?.match(/\(([^)]*)\)\.?$/)?.[1] ?? null);
    });
    return () => {
      live = false;
    };
  }, []);
  const series = (forecast?.sections || []).flatMap((s) => s.series).filter((s) => s.parameter);
  return (
    <>
      <p className="method-lead">
        The baseline grows wages, benefits, prices and rents at the rates of the{" "}
        <SourceLink id="obr_efo_current" />, so the incomes and poverty figures start from that forecast.
      </p>
      <ul className="method-list">
        <li>Each rate is the growth in a calendar year&apos;s average on the year before.</li>
        <li>
          A financial year takes the growth of the calendar year it starts in. 2031-32 is past the OBR forecast and
          uses <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s assumptions for that year, on
          the path to the OBR&apos;s long-run ones{endNote ? ` (${endNote})` : ""}.
        </li>
        <li>Benefit rates in the baseline follow a lagged CPI index built from this forecast.</li>
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
