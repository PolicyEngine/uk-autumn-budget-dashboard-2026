'use client';

import { useState, useEffect, useRef } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import OBRComparisonTable from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatterTemplate from "./components/HouseholdScatterTemplate";
import { EXAMPLE_HOUSEHOLDS } from "./utils/exampleHouseholds";
import YearSlider from "./components/YearSlider";
import ViewTabs from "./components/ViewTabs";
import MethodologyTab, { METHOD_SECTIONS } from "./components/MethodologyTab";
import ReplicationLine from "./components/ReplicationLine";
import SectionHeading from "./components/SectionHeading";
import LivingStandardsTab from "./components/livingStandards/LivingStandardsTab";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
  REVENUE_RAISING_NAMES,
} from "./utils/policyConfig";
import { DISPLAY_YEARS } from "./utils/displayYears";

// Autumn Budget 2026 policy provisions
const POLICIES = [
  {
    id: "two_child_limit",
    name: "2 child limit repeal",
    description: "Repeal the two-child limit on benefits",
    explanation:
      "Removes the two-child limit in Universal Credit from April 2026, so families receive the child element for every child. The Government estimates this reduces child poverty by 450,000 by 2029-30.",
  },
  {
    id: "fuel_duty_freeze",
    name: "Fuel duty freeze extension",
    description: "Freeze fuel duty rates until September 2026",
    explanation:
      "Keeps fuel duty at 52.95p a litre until September 2026, then returns it to 57.95p in three steps (1p, 2p, 2p) by March 2027, with RPI uprating after that. Without the policy the 5p cut would end on 22 March 2026.",
  },
  {
    id: "rail_fares_freeze",
    name: "Rail fares freeze",
    description: "Freeze regulated rail fares for one year from March 2026",
    explanation:
      "Freezes regulated rail fares in England for a year from March 2026, instead of a 5.8% RPI-linked rise. The Government estimates passengers pay £600 million less in 2026-27.",
  },
  {
    id: "threshold_freeze_extension",
    name: "Threshold freeze extension",
    description: "Extend the freeze on income tax thresholds to 2030-31",
    explanation:
      "Keeps the personal allowance (£12,570), the higher-rate threshold (£50,270), the additional-rate threshold (£125,140) and the NICs secondary threshold frozen from 2027-28 to 2030-31. The OBR estimates 5.2 million more people pay income tax by 2030-31.",
  },
  {
    id: "dividend_tax_increase_2pp",
    name: "Dividend tax increase (+2pp)",
    description:
      "Increase dividend tax rates by 2 percentage points from April 2026",
    explanation:
      "Raises the basic and higher dividend tax rates by 2 points from April 2026 (8.75% → 10.75% and 33.75% → 35.75%); the additional rate stays at 39.35%. The OBR estimates £1.0–1.1bn a year from 2027-28.",
  },
  {
    id: "savings_tax_increase_2pp",
    name: "Savings income tax increase (+2pp)",
    description:
      "Increase savings income tax rates by 2 percentage points from April 2027",
    explanation:
      "Raises savings income tax rates by 2 points from April 2027 (to 22%, 42% and 47%). The OBR estimates £0.5bn a year from 2028-29. Survey data under-record savings income.",
  },
  {
    id: "property_tax_increase_2pp",
    name: "Property income tax increase (+2pp)",
    description:
      "Increase property income tax rates by 2 percentage points from April 2027",
    explanation:
      "Raises property income tax rates by 2 points from April 2027 (to 22%, 42% and 47%). The OBR estimates £0.4–0.6bn a year from 2028-29. Survey data may not capture all property income.",
  },
  {
    id: "freeze_student_loan_thresholds",
    name: "Freeze student loan repayment thresholds",
    description:
      "Freeze Plan 2 repayment thresholds from 2027-28 to 2029-30",
    explanation:
      "Freezes the Plan 2 repayment threshold at £29,385 for three years from April 2027, instead of uprating it with RPI. The OBR estimates £255–355m a year in 2027-28 to 2029-30; its larger 2026-27 figure includes a one-off revaluation of loan balances, which this model leaves out.",
  },
  {
    id: "salary_sacrifice_cap",
    name: "Salary sacrifice cap",
    description: "Cap NI-free salary sacrifice pension contributions at £2,000",
    explanation:
      "Caps National Insurance-free salary sacrifice pension contributions at £2,000 a year from April 2029; contributions above the cap pay employee and employer NICs. The model assumes employers spread the cost and employees keep their contributions. Compare PolicyEngine and OBR estimates in the Public finances section.",
  },
];

