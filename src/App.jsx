'use client';

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import PolicySelector from "./components/PolicySelector";
import BudgetaryImpactChart from "./components/BudgetaryImpactChart";
import DistributionalChart from "./components/DistributionalChart";
import WaterfallChart from "./components/WaterfallChart";
import ConstituencyMap from "./components/ConstituencyMap";
import { ObrComparisonFoot } from "./components/OBRComparisonTable";
import PersonalImpactTab from "./components/PersonalImpactTab";
import HouseholdScatter from "./components/HouseholdScatter";
import { MeasureKeyProvider, SectionMeasureKey } from "./components/MeasureKey";
import YearSlider from "./components/YearSlider";
import SourceLink from "./components/SourceLink";
import useScrollReveal from "./hooks/useScrollReveal";
import ViewTabs from "./components/ViewTabs";
import { SUB_TAB_PARAM } from "./components/SubTabs";
import MethodologyTab from "./components/MethodologyTab";
import ReplicationLine from "./components/ReplicationLine";
import SectionHeading from "./components/SectionHeading";
import LivingStandardsTab from "./components/livingStandards/LivingStandardsTab";
import { PovertyMeasuresRow } from "./components/MeasuresPovertyCard";
import TwinLink from "./components/TwinLink";
import GrowthWithMeasuresCard from "./components/livingStandards/GrowthWithMeasuresCard";
import { GROWTH_CURRENT_LAW_ANCHOR } from "./components/livingStandards/sections/ViewCards";
import YoungPeopleSection, { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import PensionersSection from "./components/PensionersSection";
import PopulationImpactView from "./components/PopulationImpactView";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";
import { DISPLAY_YEARS } from "./utils/displayYears";
import { buildMeasureCatalogue, MeasureCatalogueProvider, useMeasureCatalogue } from "./utils/measureCatalogue";
import { loadDashboard, budgetChartData } from "./utils/loadDashboard";
import { loadManifest } from "./utils/publication/load";
import { PublicationCheckContext, serialisedChecks } from "./utils/publication/check";
import UnavailableNotice, { RemoveUnavailable } from "./components/publication/UnavailableNotice";
import { PROVISIONAL_LABEL } from "./utils/publication/manifest";
import { installInfoTooltipClamp } from "./utils/infoTooltip";
import PolicyCards from "./components/PolicyCards";
import SummaryMetricChart, { SUMMARY_METRICS } from "./components/SummaryMetricChart";

// The views, as tabs under the intro. `year` and `policies` say which of
// the band's pills apply to a view; the others keep their place in the band
// but are hidden. OBR forecast is current law (incomes and poverty without
// the measures) and the OBR forecast behind it, Policies describes every measure and Methodology is text: no
// pill applies to them. Population impact's sub-tabs (Public finances, All
// households, Young people, Pensioners, Living standards, Poverty) are in
// PopulationImpactView; the OBR forecast's (Living standards,
// Poverty, Forecast changes) in LivingStandardsTab. Living standards and Poverty
// are twins: with the selected measures on Population impact, without them
// (current law) on the OBR forecast.
export const VIEWS = [
  { value: "dashboard", label: "Population impact", year: true, policies: true },
  { value: "household", label: "Household impact", year: true, policies: true },
  { value: "outlook", label: "OBR forecast", year: false, policies: false },
  { value: "policies", label: "Policies", year: false, policies: false },
  { value: "methodology", label: "Methodology", year: false, policies: false },
];

const VIEW_BY_KEY = Object.fromEntries(VIEWS.map((view) => [view.value, view]));

// Old ?tab= values still opened by shared links, and the view each is now;
// the address is rewritten to the new value
// (?tab=living was the OBR forecast's address; for its old
// ?sub=baseline see oldOutlookBaseline)
const VIEW_ALIASES = { personal: "household", living: "outlook" };
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
 * Whether a page address is an old link to the OBR forecast's
 * former Baseline outlook sub-tab (?tab=outlook or ?tab=living, with
 * ?sub=baseline): incomes and poverty under current law, now its Living
 * standards sub-tab, the default.
 */
export function oldOutlookBaseline({ search }) {
  const params = new URLSearchParams(search);
  return viewKey(params.get("tab")) === "outlook" && params.get(SUB_TAB_PARAM) === "baseline";
}

/**
 * Whether a page address links to the income decile pair (#deciles), which
 * is on Population impact's All households sub-tab (it was on Living
 * standards before).
 */
export const DECILES_ANCHOR = "deciles";
export function opensDeciles({ hash }) {
  return hash === `#${DECILES_ANCHOR}`;
}

/** The view a page address opens: an old Young people link, else ?tab=, else the default. */
export function viewFromLocation({ search, hash }) {
  if (opensYoungPeople({ search, hash })) return DEFAULT_VIEW;
  if (opensDeciles({ hash })) return DEFAULT_VIEW;
  const tab = viewKey(new URLSearchParams(search).get("tab"));
  return VIEW_BY_KEY[tab] ? tab : DEFAULT_VIEW;
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

function Dashboard({ published, unavailable = null, updated = false }) {
  const catalogue = useMeasureCatalogue();
  const POLICIES = catalogue.measures;
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
  const [distributionalYear, setDistributionalYear] = useState(DEFAULT_DISPLAY_YEAR);
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

  // Every "i" tooltip stays inside the screen (a phone's edge columns)
  useEffect(() => installInfoTooltipClamp(), []);

  // The server and first hydrated render share the default shell. Read the
  // browser address before paint, and only then allow the URL writer below.
  useLayoutEffect(() => {
    // An old link to the Young people view opens its sub-tab; the hash
    // stays, so the page scrolls to the section
    const view = viewFromLocation(window.location);
    if (opensYoungPeople(window.location)) dropSubTab("young");
    // A link to the decile pair opens All households, where it now is
    else if (opensDeciles(window.location)) dropSubTab("all");
    // An old Baseline outlook link opens the OBR forecast's Living
    // standards, its default sub-tab (?sub=forecast is still its Forecast changes)
    if (oldOutlookBaseline(window.location)) dropSubTab(null);
    setActiveTab(view);
    setLocationReady(true);
  }, []);

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
    budgetData: budgetChartData(published.budgetary, catalogue.displayable, selectedPolicies, DISPLAY_YEARS),
    rawDistributional: published.distributional.filter((row) => selectedPolicies.includes(row.reform_id)),
    rawWinnersLosers: published.winnersLosers.filter((row) => selectedPolicies.includes(row.reform_id)),
    // Every verified run's rows: the summary statistics read one run, not a
    // sum (the receipted metrics carry the contract's columns only, #104)
    rawMetrics: published.metrics,
  }), [published, catalogue, selectedPolicies]);

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
    setChosenPolicies([policyId]);
    setSelectionChosen(true);
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
            onClick={handlePresetClick}
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
    // Living standards and Poverty show the selected measures' effect; their
    // twins on the OBR forecast (same names) show current law
    const twin = (twinSub) => <TwinLink tab="outlook" sub={twinSub} onShow={handleTabChange} />;
    if (sub === "living") {
      if (!results) return null;
      return (
        <div className="results-container">
          <SectionHeading
            icon="wallet"
            title="How the measures change incomes"
            subtitle="With the selected measures: how they change income growth across the income distribution. The change by income decile is on All households."
          />
          {/* Growth across the distribution with the measures: the twin of
              the Pre-measures forecast's chart (current law), which links
              back here */}
          <section className="report-section ls-section">
            <div className="charts-grid">
              <GrowthWithMeasuresCard
                selectedPolicies={selectedPolicies}
                twinLink={
                  <TwinLink tab="outlook" sub="living" onShow={handleTabChange} label="Without the measures" anchor={GROWTH_CURRENT_LAW_ANCHOR} />
                }
              />
            </div>
          </section>
          <SectionHeading
            id="inequality-heading"
            icon="scale"
            title="Inequality"
            subtitle={<>With the selected measures. {twin("living")}</>}
          />
          <section id="inequality" className="report-section">
            <div className="charts-grid">
              <SummaryMetricChart
                metric={SUMMARY_METRICS.inequality}
                rows={results.rawMetrics}
                policies={POLICIES}
                selectedPolicies={selectedPolicies}
                selectedYear={distributionalYear}
              />
            </div>
          </section>
        </div>
      );
    }
    if (sub === "poverty") {
      if (!results) return null;
      return (
        <div className="results-container">
          <SectionHeading
            icon="lifebuoy"
            title="How the measures change poverty"
            subtitle={<>With the selected measures. {twin("poverty")}</>}
          />
          {/* The change by year beside which measures move it */}
          <section id="poverty" className="report-section">
            <PovertyMeasuresRow
              rows={results.rawMetrics}
              policies={POLICIES}
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
            />
          </section>
        </div>
      );
    }
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
        />
      );
    }
    if (!results) return null;
    if (sub === "finances") {
      return (
        <div className="results-container">
          <SectionHeading
            icon="banknote"
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
        {/* Three sections: by area (the constituency map), by income (the
            decile pair) and across households (the scatter of binned groups;
            the per-household scatter stays withdrawn, as it showed survey
            households one by one). One measure key above them all
            (MeasureKey): the decile cards colour by measure and register
            with it. Results by region are hidden for now (RegionView is
            kept, not rendered). */}
        <MeasureKeyProvider>
          <SectionMeasureKey />
          <SectionHeading
            id="by-area"
            icon="compass"
            title="By area"
            subtitle="Average change in household income in each parliamentary constituency."
          />
          <section id="constituencies" className="report-section charts-stack">
            <ConstituencyMap
              selectedPolicies={selectedPolicies}
              selectedYear={distributionalYear}
              policies={POLICIES}
              showRegionLink={false}
            />
          </section>
          <SectionHeading
            id="by-income"
            icon="wallet"
            title="By income"
            subtitle="How the change differs between lower- and higher-income households."
          />
          <section id={DECILES_ANCHOR} className="report-section distributional-section">
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
          <SectionHeading
            id="across-households"
            icon="users"
            title="Across households"
            subtitle="Who gains and who loses at every income level, in groups of households with similar incomes and changes."
          />
          <section id="scatter" className="report-section charts-stack">
            <HouseholdScatter
              selectedPolicies={selectedPolicies}
              policies={POLICIES}
              selectedYear={distributionalYear}
            />
          </section>
          <p className="section-link">
            Where would your household be?{" "}
            <a
              className="twin-link"
              href={`?${new URLSearchParams({ tab: "household", ...(selectionChosen ? { policies: selectedPolicies.join(",") } : {}) })}`}
              onClick={(event) => {
                event.preventDefault();
                handleTabChange("household");
              }}
            >
              Work it out on Household impact →
            </a>
          </p>
        </MeasureKeyProvider>
      </div>
    );
  };

  return (
    // A view without the year pill has a one-row band on a phone
    <div className="app" ref={appRef} data-band={yearShown ? undefined : "compact"} data-publication={unavailable ? "unavailable" : "verified"}>
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
          for your own household, alongside the OBR forecast.
          Costings are our own; forecast:{" "}
          <SourceLink source="obr_efo_current" />. Choose a year and
          policies in the bar above.
        </p>
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

        {VIEWS.filter(({ value }) => visited.includes(value) || value === activeTab).map(({ value }) => (
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
              <p>Figures appear here once the 2026 Budget measures are approved for publication.</p>
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
        ) : value === "outlook" ? (
          // Current law needs no publication: its sub-tabs read only the
          // independent outlook, so they show whatever Population impact shows
          <LivingStandardsTab active={activeTab === value} onShowTab={handleTabChange} />
        ) : value === "policies" ? (
          // Every published measure's card, whatever the band's selection
          <div className="results-container">
            <SectionHeading
              icon="fileText"
              title="Policies"
              subtitle="What each measure changes, when, and how it is modelled."
            />
            <section id="policy-details" className="report-section policy-details-content">
              <PolicyCards
                policies={POLICIES}
                selectedPolicies={defaultPolicies}
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
            onRemoveUnavailable={removeFromSelection}
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
// How often an open page checks for a newer publication, besides when it
// regains focus
const RECHECK_MS = 5 * 60 * 1000;

function App() {
  const [published, setPublished] = useState(null);
  const [error, setError] = useState(null);
  const [updated, setUpdated] = useState(false);
  const current = useRef(null);
  const confirmer = useRef(null);
  // Stable for the page's life: each Household impact request waits on it
  const confirmPublication = useCallback(
    (snapshot) => (confirmer.current ? confirmer.current(snapshot) : Promise.resolve(false)),
    [],
  );
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const controller = new AbortController();
    const show = (result) => {
      current.current = result;
      setPublished(result);
      setError(null);
    };
    let initialComplete = false;
    const initial = loadDashboard(base, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) show(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { initialComplete = true; });

    // An open page follows the publication: a newer manifest replaces the
    // figures with its own verified ones. A missing, invalid or unreachable
    // manifest takes them away until a later check verifies publication again.
    // Under the same manifest, artifacts that failed to verify are tried again.
    // Each check resolves to the live snapshot it found, or null for none.
    const run = async () => {
      try {
        const live = await loadManifest(base, { signal: controller.signal });
        const catalogue = current.current?.catalogue;
        const shown = catalogue?.manifest?.snapshotSha256 ?? null;
        const failed = Object.keys(catalogue?.failures ?? {}).length > 0;
        if (current.current !== null && (live?.snapshotSha256 ?? null) === shown && !failed) return shown;
        const next = await loadDashboard(base, { signal: controller.signal });
        if (controller.signal.aborted) return null;
        show(next);
        const found = next.catalogue.manifest?.snapshotSha256 ?? null;
        if (found !== shown) setUpdated(true);
        return found;
      } catch (failure) {
        if (controller.signal.aborted) return null;
        current.current = null;
        setPublished(null);
        setError(failure.message);
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
  }, []);
  const unavailable = !published && !error
    ? { reason: "Loading published measures…", loading: true }
    : error
    ? { reason: "Published results are unavailable", detail: error }
    : published.status === "no-manifest"
      ? { reason: "No Budget results are published yet" }
      : null;
  const shown = unavailable ? NOTHING_PUBLISHED : published;
  // One snapshot per mount: a newer one starts the views afresh
  const snapshot = shown.catalogue.manifest?.snapshotSha256 ?? "none";
  return (
    <PublicationCheckContext.Provider value={confirmPublication}>
      <MeasureCatalogueProvider catalogue={shown.catalogue}>
        <Dashboard key={snapshot} published={shown} unavailable={unavailable} updated={updated && !unavailable} />
      </MeasureCatalogueProvider>
    </PublicationCheckContext.Provider>
  );
}

export default App;
