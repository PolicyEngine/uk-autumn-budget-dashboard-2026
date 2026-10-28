import { describe, expect, it } from "vitest";
import { PLAN_2_ID, interactionName } from "./interactionName";

describe("interactionName", () => {
  it("names the baseline difference when the Plan 2 measure is selected", () => {
    expect(interactionName(["fuel_duty_rise_deferral", PLAN_2_ID])).toBe("Interaction and baseline difference");
  });

  it("stays 'Interaction' without the Plan 2 measure", () => {
    expect(interactionName(["fuel_duty_rise_deferral", "warm_home_discount_top_up"])).toBe("Interaction");
    expect(interactionName(undefined)).toBe("Interaction");
  });
});