// The views, as tabs under the intro. `year` and `policies` say which of
// the band's pills apply to a view; the others keep their place in the band
// but are hidden. The Living standards view is the pre-Budget baseline
// outlook, and Methodology is text: neither pill applies to them.
export const VIEWS = [
  { value: "dashboard", label: "Population impact", year: true, policies: true },
  { value: "personal", label: "Personal impact", year: false, policies: true },
  { value: "young", label: "Young people", year: true, policies: true },
  { value: "living", label: "Living standards", year: false, policies: false },
  { value: "methodology", label: "Methodology", year: false, policies: false },
];

const VIEW_BY_KEY = Object.fromEntries(VIEWS.map((view) => [view.value, view]));

// The default view has no ?tab= in the URL; ?tab=dashboard is read too
const DEFAULT_VIEW = "dashboard";

// Views whose links keep the chosen policies in the URL
const POLICY_PARAM_VIEWS = new Set(["dashboard", "young"]);

const tabId = (view) => `tab-${view}`;
const panelId = (view) => `panel-${view}`;

/** The view a page address opens: #young-people, else ?tab=, else the default. */
export function viewFromLocation({ search, hash }) {
  if (hash === `#${YOUNG_PEOPLE_ANCHOR}`) return "young";
  const tab = new URLSearchParams(search).get("tab");
  return VIEW_BY_KEY[tab] ? tab : DEFAULT_VIEW;
}

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
    setActiveTab(viewFromLocation(window.location));

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

    if (activeTab === DEFAULT_VIEW) {
      params.delete("tab");
    } else {
      params.set("tab", activeTab);
    }
    if (POLICY_PARAM_VIEWS.has(activeTab) && selectedPolicies.length > 0) {
      params.set("policies", selectedPolicies.join(","));
    } else {
      params.delete("policies");
    }

    // Re-add personal param if it was there
    if (personalParam) {
      params.set("personal", personalParam);
    }

    const newUrl = `${params.toString() ? `?${params.toString()}` : window.location.pathname}${window.location.hash}`;
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

  // A link to #young-people from elsewhere on the page opens its view
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) setActiveTab("young");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The tab bar's place in the page, before it sticks under the band
  const tabsSentinelRef = useRef(null);

  // Switch view. If the reader had scrolled past the tabs, bring the new
  // view's top up under them, so it does not open part way down.
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    // A hash that belongs to the Young people view goes when another view
    // is chosen, so the address never opens a different view from this one
    if (tab !== "young" && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    const sentinel = tabsSentinelRef.current;
    if (!sentinel) return;
    const band = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--title-row-height"),
    ) || 0;
    const top = sentinel.getBoundingClientRect().top + window.scrollY - band;
    if (window.scrollY > top) window.scrollTo({ top });
  };

  // Open the Methodology view at one of its sections
  const showMethod = (sectionId) => {
    handleTabChange("methodology");
    setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const view = VIEW_BY_KEY[activeTab] ?? VIEW_BY_KEY[DEFAULT_VIEW];

  // With no policies chosen, the policy-driven views offer the full Budget
  const emptyState = (
    <div className="empty-state">
      <p>
        Select policies to analyse their impact on government revenue and
        household incomes.
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
  );


  return (
    <div className="app">
      <main className="main-content">
        {/* The title row is the page's sticky header: it docks at the top
            once the reader scrolls past it, compact, with the policy
            selector still in reach. The sentinel tells it when it is stuck. */}
        <div ref={titleSentinelRef} className="title-sentinel" aria-hidden="true" />
        <div className={`title-row ${titleStuck ? "is-stuck" : ""}`}>
          <h1>UK Autumn Budget 2026</h1>

          {/* The year applies to every chart on the Population and Young
              people views, and the revenue chart highlights it; it lives in
              the band so it can be changed from anywhere. The policy pill
              applies to those views and Personal impact. A pill that does
              not apply keeps its place but is hidden, so the band does not
              move. */}
          <div
            className={`band-year ${view.year ? "" : "is-hidden"}`}
            aria-hidden={view.year ? undefined : "true"}
            inert={!view.year}
          >
            <YearSlider
              selectedYear={distributionalYear}
              onYearChange={setDistributionalYear}
            />
          </div>
          <div
            className={`band-policy ${view.policies ? "" : "is-hidden"}`}
            aria-hidden={view.policies ? undefined : "true"}
            inert={!view.policies}
          >
            <PolicySelector
              policies={POLICIES}
              selectedPolicies={selectedPolicies}
              onPolicyToggle={handlePolicyToggle}
            />
          </div>
        </div>

        {/* Lead: what the page shows, and where its controls are. It sits
            above the tabs, so it holds for every view. */}
        <p className="dashboard-intro">
          The fiscal and distributional effects of the UK Autumn Budget 2026
          measures. Choose policies and a year in the bar above.
        </p>

        <div ref={tabsSentinelRef} className="view-tabs-sentinel" aria-hidden="true" />
        <ViewTabs
          tabs={VIEWS}
          value={activeTab}
          onChange={handleTabChange}
          tabId={tabId}
          panelId={panelId}
        />

        <div
          id={panelId(activeTab)}
          role="tabpanel"
          aria-labelledby={tabId(activeTab)}
          className="tab-panel"
        >
        {/* Which policies the charts below show, when not all */}
        {POLICY_PARAM_VIEWS.has(activeTab) &&
          selectedPolicies.length > 0 &&
          selectedPolicies.length < POLICIES.length && (
            <p className="showing-line">
              {selectedPolicies.length === 1
                ? `Showing: ${
                    POLICIES.find((policy) => policy.id === selectedPolicies[0])?.name
                  }`
                : `Showing ${selectedPolicies.length} of ${POLICIES.length} policies`}
            </p>
          )}
        {activeTab === "living" ? (
          <LivingStandardsTab />
        ) : activeTab === "methodology" ? (
          <MethodologyTab onShowTab={handleTabChange} />
        ) : activeTab === "personal" ? (
          <PersonalImpactTab
            selectedPolicies={selectedPolicies}
            policies={POLICIES}
            onShowMethod={showMethod}
          />
        ) : activeTab === "young" ? (
          selectedPolicies.length === 0 ? (
            emptyState
          ) : (
            // Young people (under 25): results by age, #young-people
            <YoungPeopleSection
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
              policies={POLICIES}
            />
          )
        ) : (
          <>
            {selectedPolicies.length === 0 ? (
              emptyState
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
                            <OBRComparisonTable
                              selectedPolicies={selectedPolicies}
                              selectedYear={distributionalYear}
                            />
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
                        footer={
                          <p className="map-method-link">
                            <a
                              href={`?tab=methodology#${METHOD_SECTIONS.geography}`}
                              onClick={(event) => {
                                event.preventDefault();
                                showMethod(METHOD_SECTIONS.geography);
                              }}
                            >
                              How these figures are estimated
                            </a>
                          </p>
                        }
                      />
                      <HouseholdScatterTemplate selectedYear={distributionalYear} />
                    </section>

                    {/* Row 3: example households. Each card has its own
                        household chooser, starting on different ones. */}
                    <SectionHeading
                      title="Example households"
                      subtitle="Net income of five example households across their incomes. Choose a household in each chart."
                    />
                    <section
                      id="household"
                      className="report-section charts-grid charts-row-3"
                    >
                      <EmploymentIncomeChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        defaultHousehold={EXAMPLE_HOUSEHOLDS[0].id}
                      />
                      <EmploymentIncomeDiffChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        defaultHousehold={EXAMPLE_HOUSEHOLDS[1].id}
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
                          {[
                            ["Raise revenue", true],
                            ["Cost revenue", false],
                          ].map(([heading, raises]) => {
                            const items = ALL_POLICY_NAMES.map((name) =>
                              POLICIES.find((policy) => policy.name === name),
                            ).filter(
                              (policy) =>
                                policy &&
                                selectedPolicies.includes(policy.id) &&
                                REVENUE_RAISING_NAMES.has(policy.name) === raises,
                            );
                            if (!items.length) return null;
                            return (
                              <div key={heading} className="policy-group">
                                <h3 className="policy-group-heading">{heading}</h3>
                                <div className="policy-grid">
                                  {items.map((policy) => (
                                    <div key={policy.id} className="policy-detail">
                                      <p className="policy-detail-name">
                                        <span
                                          className="policy-detail-swatch"
                                          style={{ background: POLICY_COLORS[policy.name] }}
                                          aria-hidden="true"
                                        />
                                        {policy.name}
                                      </p>
                                      <p className="policy-detail-text">{policy.explanation}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}
          </>
        )}
        </div>
        <ReplicationLine />
      </main>
    </div>
  );
}

export default App;
