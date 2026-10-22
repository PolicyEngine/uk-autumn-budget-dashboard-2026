'use client';

import { useState, useEffect, useRef } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import GeographyMethodology from "./components/GeographyMethodology";
import OBRComparisonTable from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatterTemplate from "./components/HouseholdScatterTemplate";
import YearSlider from "./components/YearSlider";
import PillSelect from "./components/PillSelect";
import ReplicationLine from "./components/ReplicationLine";
import { DISPLAY_YEARS } from "./utils/displayYears";

// Autumn Budget 2026 policy provisions
const POLICIES = [
  {
    id: "two_child_limit",
    name: "2 child limit repeal",
    description: "Repeal the two-child limit on benefits",
    explanation:
      'The two-child limit restricts Universal Credit and Child Tax Credit payments to a maximum number of children per family. Removing this limit allows families to claim child-related benefit payments for all children without a cap. The Government estimates this will reduce child poverty by 450,000 by 2029-30. See our <a href="https://policyengine.org/uk/research/uk-two-child-limit" target="_blank" rel="noopener noreferrer">research report</a> for details.',
  },
  {
    id: "fuel_duty_freeze",
    name: "Fuel duty freeze extension",
    description: "Freeze fuel duty rates until September 2026",
    explanation:
      'The baseline assumes the 5p cut ends on 22 March 2026, returning the rate to 57.95p, followed by RPI uprating from April 2026. The announced policy (reform) maintains the freeze at 52.95p until September 2026, then implements a staggered reversal with increases of 1p, 2p, and 2p over three-month periods, reaching 57.95p by March 2027. Both then apply annual RPI uprating. See our <a href="https://policyengine.org/uk/research/fuel-duty-freeze-2025" target="_blank" rel="noopener noreferrer">research report</a> for details.',
  },
  {
    id: "rail_fares_freeze",
    name: "Rail fares freeze",
    description: "Freeze regulated rail fares for one year from March 2026",
    explanation:
      'Freezes regulated rail fares in England for one year from March 2026 - the first freeze in 30 years. Without the freeze, fares would have increased by 5.8% under the RPI formula. The Government estimates this will save passengers £600 million in 2026-27, with commuters on expensive routes saving over £300 per year. See our <a href="https://policyengine.org/uk/research/rail-fares-freeze-2025" target="_blank" rel="noopener noreferrer">research report</a> for details.',
  },
  {
    id: "threshold_freeze_extension",
    name: "Threshold freeze extension",
    description: "Extend the freeze on income tax thresholds to 2030-31",
    explanation:
      "This policy extends the freeze on income tax thresholds from 2027-28 to 2030-31. The personal allowance remains frozen at £12,570, the higher-rate threshold at £50,270, and the additional-rate threshold at £125,140. The NICs secondary threshold is also frozen. By 2030-31, the OBR estimates this will bring 5.2 million additional individuals into paying income tax.",
  },
  {
    id: "dividend_tax_increase_2pp",
    name: "Dividend tax increase (+2pp)",
    description:
      "Increase dividend tax rates by 2 percentage points from April 2026",
    explanation:
      "Increases dividend tax rates by 2 percentage points from April 2026. Basic rate: 8.75% → 10.75%, Higher rate: 33.75% → 35.75%. The additional rate remains at 39.35%. OBR estimates this will raise £1.0-1.1bn annually from 2027-28.",
  },
  {
    id: "savings_tax_increase_2pp",
    name: "Savings income tax increase (+2pp)",
    description:
      "Increase savings income tax rates by 2 percentage points from April 2027",
    explanation:
      "Increases savings income tax rates by 2 percentage points from April 2027. Basic: 20% → 22%, Higher: 40% → 42%, Additional: 45% → 47%. OBR estimates this will raise £0.5bn annually from 2028-29. Note: FRS data may underreport savings income.",
  },
  {
    id: "property_tax_increase_2pp",
    name: "Property income tax increase (+2pp)",
    description:
      "Increase property income tax rates by 2 percentage points from April 2027",
    explanation:
      "Increases property income tax rates by 2 percentage points from April 2027. Basic: 20% → 22%, Higher: 40% → 42%, Additional: 45% → 47%. OBR estimates this will raise £0.4-0.6bn annually from 2028-29. Note: Property income may not be fully captured in FRS.",
  },
  {
    id: "freeze_student_loan_thresholds",
    name: "Freeze student loan repayment thresholds",
    description:
      "Freeze Plan 2 repayment thresholds from 2027-28 to 2029-30",
    explanation:
      "Freezes the Plan 2 student loan repayment threshold at £29,385 for three years from April 2027, instead of allowing RPI uprating. This means graduates start repaying at a lower real income level, increasing repayments. OBR estimates this raises £255-355m annually from 2027-30. Note: The OBR figure for 2026-27 (£5.9bn) is significantly higher because it includes a one-off student loan revaluation that year, where the Government revalued existing student loan balances. Our microsimulation focuses only on the threshold freeze starting in 2027.",
  },
  {
    id: "salary_sacrifice_cap",
    name: "Salary sacrifice cap",
    description: "Cap NI-free salary sacrifice pension contributions at £2,000",
    explanation:
      'Caps National Insurance-free salary sacrifice pension contributions at £2,000 per year from April 2029. Contributions above this threshold become subject to employee and employer NICs. PolicyEngine estimates this will raise £3.3bn in 2029-30, assuming employers spread costs and employees maintain pension contributions. The OBR estimates £4.9bn (static) or £4.7bn (post-behavioural). See our <a href="https://policyengine.org/uk/research/uk-salary-sacrifice-cap" target="_blank" rel="noopener noreferrer">research report</a> for details.',
  },
];

