import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GrowthWithMeasuresCard, { WITH_MEASURES_TITLE, clearGrowthWithMeasuresCache } from "./GrowthWithMeasuresCard";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";

const PUBLIC = join(__dirname, "..", "..", "..", "public", "data");
const OUTLOOK = readFileSync(join(PUBLIC, "living_standards_outlook.json"), "utf8");
const GROWTH = readFileSync(join(PUBLIC, "income_growth_with_measures.csv"), "utf8");

beforeEach(() => {
  clearGrowthWithMeasuresCache();
  clearOutlookCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).endsWith("living_standards_outlook.json")) return new Response(OUTLOOK, { status: 200 });
      if (String(url).endsWith("income_growth_with_measures.csv")) return new Response(GROWTH, { status: 200 });
      return new Response("", { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Growth across the distribution, with the selected measures", () => {
  it("shows the measures' effect by default, labelled with the measures, with a link to its twin", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32"]} twinLink={<a href="?tab=outlook&sub=living">twin</a>} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    // The header holds only the twin link; "with the measures" is in About
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/With the selected measures: each bar is the measures' effect/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "twin" })).toBeTruthy();
    expect(screen.getAllByText(/Difference from current law/).length).toBeGreaterThan(0);
    expect(screen.getByText(/the measures' effect on real median income growth/)).toBeTruthy();
  });

  it("says so, with no chart, when the measure does not move HBAI income", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["road_fuel_vat_cut"]} twinLink={null} />);
    expect(await screen.findByText(/do not change this income/)).toBeTruthy();
    expect(screen.queryByText(/Difference from current law/)).toBeNull();
  });

  it("stands two measures for the package, with a note", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32", "plan_2_threshold_unfreeze"]} twinLink={null} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    expect(screen.getByText(/this is the whole package/)).toBeTruthy();
  });
});
