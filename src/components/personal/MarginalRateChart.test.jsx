import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MarginalRateChart, { RateTooltip } from "./MarginalRateChart";
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
    expect(describeParts(step(0.4, 0.2, 0.02))).toBe("income tax 40%, personal allowance taper 20%, National Insurance 2%");
    expect(describeParts(null)).toBe("");
  });
});

describe("MarginalRateChart", () => {
  it("stacks the parts in use, with a note behind an i for the Child Benefit clawback and the personal allowance taper", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("Personal allowance taper")).toBeInTheDocument();
    // One view at a time: After first, with its total only
    expect(screen.getByRole("button", { name: "After" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Total rate after")).toBeInTheDocument();
    expect(screen.queryByText("Total rate before")).not.toBeInTheDocument();
    // Every shared component has a chip, so the two cards' keys line up;
    // one with nothing for this household is disabled
    expect(screen.getByRole("button", { name: "Student loan" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Earnings and other income" })).toHaveAttribute("aria-disabled", "true");
    // The parts are chips (shown, hidden or highlighted from the key)
    expect(screen.getByRole("button", { name: "Personal allowance taper" })).toHaveAttribute("aria-pressed", "true");
    // One sentence: the rate, then the rate as money; its parts in More info
    expect(screen.getByText(/^At £110,000 your marginal tax rate is 62%, so of your next/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/made up of income tax 40%, personal allowance taper 20%, National Insurance 2%/)).toBeInTheDocument();
    // The PA taper's note, which the legend had behind an "i", is a definition
    expect(document.querySelector(".chart-more-info")).toHaveTextContent(/Personal allowance taper/);
  });

  it("switches between before, after and the change, each with its own legend", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(screen.getByText("Total rate before")).toBeInTheDocument();
    expect(screen.queryByText("Total rate after")).not.toBeInTheDocument();
    expect(screen.getByText("Personal allowance taper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Change in marginal rate")).toBeInTheDocument();
    expect(screen.queryByText("Personal allowance taper")).not.toBeInTheDocument();
    expect(document.querySelector('[data-view="change"]')).not.toBeNull();
  });

  it("gives in its tooltip only what the view draws", () => {
    const point = {
      income: 50000,
      ...step(0.4, 0, 0.02),
      beforeRaw: 0.42,
      afterRaw: 0.45,
      change: 0.03,
    };
    const parts = RATE_PARTS.filter((part) => ["income_tax", "national_insurance"].includes(part.name));
    const tip = (view) => {
      const { container, unmount } = render(
        <RateTooltip active payload={[{ payload: point }]} yearLabel="2027-28" parts={view === "change" ? null : parts} view={view} />,
      );
      const text = container.textContent;
      unmount();
      return text;
    };
    expect(tip("before")).toMatch(/Income tax/);
    expect(tip("before")).toMatch(/Total rate before.*42%/);
    expect(tip("before")).not.toMatch(/Total rate after/);
    expect(tip("after")).toMatch(/Total rate after.*45%/);
    expect(tip("after")).not.toMatch(/Total rate before/);
    expect(tip("change")).toMatch(/Change in marginal rate.*\+3pp/);
    expect(tip("change")).not.toMatch(/Income tax|Total rate/);
  });

  it("draws the totals alone when the API sends no parts", () => {
    render(<MarginalRateChart sweep={sweep(null)} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("After the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("Total rate after")).not.toBeInTheDocument();
    expect(screen.getByText(/^At £110,000 your marginal tax rate is 62%, so of your next/)).toBeInTheDocument();
  });
});

describe("the two Across earnings cards in step", () => {
  it("share one list of components: the same chips in the same order on both, those with nothing disabled", async () => {
    const { sweepChips, SWEEP_COMPONENTS } = await import("./sweepComponents");
    const net = sweepChips("net", new Set(["market_income", "income_tax", "national_insurance"]), { label: "Net income after", colour: "x" });
    const rate = sweepChips("rate", new Set(["income_tax", "national_insurance"]), { label: "Total rate after", colour: "x" });
    expect(net.map((chip) => chip.label).slice(0, -1)).toEqual(rate.map((chip) => chip.label).slice(0, -1));
    expect(net.map((chip) => chip.key).slice(0, -1)).toEqual(SWEEP_COMPONENTS.map((component) => component.key));
    const by = (chips, key) => chips.find((chip) => chip.key === key);
    expect(by(net, "income_tax").disabled).toBe(false);
    expect(by(net, "universal_credit")).toMatchObject({ disabled: true, tip: "No effect for this household" });
    expect(by(net, "pa_taper")).toMatchObject({ disabled: true, tip: "Included in income tax on this card" });
    expect(by(rate, "earnings").disabled).toBe(true);
    // The same colour on both
    for (const chip of net.slice(0, -1)) expect(by(rate, chip.key).colour).toBe(chip.colour);
  });

  it("says 'With no earnings' at a salary of £0, over the first £200", () => {
    const own = { before: step(0.2, 0, 0), after: step(0.4, 0, 0) };
    render(
      <MarginalRateChart
        sweep={{ ...sweep({ before: STEPS, after: STEPS, own }), own: { income: 0, beforeRate: 0.2, afterRate: 0.393 } }}
        salary={0}
        yearLabel="2027-28"
      />,
    );
    expect(document.querySelector(".chart-description").textContent).toBe(
      "With no earnings, your marginal tax rate on your first £200 would be 20% before and 39% after, so of your first £200 of earnings, you keep £160 before and keep £121 after.",
    );
  });
});
