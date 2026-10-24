'use client';

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import OBRComparisonTable from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatter from "./components/HouseholdScatter";
import { EXAMPLE_HOUSEHOLDS } from "./utils/exampleHouseholds";
import YearSlider from "./components/YearSlider";
import ViewTabs from "./components/ViewTabs";
import { SUB_TAB_PARAM } from "./components/SubTabs";
import MethodologyTab from "./components/MethodologyTab";
import ReplicationLine from "./components/ReplicationLine";
import SectionHeading from "./components/SectionHeading";
import Disclosure from "./components/Disclosure";
import LivingStandardsTab from "./components/livingStandards/LivingStandardsTab";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import PopulationImpactView from "./components/PopulationImpactView";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";
import { buildBudgetData } from "./utils/budgetData";
import { POLICIES } from "./utils/policies";
import Note from "./components/Note";
import PolicyCards from "./components/PolicyCards";

// The views, as tabs under the intro. `year` and `policies` say which of
// the band's pills apply to a view; the others keep their place in the band
// but are hidden. The Living standards view is the pre-Budget baseline
// outlook, and Methodology is text: neither pill applies to them. Young
// people is a sub-tab of Population impact (PopulationImpactView).
export const VIEWS = [
  { value: "dashboard", label: "Population impact", year: true, policies: true },
  { value: "personal", label: "Personal impact", year: true, policies: true },
  { value: "living", label: "Living standards", year: false, policies: false },
  { value: "methodology", label: "Methodology", year: false, policies: false },
];

const VIEW_BY_KEY = Object.fromEntries(VIEWS.map((view) => [view.value, view]));

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

/** The view a page address opens: an old Young people link, else ?tab=, else the default. */
export function viewFromLocation({ search, hash }) {
  if (opensYoungPeople({ search, hash })) return DEFAULT_VIEW;
  const tab = new URLSearchParams(search).get("tab");
  return VIEW_BY_KEY[tab] ? tab : DEFAULT_VIEW;
}

// The banner under the intro, and the views it is left off
export const CANDIDATE_BANNER =
  "Candidate measures, modelled before the Budget on 28 October; not announced policy.";
const VIEWS_WITHOUT_CANDIDATE_BANNER = new Set(["living", "methodology"]);

