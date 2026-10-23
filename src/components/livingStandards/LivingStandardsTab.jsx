// The Living standards view: the pre-Budget baseline outlook for UK
// household incomes and poverty, and the OBR forecast it is built on.
// Ported from PolicyEngine/uk-living-standards-outlook (branch
// review-1-fixes, db0c8e4): its two tabs are this view's sections, in the
// dashboard's layout. It reads public/data/living_standards_outlook.json and
// runs on its own engine version, which its provenance line states.

import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import Note from "../Note";
import { describeDataset, fyDash, loadOutlook } from "../../utils/livingStandards/outlook";
import LivingStandardsSection from "./sections/LivingStandardsSection";
import DecileGrowthSection from "./sections/DecileGrowthSection";
import NonPensionerSplitSection from "./sections/NonPensionerSplitSection";
import InequalitySection from "./sections/InequalitySection";
import PovertySection from "./sections/PovertySection";
import DeepPovertySection from "./sections/DeepPovertySection";
import PovertyByGroupSection from "./sections/PovertyByGroupSection";
import ChildPovertyFamilySection from "./sections/ChildPovertyFamilySection";
import TwoChildLimitSection from "./sections/TwoChildLimitSection";
import CaveatsSection from "./sections/CaveatsSection";
import ForecastHeadlineSection from "./sections/ForecastHeadlineSection";
import ForecastSeriesSection from "./sections/ForecastSeriesSection";
import RhdiSection from "./sections/RhdiSection";
import AboutDataSection from "./sections/AboutDataSection";
import "./LivingStandards.css";

// The baseline sections, in order. blocks: [A, B] is a two-up row whose
// cards line up; [A] is full width. foot: notes said once under the section.
const BASELINE_ROWS = [
  {
    id: "incomes",
    title: "Incomes",
    subtitle: "Household income, income growth across the distribution, and inequality.",
    blocks: [
      [LivingStandardsSection, DecileGrowthSection],
      [NonPensionerSplitSection, InequalitySection],
    ],
    foot: (d) => [d.meta?.headline_end_year_note, d.meta?.cpi_ahc_note],
  },
  {
    id: "poverty",
    title: "Poverty",
    subtitle: "Poverty rates, how far below the line people are, and poverty by group.",
    blocks: [[PovertySection, DeepPovertySection], [PovertyByGroupSection]],
  },
  {
    id: "child-poverty",
    title: "Child poverty",
    subtitle: "Child poverty by family, and with the two-child limit kept.",
    requires: "child_poverty_by_family",
    blocks: [[ChildPovertyFamilySection, TwoChildLimitSection]],
  },
];

function Row({ row, data }) {
  if (row.requires && !data[row.requires]) return null;
  const foot = [].concat(row.foot ? row.foot(data) : []).filter(Boolean);
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
        {foot.map((f) => (
          <Note key={f}>{fyDash(f)}</Note>
        ))}
      </section>
    </>
  );
}

/** The engine and data this view runs on, and its status: said once, here. */
function Provenance({ meta }) {
  const ds = describeDataset(meta.dataset);
  const data = [ds.name, ds.date && `(${ds.date}${ds.id ? `, ${ds.id}` : ""})`].filter(Boolean).join(" ");
  return (
    <p className="ls-provenance">
      <span className="ls-demo-badge">Demo</span>
      <span>
        Baseline from policyengine {meta.policyengine} (policyengine-uk {meta.policyengine_uk}) on {data}; demo
        output, unvalidated. The Budget views use a different engine version.
      </span>
    </p>
  );
}

export default function LivingStandardsTab() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
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
  const forecast = data?.forecast;

  return (
    <>
      <p className="dashboard-intro">
        Projections of UK household incomes and poverty under current legislated policy: the baseline against which
        Autumn Budget 2026 measures are scored. Pre-Budget baseline: OBR March 2026 forecast. Budget measures are
        not modelled.
      </p>
      {data?.meta && <Provenance meta={data.meta} />}

      {loading && <p className="ls-loading">Loading outlook data…</p>}
      {error && <div className="ls-error">Could not load outlook data: {error}</div>}

      {data && (
        <div className="results-container">
          {BASELINE_ROWS.map((row) => (
            <Row key={row.id} row={row} data={data} />
          ))}

          <SectionHeading
            title="What the baseline leaves out"
            subtitle="Gaps and simplifications that change how the projections read."
          />
          <section id="living-caveats" className="report-section">
            <CaveatsSection data={data} />
          </section>

          {forecast && (
            <>
              <SectionHeading
                title="Forecast changes"
                subtitle={
                  forecast.post_published
                    ? `The OBR economic forecast behind the baseline. This compares the ${forecast.pre_label.replace(/\s*\(pre-Budget\)/, "")} forecast with the Autumn Budget 2026 forecast.`
                    : "The OBR economic forecast behind the baseline. This shows the OBR March 2026 (pre-Budget) forecast; each chart will add the Autumn Budget 2026 forecast once the OBR publishes it on 28 October."
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

          <SectionHeading title="Data" subtitle="The prices, sources and notes behind this view." />
          <AboutDataSection data={data} />
        </div>
      )}
    </>
  );
}
