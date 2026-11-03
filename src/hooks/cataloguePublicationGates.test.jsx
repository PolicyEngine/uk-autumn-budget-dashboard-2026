import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { useGeographyData, resetGeographyCache } from "./useGeographyData";
import { useHouseholdScatterData, resetHouseholdScatterCache } from "./useHouseholdScatterData";
import { chooseSelectionReform, selectionPackageKey } from "../utils/geography/selection";
import { SCATTER_SELECTION_NOT_PUBLISHED, scatterView } from "../utils/householdScatter";
import { ALPHA, BETA, COMBINED, YEAR, bindFlatFiles, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const geography = (level, packageAs = COMBINED, includePackage = true) => [
  "level,area_code,area_name,reform,year,outcome,value,lo,hi,direction,tier,reason,support_band,noise,estimator",
  ...[ALPHA, BETA, ...(includePackage ? [packageAs] : [])].flatMap((id) => [YEAR, YEAR + 1].map((year) =>
    [level, level === "region" ? "E12000001" : "Z14000001", "Synthetic area", id, year, "relative_change", "0.01", "0.005", "0.015", "gain", "reported", "", "30+", "False", "direct"].join(","),
  )),
].join("\n");
// Receipt-verified scatter tables, keyed by artifact as loadPublication returns them
const scatterTables = () => Object.fromEntries([ALPHA, BETA, COMBINED].map((id) => [id, {
  household_scatter_binned: [YEAR, YEAR + 1].map((year) => ({
    reform_id: id, reform_name: "Synthetic measure", year, income_band: 25000, change_band: 100, households: 1000,
  })),
}]));

/** A catalogue as the page builds it, with the geography files bound to its manifest. */
async function verifiedCatalogue(fixture, { packageAs = COMBINED, includePackage = true } = {}) {
  const aliases = packageAs === COMBINED ? {} : { [packageAs]: COMBINED };
  const served = await bindFlatFiles(fixture.manifest, {
    "regional.csv": geography("region", packageAs, includePackage), "constituency.csv": geography("constituency", packageAs, includePackage),
  }, aliases);
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const name = String(url).slice(String(url).indexOf("/data/") + 6);
    return Object.hasOwn(served, name) ? new Response(served[name]) : new Response(null, { status: 404 });
  }));
  return buildMeasureCatalogue({ ...fixture, tablesByKey: scatterTables() });
}

