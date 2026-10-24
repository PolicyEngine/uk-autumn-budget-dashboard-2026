import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useIncomeCurve, { curveFor, hasLevels, parseCurve } from "./useIncomeCurve";
import { loadDashboard } from "../utils/loadDashboard";
import { MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fixtureJson, fixtureText, IN_DATA } from "../test/publicationFixture";
import { dashboardFixtureFetch } from "../test/dashboardFixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// TEST DATA ONLY: synthetic ids and values
const PACKAGE = "combined--a+b";
const HEADER =
  "reform_id,reform_name,year,household,x_variable,income,baseline_net_income,reform_net_income";

const CSV = [
  HEADER,
  `${PACKAGE},Package,2029,single_renter,employment_income,0.0,1000.0,900.0`,
  `${PACKAGE},Package,2029,single_renter,employment_income,500.0,1400.0,1300.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,0.0,1100.0,1050.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,500.0,1500.0,1450.0`,
  `b,Measure B,2029,single_renter,employment_income,0.0,1000.0,980.0`,
  `b,Measure B,2029,single_renter,employment_income,500.0,1400.0,1380.0`,
  `a,"Measure A, with a comma",2029,pensioner_couple,private_pension_income,0.0,5000.0,4000.0`,
  `a,"Measure A, with a comma",2030,single_renter,employment_income,0.0,7000.0,6000.0`,
].join("\n");

describe("the example households' curves", () => {
  it("parse every column, a quoted measure name included", () => {
    const rows = parseCurve(CSV);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toEqual({
      reformId: "a",
      year: 2029,
      household: "single_renter",
      income: 0,
      baseline: 1100,
      reformNet: 1050,
    });
  });

  it("sum the selected measures' changes on the combined package's baseline", () => {
    const curve = curveFor(parseCurve(CSV), {
      household: "single_renter",
      year: 2029,
      policies: ["a", "b"],
      combinedId: PACKAGE,
    });
    expect(curve).toEqual([
      { income: 0, baseline: 1000, difference: -70, reform: 930 },
      { income: 500, baseline: 1400, difference: -70, reform: 1330 },
    ]);
    expect(hasLevels(curve)).toBe(true);
  });

  it("keep households and years apart", () => {
    const rows = parseCurve(CSV);
    const pensioners = curveFor(rows, { household: "pensioner_couple", year: 2029, policies: ["a"], combinedId: PACKAGE });
    expect(pensioners).toEqual([{ income: 0, baseline: null, difference: -1000, reform: null }]);
    expect(curveFor(rows, { household: "lone_parent", year: 2029, policies: ["a"], combinedId: PACKAGE })).toEqual([]);
  });
});

describe("the package baseline (review finding 6)", () => {
  // The reviewer's reproduction: member baselines 190 and 195, changes +10
  // and +5, package baseline 185
  const rows = [
    { reformId: "a", household: "example", year: 2029, income: 0, baseline: 190, reformNet: 200 },
    { reformId: "b", household: "example", year: 2029, income: 0, baseline: 195, reformNet: 200 },
    { reformId: PACKAGE, household: "example", year: 2029, income: 0, baseline: 185, reformNet: 200 },
  ];
  const options = { household: "example", year: 2029, policies: ["a", "b"] };

  it("draws levels from the package's baseline, never a member's", () => {
    expect(curveFor(rows, { ...options, combinedId: PACKAGE })).toEqual([{ income: 0, baseline: 185, difference: 15, reform: 200 }]);
  });

  it("keeps the change but no levels once the package run is gone", () => {
    const held = rows.filter((row) => row.reformId !== PACKAGE);
    for (const combinedId of [null, PACKAGE]) {
      const curve = curveFor(held, { ...options, combinedId });
      expect(curve).toEqual([{ income: 0, baseline: null, difference: 15, reform: null }]);
      expect(hasLevels(curve)).toBe(false);
    }
  });

  it("never takes a run that is not the catalogue's package as the baseline", () => {
    const other = rows.map((row) => (row.reformId === PACKAGE ? { ...row, reformId: "other_combined" } : row));
    expect(hasLevels(curveFor(other, { ...options, combinedId: PACKAGE }))).toBe(false);
    expect(hasLevels(curveFor(other, { ...options, combinedId: null }))).toBe(false);
  });

  it("requires the package baseline at every income point", () => {
    const extra = [...rows, { reformId: "a", household: "example", year: 2029, income: 100, baseline: 190, reformNet: 200 }, { reformId: "b", household: "example", year: 2029, income: 100, baseline: 195, reformNet: 200 }];
    expect(hasLevels(curveFor(extra, { ...options, combinedId: PACKAGE }))).toBe(false);
  });

  it("shows nothing when a selected measure has no row", () => {
    expect(curveFor(rows, { ...options, policies: ["a", "b", "c"], combinedId: PACKAGE })).toEqual([]);
  });
});

