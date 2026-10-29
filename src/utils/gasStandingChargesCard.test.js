import { describe, expect, it } from "vitest";
import { UNMODELLED_MEASURES } from "./unmodelledMeasures";
import { CALCULATOR_ONLY_MEASURES, GAS_STANDING_CHARGES_ID } from "./calculatorOnlyMeasures";

/**
 * The Policies tab's card for gas standing charges abolished (#355): the
 * national figures still leave it out, and the card says the Household
 * calculator includes it, on what, and why no national figure does.
 */
const card = () => UNMODELLED_MEASURES.find((measure) => measure.id === CALCULATOR_ONLY_MEASURES[GAS_STANDING_CHARGES_ID].card);

describe("the gas standing charges card", () => {
  it("says the Household calculator includes it, from a home's gas use, from an assumed start", () => {
    expect(card().notModelled).toBe(
      "The Household calculator includes it, from a home's gas use and an assumed 1 January 2028 start. National figures would need gas use in kWh, which the data lack.",
    );
  });

  it("no longer says the start and mitigation stop it being modelled at all", () => {
    expect(card().notModelled).not.toMatch(/not yet set/);
    // The card's own facts stay the government's
    expect(card().changes).toMatch(/£108 a year on average/);
    expect(card().noCosting).toMatch(/Table 6\.1 has no row/);
  });
});
