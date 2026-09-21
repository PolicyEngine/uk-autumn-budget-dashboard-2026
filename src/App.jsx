'use client';

import { useState, useEffect } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import HouseholdChart from "./components/HouseholdChart";
import OBRComparisonTable from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import YearSlider from "./components/YearSlider";

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
        householdScatterRes,
      ] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/budgetary_impact.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/distributional_impact.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/winners_losers.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/metrics.csv`),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/household_scatter.csv`),
      ]);

      const budgetaryData = parseCSV(await budgetaryRes.text());
      const distributionalData = parseCSV(await distributionalRes.text());
      const winnersLosersData = parseCSV(await winnersLosersRes.text());
      const metricsData = parseCSV(await metricsRes.text());
      const householdScatterData = parseCSV(await householdScatterRes.text());

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
      // Keep raw household scatter data (filtering will be done by component)
      const filteredHouseholdScatter = householdScatterData.filter((row) =>
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
        householdScatterData:
          filteredHouseholdScatter.length > 0 ? filteredHouseholdScatter : null,
        rawDistributional: filteredDistributional,
        rawWinnersLosers: filteredWinnersLosers,
        rawHouseholdScatter: filteredHouseholdScatter,
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

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  return (
    <div className="app">
      <main className="main-content">
        {/* Title row with controls */}
        <div className="title-row">
          <h1>UK Autumn Budget 2026</h1>
          {activeTab === "dashboard" && (
            <PolicySelector
              policies={POLICIES}
              selectedPolicies={selectedPolicies}
              onPolicyToggle={handlePolicyToggle}
            />
          )}
        </div>

        {/* Tab navigation */}
        <div className="tab-navigation">
          <button
            className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => handleTabChange("dashboard")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            Population impact
          </button>
          <button
            className={`tab-button ${activeTab === "personal" ? "active" : ""}`}
            onClick={() => handleTabChange("personal")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Personal impact
          </button>
        </div>

        {activeTab === "personal" ? (
          <PersonalImpactTab />
        ) : (
          <>
            {/* Dashboard description */}
            <p className="dashboard-intro">
              Explore the fiscal and distributional impacts of potential UK
              budget policies. Select policies to see how they affect government
              revenue, household incomes, and inequality across income groups.{" "}
              {selectedPolicies.length > 0 && (
                <a
                  href="#policy-details"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowPolicyDetails(true);
                    // Delay scroll to allow accordion to expand first
                    setTimeout(() => {
                      document
                        .getElementById("policy-details")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }, 50);
                  }}
                >
                  See policy descriptions below.
                </a>
              )}
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
                    <div className="hero-chart">
                      <BudgetaryImpactChart data={results.budgetData} />
                    </div>

                    {/* OBR Comparison (expandable) */}
                    <div className="obr-expandable">
                      <button
                        className="obr-toggle-button"
                        onClick={() => setShowOBRComparison(!showOBRComparison)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
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
                          style={{
                            transform: showOBRComparison
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                            transition: "transform 0.2s",
                            marginLeft: "auto",
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

                    {/* Row 1: Absolute and Relative Impact with shared year slider */}
                    <div className="distributional-section">
                      <div className="section-year-slider">
                        <YearSlider
                          selectedYear={distributionalYear}
                          onYearChange={setDistributionalYear}
                        />
                      </div>
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
                    </div>

                    {/* Row 2: Constituency Map and Scatter */}
                    <div className="charts-grid charts-row-2">
                      <ConstituencyMap
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
                      {results.rawHouseholdScatter && (
                        <HouseholdChart
                          rawData={results.rawHouseholdScatter}
                          selectedPolicies={selectedPolicies}
                          selectedYear={distributionalYear}
                        />
                      )}
                    </div>

                    {/* Row 3: Net Income Analysis Charts */}
                    <div className="charts-grid charts-row-3">
                      <EmploymentIncomeChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
                      <EmploymentIncomeDiffChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
                    </div>

                    {/* Policy Details Footer */}
                    <div id="policy-details" className="policy-details-footer">
                      <button
                        className="policy-details-toggle"
                        onClick={() => setShowPolicyDetails(!showPolicyDetails)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
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
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
