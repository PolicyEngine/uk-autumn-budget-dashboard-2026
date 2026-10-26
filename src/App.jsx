'use client';

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ZeroMeasuresNote from "./components/ZeroMeasuresNote";
import { decileMembership } from "./utils/legendMembership";
import ConstituencyMap from "./components/ConstituencyMap";
import { ObrComparisonFoot } from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatter from "./components/HouseholdScatter";
import YearSlider from "./components/YearSlider";
import SourceLink from "./components/SourceLink";
import useScrollReveal from "./hooks/useScrollReveal";
import ViewTabs from "./components/ViewTabs";
import { SUB_TAB_PARAM } from "./components/SubTabs";
import MethodologyTab from "./components/MethodologyTab";
import ReplicationLine from "./components/ReplicationLine";
import SectionHeading from "./components/SectionHeading";
import LivingStandardsTab from "./components/livingStandards/LivingStandardsTab";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import PensionersSection from "./components/PensionersSection";
import PopulationImpactView from "./components/PopulationImpactView";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";
import { buildBudgetData } from "./utils/budgetData";
import { POLICIES } from "./utils/policies";
import PolicyCards from "./components/PolicyCards";
import SummaryMetricChart, { SUMMARY_METRICS } from "./components/SummaryMetricChart";

// The views, as tabs under the intro. `year` and `policies` say which of
// the band's pills apply to a view; the others keep their place in the band
// but are hidden. Pre-measures forecast is the outlook before the Budget's
// measures, Policies describes every measure and Methodology is text: no
// pill applies to them. Population impact's sub-tabs (Public finances, All
// households, Young people, Pensioners, Living standards, Poverty) are in
// PopulationImpactView.
export const VIEWS = [
  { value: "dashboard", label: "Population impact", year: true, policies: true },
  { value: "household", label: "Household impact", year: true, policies: true },
  { value: "outlook", label: "Pre-measures forecast", year: false, policies: false },
  { value: "policies", label: "Policies", year: false, policies: false },
  { value: "methodology", label: "Methodology", year: false, policies: false },
];

const VIEW_BY_KEY = Object.fromEntries(VIEWS.map((view) => [view.value, view]));

// Old ?tab= values still opened by shared links, and the view each is now;
// the address is rewritten to the new value
// (?tab=living was the pre-measures forecast's address; its ?sub= values,
// baseline and forecast, carry over unchanged)
const VIEW_ALIASES = { personal: "household", living: "outlook" };
const viewKey = (tab) => VIEW_ALIASES[tab] ?? tab;

// The default view has no ?tab= in the URL; ?tab=dashboard is read too
const DEFAULT_VIEW = "dashboard";

// Views whose links keep the chosen policies in the URL
const POLICY_PARAM_VIEWS = new Set(["dashboard"]);

const tabId = (view) => `tab-${view}`;
const panelId = (view) => `panel-${view}`;

/** Whether the band's year pill applies: on the views that use a year. */
export function yearPillShown(view) {
  return Boolean(VIEW_BY_KEY[view]?.year);
}

/**
 * Whether a page address is an old link to the Young people view
 * (#young-people or ?tab=young), now Population impact's Young people
 * sub-tab.
 */
export function opensYoungPeople({ search, hash }) {
  return (
    hash === `#${YOUNG_PEOPLE_ANCHOR}` || new URLSearchParams(search).get("tab") === "young"
  );
}

/**
 * Whether a page address is an old link to the example households' income
 * charts (#household on Population impact), now on Household impact.
 */
export function opensIncomeCurves({ search, hash }) {
  if (hash !== "#household") return false;
  const tab = new URLSearchParams(search).get("tab");
  return !tab || tab === DEFAULT_VIEW;
}

/** The view a page address opens: an old Young people link, else ?tab=, else the default. */
export function viewFromLocation({ search, hash }) {
  if (opensYoungPeople({ search, hash })) return DEFAULT_VIEW;
  if (opensIncomeCurves({ search, hash })) return "household";
  const tab = viewKey(new URLSearchParams(search).get("tab"));
  return VIEW_BY_KEY[tab] ? tab : DEFAULT_VIEW;
}

// Preset policy combinations
// Every measure, for Policies (which ignores the band's selection)
const ALL_POLICY_IDS = POLICIES.map((p) => p.id);

