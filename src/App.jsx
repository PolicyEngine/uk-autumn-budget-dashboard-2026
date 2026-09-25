'use client';

import { useState, useEffect, useRef, useCallback } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import HouseholdChart from "./components/HouseholdChart";
import PersonalImpactTab from "./components/PersonalImpactTab";
import YearSlider from "./components/YearSlider";

import { POLICIES, LEGACY_POLICIES, CHART_POLICIES } from "./utils/policyConfig";

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

const validPolicyIds = CHART_POLICIES.map((p) => p.id);

function App() {
  const analysisRequest = useRef(0);
  const [selectedPolicies, setSelectedPolicies] = useState(
    POLICIES.map((p) => p.id),
  );
  // Show the first year in which transport measures have an effect.
  const [selectedYear, setSelectedYear] = useState(2027);
  // Shared year for distributional analysis charts (WaterfallChart and DistributionalChart)
  const [distributionalYear, setDistributionalYear] = useState(2027);
  const [results, setResults] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showPolicyDetails, setShowPolicyDetails] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Initialize from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const policiesParam = params.get("policies");
    const tabParam = params.get("tab");

    if (tabParam === "personal") {
      setActiveTab("personal");
    }

    if (policiesParam !== null) {
      // Filter to only include valid policy IDs
      const policies = policiesParam
        .split(",")
        .filter((id) => validPolicyIds.includes(id));
      setSelectedPolicies(policies.includes("autumn_budget_2025_combined")
        ? ["autumn_budget_2025_combined"]
        : policies);
    }
  }, []);

  // Update URL when policies or tab change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Preserve personal impact data if present
    const personalParam = params.get("personal");

    if (activeTab === "personal") {
      params.set("tab", "personal");
    } else {
      params.delete("tab");
    }
    params.set("policies", selectedPolicies.join(","));

    // Re-add personal param if it was there
    if (personalParam) {
      params.set("personal", personalParam);
    }

    const newUrl = params.toString()
      ? `?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }, [selectedPolicies, activeTab]);

  const runAnalysis = useCallback(async () => {
    const requestId = ++analysisRequest.current;
    try {
      setLoadError(null);
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

      for (const response of [budgetaryRes, distributionalRes, winnersLosersRes, metricsRes, householdScatterRes]) {
        if (!response.ok) throw new Error("Dashboard data could not be loaded. Please retry.");
      }
      const budgetaryData = parseCSV(await budgetaryRes.text());
      const distributionalData = parseCSV(await distributionalRes.text());
      const winnersLosersData = parseCSV(await winnersLosersRes.text());
      const metricsData = parseCSV(await metricsRes.text());
      const householdScatterData = parseCSV(await householdScatterRes.text());

      if (selectedPolicies.some((id) => !budgetaryData.some((row) => row.reform_id === id))) {
        throw new Error("Results for the selected policies are not available yet.");
      }
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
        CHART_POLICIES.forEach((policy) => {
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
        CHART_POLICIES.forEach((policy) => {
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
        CHART_POLICIES.forEach((policy) => {
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

      if (requestId !== analysisRequest.current) return;
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
      if (requestId !== analysisRequest.current) return;
      console.error("Error loading results:", error);
      setLoadError(error.message);
      setResults(null);
    }
  }, [selectedPolicies, selectedYear]);

  useEffect(() => {
    if (selectedPolicies.length) runAnalysis();
    return () => { analysisRequest.current += 1; };
  }, [selectedPolicies, runAnalysis]);

  const handlePolicyToggle = (policyId) => {
    setSelectedPolicies((prev) => {
      if (policyId === "autumn_budget_2025_combined") {
        return prev.includes(policyId) ? [] : [policyId];
      }
      if (prev.includes("autumn_budget_2025_combined")) {
        return [policyId];
      }
      if (prev.includes(policyId)) {
        return prev.filter((id) => id !== policyId);
      } else {
        return [...prev, policyId];
      }
    });
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
              policies={[
                ...POLICIES,
                ...LEGACY_POLICIES.filter((policy) => selectedPolicies.includes(policy.id)),
              ]}
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

        <p role="note" className="dashboard-intro">
          Years are model labels: annual income tax uses the UK tax year
          beginning in that year, while fuel and bus impacts use the calendar
          year. Combined totals mix those windows and are provisional, not
          directly comparable with OBR fiscal-year costings.
        </p>

        {activeTab === "personal" ? (
          <PersonalImpactTab
            key={selectedPolicies.join(",")}
            selectedPolicies={selectedPolicies}
          />
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
            <p role="note" className="dashboard-intro">
              Provisional data: the national estimates were rerun against the
              current reform code using a dataset whose certified release has
              not been verified. Aligned constituency weights and a certified
              rerun are still pending.
            </p>

            {selectedPolicies.length === 0 ? (
              <div className="empty-state">
                <p>
                  Select policies to analyse their impact on government revenue
                  and household incomes.
                </p>
                <button className="preset-button" onClick={() => setSelectedPolicies(POLICIES.map((policy) => policy.id))}>
                  Select all 2026 policies
                </button>
              </div>
            ) : (
              <div className="results-container">
                {loadError && <p role="alert">{loadError} <button onClick={runAnalysis}>Retry</button></p>}
                {!results && !loadError && <p role="status">Loading policy results…</p>}
                {results && (
                  <>
                    {/* Hero Chart: Revenue Impact */}
                    <div className="hero-chart">
                      <BudgetaryImpactChart data={results.budgetData} />
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
                      {results.rawHouseholdScatter && !selectedPolicies.some((id) =>
                        LEGACY_POLICIES.some((policy) => policy.id === id),
                      ) && (
                        <HouseholdChart
                          rawData={results.rawHouseholdScatter}
                          selectedPolicies={selectedPolicies}
                          selectedYear={distributionalYear}
                        />
                      )}
                      {selectedPolicies.some((id) =>
                        LEGACY_POLICIES.some((policy) => policy.id === id),
                      ) && (
                        <div className="chart-container">
                          <h3>Household sample</h3>
                          <p>Comparable sampled households are unavailable for historical policy links.</p>
                        </div>
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