// Preset policy combinations
const PRESETS = [
  {
    id: "autumn-budget",
    name: "Autumn Budget 2026",
    policies: POLICIES.map((p) => p.id),
  },
];

// The ui-kit shell's sticky site nav, as globals.css selects it to make it
// scroll away (@policyengine/ui-kit 0.12.0). Kept in step with globals.css.
export const SHELL_STICKY_NAV_SELECTOR =
  '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';

/** A section's title and one-line subtitle, on the page above its cards. */
function SectionHeading({ title, subtitle }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");

  // Parse a single CSV line handling quoted fields
  const parseLine = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx];
    });
    data.push(row);
  }
  return data;
}

function App() {
  const [selectedPolicies, setSelectedPolicies] = useState(
    POLICIES.map((p) => p.id),
  );
  // Default to 2029 so more policies have visible impact
  const [selectedYear, setSelectedYear] = useState(2030);
  // Shared year for distributional analysis charts (WaterfallChart and DistributionalChart)
  const [distributionalYear, setDistributionalYear] = useState(2029);
  const [results, setResults] = useState(null);
  const [showPolicyDetails, setShowPolicyDetails] = useState(false);
  const [showOBRComparison, setShowOBRComparison] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Valid policy IDs from POLICIES
  const validPolicyIds = POLICIES.map((p) => p.id);

  // Initialize from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const policiesParam = params.get("policies");
    const tabParam = params.get("tab");

    if (tabParam === "personal") {
      setActiveTab("personal");
    }

    if (policiesParam) {
      // Filter to only include valid policy IDs
      const policies = policiesParam
        .split(",")
        .filter((id) => validPolicyIds.includes(id));
      setSelectedPolicies(policies);
    }
  }, []);

  // Update URL when policies or tab change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Preserve personal impact data if present
    const personalParam = params.get("personal");

    if (activeTab === "personal") {
      params.set("tab", "personal");
      params.delete("policies");
    } else {
      params.delete("tab");
      if (selectedPolicies.length > 0) {
        params.set("policies", selectedPolicies.join(","));
      } else {
        params.delete("policies");
      }
    }

    // Re-add personal param if it was there
    if (personalParam) {
      params.set("personal", personalParam);
    }

    const newUrl = params.toString()
      ? `?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }, [selectedPolicies, activeTab]);

  // Run analysis when policies or year change
  useEffect(() => {
    if (selectedPolicies.length === 0) {
      setResults(null);
      return;
    }

    runAnalysis();
  }, [selectedPolicies, selectedYear]);

  const runAnalysis = async () => {
    try {
      // Fetch all CSVs in parallel
      const [
        budgetaryRes,
        distributionalRes,
        winnersLosersRes,
        metricsRes,
      ] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/budgetary_impact.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/distributional_impact.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/winners_losers.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/metrics.csv`),
      ]);

      const budgetaryData = parseCSV(await budgetaryRes.text());
      const distributionalData = parseCSV(await distributionalRes.text());
      const winnersLosersData = parseCSV(await winnersLosersRes.text());
      const metricsData = parseCSV(await metricsRes.text());

      // Filter data for selected policies
      const filteredBudgetary = budgetaryData.filter((row) =>
        selectedPolicies.includes(row.reform_id),
      );
      const filteredDistributional = distributionalData.filter((row) =>
        selectedPolicies.includes(row.reform_id),
      );
      const filteredWinnersLosers = winnersLosersData.filter((row) =>
        selectedPolicies.includes(row.reform_id),
      );
      const filteredMetrics = metricsData.filter((row) =>
        selectedPolicies.includes(row.reform_id),
      );

      // Build budgetary impact data for chart (2026-2029)
      // Always include all policy keys for smooth animations
      const years = [2026, 2027, 2028, 2029, 2030];
      const budgetData = years.map((year) => {
        const dataPoint = { year };
        let netImpact = 0;
        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = budgetaryData.find(
            (row) => row.reform_id === policy.id && parseInt(row.year) === year,
          );
          const value = isSelected && dataRow ? parseFloat(dataRow.value) : 0;
          dataPoint[policy.name] = value;
          netImpact += value;
        });
        dataPoint.netImpact = netImpact;
        return dataPoint;
      });

      // Calculate budgetary impact for 2026 (metrics always show 2026)
      const budgetaryImpact2026 = filteredBudgetary
        .filter((row) => parseInt(row.year) === 2026)
        .reduce((sum, row) => sum + parseFloat(row.value), 0);

      // Build distributional data (grouped by decile with policy breakdown)
      // Always include all policy keys for smooth animations
      const decileOrder = [
        "1st",
        "2nd",
        "3rd",
        "4th",
        "5th",
        "6th",
        "7th",
        "8th",
        "9th",
        "10th",
      ];
      const distributionalSelectedYear = distributionalData.filter(
        (row) => parseInt(row.year) === selectedYear,
      );
      const distributionalChartData = decileOrder.map((decile) => {
        const dataPoint = { decile };
        let netChange = 0;
        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = distributionalSelectedYear.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          const value = isSelected && dataRow ? parseFloat(dataRow.value) : 0;
          dataPoint[policy.name] = value;
          netChange += value;
        });
        dataPoint.netChange = netChange;
        return dataPoint;
      });

      // Build waterfall data (grouped by decile with policy breakdown)
      // Always include all policy keys for smooth animations
      const waterfallSelectedYear = winnersLosersData.filter(
        (row) => parseInt(row.year) === selectedYear && row.decile !== "all",
      );
      const waterfallDeciles = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
      ];
      const waterfallData = waterfallDeciles.map((decile) => {
        const dataPoint = { decile };
        let netChange = 0;
        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = waterfallSelectedYear.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          const value =
            isSelected && dataRow ? parseFloat(dataRow.avg_change) : 0;
          dataPoint[policy.name] = value;
          netChange += value;
        });
        dataPoint.netChange = netChange;
        return dataPoint;
      });

      // Extract metrics for 2026 (metrics always show 2026)
      const metrics2026 = filteredMetrics.find(
        (row) => parseInt(row.year) === 2026,
      );
      const percentAffected = metrics2026
        ? parseFloat(metrics2026.people_affected)
        : null;
      const giniChange = metrics2026
        ? parseFloat(metrics2026.gini_change)
        : null;
      const povertyRateChange = metrics2026
        ? parseFloat(metrics2026.poverty_change_pp)
        : null;

      // Calculate total revenue over budget window (2026-2029)
      const budgetWindowRevenue = filteredBudgetary.reduce(
        (sum, row) => sum + parseFloat(row.value),
        0,
      );

      setResults({
        metrics: {
          budgetaryImpact2026,
          budgetWindowRevenue,
          percentAffected,
          giniChange,
          povertyRateChange,
        },
        budgetData,
        distributionalData:
          distributionalChartData.length > 0 ? distributionalChartData : null,
        waterfallData: waterfallData.length > 0 ? waterfallData : null,
        rawDistributional: filteredDistributional,
        rawWinnersLosers: filteredWinnersLosers,
      });
    } catch (error) {
      console.error("Error loading results:", error);
      setResults(null);
    }
  };

  const handlePolicyToggle = (policyId) => {
    setSelectedPolicies((prev) => {
      if (prev.includes(policyId)) {
        return prev.filter((id) => id !== policyId);
      } else {
        return [...prev, policyId];
      }
    });
  };

  const handlePresetClick = (presetPolicies) => {
    setSelectedPolicies(presetPolicies);
  };

  const titleSentinelRef = useRef(null);
  const [titleStuck, setTitleStuck] = useState(false);
  useEffect(() => {
    const sentinel = titleSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setTitleStuck(!entry.isIntersecting),
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // globals.css un-sticks the ui-kit site nav with a selector written
  // against the shell's markup. Say so in development if it stops matching.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!document.querySelector(SHELL_STICKY_NAV_SELECTOR)) {
      console.warn(
        "The ui-kit site nav was not found by SHELL_STICKY_NAV_SELECTOR; " +
          "update it in App.jsx and globals.css so only the title row is sticky.",
      );
    }
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  // Open the policy notes (collapsed by default) and scroll to them.
  const handleSectionJump = (id) => {
    if (id === "policy-details") setShowPolicyDetails(true);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  return (
    <div className="app">
      <main className="main-content">
        {/* The title row is the page's sticky header: it docks at the top
            once the reader scrolls past it, compact, with the policy
            selector still in reach. The sentinel tells it when it is stuck. */}
        <div ref={titleSentinelRef} className="title-sentinel" aria-hidden="true" />
        <div className={`title-row ${titleStuck ? "is-stuck" : ""}`}>
          <h1>UK Autumn Budget 2026</h1>

          {/* The view (Population or Personal impact): a pill like the
              year and policy pills, switching the tab panel below */}
          <div className="band-view">
            <PillSelect
              name="View"
              label="impact"
              value={activeTab}
              onChange={handleTabChange}
              options={[
                { value: "dashboard", label: "Population impact", badge: "Population" },
                { value: "personal", label: "Personal impact", badge: "Personal" },
              ]}
            />
          </div>

          {activeTab === "dashboard" && (
            <>
              {/* The year applies to every chart below the revenue chart,
                  which highlights it; it lives in the band so it can be
                  changed from anywhere on the page. */}
              <div className="band-year">
                <YearSlider
                  selectedYear={distributionalYear}
                  onYearChange={setDistributionalYear}
                />
              </div>
              <div className="band-policy">
                <PolicySelector
                  policies={POLICIES}
                  selectedPolicies={selectedPolicies}
                  onPolicyToggle={handlePolicyToggle}
                />
              </div>
            </>
          )}
        </div>

        {activeTab === "personal" ? (
          <div
            id="panel-personal"
            role="region"
            aria-label="Personal impact"
            className="tab-panel"
          >
            <PersonalImpactTab />
          </div>
        ) : (
          <div
            id="panel-dashboard"
            role="region"
            aria-label="Population impact"
            className="tab-panel"
          >
            {/* Lead: what the page shows, and where its controls are */}
            <p className="dashboard-intro">
              The fiscal and distributional effects of the UK Autumn Budget
              2026 measures. Choose policies and a year in the bar above;{" "}
              <a
                href="#policy-details"
                onClick={(e) => {
                  e.preventDefault();
                  handleSectionJump("policy-details");
                }}
              >
                policy details
              </a>{" "}
              are at the bottom of the page.
            </p>

            {selectedPolicies.length === 0 ? (
              <div className="empty-state">
                <p>
                  Select policies to analyse their impact on government revenue
                  and household incomes.
                </p>
                <div className="preset-buttons">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className="preset-button"
                      onClick={() => handlePresetClick(preset.policies)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="results-container">
                {results && (
                  <>
                    {/* Hero Chart: Revenue Impact */}
                    <SectionHeading
                      title="Public finances"
                      subtitle="Net effect of the selected policies on government revenue and spending, by year."
                    />
                    <section id="revenue" className="report-section hero-chart">
                      <BudgetaryImpactChart
                        data={DISPLAY_YEARS.map(
                          (year) =>
                            results.budgetData.find((point) => point.year === year) ?? {
                              // In the config, not yet in the published files
                              year,
                              netImpact: null,
                              unpublished: true,
                            },
                        )}
                        selectedYear={distributionalYear}
                      />
                      {/* OBR comparison: an expandable row at the foot of the card */}
                      <div id="obr-comparison" className="obr-expandable">
                        <button
                          type="button"
                          className="obr-toggle-button"
                          aria-expanded={showOBRComparison}
                          onClick={() => setShowOBRComparison(!showOBRComparison)}
                        >
                          Compare with OBR estimates
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            style={{
                              transform: showOBRComparison
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                              transition: "transform 0.2s",
                            }}
                          >
                            <polyline points="6 9 12 15 18 9"></polyline>
                          </svg>
                        </button>
                        {showOBRComparison && (
                          <div className="obr-content">
                            <OBRComparisonTable selectedPolicies={selectedPolicies} />
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Row 1: Absolute and Relative Impact (the year is chosen in the title band) */}
                    <SectionHeading
                      title="Households by income"
                      subtitle="How net income changes across the income distribution in the selected year."
                    />
                    <section
                      id="deciles"
                      className="report-section distributional-section"
                    >
                      <div className="charts-grid">
                        <WaterfallChart
                          rawData={results.rawWinnersLosers}
                          selectedPolicies={selectedPolicies}
                          selectedYear={distributionalYear}
                        />
                        <DistributionalChart
                          rawData={results.rawDistributional}
                          selectedPolicies={selectedPolicies}
                          selectedYear={distributionalYear}
                        />
                      </div>
                    </section>

                    {/* Row 2: the constituency map beside the household
                        scatter. The scatter is a template until binned
                        household results are published: the per-household
                        scatter stays withdrawn, as it showed survey
                        households one by one. Results by region are hidden
                        for now (RegionView is kept, not rendered). */}
                    <SectionHeading
                      title="Where and who"
                      subtitle="Average change by constituency, and how changes vary between households."
                    />
                    <section
                      id="constituencies"
                      className="report-section charts-grid charts-row-2"
                    >
                      <ConstituencyMap
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        policies={POLICIES}
                        showRegionLink={false}
                        footer={<GeographyMethodology />}
                      />
                      <HouseholdScatterTemplate selectedYear={distributionalYear} />
                    </section>

                    {/* Row 3: Net Income Analysis Charts */}
                    <SectionHeading
                      title="Example household"
                      subtitle="Two adults aged 40 and three children aged 7, 5 and 3. The main earner pays £10,000 a year into a pension."
                    />
                    <section
                      id="household"
                      className="report-section charts-grid charts-row-3"
                    >
                      <EmploymentIncomeChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
                      <EmploymentIncomeDiffChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
                    </section>

                    {/* Policy Details Footer */}
                    <SectionHeading
                      title="Policies"
                      subtitle="What each selected policy does and how it is modelled."
                    />
                    <section
                      id="policy-details"
                      className="report-section policy-details-footer"
                    >
                      <button
                        type="button"
                        className="policy-details-toggle"
                        aria-expanded={showPolicyDetails}
                        onClick={() => setShowPolicyDetails(!showPolicyDetails)}
                      >
                        About selected policies
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{
                            transform: showPolicyDetails
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                            transition: "transform 0.2s",
                          }}
                        >
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </button>
                      {showPolicyDetails && (
                        <div className="policy-details-content">
                          {POLICIES.filter((policy) =>
                            selectedPolicies.includes(policy.id),
                          ).map((policy) => (
                            <div key={policy.id} className="policy-detail">
                              <strong>{policy.name}:</strong>{" "}
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: policy.explanation,
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <ReplicationLine />
      </main>
    </div>
  );
}

export default App;
