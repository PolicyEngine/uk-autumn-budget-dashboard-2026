'use client';

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import EmploymentIncomeChart from "./components/EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./components/EmploymentIncomeDiffChart";
import { ObrComparisonFoot } from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatter from "./components/HouseholdScatter";
import { EXAMPLE_HOUSEHOLDS } from "./utils/exampleHouseholds";
import YearSlider from "./components/YearSlider";
import SourceLink from "./components/SourceLink";
import useScrollReveal from "./hooks/useScrollReveal";
import HouseholdPicker from "./components/HouseholdPicker";
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
import { PublicationCheckContext, serialisedChecks } from "./utils/publication/check";
import UnavailableNotice, { RemoveUnavailable } from "./components/publication/UnavailableNotice";
import { PROVISIONAL_LABEL } from "./utils/publication/manifest";
import PolicyCards from "./components/PolicyCards";
import PillSelect from "./components/PillSelect";
import { HISTORICAL_PROVISIONAL_LABEL, loadHistoricalViews, PastEventBanner, PastEventPopulation } from "./components/historical/PastEvent";
import { DEFAULT_RELEASE, findRelease, newestFirst, publishedHistoricalReleases } from "./utils/publication/release";
import { releaseYears } from "./utils/historical";

// The views, as tabs under the intro. `year` and `policies` say which of
// the band's pills apply to a view; the others keep their place in the band
// but are hidden. The Living standards view is the pre-Budget baseline
// outlook, and Methodology is text: neither pill applies to them. Young
// people is a sub-tab of Population impact (PopulationImpactView).
export const VIEWS = [
  { value: "dashboard", label: "Population impact", year: true, policies: true },
  { value: "household", label: "Household impact", year: true, policies: true },
  { value: "living", label: "Living standards", year: false, policies: false },
  { value: "methodology", label: "Methodology", year: false, policies: false },
];

const VIEW_BY_KEY = Object.fromEntries(VIEWS.map((view) => [view.value, view]));

// Old ?tab= values still opened by shared links, and the view each is now;
// the address is rewritten to the new value
const VIEW_ALIASES = { personal: "household" };
const viewKey = (tab) => VIEW_ALIASES[tab] ?? tab;

// The default view has no ?tab= in the URL; ?tab=dashboard is read too
const DEFAULT_VIEW = "dashboard";

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
 * The views a release has. A past event is one view, Population impact
 * without its sub-tabs (docs/historical-releases.md, question 4): Household
 * impact, Young people, Living standards, results by area and the example
 * households are built on 2026 inputs, and Methodology describes this
 * Budget's modelling.
 */
export function viewsFor(release = DEFAULT_RELEASE) {
  return release.kind === "historical" ? VIEWS.filter((view) => view.value === DEFAULT_VIEW) : VIEWS;
}

/** The view a page address opens: an old Young people link, else ?tab=, else the default. */
export function viewFromLocation({ search, hash }, views = VIEWS) {
  if (opensYoungPeople({ search, hash })) return DEFAULT_VIEW;
  const tab = viewKey(new URLSearchParams(search).get("tab"));
  return views.some((view) => view.value === tab) ? tab : DEFAULT_VIEW;
}

// The selected release, when it is not the page's own: ?budget=<id>
export const RELEASE_PARAM = "budget";

/**
 * The address for another release: ?budget= names it (none for the page's
 * own), and what belonged to the release left goes, since each release has
 * its own measures, years and views: the measures, the sub-tab, the Young
 * people hash, and a view the new release does not have.
 */
