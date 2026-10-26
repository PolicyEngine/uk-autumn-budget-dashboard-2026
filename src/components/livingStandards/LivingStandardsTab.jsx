// The Pre-measures forecast view (?tab=outlook; ?tab=living before): the
// OBR economic forecast behind the current-law baseline, as calendar-year
// growth. The baseline itself (incomes and poverty under current law) is on
// Population impact's Living standards and Poverty sub-tabs
// (CurrentLawSection). Ported from PolicyEngine/uk-living-standards-outlook
// (branch review-1-fixes, db0c8e4), its Forecast changes tab. It reads
// public/data/living_standards_outlook.json; the Methodology view states
// its engine version, status and notes. That is the first sub-tab, Forecast
// changes. The second, Forecast vintages (?sub=vintages), is the OBR's
// forecasts beside the outturn (forecastVintages/ForecastVintagesView): it
// reads its own file, so it shows whether or not the outlook can be read.
// Old links to the view's former Baseline outlook sub-tab (?sub=baseline)
// are handled in App.jsx.

import { useRef, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import UnavailableNotice from "../publication/UnavailableNotice";
import SourceLink from "../SourceLink";
import { ForecastSource } from "./sources";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import { forecastName } from "../../utils/livingStandards/forecast";
import { OutlookStatus, useOutlook } from "./useOutlook";
import CurrentLawSection from "./CurrentLawSection";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import ForecastVintagesView from "../forecastVintages/ForecastVintagesView";
import "./LivingStandards.css";

const SUB_TABS = [
  { value: "forecast", label: "Forecast changes", icon: "refresh" },
  { value: "vintages", label: "Forecast vintages", icon: "clock" },
];
const SUB_TAB_VALUES = SUB_TABS.map((t) => t.value);

/** The OBR forecast behind the baseline: headline tiles, then the series. */
function ForecastPanel({ forecast, data }) {
  // Charts or tables
  const [forecastView, setForecastView] = useState("chart");
  // `obr-forecast` updates an independent baseline JSON. Its Budget-day
  // extract has no receipt or release-index binding yet, so publication of
  // that JSON alone cannot authorise the new forecast figures.
  if (forecast?.post_published) {
    return (
      <UnavailableNotice reason="Budget-day forecast is unavailable until verified">
        <p>
          Incomes and poverty under current law, on the forecast they were built from, remain on Population impact&apos;s
          Living standards and Poverty sub-tabs.
        </p>
      </UnavailableNotice>
    );
  }
  return (
    <>
      <SectionHeading
        title="Forecast changes"
        subtitle={
          forecast.post_published
            ? <>The OBR economic forecast behind the baseline: calendar-year growth in the annual average. This compares the {forecastName(forecast.pre_label)} forecast with the {forecastName(forecast.post_label)} forecast. <ForecastSource forecast={forecast} /></>
            : <>The OBR forecast behind the baseline: calendar-year growth, from the <SourceLink source="obr_efo_current" />.</>
        }
      />
      <section id="living-forecast" className="report-section">
        <ForecastHeadlineSection data={data} />
        <div className="ls-section-controls">
          <PillSelect
            variant="light"
            prefix="Show as"
            name="Chart or table"
            value={forecastView}
            onChange={setForecastView}
            options={[
              { value: "chart", label: "Charts" },
              { value: "table", label: "Tables" },
            ]}
          />
        </div>
      </section>
      <ForecastSeriesSection data={data} view={forecastView} />
    </>
  );
}

/**
 * @param {Object} props
 * @param {boolean} [props.active] - Whether the view is shown (kept mounted while hidden)
 * @param {boolean} [props.withCurrentLaw] - Also show incomes and poverty
 *   under current law, below the forecast. App sets it while no Budget
 *   publication verifies (#104): Population impact, their usual home, is
 *   unavailable then, and these cards read only the independent outlook,
 *   so they stay reachable. They are PolicyEngine's figures, so they go
 *   under Forecast changes, never Forecast vintages.
 */
export default function LivingStandardsTab({ active = true, withCurrentLaw = false }) {
  const [sub, setSub] = useSubTabParam(SUB_TAB_VALUES, active);
  // Sub-tabs opened so far stay mounted, hidden while the other is shown
  const [visited, setVisited] = useState([sub]);
  if (!visited.includes(sub)) setVisited([...visited, sub]);

  const { loading, data, error } = useOutlook();
  // Forecast vintages' link to Forecast changes opens it through the bar
  const subTabs = useRef(null);

  // The sub-tabs show from the first render: Forecast vintages reads its own
  // file, and Forecast changes shows the outlook's state until it is read
  return (
    <div className="results-container">
      <SubTabs
        ref={subTabs}
        tabs={SUB_TABS}
        value={sub}
        onChange={setSub}
        ariaLabel="Pre-measures forecast sections"
        idPrefix="living"
      />
      {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
        <SubTabPanel key={value} idPrefix="living" value={value} hidden={value !== sub}>
          {value === "vintages" ? (
            <ForecastVintagesView
              active={active && value === sub}
              related={{
                href: "?tab=outlook",
                label: "Forecast changes",
                onShow: () => subTabs.current?.show("forecast"),
              }}
            />
          ) : (
            <>
              <OutlookStatus loading={loading} error={error} />
              {data?.forecast && <ForecastPanel forecast={data.forecast} data={data} />}
              {withCurrentLaw && (
                <>
                  <CurrentLawSection id="incomes" />
                  <CurrentLawSection id="poverty" />
                </>
              )}
            </>
          )}
        </SubTabPanel>
      ))}
    </div>
  );
}
