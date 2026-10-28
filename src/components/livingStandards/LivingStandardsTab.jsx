// The Pre-measures forecast view (?tab=outlook; ?tab=living before): the
// outlook without the Budget measures, under current law, in three
// sub-tabs. Living standards and Poverty (CurrentLawSection) mirror
// Population impact's sub-tabs of the same names; Forecast changes is the OBR
// economic forecast behind the baseline, as calendar-year growth. Ported
// from PolicyEngine/uk-living-standards-outlook (branch review-1-fixes,
// db0c8e4), its Baseline outlook and Forecast changes tabs. It reads
// public/data/living_standards_outlook.json; the Methodology view states
// its engine version, status and notes. The old ?sub=baseline link is
// handled in App.jsx.

import { useState } from "react";
import SectionHeading from "../SectionHeading";
import SourceLink from "../SourceLink";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import CurrentLawSection from "./CurrentLawSection";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import ViewLink from "../ViewLink";
import { FORECAST_FEED_ANCHOR } from "../methodology/ForecastFeedMethod";
import { forecastName, hasPost } from "../../utils/livingStandards/forecast";
import { OutlookStatus, useOutlook } from "./useOutlook";
import "./LivingStandards.css";

/** The OBR forecast behind the baseline: headline tiles, then the series. */
function ForecastPanel({ forecast, data, onShowTab }) {
  // Charts or tables
  const [forecastView, setForecastView] = useState("chart");
  // A later OBR forecast loaded by `obr-forecast` (post_published, its file
  // and SHA-256 in post_source, the file's review row in
  // data_inputs/public_data_review.csv) is drawn beside the earlier one,
  // series by series, for comparison
  const later = forecast.sections?.some((s) => s.series.some((series) => hasPost(forecast, series)));
  return (
    <>
      {/* Named for the forecast(s), so it is not the sub-tab's label again */}
      <SectionHeading
        icon="trend"
        id="forecast-changes"
        title={
          later
            ? `${forecastName(forecast.pre_label)} and ${forecastName(forecast.post_label).replace(/^OBR\s+/, "")} economic forecasts`
            : `${forecastName(forecast.pre_label) || "OBR"} economic forecast`
        }
        subtitle={
          <>
            {later ? (
              <>
                Calendar-year growth in the <SourceLink source="obr_efo_march_2026" /> and the{" "}
                <SourceLink source="obr_efo_october_2026" />, published with the Budget, shown for comparison. The
                Budget figures use the October 2026 forecast.
              </>
            ) : (
              <>
                Calendar-year growth behind the baseline, from the <SourceLink source="obr_efo_current" />.
              </>
            )}{" "}
            <ViewLink tab="methodology" hash={FORECAST_FEED_ANCHOR} onShowTab={onShowTab}>
              How these forecasts feed our figures →
            </ViewLink>
          </>
        }
      />
      <section id="living-forecast" className="report-section">
        <ForecastHeadlineSection data={data} />
      </section>
      <ForecastSeriesSection data={data} view={forecastView} onViewChange={setForecastView} />
    </>
  );
}

/** Pre-measures forecast's sub-tabs; the first, Living standards, is the default. */
export const OUTLOOK_SUB_TABS = [
  { value: "living", label: "Living standards", icon: "coins" },
  { value: "poverty", label: "Poverty", icon: "percent" },
  { value: "forecast", label: "Forecast changes", icon: "trend" },
];

const SUB_TAB_VALUES = OUTLOOK_SUB_TABS.map((tab) => tab.value);

const ID_PREFIX = "outlook";

/**
 * The Pre-measures forecast view: what happens without the measures, under
 * current law, as pill sub-tabs under the view tabs. Living standards
 * (incomes, growth across the distribution, inequality) and Poverty are the
 * twins of Population impact's sub-tabs of the same names, which show the
 * selected measures' effect; each links to the other. Forecast changes is the
 * forecast the baseline is built on. The open sub-tab is ?sub=
 * (useSubTabParam): Living standards has no parameter, the others are
 * ?sub=poverty and ?sub=forecast. The outlook is read once for every
 * sub-tab (useOutlook).
 *
 * @param {Object} props
 * @param {boolean} [props.active] - Whether the view is shown (App keeps it mounted while hidden)
 * @param {(tab: string, sub: string) => void} [props.onShowTab] - Open another view at a sub-tab
 */
export default function LivingStandardsTab({ active = true, onShowTab, selectedYear = null }) {
  const outlook = useOutlook();
  const [sub, setSub] = useSubTabParam(SUB_TAB_VALUES, active);
  // Sub-tabs opened so far stay mounted, hidden while another is shown
  const [visited, setVisited] = useState([sub]);
  if (!visited.includes(sub)) setVisited([...visited, sub]);
  const { loading, data, error } = outlook;
  return (
    <>
      <SubTabs
        tabs={OUTLOOK_SUB_TABS}
        value={sub}
        onChange={setSub}
        ariaLabel="Pre-measures forecast sections"
        idPrefix={ID_PREFIX}
      />
      {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
        <SubTabPanel key={value} idPrefix={ID_PREFIX} value={value} hidden={value !== sub}>
          <div className="results-container">
            {value === "forecast" ? (
              <>
                <OutlookStatus loading={loading} error={error} />
                {data?.forecast && <ForecastPanel forecast={data.forecast} data={data} onShowTab={onShowTab} />}
              </>
            ) : (
              <CurrentLawSection id={value} outlook={outlook} onShowTab={onShowTab} selectedYear={selectedYear} />
            )}
          </div>
        </SubTabPanel>
      ))}
    </>
  );
}
