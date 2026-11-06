/**
 * Whether a series ({period: value}) is one the page can draw (isSeries in
 * load.js). The build's series_as_read
 * (src/uk_budget_data/forecast_vintages/build.py) is held to the same
 * cases in tests/test_forecast_vintages.py, so the build never writes a
 * series the page refuses.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forecastVintagesProblem, isSeries } from "./load";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const CASES = JSON.parse(readFileSync("tests/fixtures/forecast_vintages_series_cases.json", "utf8")).cases;

describe("a series the page can draw", () => {
  it.each(CASES.map((c) => [c.name, c]))("as the build reads it: %s", (_, c) => {
    expect(isSeries(c.values, c.frequency)).toBe(c.accepted);
  });

  it("is every committed series", () => {
    for (const v of DATA.variables) {
      for (const measure of [v.level, v.share].filter(Boolean)) {
        for (const values of [measure.outturn, ...measure.vintages.map((x) => x.values)]) expect(isSeries(values, v.frequency)).toBe(true);
      }
    }
  });

  // Found by the ninth review: a blank ONS year left a gap in the outturn
  // the build wrote, and the page refused the whole file
  it("refuses a whole file whose outturn has a year missing between", () => {
    const data = structuredClone(DATA);
    delete data.variables.find((v) => v.id === "real_gdp").level.outturn["1955"];
    expect(forecastVintagesProblem(data)).toBe("real_gdp: no outturn");
  });
});
