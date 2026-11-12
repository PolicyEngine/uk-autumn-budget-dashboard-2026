import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALCULATOR_ONLY_MEASURES, isCalculatorOnly } from "./calculatorOnlyMeasures";
import { HELD_FOR_CHECKS, UNMODELLED_MEASURES, UNMODELLED_REASONS } from "./unmodelledMeasures";

// Company car tax and the Machine Games Duty rise stay out of the national
// results (11 November 2026). From policyengine 6.16.2 the national data
// hold company cars and machine takings, so neither is held for want of
// data any more: each is held while we check our own estimate. Each one's
// card says so, and nothing publishes a figure for either: the page lists
// exactly the measures the publication manifest names
// (measureCatalogue.jsx), so the manifest is what these tests watch.
//
// To publish one: take it out of HELD here and in
// tests/test_held_measures.py, out of HELD_FOR_CHECKS and
// UNMODELLED_MEASURES (unmodelledMeasures.js), and, for the duty, out of
// CALCULATOR_ONLY_MEASURES, in the change that stages its figures.
const HELD = [
  {
    card: "machine-games-duty",
    // The id its figures would publish under (reforms.py registers it)
    measure: /machine_games/,
    row: 56,
    values: [0, 135, 150, 145, 145, 145],
    why: "Household calculator only: we haven't yet finished and checked a national estimate.",
  },
  {
    card: "company-car-tax",
    // No measure is registered; any id for one would name the car
    measure: /company_car/,
    row: 86,
    values: [0, 0, 0, 0, 310, 345],
    why: "Our costing falls well short of the Treasury's; we haven't established why.",
  },
];

const PUBLIC_DATA = join(process.cwd(), "public", "data");
const card = (id) => UNMODELLED_MEASURES.find((measure) => measure.id === id);
const whyOf = (measure) => measure.points.find((point) => point.label === "Why we leave it out").text;

describe("the measures we hold back while we check our estimates", () => {
  it("are company car tax and the Machine Games Duty rise, each still a card with the Treasury's row", () => {
    expect([...HELD_FOR_CHECKS].sort()).toEqual(HELD.map((held) => held.card).sort());
    for (const held of HELD) {
      const measure = card(held.card);
      expect(measure, held.card).toBeDefined();
      expect(measure.costings.map(({ row, values }) => [row, values]), held.card).toEqual([[held.row, held.values]]);
      // Its place in the list is one of the page's own groups
      expect(UNMODELLED_REASONS.map(({ id }) => id), held.card).toContain(measure.reason);
    }
  });

  it("say why we hold each one, in words that stay true of data holding company cars and machine takings", () => {
    for (const held of HELD) {
      const why = whyOf(card(held.card));
      expect(why, held.card).toBe(held.why);
      // The reasons written for the earlier data
      expect(why, held.card).not.toMatch(/no company cars|no gambling|machine types|data (?:hold|lack|have) no/i);
    }
  });

  it("give no figure of ours: the shortfall and the unfinished estimate are said in words", () => {
    for (const held of HELD) expect(whyOf(card(held.card)), held.card).not.toMatch(/[0-9%£]/);
  });

  it("keep the duty in the Household calculator only, and company car tax out of it", () => {
    const calculatorOnly = Object.keys(CALCULATOR_ONLY_MEASURES);
    expect(calculatorOnly.filter((id) => HELD[0].measure.test(id))).toEqual(["machine_games_duty_rise"]);
    expect(isCalculatorOnly("machine_games_duty_rise")).toBe(true);
    expect(whyOf(card("machine-games-duty"))).toMatch(/^Household calculator only: /);
    expect(calculatorOnly.filter((id) => HELD[1].measure.test(id))).toEqual([]);
  });

  it("are in no publication: the manifest names neither, alone or in a package, and no artifact or costing holds one", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC_DATA, "manifest.json"), "utf8"));
    const named = [
      ...Object.keys(manifest.measures ?? {}),
      ...Object.values(manifest.combined ?? {}).flatMap((entry) => entry.measures ?? []),
      ...(manifest.superseded ?? []).map((entry) => entry.key),
      ...Object.values(manifest.measures ?? {}).map((entry) => entry.artifact ?? ""),
    ];
    const artifacts = existsSync(join(PUBLIC_DATA, "artifacts")) ? readdirSync(join(PUBLIC_DATA, "artifacts")) : [];
    const costings = JSON.parse(readFileSync(join(PUBLIC_DATA, "official_costings.json"), "utf8"));
    for (const held of HELD) {
      const message = `${held.card} is held out of the national results: see the note at the top of heldMeasures.test.js`;
      expect(named.filter((name) => held.measure.test(name)), message).toEqual([]);
      expect(artifacts.filter((name) => held.measure.test(name)), message).toEqual([]);
      expect(Object.keys(costings.measures ?? {}).filter((name) => held.measure.test(name)), message).toEqual([]);
    }
  });
});
