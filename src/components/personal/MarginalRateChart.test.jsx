import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MarginalRateChart from "./MarginalRateChart";
import { breakdownRows, partsInUse } from "./marginalRateParts";

// Three steps: basic rate, higher rate, then the allowance taper
const RATES = [
  { income: 0, to: 50000, before: 0.28, after: 0.28 },
  { income: 50000, to: 100000, before: 0.42, after: 0.42 },
  { income: 100000, to: 150000, before: 0.62, after: 0.62 },
];
const step = (tax, taper, ni) => ({
  income_tax: tax,
  personal_allowance_taper: taper,
  national_insurance: ni,
  student_loan: 0,
  child_benefit_charge: 0,
  universal_credit: 0,
  other_benefits: 0,
  other: 0,
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

describe("marginal rate parts", () => {
  it("keeps only the parts a step uses, and each row adds up to its total", () => {
    expect(partsInUse(STEPS).map((part) => part.name)).toEqual([
      "income_tax",
      "personal_allowance_taper",
      "national_insurance",
    ]);
    const rows = breakdownRows(RATES, { after: STEPS });
    // The last step is drawn to the sweep's end
    expect(rows).toHaveLength(RATES.length + 1);
    expect(rows[rows.length - 1].income).toBe(150000);
    for (const row of rows) {
      const sum = row.income_tax + row.personal_allowance_taper + row.national_insurance;
      expect(sum).toBeCloseTo(row.after, 6);
    }
  });
});

describe("MarginalRateChart", () => {
  it("opens on the breakdown, with each part's note behind an i, and switches to before vs after", () => {
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS })} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByRole("button", { name: /Marginal tax rate shown/ })).toHaveTextContent("Breakdown");
    const legend = screen.getByRole("list", { name: "Parts of the marginal tax rate" });
    expect(legend).toHaveTextContent("Personal allowance taper");
    expect(legend).not.toHaveTextContent("Student loan");
    expect(screen.getByRole("button", { name: "About Personal allowance taper" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Marginal tax rate shown/ }));
    fireEvent.click(screen.getByRole("option", { name: /Before vs after/ }));
    expect(screen.queryByRole("list", { name: "Parts of the marginal tax rate" })).not.toBeInTheDocument();
    expect(screen.getByText("Before the selected policies")).toBeInTheDocument();
  });

  it("draws the totals alone when the API sends no parts", () => {
    render(<MarginalRateChart sweep={sweep(null)} salary={110000} yearLabel="2027-28" />);
    expect(screen.queryByRole("button", { name: /Marginal tax rate shown/ })).not.toBeInTheDocument();
    expect(screen.getByText("After the selected policies")).toBeInTheDocument();
    expect(screen.getByText("At £110,000 your marginal tax rate is 62% before and 62% after.")).toBeInTheDocument();
  });
});
