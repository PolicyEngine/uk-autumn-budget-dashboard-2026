import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interactionName } from "./interactionName";
import { MODELLED_NOT_SURVEY } from "./measureModelling";

const MODELLED = { description: "Repayments are modelled, replacing those reported in the survey, and the revenue figure is the change in modelled repayments." };
const PLAIN = { description: "Duty rises with RPI." };

describe("interactionName", () => {
  it("names the baseline difference when a selected measure replaces survey values", () => {
    expect(interactionName([PLAIN, MODELLED])).toBe("Interaction and baseline difference");
  });

  it("stays 'Interaction' otherwise", () => {
    expect(interactionName([PLAIN, {}])).toBe("Interaction");
    expect(interactionName(undefined)).toBe("Interaction");
  });

  // The label reads one phrase from the published descriptions, so a
  // regeneration that rewrites it would quietly turn the label back to
  // "Interaction". This fails instead. If no published measure replaces
  // survey values any more (none has a baseline_simulation_modifier), delete
  // this test; if one still does, put the phrase back in its description.
  it("finds the phrase in at least one published description", () => {
    const { measures } = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"),
    );
    const modelled = Object.entries(measures)
      .filter(([, measure]) => MODELLED_NOT_SURVEY.test(measure?.description ?? ""))
      .map(([id]) => id);
    expect(modelled.length, "no published description says 'replacing those reported in the survey'").toBeGreaterThan(0);
  });
});
