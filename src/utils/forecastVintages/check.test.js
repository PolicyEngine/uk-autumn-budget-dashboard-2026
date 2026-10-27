/**
 * Whether a measure's outturn check is one the page can state truly
 * (checkProblem in load.js). The build's check_as_read
 * (src/uk_budget_data/forecast_vintages/build.py) is held to the same
 * cases in tests/test_forecast_vintages.py, so the build never writes a
 * check the page refuses, and the page states no gap beyond its tolerance.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkProblem, forecastVintagesProblem } from "./load";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const CASES = JSON.parse(readFileSync("tests/fixtures/forecast_vintages_check_cases.json", "utf8")).cases;

/** One change from the shared check cases, made in place. */
function apply(data, op) {
  const measure = data.variables.find((v) => v.id === op.variable)[op.measure];
  if (op.op === "set") measure.check[op.field] = op.to;
  else if (op.op === "drop_check") delete measure.check;
  else if (op.op === "kind") measure.kind = op.to;
  else throw new Error(`Unknown check case op ${op.op}`);
}

const problemOf = (data, variableId, name) => {
  const variable = data.variables.find((v) => v.id === variableId);
  return checkProblem(variable[name].check, variable[name], variable.frequency);
};

describe("an outturn check the page can state truly", () => {
  it.each(CASES.map((c) => [c.name, c]))("as the build reads it: %s", (_, c) => {
    const data = structuredClone(DATA);
    for (const op of c.ops) apply(data, op);
    const { variable, measure } = c.ops[0];
    expect(problemOf(data, variable, measure) === null).toBe(c.accepted);
  });

  it("in every committed measure", () => {
    for (const v of DATA.variables) {
      for (const name of ["level", "share"].filter((m) => v[m]?.kind)) expect(problemOf(DATA, v.id, name), `${v.id} ${name}`).toBeNull();
    }
  });

  it("refuses the whole file for a measure without one", () => {
    const data = structuredClone(DATA);
    delete data.variables.find((v) => v.id === "employment").level.check;
    expect(forecastVintagesProblem(data)).toMatch(/employment: it has no outturn check/);
  });
});
