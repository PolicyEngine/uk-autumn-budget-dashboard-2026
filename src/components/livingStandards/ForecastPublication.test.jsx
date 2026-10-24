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

describe("the independent outlook and Budget-day forecast", () => {
  it("keeps baseline figures available without a publication manifest", async () => {
    loadOutlook.mockResolvedValue({ data: original, error: null });
    window.history.replaceState({}, "", "/?tab=living");
    render(<LivingStandardsTab />);
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Poverty" })).toBeInTheDocument();
  });

  it("never renders an unverified Budget-day forecast, whatever its figures", async () => {
    await fc.assert(fc.asyncProperty(fc.double({ min: -10, max: 10, noNaN: true }), async (value) => {
      const data = structuredClone(original);
      data.forecast.post_published = true;
      for (const section of data.forecast.sections) {
        for (const series of section.series) series.post = series.pre.map((row) => ({ ...row, value }));
      }
      loadOutlook.mockResolvedValue({ data, error: null });
      window.history.replaceState({}, "", "/?tab=living&sub=forecast");
      render(<LivingStandardsTab />);
      expect(await screen.findByText("Budget-day forecast is unavailable until verified")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Forecast changes" })).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Baseline outlook" })).toBeInTheDocument();
      expect(document.querySelector(".ls-card")).toBeNull();
      cleanup();
    }), { numRuns: 20 });
  });
});