/** The page's catalogue from the real receipt-verified publication fixture. */
async function fixtureCatalogue({ combinedStatus = "approved", overrides = {} } = {}) {
  const manifest = fixtureJson("manifest.json");
  manifest.measures = { alpha: manifest.measures.alpha, beta: manifest.measures.beta };
  manifest.combined["combined--alpha+beta"].status = combinedStatus;
  const served = { "manifest.json": JSON.stringify(manifest), ...overrides };
  const fetchImpl = dashboardFixtureFetch({ overrides: served });
  vi.stubGlobal("fetch", fetchImpl);
  const { catalogue } = await loadDashboard("", { fetchImpl });
  return catalogue;
}

async function curveFromHook(catalogue) {
  const wrapper = ({ children }) => createElement(MeasureCatalogueProvider, { catalogue }, children);
  const { result } = renderHook(
    () => useIncomeCurve({ household: "couple_three_children", year: IN_DATA, policies: ["alpha", "beta"] }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current;
}

describe("the income curve on the receipt-verified route", () => {
  it("draws levels when the approved package run verifies", async () => {
    const catalogue = await fixtureCatalogue();
    expect(catalogue.combinedId).toBe("combined--alpha+beta");
    const curve = await curveFromHook(catalogue);
    expect(curve.data.length).toBeGreaterThan(0);
    expect(curve.levels).toBe(true);
  });

  it.each(["staged", "withdrawn", "stale"])("has no levels when the package run is %s", async (status) => {
    const catalogue = await fixtureCatalogue({ combinedStatus: status });
    expect(catalogue.combinedId).toBeNull();
    const curve = await curveFromHook(catalogue);
    expect(curve.data.length).toBeGreaterThan(0);
    expect(curve.levels).toBe(false);
    expect(curve.data.every((point) => point.baseline === null && point.reform === null)).toBe(true);
  });

  it("has no levels when the package's curve bytes no longer match its receipt", async () => {
    const manifest = fixtureJson("manifest.json");
    const artifact = manifest.combined["combined--alpha+beta"].artifact;
    const path = `${artifact}/income_curve.csv`;
    const catalogue = await fixtureCatalogue();
    // Tampered after the page loaded: the curve is read through the receipt again
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: {
      "manifest.json": JSON.stringify({ ...manifest, measures: { alpha: manifest.measures.alpha, beta: manifest.measures.beta } }),
      [path]: fixtureText(path).replace(/,0\.0,0\.0,/, ",0.0,999999.0,"),
    } }));
    const curve = await curveFromHook(catalogue);
    expect(curve.levels).toBe(false);
  });

  it("shows nothing for a member whose curve bytes no longer match its receipt", async () => {
    const manifest = fixtureJson("manifest.json");
    const path = `${manifest.measures.alpha.artifact}/income_curve.csv`;
    const catalogue = await fixtureCatalogue();
    vi.stubGlobal("fetch", dashboardFixtureFetch({ overrides: { [path]: `${fixtureText(path)}\n` } }));
    const curve = await curveFromHook(catalogue);
    expect(curve.data).toEqual([]);
  });
});
