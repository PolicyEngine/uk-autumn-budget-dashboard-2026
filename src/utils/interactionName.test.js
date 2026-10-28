import { describe, expect, it } from "vitest";
import { interactionName } from "./interactionName";

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
});
