import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { useGeographyData, resetGeographyCache } from "./useGeographyData";
import { useHouseholdScatterData, resetHouseholdScatterCache } from "./useHouseholdScatterData";
import { chooseReform } from "../utils/geography/selection";
import { scatterView } from "../utils/householdScatter";
import { ALPHA, BETA, COMBINED, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const geography = (level) => [
  "level,area_code,area_name,reform,year,outcome,value,lo,hi,direction,tier,reason,support_band,noise,estimator",
  ...[ALPHA, BETA, COMBINED].flatMap((id) => [YEAR, YEAR + 1].map((year) =>
    [level, level === "region" ? "E12000001" : "Z14000001", "Synthetic area", id, year, "relative_change", "0.01", "0.005", "0.015", "gain", "reported", "", "30+", "False", "direct"].join(","),
  )),
].join("\n");
const scatter = [
  "reform_id,reform_name,year,income_band,change_band,households",
  ...[ALPHA, BETA, COMBINED].flatMap((id) => [YEAR, YEAR + 1].map((year) =>
    [id, "Synthetic measure", year, 25000, 100, 1000].join(","),
  )),
].join("\n");

function wrapperFor(catalogue) {
  return function CatalogueWrapper({ children }) {
    return <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;
  };
}
beforeEach(() => {
  resetGeographyCache();
  resetHouseholdScatterCache();
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const text = url.endsWith("household_scatter_binned.csv") ? scatter
      : url.endsWith("regional.csv") ? geography("region") : geography("constituency");
    return new Response(text);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("catalogue gates on additional population files", () => {
  it.each(["staged", "withdrawn", "not_computable"])("refuses a %s combined run in both geography tables and the household scatter", async (status) => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = status;
    for (const entry of [...Object.values(fixture.manifest.measures), ...Object.values(fixture.manifest.combined)]) entry.years = [YEAR];
    const catalogue = buildMeasureCatalogue(fixture);
    const { result } = renderHook(() => ({
      regional: useGeographyData("regional"),
      constituency: useGeographyData("constituency"),
      scatter: useHouseholdScatterData(),
    }), { wrapper: wrapperFor(catalogue) });
    await waitFor(() => {
      expect(result.current.regional.status).toBe("ready");
      expect(result.current.constituency.status).toBe("ready");
      expect(result.current.scatter.status).toBe("ready");
    });
    expect(catalogue.combinedId).toBeNull();
    for (const name of ["regional", "constituency"]) {
      const table = result.current[name].table;
      expect(table.reforms).toEqual([ALPHA, BETA]);
      expect(table.rows.every((row) => row.year === YEAR)).toBe(true);
      expect(chooseReform({ selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], reforms: table.reforms }).kind).toBe("no-package");
    }
    expect(result.current.scatter.rows.every((row) => row.reform_id !== COMBINED && row.year === YEAR)).toBe(true);
    expect(scatterView({ data: result.current.scatter, selectedIds: [ALPHA, BETA], policyIds: [ALPHA, BETA], year: YEAR }).kind).toBe("notice");
  });

  it("keeps supported approved rows and removes unsupported years including a combined member's year", async () => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.measures[ALPHA].years = [YEAR, YEAR + 1];
    fixture.manifest.measures[ALPHA].unsupported_years = [YEAR + 1];
    fixture.manifest.measures[BETA].years = [YEAR, YEAR + 1];
    fixture.manifest.combined[COMBINED].years = [YEAR, YEAR + 1];
    const catalogue = buildMeasureCatalogue(fixture);
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
});
