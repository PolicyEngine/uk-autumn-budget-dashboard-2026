// The Pre-measures forecast view (?tab=outlook; ?tab=living before): the
// outlook without the Budget measures, under current law, in four
// sub-tabs. Living standards and Poverty (CurrentLawSection) mirror
// Population impact's sub-tabs of the same names; Forecast changes is the OBR
// economic forecast behind the baseline, as calendar-year growth. Ported
// from PolicyEngine/uk-living-standards-outlook (branch review-1-fixes,
// db0c8e4), its Baseline outlook and Forecast changes tabs. It reads
// public/data/living_standards_outlook.json; the Methodology view states
// its engine version, status and notes. The fourth, Forecast vintages
// (?sub=vintages), is the OBR's forecasts beside the outturn
// (forecastVintages/ForecastVintagesView): it reads its own file and shows
// no PolicyEngine figure. The old ?sub=baseline link is handled in App.jsx.

import { useRef, useState } from "react";
import SectionHeading from "../SectionHeading";
import UnavailableNotice from "../publication/UnavailableNotice";
import SourceLink from "../SourceLink";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import CurrentLawSection from "./CurrentLawSection";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import ViewLink from "../ViewLink";
import { FORECAST_FEED_ANCHOR } from "../methodology/ForecastFeedMethod";
import { forecastName } from "../../utils/livingStandards/forecast";
import { OutlookStatus, useOutlook } from "./useOutlook";
import ForecastVintagesView from "../forecastVintages/ForecastVintagesView";
import "./LivingStandards.css";

/** The OBR forecast behind the baseline: headline tiles, then the series. */
function ForecastPanel({ forecast, data, onShowTab }) {
  // Charts or tables
  const [forecastView, setForecastView] = useState("chart");
  // `obr-forecast` updates an independent baseline JSON. Its Budget-day
  // extract has no receipt or release-index binding yet, so publication of
  // that JSON alone cannot authorise the new forecast figures.
  if (forecast?.post_published) {
    return (
      <UnavailableNotice reason="Budget-day forecast is unavailable until verified">
        <p>
          Incomes and poverty under current law, on the forecast they were built from, remain on this view&apos;s
          Living standards and Poverty sub-tabs.
        </p>
      </UnavailableNotice>
    );
  }
  return (
    <>
      {/* Named for the forecast, so it is not the sub-tab's label again */}
      <SectionHeading
        icon="trend"
        id="forecast-changes"
        title={`${forecastName(forecast.pre_label) || "OBR"} economic forecast`}
        subtitle={
          <>
            Calendar-year growth behind the baseline, from the <SourceLink source="obr_efo_current" />.{" "}
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
  { value: "vintages", label: "Forecast vintages", icon: "clock" },
];

const SUB_TAB_VALUES = OUTLOOK_SUB_TABS.map((tab) => tab.value);

const ID_PREFIX = "outlook";

/**
 * The Pre-measures forecast view: what happens without the measures, under
 * current law, as pill sub-tabs under the view tabs. Living standards
 * (incomes, growth across the distribution, inequality) and Poverty are the
 * twins of Population impact's sub-tabs of the same names, which show the
 * selected measures' effect; each links to the other. Forecast changes is the
 * forecast the baseline is built on, and Forecast vintages the OBR's
 * forecasts since June 2010 beside the outturn. The open sub-tab is ?sub=
 * (useSubTabParam): Living standards has no parameter, the others are
 * ?sub=poverty, ?sub=forecast and ?sub=vintages. The outlook is read once
 * for the first three (useOutlook); Forecast vintages reads its own file,
 * so it shows whether or not the outlook can be read.
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
  // Forecast vintages' link to Forecast changes opens it through the bar
  const subTabs = useRef(null);
  return (
    <>
      <SubTabs
        ref={subTabs}
        tabs={OUTLOOK_SUB_TABS}
        value={sub}
        onChange={setSub}
        ariaLabel="Pre-measures forecast sections"
        idPrefix={ID_PREFIX}
      />
      {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
        <SubTabPanel key={value} idPrefix={ID_PREFIX} value={value} hidden={value !== sub}>
          <div className="results-container">
            {value === "vintages" ? (
              <ForecastVintagesView
                active={active && value === sub}
                related={{
                  href: "?tab=outlook&sub=forecast",
                  label: "Forecast changes",
                  onShow: () => subTabs.current?.show("forecast"),
                }}
              />
            ) : value === "forecast" ? (
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
