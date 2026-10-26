// How the OBR forecast feeds the baseline, in the Methodology view's
// Living standards section (the Forecast changes sub-tab links here): one
// line, then the basis, the years, and the policyengine-uk parameter each
// series sets, read from the outlook (forecast.sections[].series[].parameter).

import { useEffect, useState } from "react";
import { loadOutlook } from "../../utils/livingStandards/outlook";
import { seriesName } from "../../utils/livingStandards/forecastWords";

export const FORECAST_FEED_ANCHOR = "method-forecast-feed";

export default function ForecastFeedMethod() {
  const [forecast, setForecast] = useState(null);
  const [endNote, setEndNote] = useState(null);
  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live && r.data?.forecast) setForecast(r.data.forecast);
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
    <div id={FORECAST_FEED_ANCHOR} className="card method-card">
      <h3 className="method-card-title">How the forecast feeds the baseline</h3>
      <p className="method-lead">
        The baseline grows wages, benefits, prices and rents at the OBR forecast&apos;s rates, so the incomes and
        poverty figures start from that forecast.
      </p>
      <ul className="method-list">
        <li>Each rate is the growth in a calendar year&apos;s average on the year before.</li>
        <li>
          A financial year takes the growth of the calendar year it starts in. 2031-32 is past the OBR forecast and
          uses policyengine-uk&apos;s long-run assumptions{endNote ? ` (${endNote})` : ""}.
        </li>
        <li>Benefit rates in the baseline follow a lagged CPI index built from this forecast.</li>
      </ul>
      {series.length > 0 && (
        <details className="method-details">
          <summary>The policyengine-uk parameter each series sets</summary>
          <ul className="method-list forecast-feed-params">
            {series.map((s) => (
              <li key={s.key}>
                {seriesName(s)}: <code>{s.parameter}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