export function releaseAddress({ pathname, search, hash }, release, own = DEFAULT_RELEASE) {
  const params = new URLSearchParams(search);
  params.delete("policies");
  params.delete(SUB_TAB_PARAM);
  if (params.has("tab") && !viewsFor(release).some((view) => view.value === viewKey(params.get("tab")))) params.delete("tab");
  if (release === own) params.delete(RELEASE_PARAM);
  else params.set(RELEASE_PARAM, release.id);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash === `#${YOUNG_PEOPLE_ANCHOR}` ? "" : hash}`;
}


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
const BUDGET_VIEWS = new Set(["dashboard", "household"]);

/**
 * The page for one release: this Budget's by default, or a past event's.
 * `releases` lists the releases the band offers, newest first, when there
 * is more than one; `onReleaseChange` takes the id chosen.
 */
function Dashboard({ published, unavailable = null, updated = false, release = DEFAULT_RELEASE, releases = null, onReleaseChange }) {
  const catalogue = useMeasureCatalogue();
  const POLICIES = catalogue.measures;
  const past = release.kind === "historical";
  const views = viewsFor(release);
  // A past event's own years; this Budget's are the dashboard's
  const pastYears = useMemo(() => (past ? releaseYears(catalogue) : null), [past, catalogue]);
  const chartYears = pastYears ?? DISPLAY_YEARS;
  // A link's ?policies= is a chosen selection. Without one the selection is
  // the default, every displayable measure, and follows the publication.
  const requested = typeof window === "undefined" || !catalogue.manifest ? null : new URLSearchParams(window.location.search).get("policies");
  const [chosenPolicies, setChosenPolicies] = useState(() =>
    requested === null ? [] : [...new Set(requested.split(",").map((id) => id.trim()).filter(Boolean))],
  );
  const [selectionChosen, setSelectionChosen] = useState(requested !== null);
  // The default is derived, never stored: an artifact that verifies later
  // under the same manifest joins it, as on a fresh load (review of
  // 3d52cff, finding 1). A newer manifest remounts the view instead.
  const defaultPolicies = useMemo(() => catalogue.displayable.map((measure) => measure.id), [catalogue]);
  const selectedPolicies = selectionChosen ? chosenPolicies : defaultPolicies;
  const [exampleHouseholdId, setExampleHouseholdId] = useState(EXAMPLE_HOUSEHOLDS[0].id);
  const [distributionalYear, setDistributionalYear] = useState(() => (pastYears ? pastYears[0] : DEFAULT_DISPLAY_YEAR));
  const [activeTab, setActiveTab] = useState(DEFAULT_VIEW);
  const [locationReady, setLocationReady] = useState(false);
  const PRESETS = [{ id: "autumn-budget", name: "All measures" }];
  // Cards fade and rise in as they scroll into view
  const mainRef = useRef(null);
  useScrollReveal(mainRef);
  // The views opened so far: each stays mounted once opened, hidden while
  // another is shown, so its state, open expanders and any calculation in
  // flight carry on
  const [visited, setVisited] = useState([DEFAULT_VIEW]);
  if (!visited.includes(activeTab)) setVisited([...visited, activeTab]);

  // The server and first hydrated render share the default shell. Read the
  // browser address before paint, and only then allow the URL writer below.
  useLayoutEffect(() => {
    if (!past && opensYoungPeople(window.location)) dropSubTab("young");
    setActiveTab(viewFromLocation(window.location, views));
    setLocationReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the address is read once, at mount; a release is its own mount

  useEffect(() => {
    if (!locationReady) return;
    const params = new URLSearchParams(window.location.search);
    if (activeTab === DEFAULT_VIEW) params.delete("tab");
    else params.set("tab", activeTab);
    if (!unavailable) {
      // A chosen selection, an empty one included, stays in the address on
      // every view, so a later snapshot's remount restores exactly it: a
      // withdrawn measure shows as unavailable rather than dropping out,
      // and a newly published one is not added unasked. The default stays
      // out of the address, so a remount shows every measure then
      // displayable, a newly published one included.
      if (selectionChosen) params.set("policies", selectedPolicies.join(","));
      else params.delete("policies");
    }
    window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  }, [selectedPolicies, selectionChosen, activeTab, locationReady, unavailable]);

  const results = useMemo(() => ({
    budgetData: budgetChartData(published.budgetary, catalogue.displayable, selectedPolicies, chartYears),
    rawDistributional: published.distributional.filter((row) => selectedPolicies.includes(row.reform_id)),
    rawWinnersLosers: published.winnersLosers.filter((row) => selectedPolicies.includes(row.reform_id)),
  }), [published, catalogue, selectedPolicies, chartYears]);

  const handlePolicyToggle = (policyId) => {
    if (!catalogue.byId.get(policyId)?.displayable) return;
    setChosenPolicies(selectedPolicies.includes(policyId) ? selectedPolicies.filter((id) => id !== policyId) : [...selectedPolicies, policyId]);
    setSelectionChosen(true);
  };
  // The one preset is the default, every displayable measure, so choosing
  // it hands the selection back to the publication
  const handlePresetClick = () => {
    setSelectionChosen(false);
  };
  // Only on the reader's request: an unavailable measure leaves the selection
  const removeFromSelection = (ids) => {
    setChosenPolicies(selectedPolicies.filter((id) => !ids.includes(id)));
    setSelectionChosen(true);
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
    if (past) return undefined;
    const onHashChange = () => {
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
        dropSubTab("young");
        setActiveTab(DEFAULT_VIEW);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [past]);

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

  // An explicit URL selection is never silently narrowed into another
  // selection. Household impact applies its own year-aware gate; Population
  // impact with an unavailable member has no complete set of Budget figures.
  // Each opened view stays mounted, so the check is per view, not for the
  // open one only.
  const unavailableIds = selectedPolicies.filter((id) => !catalogue.byId.get(id)?.displayable);
  const selectionUnavailable = unavailableIds.length ? {
    reason: "Some selected measures are unavailable",
    detail: unavailableIds.map((id) => catalogue.byId.get(id)?.name ?? id).join(", "),
  } : null;
  const viewUnavailable = (value) => unavailable ?? (value === "dashboard" ? selectionUnavailable : null);

  const view = VIEW_BY_KEY[activeTab] ?? VIEW_BY_KEY[DEFAULT_VIEW];
  // A past event with no figures yet has no years to offer
  const yearShown = yearPillShown(activeTab) && (!pastYears || pastYears.length > 0);
  // The release pill applies to Population impact, the one view every
  // release has
  const releaseShown = activeTab === DEFAULT_VIEW;
  // While the release pill is in the band, the band keeps its pill row,
  // even for a past event with no years to offer (still loading, or
  // unavailable): the pill is the way back to another release
  const releasePill = Boolean(releases) && releaseShown;
  const compactBand = !yearShown && !releasePill;

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
            onClick={handlePresetClick}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  );


  return (
    // A view without the year pill has a one-row band on a phone
    <div className={past ? "app historical-release" : "app"} ref={appRef} data-band={compactBand ? "compact" : undefined} data-release-pill={releasePill ? "shown" : undefined} data-publication={unavailable ? "unavailable" : "verified"} data-release={past ? release.id : undefined}>
      <main className="main-content" ref={mainRef}>
        {/* The title row is the page's sticky header: it docks at the top
            once the reader scrolls past it, compact, with the policy
            selector still in reach. The sentinel tells it when it is stuck. */}
        <div ref={titleSentinelRef} className="title-sentinel" aria-hidden="true" />
        <div className={`title-row ${titleStuck ? "is-stuck" : ""}${releases ? " has-releases" : ""}`}>
          <h1>{past ? release.name : "UK Autumn Budget 2026"}</h1>

          {/* Which Budget or past fiscal event the page shows, once more
              than one is published: each has its own measures, years and
              views, so choosing one starts the page afresh */}
          {releases && (
            <div
              className={`band-release ${releaseShown ? "" : "is-hidden"}`}
              aria-hidden={releaseShown ? undefined : "true"}
              inert={!releaseShown}
            >
              <PillSelect
                options={releases.map((option) => ({ value: option.id, label: option.name }))}
                value={release.id}
                onChange={onReleaseChange}
                name="Budget"
              />
            </div>
          )}

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
              {...(pastYears?.length ? { years: pastYears } : {})}
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
        {past ? (
          <PastEventBanner release={release} years={pastYears} />
        ) : (
        <p className="dashboard-intro">
          This dashboard uses <SourceLink source="policyengine_uk_model" /> to
          show how Autumn Budget 2026 measures would affect the public
          finances and households: by income, area and age, and
          for your own household, alongside the living standards outlook.
          Costings are our own; forecast:{" "}
          <SourceLink source="obr_efo_current" />. Choose a year and
          policies in the bar above.
        </p>
        )}
        {updated && (
          <p className="publication-updated" role="status">
            Newer results were published while this page was open; it now shows them.
          </p>
        )}
        {catalogue.manifest && catalogue.displayable.some((measure) => catalogue.manifest.measures[measure.id].status === "provisional") && (
          <p className="publication-provisional" role="status">{past ? HISTORICAL_PROVISIONAL_LABEL : PROVISIONAL_LABEL}</p>
        )}
        {catalogue.measures.filter((measure) => !measure.availability.available).map((measure) => (
          <UnavailableNotice key={measure.id} reason={`${measure.name}: ${measure.availability.reason}`}>
            <p>{measure.description}</p>
            <p>This measure is excluded from the displayed figures. Totals cover the selected available measures.</p>
          </UnavailableNotice>
        ))}

        <div ref={tabsSentinelRef} className="view-tabs-sentinel" aria-hidden="true" />
        <ViewTabs
          tabs={views}
          value={activeTab}
          onChange={handleTabChange}
          tabId={tabId}
          panelId={panelId}
        />

        {views.filter(({ value }) => visited.includes(value) || value === activeTab).map(({ value }) => (
        <div
          key={value}
          id={panelId(value)}
          role="tabpanel"
          aria-labelledby={tabId(value)}
          className="tab-panel"
          hidden={value !== activeTab}
        >
        {BUDGET_VIEWS.has(value) && viewUnavailable(value) ? (
          <UnavailableNotice reason={viewUnavailable(value).reason}>
            {viewUnavailable(value).detail && <p>{viewUnavailable(value).detail}</p>}
            {unavailable ? (
              <p>{past ? `Figures appear here once results for the ${release.name} are published.` : "Figures appear here once the 2026 Budget measures are approved for publication."}</p>
            ) : (
              <>
                <p>No figures are shown for a selection while any of it is unavailable.</p>
                <RemoveUnavailable
                  names={unavailableIds.map((id) => catalogue.byId.get(id)?.name ?? id)}
                  onRemove={() => removeFromSelection(unavailableIds)}
                />
              </>
            )}
          </UnavailableNotice>
        ) : value === "living" ? (
          <LivingStandardsTab active={activeTab === value} />
        ) : value === "methodology" ? (
          <MethodologyTab onShowTab={handleTabChange} />
        ) : past ? (
          // A past event's one view (components/historical/PastEvent.jsx)
          <PastEventPopulation
            published={published}
            views={published.views}
            selectedPolicies={selectedPolicies}
            selectedYear={distributionalYear}
            years={pastYears}
            budgetData={results.budgetData}
            emptyState={emptyState}
            note={showingLine}
          />
        ) : value === "household" ? (
          <PersonalImpactTab
            selectedPolicies={selectedPolicies}
            policies={POLICIES}
            year={distributionalYear}
            onRemoveUnavailable={removeFromSelection}
            active={activeTab === value}
          />
        ) : (
          // Population impact: All households and Young people sub-tabs
          <PopulationImpactView note={showingLine} active={activeTab === value}>
          {(sub) => sub === "young" ? (
          selectedPolicies.length === 0 ? (
            emptyState
          ) : (
            // Young people (16 to 24): results by age, #young-people
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
                      {/* OBR comparison: an expandable row at the foot of the
                          card once the OBR has costed the measures */}
                      <ObrComparisonFoot
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                      />
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

                    {/* Row 3: example households, one chooser above both
                        charts */}
                    <SectionHeading
                      title="Example households"
                      subtitle="Net income of five example households across their incomes."
                    />
                    <div className="example-household-picker">
                      <HouseholdPicker
                        value={exampleHouseholdId}
                        onChange={setExampleHouseholdId}
                      />
                    </div>
                    <section
                      id="household"
                      className="report-section charts-grid charts-row-3"
                    >
                      <EmploymentIncomeChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        household={exampleHouseholdId}
                        onHouseholdChange={setExampleHouseholdId}
                        showPicker={false}
                      />
                      <EmploymentIncomeDiffChart
                        selectedPolicies={selectedPolicies}
                        selectedYear={distributionalYear}
                        household={exampleHouseholdId}
                        onHouseholdChange={setExampleHouseholdId}
                        showPicker={false}
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
        ))}
        <ReplicationLine />
      </main>
    </div>
  );
}
// How often an open page checks for a newer publication, besides when it
// regains focus
const RECHECK_MS = 5 * 60 * 1000;

/**
 * One release's verified publication: loadDashboard's, and for a past event
 * its three flat views, checked against the same catalogue
 * (components/historical/PastEvent.jsx).
 */
async function loadRelease(base, release, { signal }) {
  const published = await loadDashboard(base, { signal, release });
  if (release.kind !== "historical" || published.status !== "ready") return published;
  return { ...published, views: await loadHistoricalViews(published.catalogue, { signal }) };
}

/**
 * The dashboard. `releaseId` is the release the page opens with: this
 * Budget's on `/`, a past event's on its own route. A link's ?budget= opens
 * another registered release instead.
 *
 * @param {{releaseId?: string}} [props]
 */
function App({ releaseId } = {}) {
  const own = (releaseId && findRelease(releaseId)) || DEFAULT_RELEASE;
  // The server and the first render show the page's own release; the
  // address is read before paint, and only then is anything loaded
  const [chosen, setChosen] = useState(null);
  const [located, setLocated] = useState(false);
  const release = chosen ?? own;
  // Each result is kept with the release it is of, so a release's header
  // never shows over another release's figures, not even for one render
  const [published, setPublished] = useState(null);
  const [error, setError] = useState(null);
  const [updated, setUpdated] = useState(null);
  // The past events this build ships, each offered once its manifest verifies
  const [offered, setOffered] = useState([]);
  const current = useRef(null);
  const confirmer = useRef(null);
  // Stable for the page's life: each Household impact request waits on it
  const confirmPublication = useCallback(
    (snapshot) => (confirmer.current ? confirmer.current(snapshot) : Promise.resolve(false)),
    [],
  );
  useLayoutEffect(() => {
    const id = new URLSearchParams(window.location.search).get(RELEASE_PARAM);
    const named = id === null ? undefined : findRelease(id);
    if (named && named !== own) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is read once, before paint
      setChosen(named);
    } else if (id !== null) {
      // An unknown release, or the page's own, leaves the address
      const params = new URLSearchParams(window.location.search);
      params.delete(RELEASE_PARAM);
      window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    }
    setLocated(true);
  }, [own]);

  useEffect(() => {
    const candidates = publishedHistoricalReleases();
    // A build with no past event's manifest asks for none
    if (!candidates.length) return undefined;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const controller = new AbortController();
    Promise.all(candidates.map((candidate) =>
      loadManifest(base, { signal: controller.signal, release: candidate }).then((manifest) => (manifest ? candidate : null), () => null),
    )).then((verified) => { if (!controller.signal.aborted) setOffered(verified.filter(Boolean)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!located) return undefined;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const controller = new AbortController();
    current.current = null;
    const show = (result) => {
      current.current = result;
      setPublished({ release, result });
      setError(null);
    };
    let initialComplete = false;
    const initial = loadRelease(base, release, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) show(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError({ release, message: failure.message }); })
      .finally(() => { initialComplete = true; });

    // An open page follows the publication: a newer manifest replaces the
    // figures with its own verified ones. A missing, invalid or unreachable
    // manifest takes them away until a later check verifies publication again.
    // Under the same manifest, artifacts that failed to verify are tried again.
    // Each check resolves to the live snapshot it found, or null for none.
    const run = async () => {
      try {
        const live = await loadManifest(base, { signal: controller.signal, release });
        const catalogue = current.current?.catalogue;
        const shown = catalogue?.manifest?.snapshotSha256 ?? null;
        const failed = Object.keys(catalogue?.failures ?? {}).length > 0;
        if (current.current !== null && (live?.snapshotSha256 ?? null) === shown && !failed) return shown;
        const next = await loadRelease(base, release, { signal: controller.signal });
        if (controller.signal.aborted) return null;
        show(next);
        const found = next.catalogue.manifest?.snapshotSha256 ?? null;
        if (found !== shown) setUpdated(release);
        return found;
      } catch (failure) {
        if (controller.signal.aborted) return null;
        current.current = null;
        setPublished(null);
        setError({ release, message: failure.message });
        return null;
      }
    };
    // One check at a time; one asked for mid-check runs when it ends
    const check = serialisedChecks(run);
    const recheck = () => { if (!controller.signal.aborted && initialComplete) check(); };
    // A household request waits for a check that started after it was made:
    // true only if the snapshot it was made under is still the live one.
    confirmer.current = async (snapshot) => {
      await initial;
      if (controller.signal.aborted) return false;
      return (await check()) === snapshot;
    };
    const onVisible = () => { if (document.visibilityState === "visible") recheck(); };
    const timer = setInterval(recheck, RECHECK_MS);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      confirmer.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [release, located]);

  // Another release starts the page afresh: its own address, measures,
  // years and views
  const changeRelease = useCallback((id) => {
    const next = findRelease(id);
    if (!next || next === release) return;
    window.history.replaceState({}, "", releaseAddress(window.location, next, own));
    setUpdated(null);
    setChosen(next);
  }, [release, own]);

  const past = release.kind === "historical";
  const result = published?.release === release ? published.result : null;
  const failure = error?.release === release ? error.message : null;
  const unavailable = !result && !failure
    ? { reason: "Loading published measures…" }
    : failure
    ? { reason: past ? `Published results for the ${release.name} are unavailable` : "Published results are unavailable", detail: failure }
    : result.status === "no-manifest"
      ? { reason: past ? `No results for the ${release.name} are published yet` : "No Budget results are published yet" }
      : null;
  const shown = unavailable ? NOTHING_PUBLISHED : result;
  // The band offers a choice once a past event's manifest verifies: this
  // Budget, every verified past event and the one shown, newest first
  const releases = offered.length ? newestFirst([...new Set([DEFAULT_RELEASE, ...offered, release])]) : null;
  // One release and snapshot per mount: another starts the views afresh
  const snapshot = shown.catalogue.manifest?.snapshotSha256 ?? "none";
  return (
    <PublicationCheckContext.Provider value={confirmPublication}>
      <MeasureCatalogueProvider catalogue={shown.catalogue}>
        <Dashboard
          key={`${release.id}:${snapshot}`}
          published={shown}
          unavailable={unavailable}
          updated={updated === release && !unavailable}
          release={release}
          releases={releases}
          onReleaseChange={changeRelease}
        />
      </MeasureCatalogueProvider>
    </PublicationCheckContext.Provider>
  );
}

export default App;
