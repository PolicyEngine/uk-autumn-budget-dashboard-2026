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
import PopulationImpactView from "./components/PopulationImpactView";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";
import { DISPLAY_YEARS } from "./utils/displayYears";
import { buildMeasureCatalogue, MeasureCatalogueProvider, useMeasureCatalogue } from "./utils/measureCatalogue";
import { loadDashboard, budgetChartData } from "./utils/loadDashboard";
import { loadManifest } from "./utils/publication/load";
import UnavailableNotice from "./components/publication/UnavailableNotice";
import { PROVISIONAL_LABEL } from "./utils/publication/manifest";
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

// The ui-kit shell's sticky site nav, as globals.css selects it to make it
// scroll away (@policyengine/ui-kit 0.12.0). Kept in step with globals.css.
export const SHELL_STICKY_NAV_SELECTOR =
  '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';

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

// With no Budget results to show: the page's shell and the views that need
// none (Living standards, Methodology) still render
const NOTHING_PUBLISHED = Object.freeze({
  status: "no-manifest", catalogue: buildMeasureCatalogue(),
  budgetary: [], distributional: [], winnersLosers: [], metrics: [],
});

// The views whose figures come from the publication
const BUDGET_VIEWS = new Set(["dashboard", "personal"]);

function Dashboard({ published, unavailable = null, updated = false }) {
  const catalogue = useMeasureCatalogue();
  const POLICIES = catalogue.measures;
  const [selectedPolicies, setSelectedPolicies] = useState(() => {
    const requested = typeof window === "undefined" || !catalogue.manifest ? null : new URLSearchParams(window.location.search).get("policies");
    const available = catalogue.displayable.map((measure) => measure.id);
    return requested === null ? available : [...new Set(requested.split(",").map((id) => id.trim()).filter(Boolean))];
  });
  const [exampleHouseholdId, setExampleHouseholdId] = useState(EXAMPLE_HOUSEHOLDS[0].id);
  const [distributionalYear, setDistributionalYear] = useState(DEFAULT_DISPLAY_YEAR);
  const [activeTab, setActiveTab] = useState(DEFAULT_VIEW);
  const [locationReady, setLocationReady] = useState(false);
  const PRESETS = [{ id: "autumn-budget", name: "All candidate measures", policies: catalogue.displayable.map((measure) => measure.id) }];

  // The server and first hydrated render share the default shell. Read the
  // browser address before paint, and only then allow the URL writer below.
  useLayoutEffect(() => {
    if (opensYoungPeople(window.location)) dropSubTab("young");
    setActiveTab(viewFromLocation(window.location));
    setLocationReady(true);
  }, []);

  useEffect(() => {
    if (!locationReady) return;
    const params = new URLSearchParams(window.location.search);
    if (activeTab === DEFAULT_VIEW) params.delete("tab");
    else params.set("tab", activeTab);
    if (!unavailable) {
      // Keep an unavailable personal request explicit across a later
      // snapshot remount, rather than silently reopening default measures.
      const blockedPersonal = activeTab === "personal" && selectedPolicies.some((id) => !catalogue.byId.get(id)?.displayable);
      if ((POLICY_PARAM_VIEWS.has(activeTab) || blockedPersonal) && selectedPolicies.length) params.set("policies", selectedPolicies.join(","));
      else params.delete("policies");
    }
    window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  }, [selectedPolicies, activeTab, locationReady]);

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

  // An explicit URL selection is never silently narrowed into another
  // selection. Personal impact applies its own year-aware gate; Population
  // impact with an unavailable member has no complete set of Budget figures.
  const unavailableIds = selectedPolicies.filter((id) => !catalogue.byId.get(id)?.displayable);
  const viewUnavailable = unavailable ?? (activeTab === "dashboard" && unavailableIds.length ? {
    reason: "Some selected measures are unavailable",
    detail: unavailableIds.map((id) => catalogue.byId.get(id)?.name ?? id).join(", "),
  } : null);

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
    <div className="app" ref={appRef} data-band={yearShown ? undefined : "compact"} data-publication={unavailable ? "unavailable" : "verified"}>
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
          How candidate Autumn Budget 2026 measures would affect the
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
        {updated && (
          <p className="publication-updated" role="status">
            Newer results were published while this page was open; it now shows them.
          </p>
        )}
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
        {viewUnavailable && BUDGET_VIEWS.has(activeTab) ? (
          <UnavailableNotice reason={viewUnavailable.reason}>
            {viewUnavailable.detail && <p>{viewUnavailable.detail}</p>}
            <p>Figures appear here once the 2026 Budget measures are approved for publication.</p>
          </UnavailableNotice>
        ) : activeTab === "living" ? (
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
// How often an open page checks for a newer publication, besides when it
// regains focus
const RECHECK_MS = 5 * 60 * 1000;

function App() {
  const [published, setPublished] = useState(null);
  const [error, setError] = useState(null);
  const [updated, setUpdated] = useState(false);
  const current = useRef(null);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const controller = new AbortController();
    const show = (result) => {
      current.current = result;
      setPublished(result);
      setError(null);
    };
    let initialComplete = false;
    loadDashboard(base, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) show(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { initialComplete = true; });

    // An open page follows the publication: a newer manifest replaces the
    // figures with its own verified ones. A missing, invalid or unreachable
    // manifest takes them away until a later check verifies publication again.
    // Under the same manifest, artifacts that failed to verify are tried again.
    let checking = false;
    const recheck = async () => {
      if (checking || controller.signal.aborted || !initialComplete) return;
      checking = true;
      try {
        const live = await loadManifest(base, { signal: controller.signal });
        const catalogue = current.current?.catalogue;
        const shown = catalogue?.manifest?.snapshotSha256 ?? null;
        const failed = Object.keys(catalogue?.failures ?? {}).length > 0;
        if (current.current !== null && (live?.snapshotSha256 ?? null) === shown && !failed) return;
        const next = await loadDashboard(base, { signal: controller.signal });
        if (controller.signal.aborted) return;
        show(next);
        if ((next.catalogue.manifest?.snapshotSha256 ?? null) !== shown) setUpdated(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        current.current = null;
        setPublished(null);
        setError(failure.message);
      } finally {
        checking = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") recheck(); };
    const timer = setInterval(recheck, RECHECK_MS);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const unavailable = !published && !error
    ? { reason: "Loading published measures…" }
    : error
    ? { reason: "Published results are unavailable", detail: error }
    : published.status === "no-manifest"
      ? { reason: "No Budget results are published yet" }
      : null;
  const shown = unavailable ? NOTHING_PUBLISHED : published;
  // One snapshot per mount: a newer one starts the views afresh
  const snapshot = shown.catalogue.manifest?.snapshotSha256 ?? "none";
  return (
    <MeasureCatalogueProvider catalogue={shown.catalogue}>
      <Dashboard key={snapshot} published={shown} unavailable={unavailable} updated={updated && !unavailable} />
    </MeasureCatalogueProvider>
  );
}

export default App;
