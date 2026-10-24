// The Living standards view: the pre-Budget baseline outlook for UK
// household incomes and poverty, and the OBR forecast it is built on.
// Ported from PolicyEngine/uk-living-standards-outlook (branch
// review-1-fixes, db0c8e4): its two tabs are this view's two sub-tabs,
// Baseline outlook and Forecast changes, in the dashboard's layout. The
// intro sits above the sub-tabs, since it holds for both. It reads
// public/data/living_standards_outlook.json and runs on its own engine
// version; the Methodology view states that version, the data's status,
// its notes and what the baseline leaves out.

import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import SubTabs, { SubTabPanel, useSubTabParam } from "../SubTabs";
import { loadOutlook } from "../../utils/livingStandards/outlook";
import LivingStandardsSection from "./sections/LivingStandardsSection";
import DecileGrowthSection from "./sections/DecileGrowthSection";
import NonPensionerSplitSection from "./sections/NonPensionerSplitSection";
import InequalitySection from "./sections/InequalitySection";
import PovertySection from "./sections/PovertySection";
import DeepPovertySection from "./sections/DeepPovertySection";
import PovertyByGroupSection from "./sections/PovertyByGroupSection";
import ChildPovertyFamilySection from "./sections/ChildPovertyFamilySection";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import RhdiSection from "./sections/RhdiSection";
import "./LivingStandards.css";

// The baseline sections, in order. blocks: [A, B] is a two-up row whose
// cards line up; [A] is full width. Notes sit in the cards they apply to.
const BASELINE_ROWS = [
  {
    id: "incomes",
    title: "Incomes",
    subtitle: "Household income, income growth across the distribution, and inequality.",
    blocks: [
      [LivingStandardsSection, DecileGrowthSection],
      [NonPensionerSplitSection, InequalitySection],
    ],
  },
  {
    id: "poverty",
    title: "Poverty",
    subtitle: "Poverty rates, how far below the line people are, and poverty by group and by family.",
    blocks: [
      [PovertySection, DeepPovertySection],
      [PovertyByGroupSection, ChildPovertyFamilySection],
    ],
  },
];

function Row({ row, data }) {
  if (row.requires && !data[row.requires]) return null;
  // Cards whose data block is missing are skipped; a pair with one card
  // left renders it full width.
  const blocks = row.blocks
    .map((block) => block.filter((S) => !S.requires || data[S.requires]))
    .filter((block) => block.length);
  if (!blocks.length) return null;
  return (
    <>
      <SectionHeading title={row.title} subtitle={row.subtitle} />
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
  { value: "baseline", label: "Baseline outlook" },
  { value: "forecast", label: "Forecast changes" },
];
const SUB_TAB_VALUES = SUB_TABS.map((t) => t.value);

/** Incomes and poverty under the baseline. */
function BaselinePanel({ data }) {
  return (
    <>
      {BASELINE_ROWS.map((row) => (
        <Row key={row.id} row={row} data={data} />
      ))}
    </>
  );
}

/** The OBR forecast behind the baseline, and the OBR's household income. */
function ForecastPanel({ data, forecastView, setForecastView }) {
  const forecast = data.forecast;
  return (
    <>
      {forecast && (
        <>
          <SectionHeading
            title="Forecast changes"
            subtitle={
              forecast.post_published
                ? `The OBR economic forecast behind the baseline. This compares the ${forecast.pre_label.replace(/\s*\(pre-Budget\)/, "")} forecast with the Autumn Budget 2026 forecast.`
                : "The OBR economic forecast behind the baseline. Each figure and chart will add the Autumn Budget 2026 forecast once the OBR publishes it on 28 October."
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

      {data.obr_rhdi && (
        <>
          <SectionHeading
            title="Household income"
            subtitle="The OBR's national-accounts measure of household income per person."
          />
          <section id="living-rhdi" className="report-section">
            <div className="charts-grid">
              <RhdiSection data={data} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

export default function LivingStandardsTab() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [sub, setSub] = useSubTabParam(SUB_TAB_VALUES);
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
      <div className="tab-lede">
        <p>
          Projections of UK household incomes and poverty under current legislated policy: the baseline against which
          Autumn Budget 2026 measures are scored. Pre-Budget baseline: OBR March 2026 forecast. Budget measures are
          not modelled.
        </p>
      </div>

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
            ariaLabel="Living standards sections"
            idPrefix="living"
          />
          <SubTabPanel idPrefix="living" value={sub}>
            {sub === "forecast" ? (
              <ForecastPanel data={data} forecastView={forecastView} setForecastView={setForecastView} />
            ) : (
              <BaselinePanel data={data} />
            )}
          </SubTabPanel>
        </div>
      )}
    </>
  );
}
