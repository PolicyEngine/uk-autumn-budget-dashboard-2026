import { readFileSync } from "node:fs";
import { useState } from "react";
import { csvParse } from "d3";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PolicySelector from "./PolicySelector";
import { POLICIES, ALL_POLICY_NAMES, PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";

const expected = ["cgt_equalisation", "fuel_duty_rise_cancellation", "bus_fare_cap"];

describe("2026 dashboard policy contract", () => {
  it("offers exactly the three candidate policies and lets users toggle them", () => {
    expect(POLICIES.map(p => p.id)).toEqual(expected);
    expect(PERSONAL_IMPACT_POLICY_ORDER).toEqual(expected);
    expect(ALL_POLICY_NAMES).toEqual(POLICIES.map(p => p.name));
    function Selector() {
      const [selected, setSelected] = useState(expected);
      return <PolicySelector policies={POLICIES} selectedPolicies={selected}
        onPolicyToggle={id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])} />;
    }
    render(<Selector />);
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
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
      expect([...new Set(rows.map(r => r.reform_id))].sort()).toEqual([...expected].sort());
      for (const id of expected) for (let year = 2026; year <= 2030; year++) {
        expect(rows.some(r => r.reform_id === id && Number(r.year) === year)).toBe(true);
      }
      expect(rows.some(r => Object.values(r).includes("NaN"))).toBe(false);
    });
  }

  it("has nonzero income-curve effects for households with gains and transport spending", () => {
    const rows = csvParse(readFileSync("public/data/income_curve.csv", "utf8"));
    for (const id of expected) {
      expect(rows.some(r => r.reform_id === id && r.year === "2027" &&
        Math.abs(Number(r.reform_net_income) - Number(r.baseline_net_income)) > 1)).toBe(true);
    }
  });
});