// Preset policy combinations
const PRESETS = [
  {
    id: "autumn-budget",
    name: "All candidate measures",
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
  // One example household for both household cards, so they always match
  const [exampleHouseholdId, setExampleHouseholdId] = useState(
    EXAMPLE_HOUSEHOLDS[0].id,
  );
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Valid policy IDs from POLICIES
  const validPolicyIds = POLICIES.map((p) => p.id);

  // Initialize from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const policiesParam = params.get("policies");
    // An old link to the Young people view opens its sub-tab; the hash
    // stays, so the page scrolls to the section
    if (opensYoungPeople(window.location)) dropSubTab("young");
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
  // `sub` opens the new view at one of its sub-tabs (Methodology's links).
  const handleTabChange = (tab, sub) => {
    // A sub-tab (?sub=, SubTabs.jsx) belongs to the view that wrote it, so
    // it goes before another view opens and reads the address
    if (tab !== activeTab) dropSubTab(sub);
    setActiveTab(tab);
    // A hash that belongs to the Young people sub-tab goes when another view
    // is chosen, so the address never opens a different view from this one
    if (tab !== DEFAULT_VIEW && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    // Choosing the open view changes nothing, so there is nothing to keep
    tabScrollPending.current = tab !== activeTab;
  };
  useLayoutEffect(() => {
    if (!tabScrollPending.current) return;
    tabScrollPending.current = false;
    const sentinel = tabsSentinelRef.current;
    if (!sentinel || !appRef.current) return;
    const band =
      parseFloat(getComputedStyle(appRef.current).getPropertyValue("--title-row-height")) || 0;
    const top = sentinel.getBoundingClientRect().top + window.scrollY - band;
    if (window.scrollY > top) window.scrollTo({ top });
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


  return (
    // A view without the year pill has a one-row band on a phone
    <div className="app" ref={appRef} data-band={yearShown ? undefined : "compact"}>
      <main className="main-content">
        {/* The title row is the page's sticky header: it docks at the top
            once the reader scrolls past it, compact, with the policy
            selector still in reach. The sentinel tells it when it is stuck. */}
        <div ref={titleSentinelRef} className="title-sentinel" aria-hidden="true" />
        <div className={`title-row ${titleStuck ? "is-stuck" : ""}`}>
          <h1>UK Autumn Budget 2026</h1>

          {/* The year applies to every chart on Population impact (both
              sub-tabs) and to Personal impact, and
              the revenue chart highlights it; it lives in the band so it can
              be changed from anywhere. The policy pill
              applies to those views and Personal impact. A pill that does
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
          How ten candidate Autumn Budget 2026 measures would affect the
          public finances and households: by income, area and age, and for
          your own household, alongside the living standards outlook. Choose
          a year and policies in the bar above.
        </p>

        {/* Said once, under the intro, on the views that show the
            measures: Living standards has its own demo line, and
            Methodology describes them */}
        {!VIEWS_WITHOUT_CANDIDATE_BANNER.has(activeTab) && (
          <div className="candidate-banner" role="note">
            <Note>{CANDIDATE_BANNER}</Note>
          </div>
        )}

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
        {activeTab === "living" ? (
          <LivingStandardsTab />
        ) : activeTab === "methodology" ? (
          <MethodologyTab onShowTab={handleTabChange} />
        ) : activeTab === "personal" ? (
          <PersonalImpactTab
            selectedPolicies={selectedPolicies}
            policies={POLICIES}
            year={distributionalYear}
          />
        ) : (
          // Population impact: All households and Young people sub-tabs
          <PopulationImpactView note={showingLine}>
          {(sub) => sub === "young" ? (
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
                        data={results.budgetData}
                        selectedYear={distributionalYear}
                      />
                      {/* OBR comparison: an expandable row at the foot of the card */}
                      <Disclosure
                        id="obr-comparison"
                        inCard
                        title="Compare with OBR estimates"
                        contentClassName="obr-content"
                      >
                        <OBRComparisonTable
                          selectedPolicies={selectedPolicies}
                          selectedYear={distributionalYear}
                        />
                      </Disclosure>
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
                        scatter. The scatter shows binned groups of
                        households only: the per-household scatter stays
                        withdrawn, as it showed survey households one by
                        one. Results by region are hidden for now
                        (RegionView is kept, not rendered). */}
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
                      />
                      <HouseholdScatter
                        selectedPolicies={selectedPolicies}
                        policies={POLICIES}
                        selectedYear={distributionalYear}
                      />
                    </section>

                    {/* Row 3: example households. Each card has its own
                        household chooser, starting on different ones. */}
                    <SectionHeading
                      title="Example households"
                      subtitle="Net income of five example households across their incomes. Choose a household in either chart."
                    />
                    <section
                      id="household"
                      className="report-section charts-grid charts-row-3"
                    >
                      <EmploymentIncomeChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        household={exampleHouseholdId}
                        onHouseholdChange={setExampleHouseholdId}
                      />
                      <EmploymentIncomeDiffChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        household={exampleHouseholdId}
                        onHouseholdChange={setExampleHouseholdId}
                      />
                    </section>

                    {/* Policy Details Footer */}
                    <SectionHeading
                      title="Policies"
                      subtitle="What each selected policy does and how it is modelled."
                    />
                    <section id="policy-details" className="report-section">
                      <Disclosure
                        title="About selected policies"
                        contentClassName="policy-details-content"
                      >
                        <PolicyCards
                          policies={POLICIES}
                          selectedPolicies={selectedPolicies}
                        />
                      </Disclosure>
                    </section>
                  </>
                )}
              </div>
            )}
          </>
        )}
          </PopulationImpactView>
        )}
        </div>
        <ReplicationLine />
      </main>
    </div>
  );
}

export default App;
