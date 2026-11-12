import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import useHouseholdIncomeView from "./sections/LivingStandardsSection";
import usePovertyRateView from "./sections/PovertySection";
import useInequalityView from "./sections/InequalitySection";
import useDepthView from "./sections/DeepPovertySection";
import useQuintileGrowthView from "./sections/DecileGrowthSection";

const OUTLOOK = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"), "utf8"));

beforeEach(() => window.history.replaceState({}, "", "/?tab=outlook"));

describe("Pre-Budget projection CSV labels", () => {
  it.each([
    ["household income", useHouseholdIncomeView],
    ["poverty rates", usePovertyRateView],
    ["inequality", useInequalityView],
    ["depth of poverty", useDepthView],
    ["income growth", useQuintileGrowthView],
  ])("names the policy basis when exporting %s", (_, useView) => {
    const { result } = renderHook(() => useView(OUTLOOK));
    expect(result.current.download.csv().split("\r\n")[0]).toContain("pre-Budget projection");
  });

  it("leaves an export of official history free of a projected policy label", () => {
    const { result } = renderHook(() => useHouseholdIncomeView(OUTLOOK));
    act(() => result.current.controls.options.find((option) => option?.label === "Lines").onChange("outturn"));
    const csv = result.current.download.csv();
    expect(csv.split("\r\n")[0]).not.toContain("pre-Budget");
    expect(csv).toContain("Official figures");
    expect(csv.split("\r\n")[2]).not.toContain("PolicyEngine");
  });
});
