// The OBR forecast view (?tab=outlook; ?tab=living before): the
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
import PillSelect from "../PillSelect";
import UnavailableNotice from "../publication/UnavailableNotice";
import SourceLink from "../SourceLink";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import CurrentLawSection from "./CurrentLawSection";
import { ForecastSource } from "./sources";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import { forecastName } from "../../utils/livingStandards/forecast";
import { OutlookStatus, useOutlook } from "./useOutlook";
import "./LivingStandards.css";

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
          Incomes and poverty under current law, on the forecast they were built from, remain on this view&apos;s
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

/** The OBR forecast's sub-tabs; the first, Living standards, is the default. */
export const OUTLOOK_SUB_TABS = [
  { value: "living", label: "Living standards", icon: "coins" },
  { value: "poverty", label: "Poverty", icon: "percent" },
  { value: "forecast", label: "Forecast changes", icon: "trend" },
];

const SUB_TAB_VALUES = OUTLOOK_SUB_TABS.map((tab) => tab.value);

const ID_PREFIX = "outlook";

/**
 * The OBR forecast view: what happens without the measures, under
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
export default function LivingStandardsTab({ active = true, onShowTab }) {
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
        ariaLabel="OBR forecast sections"
        idPrefix={ID_PREFIX}
      />
      {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
        <SubTabPanel key={value} idPrefix={ID_PREFIX} value={value} hidden={value !== sub}>
          <div className="results-container">
            {value === "forecast" ? (
              <>
                <OutlookStatus loading={loading} error={error} />
                {data?.forecast && <ForecastPanel forecast={data.forecast} data={data} />}
              </>
            ) : (
              <CurrentLawSection id={value} outlook={outlook} onShowTab={onShowTab} />
            )}
          </div>
        </SubTabPanel>
      ))}
    </>
  );
}
