import { readFileSync } from "node:fs";
import { useState } from "react";
import { csvParse } from "d3";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PolicySelector from "./PolicySelector";
import { POLICIES, CHART_POLICIES, ALL_POLICY_NAMES, PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";

const expected = [
  "cgt_equalisation", "fuel_duty_rise_cancellation", "bus_fare_cap",
  "threshold_freeze_extension", "dividend_tax_increase_2pp",
  "savings_tax_increase_2pp", "property_tax_increase_2pp",
];

describe("2026 dashboard policy contract", () => {
  it("offers the three candidates and four carried-over policies", () => {
    expect(POLICIES.map(p => p.id)).toEqual(expected);
    expect(PERSONAL_IMPACT_POLICY_ORDER).toEqual(expected);
    expect(ALL_POLICY_NAMES).toEqual(CHART_POLICIES.map(p => p.name));
    function Selector() {
      const [selected, setSelected] = useState(expected);
      return <PolicySelector policies={POLICIES} selectedPolicies={selected}
        onPolicyToggle={id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])} />;
    }
    render(<Selector />);
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    for (const box of boxes) {
      expect(box).toBeChecked();
      fireEvent.click(box);
      expect(box).not.toBeChecked();
      fireEvent.click(box);
      expect(box).toBeChecked();
    }
  });

  for (const file of ["budgetary_impact", "distributional_impact", "winners_losers", "metrics", "household_scatter", "income_curve"]) {
    it(`${file} has current results for every policy and year`, () => {
      const rows = csvParse(readFileSync(`public/data/${file}.csv`, "utf8"));
      expect(expected.every(id => rows.some(row => row.reform_id === id))).toBe(true);
      for (const id of expected) for (let year = 2026; year <= 2030; year++) {
        expect(rows.some(r => r.reform_id === id && Number(r.year) === year)).toBe(true);
      }
      expect(rows.some(r => Object.values(r).includes("NaN"))).toBe(false);
    });
  }

  it("shows CGT and fuel effects while the illustrative London household has no bus saving", () => {
    const rows = csvParse(readFileSync("public/data/income_curve.csv", "utf8"));
    for (const id of expected.slice(0, 2)) {
      expect(rows.some(r => r.reform_id === id && Number(r.year) >= 2027 &&
        Math.abs(Number(r.reform_net_income) - Number(r.baseline_net_income)) > 1)).toBe(true);
    }
    expect(rows.filter(r => r.reform_id === "bus_fare_cap").every(r =>
      Math.abs(Number(r.reform_net_income) - Number(r.baseline_net_income)) < 0.01)).toBe(true);
  });
});
