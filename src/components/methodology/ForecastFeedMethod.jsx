// How the OBR forecast feeds the baseline, folded in the Methodology view's
// Pre-measures forecast section (the Forecast changes sub-tab links here):
// one line, then the basis, the years, and the policyengine-uk parameter
// each series sets, read from the outlook (forecast.sections[].series[].parameter).

import { useEffect, useState } from "react";
import { fyLabel, loadOutlook, outlookForecastSource } from "../../utils/livingStandards/outlook";
import { seriesName } from "../../utils/livingStandards/forecastWords";
import { ExternalLink, SourceLink } from "./MethodUi";

// The native readback has its own model version; historical files fall back
// to the model version their outlook records. These parameters share a file.
const YOY_GROWTH = "gov.economic_assumptions.yoy_growth.";
const yoyGrowthFile = (version) =>
  `https://github.com/PolicyEngine/policyengine-uk/blob/${version}/policyengine_uk/parameters/gov/economic_assumptions/yoy_growth.yaml`;
const STATUTORY_GAP = "gov.economic_assumptions.statutory_uprating_inputs.forecast_gap.";
const nativeName = (parameter, existing) => existing?.label || ({
  "per_capita.gdp": "GDP per person",
  "per_capita.non_labour_income": "Non-labour income per person",
  "council_tax.england": "Council Tax receipts in England",
  "council_tax.scotland": "Council Tax receipts in Scotland",
  "council_tax.wales": "Council Tax receipts in Wales",
}[parameter.replace(`${YOY_GROWTH}obr.`, "")] || ({
  cpi_september: "September CPI forecast adjustment",
  awe_total_pay_may_july: "May–July earnings forecast adjustment",
}[parameter.replace(STATUTORY_GAP, "")] || parameter));

export const FORECAST_FEED_ANCHOR = "method-forecast-feed";

export default function ForecastFeedMethod() {
  const [forecast, setForecast] = useState(null);
  const [engine, setEngine] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live && r.data?.forecast) setForecast(r.data.forecast);
      if (live && r.data?.meta?.policyengine_uk) setEngine(r.data.meta.policyengine_uk);
      if (live && r.data?.meta) setMeta(r.data.meta);
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const compared = (forecast?.sections || []).flatMap((s) => s.series).filter((s) => s.parameter);
  const native = forecast?.model_inputs?.mode === "native" ? forecast.model_inputs : null;
  const series = native ? Object.keys(native.parameter_changes || {}).map((parameter) => ({
    key: parameter, parameter,
    label: nativeName(parameter, compared.find((s) => s.parameter === parameter)),
  })) : compared;
  const source = /OBR (October|March) 2026/.test(meta?.headline_end_year_note ?? "") ? outlookForecastSource(meta) : null;
  const inputEngine = native?.model_version || engine;
  const basis = meta?.policy_basis;
  // The builder validates the full basis and digest before publishing a
  // projection. Versions alone cannot prove that the rollback was applied.
  const recordedNativeBasis = basis?.schema === "uk-budget-dashboard/outlook-policy-basis/v1" &&
    basis.applied_before_data_load === true && /^[a-f0-9]{64}$/.test(basis.sha256 ?? "") &&
    basis.policy_record?.native_model_version === engine && basis.forecast?.mode === "native" &&
    basis.forecast?.model_version === inputEngine;
  const comparisonOnly = Boolean(native && (!engine || !native.model_version || inputEngine !== engine || !recordedNativeBasis));
  const note = meta?.headline_end_year_note ?? "";
  // On the October 2026 forecast: its last calendar year ("calendar 2031"),
  // so the projections' last year is inside it
  const lastCalendar = source === "obr_efo_october_2026" ? note.match(/calendar (\d{4})/)?.[1] ?? null : null;
  // On March 2026: "(CPI 2.0%, earnings growth 3.3%)", the long-run
  // assumptions 2031-32 uses, said here once
  const endNote = lastCalendar ? null : note.match(/\(([^)]*)\)\.?$/)?.[1] ?? null;
  if (!source) return <p className="method-lead" role="status">{loaded ? "The outlook’s forecast provenance is unavailable." : "Loading the outlook’s forecast provenance…"}</p>;
  return (
    <>
      <p className="method-lead">
        {comparisonOnly ? (
          <>The forecast comparison includes a native input readback from policyengine-uk {inputEngine}.
          {engine ? <> The population projections still record policyengine-uk {engine}.</> : <> The population projections do not record a model version.</>}
          {!recordedNativeBasis && <> A matching pre-Budget policy and forecast basis is not recorded.</>}
          {" "}Loading this readback does not update those projections.</>
        ) : (
          <>The pre-measures forecast uses the <SourceLink id={source} />{" "}together with PolicyEngine&apos;s derived
          and carried series to project wages, benefits, prices and rents.</>
        )}
      </p>
      <ul className="method-list">
        <li>
          The OBR-published comparison series show growth in calendar-year averages, except Council Tax, which uses
          fiscal-year receipts.{native && <> The native model also uses dated statutory inputs: September CPI and
          May–July earnings forecast adjustments for benefit and pension uprating.</>}
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
        {!comparisonOnly && <li>
          Most benefit rates in the baseline rise each April with the previous September&apos;s CPI on this
          forecast. The State Pension follows the triple lock, and the Universal Credit standard allowance
          adds the above-inflation rises legislated to 2029-30. The Pension Credit guarantee rises with
          average earnings, the least the law allows.
        </li>}
      </ul>
      {series.length > 0 && (
        <>
          <h3 className="method-details-title">{native ? `Native ${comparisonOnly ? "comparison" : "economic"} inputs in policyengine-uk ${inputEngine}` : "Parameters associated with the comparison series"}</h3>
          {native && <p className="method-lead">This readback records the native model inputs, including per-person series and statutory uprating adjustments. The published OBR comparison series retain their own sources and rounding.</p>}
          <ul className="method-list forecast-feed-params">
            {series.map((s) => (
              <li key={s.key}>
                {seriesName(s)}:{" "}
                {inputEngine && s.parameter.startsWith(YOY_GROWTH) ? (
                  <ExternalLink href={yoyGrowthFile(inputEngine)}>
                    <code>{s.parameter}</code>
                  </ExternalLink>
                ) : inputEngine && s.parameter.startsWith(STATUTORY_GAP) ? (
                  <ExternalLink href={`https://github.com/PolicyEngine/policyengine-uk/blob/${inputEngine}/policyengine_uk/parameters/gov/economic_assumptions/statutory_uprating_inputs/forecast_gap/${s.parameter.slice(STATUTORY_GAP.length)}.yaml`}>
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
