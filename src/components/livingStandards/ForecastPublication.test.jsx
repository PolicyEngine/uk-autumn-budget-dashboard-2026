import { readFileSync } from "node:fs";
import fc from "fast-check";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LivingStandardsTab from "./LivingStandardsTab";
import { loadOutlook } from "../../utils/livingStandards/outlook";

vi.mock("../../utils/livingStandards/outlook", async (original) => ({
  ...await original(), loadOutlook: vi.fn(),
}));
const original = JSON.parse(readFileSync("public/data/living_standards_outlook.json", "utf8"));
afterEach(cleanup);

describe("the independent outlook and the Budget forecast", () => {
  it("keeps baseline figures available without a publication manifest", async () => {
    loadOutlook.mockResolvedValue({ data: original, error: null });
    // Current law lives on this view's Living standards and Poverty
    // sub-tabs, whatever the publication
    window.history.replaceState({}, "", "/?tab=living");
    render(<LivingStandardsTab />);
    expect(await screen.findByRole("heading", { name: "Living standards under current law" })).toBeInTheDocument();
    cleanup();
    window.history.replaceState({}, "", "/?tab=outlook&sub=poverty");
    render(<LivingStandardsTab />);
    expect(await screen.findByRole("heading", { name: "Poverty under current law" })).toBeInTheDocument();
  });

  it("draws a loaded Budget forecast beside March, whatever its figures", async () => {
    await fc.assert(fc.asyncProperty(fc.double({ min: -10, max: 10, noNaN: true }), async (value) => {
      const data = structuredClone(original);
      data.forecast.post_published = true;
      data.forecast.post_label = "OBR October 2026 (Autumn Budget)";
      for (const section of data.forecast.sections) {
        for (const series of section.series) series.post = series.pre.map((row) => ({ ...row, value }));
      }
      loadOutlook.mockResolvedValue({ data, error: null });
      window.history.replaceState({}, "", "/?tab=living&sub=forecast");
      render(<LivingStandardsTab />);
      expect(await screen.findByRole("heading", { name: "OBR March 2026 and October 2026 economic forecasts" })).toBeInTheDocument();
      expect(document.querySelector(".ls-card")).not.toBeNull();
      cleanup();
    }), { numRuns: 5 });
  });
});
