/**
 * The poverty and people-affected switch (utils/povertyFigures.js), checked
 * in both settings: PovertyFiguresWithheld.test.jsx runs these with the
 * switch off, as it ships, and PovertyFiguresShown.test.jsx with it on, so
 * turning it back on is known to bring every figure back.
 *
 * Each test file mocks utils/povertyFigures, useDataFile, the measure
 * catalogue hook, the age rows and recharts' ResponsiveContainer itself
 * (vi.mock only applies in the test file); `files` and `catalogueRef` are
 * its hoisted holders for the two hooks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, COMBINED, YEAR, measureCatalogueFixture } from "./measureCatalogueFixture";
import { parseTable } from "../utils/publication/csv";
import { fixtureJson } from "./publicationFixture";
import { downloadMenus } from "./downloadMenus";

// What only a poverty or people-affected figure (or its description) says
const POVERTY_TEXT = /poverty/i;
const PEOPLE_AFFECTED_TEXT = /People affected|of people move|Winners and losers|better off|worse off/;

/**
 * The fixture's age rows with single years 0 to 90+ for ALPHA and BETA but
 * none for their package: every single age withheld while the groups are
 * published, so By age's cards fall back to the age groups (#321, 8db101aa).
 */
function packageWithoutSingleAges() {
  const fixture = measureCatalogueFixture({ held: false });
  const lines = [ALPHA, BETA].flatMap((id) =>
    Array.from({ length: 91 }, (_, age) =>
      [id, id, YEAR, age === 90 ? "90+" : String(age), 10_000, 500, id === ALPHA ? 100 : -50, 25, 20, 30, 50, 2_000].join(","),
    ),
  );
  return { fixture, rows: parseTable("age_impact", [fixture.ageCsv, ...lines].join("\n")) };
}

