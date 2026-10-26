import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MarginalRateChart from "./MarginalRateChart";
import { breakdownRows, describeParts, drawnKey, partsInUse, RATE_PARTS } from "./marginalRateParts";

// Three steps: basic rate, higher rate, then the allowance taper
const RATES = [
  { income: 0, to: 50000, before: 0.28, after: 0.28 },
  { income: 50000, to: 100000, before: 0.42, after: 0.42 },
  { income: 100000, to: 150000, before: 0.62, after: 0.62 },
];
const step = (tax, taper, ni, other = 0) => ({
  income_tax: tax,
  child_benefit_charge: 0,
  personal_allowance_taper: taper,
  national_insurance: ni,
  student_loan: 0,
  universal_credit: 0,
  other_benefits: 0,
  other,
});
const STEPS = [step(0.2, 0, 0.08), step(0.4, 0, 0.02), step(0.4, 0.2, 0.02)];
const sweep = (parts) => ({
  points: [],
  rates: RATES,
  parts,
  own: { income: 110000, beforeRate: 0.62, afterRate: 0.62 },
  min: 0,
  max: 150000,
});
const drawnSum = (row) => RATE_PARTS.reduce((sum, part) => sum + row[drawnKey(part.name)], 0);

describe("marginal rate parts", () => {
  it("keeps only the parts a step uses, in stacking order, and each row's stack reaches its total", () => {
    expect(partsInUse(STEPS).map((part) => part.name)).toEqual([
      "income_tax",
      "personal_allowance_taper",
      "national_insurance",
    ]);
    const rows = breakdownRows(RATES, { after: STEPS });
    // The last step is drawn to the sweep's end
    expect(rows).toHaveLength(RATES.length + 1);
    expect(rows[rows.length - 1].income).toBe(150000);
    for (const row of rows) expect(drawnSum(row)).toBeCloseTo(row.after, 6);
  });

  it("draws a negative part at zero, with other taking up the difference", () => {
    // Universal Credit rising with pay (−5%) and other making it up
    const negative = { ...step(0.2, 0, 0.08, 0.05), universal_credit: -0.05 };
    const [row] = breakdownRows([RATES[0]], { after: [negative] });
    expect(row.universal_credit).toBe(-0.05);
    expect(row[drawnKey("universal_credit")]).toBe(0);
    expect(row[drawnKey("other")]).toBe(0);
    expect(drawnSum(row)).toBeCloseTo(0.28, 6);
  });

  it("puts your rate's parts in words, largest first", () => {
    expect(describeParts(step(0.4, 0.2, 0.02))).toBe("income tax 40%, PA taper 20%, National Insurance 2%");
    expect(describeParts(null)).toBe("");
  });
});

describe("MarginalRateChart", () => {
  it("stacks the parts in use, with a note behind an i for the Child Benefit clawback and the PA taper", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("PA taper")).toBeInTheDocument();
    expect(screen.getByText("Total rate after")).toBeInTheDocument();
    expect(screen.getByText("Total rate before")).toBeInTheDocument();
    expect(screen.queryByText("Student loan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About PA taper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "About Income tax" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "At £110,000 your marginal tax rate is 62% before and 62% after: income tax 40%, PA taper 20%, National Insurance 2%.",
      ),
    ).toBeInTheDocument();
  });

  it("draws the totals alone when the API sends no parts", () => {
    render(<MarginalRateChart sweep={sweep(null)} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("After the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("Total rate after")).not.toBeInTheDocument();
    expect(screen.getByText("At £110,000 your marginal tax rate is 62% before and 62% after.")).toBeInTheDocument();
  });
});
