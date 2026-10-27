// "Where you sit"'s tenths read the verified artifacts the decile charts
// read, never the root flat files, so Household calculator's lowest tenth is
// Population impact's (#228: £75.12 from the root file against £73.27).
import { describe, expect, it } from "vitest";
import { buildMeasureCatalogue, verifiedTableRows } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { decileAverages, overallAverage } from "../../utils/incomePosition";

const PAIR = ["alpha", "beta"];
const YEARS = [2026, 2027, 2028];
const manifestFixture = fixtureJson("manifest.json");

function winners(id, first) {
  return [
    ...Array.from({ length: 10 }, (_, i) => ({ reform_id: id, reform_name: id, year: 2027, decile: String(i + 1), avg_change: first + i })),
    { reform_id: id, reform_name: id, year: 2027, decile: "all", avg_change: first },
  ];
}

function catalogue({ withdrawn = null } = {}) {
  const entry = manifestFixture.measures.alpha;
  const measures = Object.fromEntries(
    PAIR.map((id) => [id, { ...entry, name: id, status: id === withdrawn ? "withdrawn" : "provisional", years: YEARS, unsupported_years: [] }]),
  );
  return buildMeasureCatalogue({
    manifest: { ...manifestFixture, measures, combined: {} },
    tablesByKey: { alpha: { winners_losers: winners("alpha", 40) }, beta: { winners_losers: winners("beta", 33) } },
  });
}

describe("the tenths' averages on Household calculator", () => {
  it("are the sum of the selected measures' verified rows, as the decile charts add them", () => {
    const rows = verifiedTableRows(catalogue(), "winners_losers");
    expect(decileAverages(rows, PAIR, 2027)[1]).toBe(73);
    expect(decileAverages(rows, PAIR, 2027)[10]).toBe(49 + 42);
    expect(overallAverage(rows, PAIR, 2027)).toBe(73);
  });

  it("leave out a measure the publication no longer shows", () => {
    const rows = verifiedTableRows(catalogue({ withdrawn: "beta" }), "winners_losers");
    expect(rows.every((row) => row.reform_id === "alpha")).toBe(true);
    expect(decileAverages(rows, PAIR, 2027)).toBeNull();
  });

  it("are none without a verified publication", () => {
    expect(verifiedTableRows(buildMeasureCatalogue(), "winners_losers")).toEqual([]);
    expect(verifiedTableRows(undefined, "winners_losers")).toEqual([]);
  });
});