const PRESETS = [
  {
    id: "autumn-budget",
    name: "All measures",
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

/** Take the open sub-tab (?sub=) out of the address, or put `sub` there. */
function dropSubTab(sub) {
  const params = new URLSearchParams(window.location.search);
  if (!sub && !params.has(SUB_TAB_PARAM)) return;
  if (sub) params.set(SUB_TAB_PARAM, sub);
  else params.delete(SUB_TAB_PARAM);
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
}

function App() {
  const [selectedPolicies, setSelectedPolicies] = useState(
    POLICIES.map((p) => p.id),
  );
  // Both start on DEFAULT_DISPLAY_YEAR (2027-28); there is no ?year param
  const [selectedYear] = useState(DEFAULT_DISPLAY_YEAR);
  // The year every chart shows, chosen with the header pill
  const [distributionalYear, setDistributionalYear] = useState(DEFAULT_DISPLAY_YEAR);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  // Cards fade and rise in as they scroll into view
  const mainRef = useRef(null);
  useScrollReveal(mainRef);
  // The views opened so far: each stays mounted once opened, hidden while
  // another is shown, so its state, open expanders and any calculation in
  // flight carry on
  const [visited, setVisited] = useState(["dashboard"]);
  if (!visited.includes(activeTab)) setVisited([...visited, activeTab]);

  // Valid policy IDs from POLICIES
  const validPolicyIds = POLICIES.map((p) => p.id);

  // Initialize from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const policiesParam = params.get("policies");
    // An old link to the Young people view opens its sub-tab; the hash
    // stays, so the page scrolls to the section
    if (opensYoungPeople(window.location)) dropSubTab("young");
    // An old link to the income charts (?sub=all#household) opens Household
    // impact, which has no sub-tabs
    else if (opensIncomeCurves(window.location)) dropSubTab();
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

      // One point per shown year, from the years the file covers (the
      // year list used to be hardcoded and stopped at 2030-31)
      const budgetData = buildBudgetData(
        budgetaryData,
        POLICIES,
        selectedPolicies,
      );

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
        // Every run's rows: the summary statistics read one run, not a sum
        rawMetrics: metricsData,
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

  // A link to #young-people from elsewhere on the page opens Population
  // impact's Young people sub-tab (PopulationImpactView shows it if open)
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
        dropSubTab("young");
        setActiveTab(DEFAULT_VIEW);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The tab bar's place in the page, before it sticks under the band
  const tabsSentinelRef = useRef(null);

  // Switch view. If the reader had scrolled past the tabs, bring the new
  // view's top up under them, so it does not open part way down. The band
  // can change height with the view (compact on a phone when the view has
  // no year pill), so this runs once the new view is laid out.
  const appRef = useRef(null);
  const tabScrollPending = useRef(false);
  // Each view's scroll position when it was left, to return to it
  const tabScroll = useRef({});
  // `sub` opens the new view at one of its sub-tabs (Methodology's links).
  const handleTabChange = (requested, sub) => {
    const tab = viewKey(requested);
    // A sub-tab (?sub=, SubTabs.jsx) belongs to the view that wrote it, so
    // it goes before another view opens and reads the address
    if (tab !== activeTab) {
      dropSubTab(sub);
      tabScroll.current[activeTab] = window.scrollY;
    }
    setActiveTab(tab);
    // A hash that belongs to the Young people sub-tab goes when another view
    // is chosen, so the address never opens a different view from this one
    if (tab !== DEFAULT_VIEW && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    // Choosing the open view changes nothing, so there is nothing to keep
    tabScrollPending.current = tab !== activeTab;
  };
  // A Policies card's "See its effect": Population impact with only that
  // measure selected (the address then carries ?policies=<id>)
  const handleShowEffect = (policyId) => {
    setSelectedPolicies([policyId]);
    handleTabChange("dashboard");
  };
  useLayoutEffect(() => {
    if (!tabScrollPending.current) return;
    tabScrollPending.current = false;
    const sentinel = tabsSentinelRef.current;
    if (!sentinel || !appRef.current) return;
    const band =
      parseFloat(getComputedStyle(appRef.current).getPropertyValue("--title-row-height")) || 0;
    const top = sentinel.getBoundingClientRect().top + window.scrollY - band;
    // A view opened before returns to where it was left, if that was below
    // the tabs; otherwise the tabs come back up under the band
    const saved = tabScroll.current[activeTab];
    if (saved !== undefined && saved > top) window.scrollTo({ top: saved });
    else if (window.scrollY > top) window.scrollTo({ top });
  }, [activeTab]);

  const view = VIEW_BY_KEY[activeTab] ?? VIEW_BY_KEY[DEFAULT_VIEW];
  const yearShown = yearPillShown(activeTab);

  // Which policies the charts show, when not all (under Population
  // impact's sub-tabs)
  const showingLine = selectedPolicies.length > 0 &&
    selectedPolicies.length < POLICIES.length && (
      <p className="showing-line">
        {selectedPolicies.length === 1
          ? `Showing: ${
              POLICIES.find((policy) => policy.id === selectedPolicies[0])?.name
            }`
          : `Showing ${selectedPolicies.length} of ${POLICIES.length} policies`}
      </p>
    );

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


  // A Population impact sub-tab's content. With no policies chosen, each
  // offers the full Budget; the charts wait for the CSVs.
  const populationPanel = (sub) => {
    if (selectedPolicies.length === 0) return emptyState;
    if (sub === "young") {
      // Young people (16 to 24): results by age, #young-people
      return (
        <YoungPeopleSection
          selectedPolicies={selectedPolicies}
          selectedYear={distributionalYear}
          policies={POLICIES}
        />
      );
    }
    if (sub === "pensioners") {
      // Pensioners (at or over State Pension age): results by age
      return (
        <PensionersSection
          selectedPolicies={selectedPolicies}
          selectedYear={distributionalYear}
          policies={POLICIES}
          onOpenHousehold={() => handleTabChange("household")}
        />
      );
    }
    if (!results) return null;
    if (sub === "living") {
      return (
        <div className="results-container">
          <SectionHeading
            title="Households by income"
            subtitle="How net income changes across the income distribution in the selected year."
          />
          <section id="deciles" className="report-section distributional-section">
            <div className="charts-grid">
              <WaterfallChart
                rawData={results.rawWinnersLosers}
                selectedPolicies={selectedPolicies}
                selectedYear={distributionalYear}
                showZeroNote={false}
              />
              <DistributionalChart
                rawData={results.rawDistributional}
                selectedPolicies={selectedPolicies}
                selectedYear={distributionalYear}
                showZeroNote={false}
              />
            </div>
            {/* One note for both charts: the measures that are £0 for
                households this year (greyed out in both keys) */}
            <ZeroMeasuresNote
              members={decileMembership(
                results.rawWinnersLosers,
                "avg_change",
                selectedPolicies,
                distributionalYear,
              )}
              year={distributionalYear}
            />
          </section>
          <SectionHeading title="Inequality" />
          <section id="inequality" className="report-section hero-chart">
            <SummaryMetricChart
              metric={SUMMARY_METRICS.inequality}
              rows={results.rawMetrics}
              policies={POLICIES}
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
            />
          </section>
        </div>
      );
    }
    if (sub === "poverty") {
      return (
        <div className="results-container">
          <SectionHeading title="Poverty" />
          <section id="poverty" className="report-section hero-chart">
            <SummaryMetricChart
              metric={SUMMARY_METRICS.poverty}
              rows={results.rawMetrics}
              policies={POLICIES}
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
            />
          </section>
        </div>
      );
    }
    if (sub === "finances") {
      return (
        <div className="results-container">
          <SectionHeading
            title="Public finances"
            subtitle="Net effect of the selected policies on government revenue and spending, by year."
          />
          <section id="revenue" className="report-section hero-chart">
            <BudgetaryImpactChart data={results.budgetData} selectedYear={distributionalYear} />
            {/* OBR comparison: an expandable row at the foot of the card
                once the OBR has costed the measures */}
            <ObrComparisonFoot
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
            />
          </section>
        </div>
      );
    }
    // All households: places, and how changes vary between households
    return (
      <div className="results-container">
        {/* The constituency map, then the household scatter below it, each
            full width. The scatter shows binned groups of households only:
            the per-household scatter stays withdrawn, as it showed survey
            households one by one. Results by region are hidden for now
            (RegionView is kept, not rendered). The example households'
            income charts are on Household impact. */}
        <SectionHeading
          title="Where and who"
          subtitle="Average change by constituency, and how changes vary between households."
        />
        <section id="constituencies" className="report-section charts-stack">
          <ConstituencyMap
            selectedPolicies={selectedPolicies}
            selectedYear={distributionalYear}
            policies={POLICIES}
            showRegionLink={false}
          />
          <HouseholdScatter
            selectedPolicies={selectedPolicies}
            policies={POLICIES}
            selectedYear={distributionalYear}
          />
        </section>

        {/* The measures are described once, on Policies */}
        <p className="policies-link-line">
          What each measure does is on{" "}
          <a
            href="?tab=policies"
            onClick={(event) => {
              event.preventDefault();
              handleTabChange("policies");
            }}
          >
            Policies
          </a>
          .
        </p>
      </div>
    );
  };

  return (
    // A view without the year pill has a one-row band on a phone
    <div className="app" ref={appRef} data-band={yearShown ? undefined : "compact"}>
      <main className="main-content" ref={mainRef}>
        {/* The title row is the page's sticky header: it docks at the top
            once the reader scrolls past it, compact, with the policy
            selector still in reach. The sentinel tells it when it is stuck. */}
        <div ref={titleSentinelRef} className="title-sentinel" aria-hidden="true" />
        <div className={`title-row ${titleStuck ? "is-stuck" : ""}`}>
          <h1>UK Autumn Budget 2026</h1>

          {/* The year applies to every chart on Population impact (both
              sub-tabs) and to Household impact, and
              the revenue chart highlights it; it lives in the band so it can
              be changed from anywhere. The policy pill
              applies to those views and Household impact. A pill that does
              not apply keeps its place but is hidden, so the band does not
              move. */}
          <div
            className={`band-year ${yearShown ? "" : "is-hidden"}`}
            aria-hidden={yearShown ? undefined : "true"}
            inert={!yearShown}
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
          This dashboard uses <SourceLink source="policyengine_uk_model" /> to
          show how Autumn Budget 2026 measures would affect the public
          finances and households: by income, area and age, and
          for your own household, alongside the pre-measures forecast.
          Costings are our own; forecast:{" "}
          <SourceLink source="obr_efo_current" />. Choose a year and
          policies in the bar above.
        </p>

        <div ref={tabsSentinelRef} className="view-tabs-sentinel" aria-hidden="true" />
        <ViewTabs
          tabs={VIEWS}
          value={activeTab}
          onChange={handleTabChange}
          tabId={tabId}
          panelId={panelId}
        />

        {VIEWS.filter(({ value }) => visited.includes(value) || value === activeTab).map(({ value }) => (
        <div
          key={value}
          id={panelId(value)}
          role="tabpanel"
          aria-labelledby={tabId(value)}
          className="tab-panel"
          hidden={value !== activeTab}
        >
        {value === "outlook" ? (
          <LivingStandardsTab active={activeTab === value} />
        ) : value === "policies" ? (
          // Every measure's card, whatever the band's selection
          <div className="results-container">
            <SectionHeading
              title="Policies"
              subtitle="What each measure does, when it is in force and how it is modelled."
            />
            <section id="policy-details" className="report-section policy-details-content">
              <p className="policy-timeline-key">
                Each card&apos;s timeline shows when the measure is in force over the years
                the charts cover, 2026-27 to 2031-32, with Budget day marked; an arrow at the
                right means it has no end date. &ldquo;See its effect&rdquo; opens Population
                impact with only that measure selected.
              </p>
              <PolicyCards
                policies={POLICIES}
                selectedPolicies={ALL_POLICY_IDS}
                onShowEffect={handleShowEffect}
              />
            </section>
          </div>
        ) : value === "methodology" ? (
          <MethodologyTab onShowTab={handleTabChange} />
        ) : value === "household" ? (
          <PersonalImpactTab
            selectedPolicies={selectedPolicies}
            policies={POLICIES}
            year={distributionalYear}
            active={activeTab === value}
          />
        ) : (
          // Population impact and its sub-tabs (populationPanel)
          <PopulationImpactView note={showingLine} active={activeTab === value}>
            {populationPanel}
          </PopulationImpactView>
        )}
        </div>
        ))}
        <ReplicationLine />
      </main>
    </div>
  );
}

export default App;
