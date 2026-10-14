import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import ConstituencyRankings from "./ConstituencyRankings";
import {
  UNAVAILABLE_MESSAGE,
  resetConstituencyDataCache,
} from "../utils/constituencyData";

// No mocks: the checked-in data files and the shipped verified set.
beforeEach(() => {
  resetConstituencyDataCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = `public${new URL(url, "http://localhost").pathname}`;
      const text = readFileSync(path, "utf8");
      return {
        ok: true,
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

// The checked-in constituency rows are the 2025 dashboard's, not certified
// Microcosm output, so neither the map nor the rankings may show them.
it("shows neither the map nor the rankings for the checked-in rows", async () => {
  const policies = [
    "two_child_limit",
    "fuel_duty_freeze",
    "rail_fares_freeze",
    "threshold_freeze_extension",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
    "freeze_student_loan_thresholds",
    "salary_sacrifice_cap",
  ];
  const { container } = render(
    <>
      <ConstituencyMap selectedPolicies={policies} selectedYear={2029} />
      <ConstituencyRankings selectedPolicies={policies} selectedYear={2029} />
    </>,
  );
  expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(container.querySelector(".constituency-map-wrapper")).toBeNull();
  expect(container.querySelector(".constituency-rankings")).toBeNull();
});
