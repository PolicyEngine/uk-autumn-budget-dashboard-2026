/**
 * Whether a forecast's figures read as its measure's kind (kindProblem in
 * load.js). The build's check_kind (src/uk_budget_data/forecast_vintages/
 * build.py) is held to the same cases in tests/test_forecast_vintages.py,
 * so the build never writes a file the page refuses for its kinds.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { forecastVintagesProblem, kindProblem } from "./load";
import { periodIndex } from "./transforms";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const CASES = JSON.parse(readFileSync("tests/fixtures/forecast_vintages_kind_cases.json", "utf8")).cases;
const copy = () => structuredClone(DATA);

/** One change from the shared kind cases, made in place. */
function apply(data, op) {
  const variable = data.variables.find((v) => v.id === op.variable);
  const measure = variable[op.measure];
  const frequency = variable.frequency;
  const lag = frequency === "quarterly" ? 4 : 1;
  const no = (key) => periodIndex(key, frequency);
  const vintage = measure.vintages.find((v) => v.label === op.vintage);
  const launch = vintage && String(vintage.launch);
  const keys = vintage ? Object.keys(vintage.values) : [];
  if (op.op === "kind") measure.kind = op.to;
  else if (op.op === "drop_launch") delete vintage.values[launch];
  else if (op.op === "drop_every_launch") {
    for (const v of measure.vintages) if (v.label !== op.but) delete v.values[String(v.launch)];
  } else if (op.op === "set_after_launch") {
    for (const k of keys) if (k !== launch) vintage.values[k] = op.to;
  } else if (op.op === "set_last") {
    vintage.values[keys.reduce((a, b) => (no(b) > no(a) ? b : a))] = op.to;
  } else if (op.op === "scale") {
    for (const k of keys) vintage.values[k] *= op.by;
  } else if (op.op === "launch_off_rate") {
    const before = Object.entries(measure.outturn).find(([k]) => no(k) === no(launch) - lag)[1];
    vintage.values[launch] = 100 * (measure.outturn[launch] / before - 1) + op.by;
  } else if (op.op === "launch_off_level") {
    let size = 0;
    for (const x of Object.values(measure.outturn)) size = Math.max(size, Math.abs(x));
    vintage.values[launch] = measure.outturn[launch] + op.by * size;
  } else throw new Error(`Unknown kind case op ${op.op}`);
}

const problemOf = (data, variableId, name) => {
  const variable = data.variables.find((v) => v.id === variableId);
  return kindProblem(variableId, variable[name], variable.frequency);
};

const MEASURES = DATA.variables.flatMap((v) => ["level", "share"].filter((m) => v[m]).map((name) => ({ id: v.id, name })));

describe("a forecast's figures read as its kind", () => {
  it.each(CASES.map((c) => [c.name, c]))("as the build reads them: %s", (_, c) => {
    const data = copy();
    for (const op of c.ops) apply(data, op);
    const { variable, measure } = c.ops[0];
    expect(problemOf(data, variable, measure) === null).toBe(c.accepted);
  });

  it("in every committed measure", () => {
    for (const { id, name } of MEASURES) expect(problemOf(DATA, id, name), `${id} ${name}`).toBeNull();
  });

  it("whatever a forecast holds after its launch period: a forecast may miss by any amount", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEASURES),
        fc.nat(),
        fc.oneof(fc.double({ min: 0.01, max: 99.99, noNaN: true }), fc.double({ min: -99.99, max: -0.01, noNaN: true })),
        ({ id, name }, which, value) => {
          const data = copy();
          const measure = data.variables.find((v) => v.id === id)[name];
          const vintage = measure.vintages[which % measure.vintages.length];
          const figure = measure.kind === "index" ? Math.abs(value) : measure.kind === "level" ? value * 1e6 : value;
          for (const k of Object.keys(vintage.values)) if (k !== String(vintage.launch)) vintage.values[k] = figure;
          expect(problemOf(data, id, name)).toBeNull();
          // The loader takes the whole file too
          expect(forecastVintagesProblem(data)).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("whichever forecasts start the period after their launch, as the build lets one, while one keeps its launch figure", () => {
    const growthOrLevel = MEASURES.filter(({ id, name }) => DATA.variables.find((v) => v.id === id)[name].kind !== "index");
    fc.assert(
      fc.property(fc.constantFrom(...growthOrLevel), fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), ({ id, name }, drop) => {
        const data = copy();
        const measure = data.variables.find((v) => v.id === id)[name];
        measure.vintages.forEach((v, i) => {
          if (i > 0 && drop[i % drop.length]) delete v.values[String(v.launch)];
        });
        expect(problemOf(data, id, name)).toBeNull();
        expect(forecastVintagesProblem(data)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});