export function describePovertyFigures(shown, { files, catalogueRef, ageRowsRef }) {
  const either = (on, off) => (shown ? on : off);

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    catalogueRef.current = null;
    files.current = {};
    if (ageRowsRef) ageRowsRef.current = null;
  });

  describe(`the switch reads ${shown ? "on" : "off"}`, () => {
    it("is the setting this file mocks", async () => {
      const { POVERTY_FIGURES_SHOWN } = await import("../utils/povertyFigures");
      expect(POVERTY_FIGURES_SHOWN).toBe(shown);
    });
  });

  describe("Population impact's Poverty sub-tab", () => {
    it(`is ${either("in", "left out of")} every list of sub-tabs`, async () => {
      const { POPULATION_SUB_TABS } = await import("../components/PopulationImpactView");
      const { BOOT_SUBS } = await import("../utils/bootView");
      const { SKELETON_SUB_TABS } = await import("../components/publication/ViewSkeleton");
      for (const values of [POPULATION_SUB_TABS.map((t) => t.value), BOOT_SUBS.dashboard, SKELETON_SUB_TABS.dashboard.map((t) => t.value)]) {
        expect(values.includes("poverty")).toBe(shown);
        expect(values.slice(0, 4)).toEqual(["finances", "all", "age", "living"]);
      }
      // The Pre-measures forecast's current-law Poverty stays either way
      expect(BOOT_SUBS.outlook).toContain("poverty");
    });

    it(`?sub=poverty opens ${either("Poverty", "Public finances")} before and after the page's code runs`, async () => {
      const { BOOT_VIEW_SCRIPT, bootView } = await import("../utils/bootView");
      const expected = either("dashboard:poverty", "dashboard:finances");
      for (const search of ["?sub=poverty", "?tab=dashboard&sub=poverty"]) {
        expect(bootView({ search, hash: "" })).toBe(expected);
        window.history.replaceState({}, "", `/${search}`);
        new Function(BOOT_VIEW_SCRIPT)();
        expect(document.documentElement.getAttribute("data-boot-view")).toBe(expected);
      }
      document.documentElement.removeAttribute("data-boot-view");
      // The current-law twin keeps its address
      expect(bootView({ search: "?tab=outlook&sub=poverty", hash: "" })).toBe("outlook:poverty");
    });

    it(`${either("renders", "is not rendered")}, and ?sub=poverty ${either("opens it", "falls back to Public finances")}`, async () => {
      const { default: PopulationImpactView } = await import("../components/PopulationImpactView");
      window.history.replaceState({}, "", "/?tab=dashboard&sub=poverty");
      render(<PopulationImpactView>{(sub) => <p>Panel {sub}</p>}</PopulationImpactView>);
      const selected = await screen.findByRole("tab", { selected: true });
      expect(selected).toHaveTextContent(either("Poverty", "Public finances"));
      expect(screen.queryByRole("tab", { name: "Poverty" }) !== null).toBe(shown);
      expect(screen.getByText(`Panel ${either("poverty", "finances")}`)).toBeInTheDocument();
      // The address follows the tab shown: no ?sub= for the default
      await waitFor(() => expect(new URLSearchParams(window.location.search).get("sub")).toBe(either("poverty", null)));
    });
  });

  describe("people affected", () => {
    const stats = {
      status: "available",
      year: 2026,
      provisional: false,
      peopleAffected: 66.62,
      giniChange: -0.00122,
      povertyChangePp: 0,
      povertyChangePct: 0,
    };

    it(`${either("shows", "leaves out")} the combined statistics' people affected and poverty change`, async () => {
      const { default: CombinedStats } = await import("../components/publication/CombinedStats");
      const { container } = render(<CombinedStats stats={stats} />);
      const terms = [...container.querySelectorAll("dt")].map((term) => term.textContent);
      expect(terms).toContain("Relative change in the Gini index");
      expect(terms.includes("People affected")).toBe(shown);
      expect(POVERTY_TEXT.test(container.textContent)).toBe(shown);
    });

    it(`By age ${either("shows", "leaves out")} the shares who gain and lose, and their download`, async () => {
      const { default: AgeSection } = await import("../components/AgeSection");
      window.history.replaceState({}, "", "/?sub=age&age=16-24");
      const { container } = render(<AgeSection selectedPolicies={[]} selectedYear={2027} policies={[]} />);
      expect(screen.queryAllByRole("heading", { name: /Winners and losers/ }).length > 0).toBe(shown);
      expect(screen.getByRole("heading", { level: 3, name: /Effect of each policy/ })).toBeInTheDocument();
      const names = downloadMenus(container).map((menu) => menu.name ?? "");
      expect(names.some((name) => /Winners and losers/.test(name))).toBe(shown);
      if (!shown) expect(container.textContent).not.toMatch(PEOPLE_AFFECTED_TEXT);
    });

    it.each([
      ["16-24", ".young-people-shares"],
      ["all", ".young-people-shares"],
      ["pensioners", ".pensioners-shares"],
    ])(`By age (?age=%s) ${either("shows", "leaves out")} Winners and losers in its age-group fallback, and keeps Effect of each policy`, async (age, selector) => {
      const { default: AgeSection } = await import("../components/AgeSection");
      const { fixture, rows } = packageWithoutSingleAges();
      const catalogue = buildMeasureCatalogue(fixture);
      catalogueRef.current = catalogue;
      ageRowsRef.current = { status: "ready", rows };
      window.history.replaceState({}, "", `/?sub=age&age=${age}`);
      const { container } = render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <AgeSection policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />
        </MeasureCatalogueProvider>,
      );
      await screen.findByRole("heading", { name: /Average change by age/ });
      const shares = container.querySelector(selector);
      expect(shares !== null).toBe(shown);
      if (shown && selector === ".young-people-shares") {
        // The fallback itself: the groups, with By single year of age disabled
        fireEvent.click(within(shares).getByRole("button", { name: /^Options:/ }));
        expect(within(shares).getByRole("radio", { name: "By age group" })).toHaveAttribute("aria-checked", "true");
        expect(within(shares).getByRole("radio", { name: "By single year of age" })).toBeDisabled();
      }
      // Effect of each policy draws its rows either way, with no people-affected figure
      expect(screen.getByRole("heading", { level: 3, name: /Effect of each policy/ })).toBeInTheDocument();
      expect(container.querySelectorAll(".measure-dumbbell-row, [class*='measure-dumbbell']").length).toBeGreaterThan(0);
      const names = downloadMenus(container).map((menu) => menu.name ?? "");
      expect(names.some((name) => /Winners and losers/.test(name))).toBe(shown);
      if (!shown) {
        expect(container.textContent).not.toMatch(PEOPLE_AFFECTED_TEXT);
        expect(container.textContent).not.toMatch(POVERTY_TEXT);
        expect(container.querySelector(".young-people-shares, .pensioners-shares")).toBeNull();
      }
    });

    it(`the Your place tip ${either("says", "does not say")} what share of people move`, async () => {
      const { ResultTiles } = await import("../components/personal/IncomePositionChart");
      const manifest = fixtureJson("manifest.json");
      const entry = manifest.measures.alpha;
      catalogueRef.current = buildMeasureCatalogue({
        manifest: { ...manifest, measures: { alpha: { ...entry, name: "alpha", status: "provisional", years: [2027], unsupported_years: [] } }, combined: {} },
        tablesByKey: { alpha: {} },
      });
      files.current = {
        "income_distribution.csv": {
          status: "ready",
          rows: ["baseline", "reform"].flatMap((side) =>
            Array.from({ length: 99 }, (_, i) => ({ reformId: "alpha", year: 2027, side, percentile: i + 1, income: (i + 1) * 1000 + (side === "reform" ? 900 : 0) })),
          ),
        },
        "income_mobility.csv": {
          status: "ready",
          rows: [{ reform_id: "alpha", year: "2027", unit: "percentile", start_decile: "all", pct_up: "12.3", pct_down: "4.5", pct_same: "83.2" }],
        },
      };
      render(
        <ResultTiles
          totals={{ before: 25000, after: 25500, change: 500 }}
          changeValue="£500"
          changeNote="2027-28"
          household={{ has_partner: true, children: [] }}
          year={2027}
          policies={["alpha"]}
        />,
      );
      // Every tip on the tiles, opened one at a time
      const tips = [];
      for (const anchor of document.querySelectorAll("[aria-describedby]")) {
        fireEvent.mouseEnter(anchor.parentElement);
        fireEvent.focus(anchor);
        tips.push(...screen.queryAllByRole("tooltip").map((tip) => tip.textContent));
        fireEvent.mouseLeave(anchor.parentElement);
        fireEvent.blur(anchor);
      }
      expect(tips.some((tip) => /percentile/.test(tip))).toBe(true);
      expect(tips.some((tip) => /12\.3% of people move up/.test(tip))).toBe(shown);
    });
  });

  describe("the inequality chart", () => {
    it(`${either("may give", "never gives")} a poverty reason for a policy with no change`, async () => {
      const { default: MeasureEffectsView } = await import("../components/MeasureEffectsView");
      const { SUMMARY_METRICS } = await import("../components/SummaryMetricChart");
      const { POLICY_DETAILS } = await import("../utils/policyDetails");
      const id = "household_energy_payment_2026";
      const payment = { id, name: id, description: POLICY_DETAILS.find((item) => item.id === id).writtenFor };
      catalogueRef.current = { byId: new Map([[id, payment]]) };
      const byMeasure = [{ id, name: "Energy payment", colour: "var(--c-reference)", points: [{ year: 2026, value: 0 }] }];
      const { container } = render(
        <MeasureEffectsView byMeasure={byMeasure} metric={SUMMARY_METRICS.inequality} selectedYear={2026} view="year" years={[2026]} />,
      );
      const reason = container.querySelector(".mev-reason").textContent;
      expect(reason).toBe(either("not counted in poverty income", "no change in inequality"));
    });
  });

  describe("the £2 bus fare cap", () => {
    it(`the inequality chart ${either("may give", "never gives")} it a poverty reason in a year it changes nothing`, async () => {
      const { default: MeasureEffectsView } = await import("../components/MeasureEffectsView");
      const { SUMMARY_METRICS } = await import("../components/SummaryMetricChart");
      const { POLICY_DETAILS } = await import("../utils/policyDetails");
      const id = "bus_fare_cap_2027";
      const detail = POLICY_DETAILS.find((item) => item.id === id);
      expect(detail.outsidePovertyIncome).toBe(true);
      catalogueRef.current = { byId: new Map([[id, { id, name: id, description: detail.writtenFor }]]) };
      const byMeasure = [{ id, name: "£2 bus fare cap", colour: "var(--c-reference)", points: [{ year: 2027, value: 0 }] }];
      const { container } = render(
        <MeasureEffectsView byMeasure={byMeasure} metric={SUMMARY_METRICS.inequality} selectedYear={2027} view="year" years={[2027]} />,
      );
      const reason = container.querySelector(".mev-reason").textContent;
      if (shown) expect(reason).toBe("not counted in poverty income");
      else expect(reason).not.toMatch(POVERTY_TEXT);
    });
  });

  describe("the words about them", () => {
    const catalogue = buildMeasureCatalogue(measureCatalogueFixture());

    it(`the Methodology ${either("describes the figures", "says once that they are withheld")}`, async () => {
      const { default: MethodologyTab } = await import("../components/MethodologyTab");
      const { WITHHELD_SENTENCE } = await import("../utils/povertyFigures");
      const { container } = render(
        <MeasureCatalogueProvider catalogue={catalogue}>
          <MethodologyTab onShowTab={() => {}} />
        </MeasureCatalogueProvider>,
      );
      const text = container.textContent;
      expect(text.split(WITHHELD_SENTENCE).length - 1).toBe(either(0, 1));
      for (const described of [
        "People moved out of or into poverty",
        "The poverty figures leave out the £100 energy payment",
        "The headline poverty measure here is absolute",
        "count winners and losers in each age band",
        "Household net income rises or falls by more than 0.01%",
        "a person moves up when the whole percentile",
        "the headline poverty and inequality figures",
        // #321: the bus fare cap's place in the poverty figures
        "and the £2 bus fare cap's fare savings",
        "not in the HBAI income poverty is measured on",
      ]) {
        expect(text.includes(described), described).toBe(shown);
      }
      // Inequality and the current-law Poverty sub-tab are described either way
      expect(text).toContain("The relative change in the Gini coefficient");
      expect(within(container).getAllByRole("link", { name: "Poverty" }).length).toBeGreaterThan(0);
    });

    it(`About this dashboard ${either("says nothing of it", "says once that they are withheld")}`, async () => {
      const { default: OverviewDrawer } = await import("../components/OverviewDrawer");
      const { WITHHELD_SENTENCE } = await import("../utils/povertyFigures");
      render(<OverviewDrawer open onClose={() => {}} onOpen={() => {}} provisional={null} />);
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent.split(WITHHELD_SENTENCE).length - 1).toBe(either(0, 1));
    });
  });
}
