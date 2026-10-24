'use client';

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
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
import { DISPLAY_YEARS } from "./utils/displayYears";
import { MeasureCatalogueProvider, useMeasureCatalogue } from "./utils/measureCatalogue";
import { loadDashboard, budgetChartData } from "./utils/loadDashboard";
import UnavailableNotice from "./components/publication/UnavailableNotice";
import { PROVISIONAL_LABEL } from "./utils/publication/manifest";

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

// The ui-kit shell's sticky site nav, as globals.css selects it to make it
// scroll away (@policyengine/ui-kit 0.12.0). Kept in step with globals.css.
export const SHELL_STICKY_NAV_SELECTOR =
  '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';

/** Take the open sub-tab (?sub=) out of the address. */
function dropSubTab() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(SUB_TAB_PARAM)) return;
  params.delete(SUB_TAB_PARAM);
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
  );
}

function Dashboard({ published }) {
  const catalogue = useMeasureCatalogue();
  const POLICIES = catalogue.measures;
  const { policyColors: POLICY_COLORS } = catalogue;
  const [selectedPolicies, setSelectedPolicies] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("policies");
    const available = catalogue.displayable.map((measure) => measure.id);
    return requested === null ? available : requested.split(",").filter((id) => available.includes(id));
  });
  const [exampleHouseholdId, setExampleHouseholdId] = useState(EXAMPLE_HOUSEHOLDS[0].id);
  const [distributionalYear, setDistributionalYear] = useState(2029);
  const [activeTab, setActiveTab] = useState(() => viewFromLocation(window.location));
  const PRESETS = [{ id: "autumn-budget", name: "Autumn Budget 2026", policies: catalogue.displayable.map((measure) => measure.id) }];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeTab === DEFAULT_VIEW) params.delete("tab");
    else params.set("tab", activeTab);
    if (POLICY_PARAM_VIEWS.has(activeTab) && selectedPolicies.length) params.set("policies", selectedPolicies.join(","));
    else params.delete("policies");
    window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  }, [selectedPolicies, activeTab]);

  const results = useMemo(() => ({
    budgetData: budgetChartData(published.budgetary, catalogue.displayable, selectedPolicies, DISPLAY_YEARS),
    rawDistributional: published.distributional.filter((row) => selectedPolicies.includes(row.reform_id)),
    rawWinnersLosers: published.winnersLosers.filter((row) => selectedPolicies.includes(row.reform_id)),
  }), [published, catalogue, selectedPolicies]);

  const handlePolicyToggle = (policyId) => {
    if (!catalogue.byId.get(policyId)?.displayable) return;
    setSelectedPolicies((previous) => previous.includes(policyId) ? previous.filter((id) => id !== policyId) : [...previous, policyId]);
  };
  const handlePresetClick = setSelectedPolicies;

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
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
        dropSubTab();
        setActiveTab("young");
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
  const handleTabChange = (tab) => {
    // A sub-tab (?sub=, SubTabs.jsx) belongs to the view that wrote it, so
    // it goes before another view opens and reads the address
    if (tab !== activeTab) dropSubTab();
    setActiveTab(tab);
    // A hash that belongs to the Young people view goes when another view
    // is chosen, so the address never opens a different view from this one
    if (tab !== "young" && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
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
    // A view without the year pill has a one-row band on a phone
    <div className="app" ref={appRef} data-band={view.year ? undefined : "compact"}>
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
          How the Autumn Budget 2026 measures affect the public finances,
          households across the income distribution, regions and
          constituencies, example households and individuals, and young
          people, with the living standards baseline. Choose a year and
          policies in the bar above.
        </p>

        {catalogue.manifest && catalogue.displayable.some((measure) => catalogue.manifest.measures[measure.id].status === "provisional") && (
          <p className="publication-provisional" role="status">{PROVISIONAL_LABEL}</p>
        )}
        {catalogue.measures.filter((measure) => !measure.availability.available).map((measure) => (
          <UnavailableNotice key={measure.id} reason={`${measure.name}: ${measure.availability.reason}`}>
            <p>{measure.description}</p>
            <p>This measure is excluded from the displayed figures. Totals cover the selected available measures.</p>
          </UnavailableNotice>
        ))}

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
                          {[
                            ["Raise revenue", "revenue"],
                            ["Cost revenue", "cost"],
                            ["Other measures", "neutral"],
                          ].map(([heading, direction]) => {
                            const items = catalogue.displayable.filter(
                              (policy) =>
                                policy &&
                                selectedPolicies.includes(policy.id) &&
                                policy.direction === direction,
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
                                          style={{ background: POLICY_COLORS[policy.seriesKey] }}
                                          aria-hidden="true"
                                        />
                                        {policy.name}
                                      </p>
                                      <p className="policy-detail-text">{policy.description}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                      </Disclosure>
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

function App() {
  const [published, setPublished] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(process.env.NEXT_PUBLIC_BASE_PATH || "", { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setPublished(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);
  if (error) return <UnavailableNotice reason="Published results are unavailable"><p>{error}</p></UnavailableNotice>;
  if (published?.status === "no-manifest") return <UnavailableNotice reason="No Budget results are published yet" />;
  if (!published) return <p role="status">Loading published measures…</p>;
  return <MeasureCatalogueProvider catalogue={published.catalogue}><Dashboard published={published} /></MeasureCatalogueProvider>;
}

export default App;
