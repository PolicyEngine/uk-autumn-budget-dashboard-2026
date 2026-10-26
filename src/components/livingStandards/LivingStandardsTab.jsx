// The Pre-measures forecast view (?tab=outlook; ?tab=living before): the
// outlook before the Budget's measures, the pre-Budget baseline for UK
// household incomes and poverty, and the OBR forecast it is built on.
// Ported from PolicyEngine/uk-living-standards-outlook (branch
// review-1-fixes, db0c8e4): its two tabs are this view's two sub-tabs,
// Baseline outlook and Forecast changes, in the dashboard's layout. The
// sub-tab pill comes first, under the view tabs, then the intro, which holds
// for both sub-tabs. It reads
// public/data/living_standards_outlook.json and runs on its own engine
// version; the Methodology view states that version, the data's status,
// its notes and what the baseline leaves out.

import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import UnavailableNotice from "../publication/UnavailableNotice";
import SourceLink from "../SourceLink";
import ViewLink from "../ViewLink";
import { ForecastSource } from "./sources";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import { loadOutlook } from "../../utils/livingStandards/outlook";
import { GrowthCard, IncomesOverTimeCard, PovertyOverTimeCard } from "./sections/ViewCards";
import WhoIsInPovertySection from "./sections/WhoIsInPovertySection";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import { forecastName } from "../../utils/livingStandards/forecast";
import "./LivingStandards.css";

// The baseline sections, in order: each one row of two cards that line up
// (a card alone takes the full width). A card shows one view at a time, with
// a Show pill; notes and sources sit in its "About this chart".
// Each section's title says it is the outlook before any measure; its
// subtitle links once to the Population impact sub-tab with the measures'
// effect on the same thing, which states no number shown here.
const BASELINE_ROWS = [
  {
    id: "incomes",
    title: "Incomes under current law",
    subtitle: (onShowTab) => (
      <>
        Incomes before any Budget measure (<SourceLink source="obr_efo_march_2026">OBR March 2026</SourceLink>). With
        the measures:{" "}
        <ViewLink tab="dashboard" sub="living" hash="deciles" onShowTab={onShowTab}>
          Living standards
        </ViewLink>
        .
      </>
    ),
    blocks: [[IncomesOverTimeCard, GrowthCard]],
  },
  {
    id: "poverty",
    title: "Poverty under current law",
    subtitle: (onShowTab) => (
      <>
        Poverty before any Budget measure. With the measures:{" "}
        <ViewLink tab="dashboard" sub="poverty" hash="poverty" onShowTab={onShowTab}>
          Poverty
        </ViewLink>
        .
      </>
    ),
    blocks: [[PovertyOverTimeCard, WhoIsInPovertySection]],
  },
];

function Row({ row, data, onShowTab }) {
  if (row.requires && !data[row.requires]) return null;
  // Cards whose data block is missing are skipped; a pair with one card
  // left renders it full width.
  const blocks = row.blocks
    .map((block) => block.filter((S) => !S.requires || data[S.requires]))
    .filter((block) => block.length);
  if (!blocks.length) return null;
  return (
    <>
      <SectionHeading title={row.title} subtitle={row.subtitle(onShowTab)} />
      <section id={`living-${row.id}`} className="report-section ls-section">
        {blocks.map((block, i) => (
          <div className="charts-grid" key={i}>
            {block.map((S, j) => (
              <S key={j} data={data} />
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

const SUB_TABS = [
  { value: "baseline", label: "Baseline outlook", icon: "trend" },
  { value: "forecast", label: "Forecast changes", icon: "refresh" },
];
const SUB_TAB_VALUES = SUB_TABS.map((t) => t.value);

/** Incomes and poverty under the baseline. */
function BaselinePanel({ data, onShowTab }) {
  return (
    <>
      {BASELINE_ROWS.map((row) => (
        <Row key={row.id} row={row} data={data} onShowTab={onShowTab} />
      ))}
    </>
  );
}

/** The OBR forecast behind the baseline, and the OBR's household income. */
function ForecastPanel({ data, forecastView, setForecastView }) {
  const forecast = data.forecast;
  // `obr-forecast` updates an independent baseline JSON. Its Budget-day
  // extract has no receipt or release-index binding yet, so publication of
  // that JSON alone cannot authorise the new forecast figures.
  if (forecast?.post_published) {
    return (
      <UnavailableNotice reason="Budget-day forecast is unavailable until verified">
        <p>The baseline outlook, on the forecast it was built from, remains available in Baseline outlook.</p>
      </UnavailableNotice>
    );
  }
  return (
    <>
      {forecast && (
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
      )}
    </>
  );
}

export default function LivingStandardsTab({ active = true, onShowTab }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [sub, setSub] = useSubTabParam(SUB_TAB_VALUES, active);
  // Sub-tabs opened so far stay mounted, hidden while the other is shown
  const [visited, setVisited] = useState([sub]);
  if (!visited.includes(sub)) setVisited([...visited, sub]);
  // Charts or tables: kept here so it survives a sub-tab switch
  const [forecastView, setForecastView] = useState("chart");

  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live) setState({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, []);

  const { loading, data, error } = state;

  return (
    <>
      {loading && (
        <p className="view-status" role="status">
          Loading outlook data…
        </p>
      )}
      {error && (
        <p className="view-status" role="alert">
          Could not load outlook data: {error}
        </p>
      )}

      {data && (
        <div className="results-container">
          <SubTabs
            tabs={SUB_TABS}
            value={sub}
            onChange={setSub}
            ariaLabel="Pre-measures forecast sections"
            idPrefix="living"
          />
          {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
            <SubTabPanel key={value} idPrefix="living" value={value} hidden={value !== sub}>
              {value === "forecast" ? (
                <ForecastPanel data={data} forecastView={forecastView} setForecastView={setForecastView} />
              ) : (
                <BaselinePanel data={data} onShowTab={onShowTab} />
              )}
            </SubTabPanel>
          ))}
        </div>
      )}
    </>
  );
}
