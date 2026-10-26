/**
 * Whether the page takes the file as a whole: its variables, each once;
 * the meta the page reads besides the forecasts; and of each measure a unit
 * reads, its forecasts each once in date order, and the files it is built
 * from, each under Sources (forecastVintagesProblem in load.js). The build's check_document
 * (src/uk_budget_data/forecast_vintages/build.py) is held to the same cases
 * in tests/test_forecast_vintages.py, so the build never writes a file the
 * page refuses.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forecastVintagesProblem } from "./load";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const CASES = JSON.parse(readFileSync("tests/fixtures/forecast_vintages_document_cases.json", "utf8")).cases;

/** One change from the shared document cases, made in place. */
function apply(data, { op, path, to }) {
  const parent = path.slice(0, -1).reduce((value, step) => value[step], data);
  const last = path.at(-1);
  if (op === "set") parent[last] = structuredClone(to);
  else if (op === "delete") delete parent[last];
  else if (op === "append") parent[last].push(structuredClone(to));
  else throw new Error(`Unknown document case op ${op}`);
}

describe("a file the page takes as a whole", () => {
  it.each(CASES.map((c) => [c.name, c]))("as the build reads it: %s", (_, c) => {
    const data = structuredClone(DATA);
    for (const op of c.ops) apply(data, op);
    expect(forecastVintagesProblem(data) === null).toBe(c.accepted);
  });

  // Found by the thirteenth review: the build checked each variable's id on
  // its own, and could write two of one id, which turns the tab off
  it("refuses a variable twice, by name", () => {
    const data = structuredClone(DATA);
    data.variables.find((v) => v.id === "receipts").id = "spending";
    expect(forecastVintagesProblem(data)).toBe("a variable twice");
  });

  // Found by the fourteenth review: each card says every file it is built
  // from is listed under Sources, and Sources could leave one out
  it("refuses a file whose Sources leave out a file a measure is built from, naming the measure", () => {
    const data = structuredClone(DATA);
    delete data.meta.sources.hpi;
    expect(forecastVintagesProblem(data)).toBe("house_prices: a file it is built from is not among the sources");
    const cut = structuredClone(DATA);
    cut.meta.sources.ons = cut.meta.sources.ons.filter((s) => s.cdid !== "D7BT");
    expect(forecastVintagesProblem(cut)).toBe("cpi: a file it is built from is not among the sources");
  });

  it("finds every file each committed measure is built from under Sources", () => {
    const { obr, ons, hpi } = DATA.meta.sources;
    let files = 0;
    for (const v of DATA.variables) {
      for (const name of new Set(Object.values(v.units).map((spec) => spec.from))) {
        const f = v[name].files;
        for (const id of f.obr) expect(obr.map((s) => s.id)).toContain(id);
        for (const cdid of f.ons) expect(ons.map((s) => s.cdid)).toContain(cdid);
        if (f.hpi) expect(hpi).toBeTruthy();
        files += f.obr.length + f.ons.length + Number(f.hpi);
      }
    }
    expect(files).toBeGreaterThan(40);
  });

  it("says no release date is one the calendar lacks", () => {
    const data = structuredClone(DATA);
    data.meta.sources.ons[0].release_date = "2026-02-30";
    expect(forecastVintagesProblem(data)).toBe("no ONS sources");
  });
});