function wrapperFor(catalogue) {
  return function CatalogueWrapper({ children }) {
    return <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;
  };
}
beforeEach(() => {
  resetGeographyCache();
  resetHouseholdScatterCache();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("catalogue gates on additional population files", () => {
  it.each(["staged", "withdrawn", "not_computable"])("rejects area files containing a %s combined run and removes it from the verified household scatter", async (status) => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = status;
    for (const entry of [...Object.values(fixture.manifest.measures), ...Object.values(fixture.manifest.combined)]) entry.years = [YEAR];
    // These files still contain the held package. The approved area
    // provenance records only alpha and beta, so neither file is publishable.
    const catalogue = await verifiedCatalogue(fixture);
    const { result } = renderHook(() => ({
      regional: useGeographyData("regional"),
      constituency: useGeographyData("constituency"),
      scatter: useHouseholdScatterData(),
    }), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => {
      expect(result.current.regional.status).toBe("error");
      expect(result.current.constituency.status).toBe("error");
      expect(result.current.scatter.status).toBe("ready");
    });
    expect(catalogue.combinedId).toBeNull();
    for (const name of ["regional", "constituency"]) {
      expect(result.current[name].table).toBeNull();
      expect(result.current[name].error).toMatch(/reform has no verified provenance/);
    }
    // Receipt-verified artifacts are independent of the rejected flat files:
    // supported individual rows remain, and the held package contributes none.
    expect(result.current.scatter.rows).toHaveLength(2);
    expect(new Set(result.current.scatter.rows.map((row) => row.reform_id))).toEqual(new Set([ALPHA, BETA]));
    expect(result.current.scatter.rows.every((row) => row.reform_id !== COMBINED && row.year === YEAR)).toBe(true);
    expect(chooseSelectionReform({ selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], reforms: [ALPHA, BETA], packageKey: selectionPackageKey(catalogue.manifest, [ALPHA, BETA]) }).kind).toBe("no-package");
    // No package: the combination is not published, never one measure in its place
    const shown = scatterView({ data: result.current.scatter, selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], year: YEAR, packageKey: selectionPackageKey(catalogue.manifest, [ALPHA, BETA]) });
    expect(shown).toMatchObject({ kind: "notice", reason: SCATTER_SELECTION_NOT_PUBLISHED });
  });

  it("keeps approved individual area figures when a withdrawn package has no rows in the verified files", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = "withdrawn";
    for (const entry of [...Object.values(fixture.manifest.measures), ...Object.values(fixture.manifest.combined)]) entry.years = [YEAR];
    const catalogue = await verifiedCatalogue(fixture, { includePackage: false });
    const { result } = renderHook(() => ({
      regional: useGeographyData("regional"),
      constituency: useGeographyData("constituency"),
    }), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => {
      expect(result.current.regional.status).toBe("ready");
      expect(result.current.constituency.status).toBe("ready");
    });
    expect(catalogue.combinedId).toBeNull();
    for (const name of ["regional", "constituency"]) {
      const table = result.current[name].table;
      expect(table.reforms).toEqual([ALPHA, BETA]);
      expect(table.rows).toHaveLength(2);
      expect(table.rows.every((row) => row.year === YEAR)).toBe(true);
      expect(chooseSelectionReform({ selectedIds: [ALPHA], policyIds: [ALPHA, BETA], reforms: table.reforms, packageKey: selectionPackageKey(catalogue.manifest, [ALPHA]) })).toEqual({ kind: "measure", reform: ALPHA });
      expect(chooseSelectionReform({ selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], reforms: table.reforms, packageKey: selectionPackageKey(catalogue.manifest, [ALPHA, BETA]) }).kind).toBe("no-package");
    }
  });

  it("keeps supported approved rows and removes unsupported years including a combined member's year", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].years = [YEAR, YEAR + 1];
    fixture.manifest.measures[ALPHA].unsupported_years = [YEAR + 1];
    fixture.manifest.measures[BETA].years = [YEAR, YEAR + 1];
    fixture.manifest.combined[COMBINED].years = [YEAR, YEAR + 1];
    const catalogue = await verifiedCatalogue(fixture);
    const { result } = renderHook(() => ({
      regional: useGeographyData("regional"), scatter: useHouseholdScatterData(),
    }), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => {
      expect(result.current.regional.status).toBe("ready");
      expect(result.current.scatter.status).toBe("ready");
    });
    const geographyRows = result.current.regional.table.rows;
    expect(geographyRows.some((row) => row.reform === COMBINED && row.year === YEAR)).toBe(true);
    expect(geographyRows.some((row) => row.reform === BETA && row.year === YEAR + 1)).toBe(true);
    expect(geographyRows.some((row) => row.reform === ALPHA && row.year === YEAR + 1)).toBe(false);
    expect(geographyRows.some((row) => row.reform === COMBINED && row.year === YEAR + 1)).toBe(false);
    expect(result.current.scatter.rows.some((row) => row.reform_id === COMBINED && row.year === YEAR + 1)).toBe(false);
  });

  it("reads the area run's package alias as the combined run the index names", async () => {
    // TEST DATA ONLY: the area run labels the package with its own alias
    const ALIAS = "synthetic_area_package";
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = await verifiedCatalogue(fixture, { packageAs: ALIAS });
    expect(catalogue.combinedId).toBe(COMBINED);
    const { result } = renderHook(() => ({
      regional: useGeographyData("regional"), constituency: useGeographyData("constituency"),
    }), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => {
      expect(result.current.regional.status).toBe("ready");
      expect(result.current.constituency.status).toBe("ready");
    });
    for (const name of ["regional", "constituency"]) {
      const table = result.current[name].table;
      expect(table.reforms).toContain(COMBINED);
      expect(table.reforms).not.toContain(ALIAS);
      expect(chooseSelectionReform({ selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], reforms: table.reforms, packageKey: selectionPackageKey(catalogue.manifest, [ALPHA, BETA]) }))
        .toMatchObject({ kind: "package", reform: COMBINED });
    }
  });

  it("shows no area figure when the index does not match the loaded manifest", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    const catalogue = await verifiedCatalogue(fixture);
    // A later deploy: a new manifest revision, index rebound to it
    const next = structuredClone(fixture.manifest);
    next.revision += 1;
    const served = await bindFlatFiles(next, { "regional.csv": geography("region") });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const name = String(url).slice(String(url).indexOf("/data/") + 6);
      return Object.hasOwn(served, name) ? new Response(served[name]) : new Response(null, { status: 404 });
    }));
    const { result } = renderHook(() => useGeographyData("regional"), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.table ?? null).toBeNull();
  });
});

