import { chooseOption, optionsLabel } from "../../test/optionsPills";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MarginalRateChart, { RateTooltip } from "./MarginalRateChart";
import { breakdownRows, describeParts, drawnKey, partsInUse, rateAxis, RATE_PARTS, stepAt } from "./marginalRateParts";

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

  it("draws a negative part below zero, as the tooltip gives it (HH8)", () => {
    // Universal Credit rising with pay (−5%), other +5%
    const negative = { ...step(0.2, 0, 0.08, 0.05), universal_credit: -0.05 };
    const [row] = breakdownRows([RATES[0]], { after: [negative] });
    expect(row.universal_credit).toBe(-0.05);
    expect(row[drawnKey("universal_credit")]).toBe(-0.05);
    expect(row[drawnKey("other")]).toBeCloseTo(0.05, 9);
    // The parts, signed, still add up to the total
    expect(drawnSum(row)).toBeCloseTo(0.28, 6);
  });

  it("never draws Other below zero: a negative remainder is no layer, and the axis stays at 0% (round 3)", () => {
    // The named parts (28%) pass the step's total (25%): Other would be −3%
    const [row] = breakdownRows([{ income: 0, to: 50000, before: 0.25, after: 0.25 }], { after: [step(0.2, 0, 0.08)] });
    expect(row[drawnKey("other")]).toBe(0);
    // Flagged, so About this chart says it is not drawn
    expect(row.otherUndrawn).toBe(true);
    expect(rateAxis([row.after, row[drawnKey("other")]]).domain[0]).toBe(0);
    // A negative named part is still drawn below zero
    const [mixed] = breakdownRows([{ income: 0, to: 50000, before: 0.2, after: 0.2 }], {
      after: [{ ...step(0.2, 0, 0.08), universal_credit: -0.1 }],
    });
    expect(mixed[drawnKey("universal_credit")]).toBe(-0.1);
    expect(mixed[drawnKey("other")]).toBeCloseTo(0.02, 9);
  });

  it("widens the rate axis below 0% for a negative rate or part, within −100% to 200% (HH8)", () => {
    expect(rateAxis([0.2, 0.6])).toEqual({ domain: [0, 1], ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    expect(rateAxis([-0.05, 0.6]).domain).toEqual([-0.2, 1]);
    expect(rateAxis([-3, 0.6]).domain).toEqual([-1, 1]);
    expect(rateAxis([0.3, 1.3]).domain[1]).toBeGreaterThanOrEqual(1.3);
    expect(rateAxis([0.3, 50]).domain[1]).toBe(2);
  });

  it("hovers the step that holds the pointer's salary, not the nearest point (HH9)", () => {
    const rows = [{ income: 0 }, { income: 50000 }, { income: 100000 }, { income: 150000 }];
    // Past a step's middle, still that step
    expect(stepAt(rows, 90000).income).toBe(50000);
    expect(stepAt(rows, 50000).income).toBe(50000);
    expect(stepAt(rows, 0).income).toBe(0);
    expect(stepAt(rows, -1)).toBeNull();
  });

  it("puts your rate's parts in words, largest first", () => {
    expect(describeParts(step(0.4, 0.2, 0.02))).toBe("income tax 40%, the personal allowance taper 20%, National Insurance 2%");
    expect(describeParts(null)).toBe("");
  });
});

describe("MarginalRateChart", () => {
  it("stacks the parts in use, with a note behind an i for the Child Benefit clawback and the personal allowance taper", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("Personal allowance taper")).toBeInTheDocument();
    // One view at a time: After first, with its total only
    expect(optionsLabel(document.body)).toBe("With the policies");
    expect(screen.getByText("Total rate with the policies")).toBeInTheDocument();
    expect(screen.queryByText("Total rate under current law")).not.toBeInTheDocument();
    // Every shared component has a chip, so the two cards' keys line up;
    // one with nothing for this household is disabled
    fireEvent.click(screen.getByRole("button", { name: /with no effect for you$/ }));
    expect(screen.getByRole("button", { name: "Student loan" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Earnings and other income" })).toHaveAttribute("aria-disabled", "true");
    // The parts are chips (shown, hidden or highlighted from the key)
    expect(screen.getByRole("button", { name: "Personal allowance taper" })).toHaveAttribute("aria-pressed", "true");
    // One sentence: the rate, then the rate as money; its parts in More info
    expect(screen.getByText(/^At £110,000 your marginal tax rate is 62%, so of your next/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/made up of income tax 40%, the personal allowance taper 20%, National Insurance 2%/)).toBeInTheDocument();
    // The PA taper's note, which the legend had behind an "i", is a definition
    expect(document.querySelector(".chart-more-info")).toHaveTextContent(/Personal allowance taper/);
  });

  it("places the hover box beside the pointer, never over the top of the plot when the pointer is low, and follows a finger (round 3)", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    const plot = document.querySelector(".mtr-plot");
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0 });
    const tip = () => document.querySelector(".mtr-tooltip");
    // Low in the plot: anchored above the pointer, not pinned to the top
    // (jsdom draws nothing, so the box is given a height of 100px)
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    fireEvent.mouseMove(plot, { clientX: 200, clientY: 300 });
    expect(tip()).not.toBeNull();
    expect(tip().style.top).toBe("188px");
    // High in the plot: below the pointer
    fireEvent.mouseMove(plot, { clientX: 200, clientY: 50 });
    expect(tip().style.top).toBe("62px");
    // Never above the plot's box, nor below it
    fireEvent.mouseMove(plot, { clientX: 200, clientY: 210 });
    expect(tip().style.top).toBe("98px");
    fireEvent.mouseMove(plot, { clientX: 200, clientY: 199 });
    expect(tip().style.top).toBe("211px");
    // A box taller than the room above the pointer (a phone) is held at the top
    height.mockReturnValue(250);
    fireEvent.mouseMove(plot, { clientX: 200, clientY: 220 });
    expect(tip().style.top).toBe("0px");
    height.mockRestore();
    fireEvent.mouseLeave(plot);
    expect(tip()).toBeNull();
    // A tap shows it and lifting the finger clears it
    fireEvent.touchStart(plot, { touches: [{ clientX: 300, clientY: 200 }] });
    expect(tip()).not.toBeNull();
    fireEvent.touchMove(plot, { touches: [{ clientX: 400, clientY: 220 }] });
    expect(tip()).not.toBeNull();
    fireEvent.touchEnd(plot, { touches: [], changedTouches: [{ clientX: 400, clientY: 220 }] });
    expect(tip()).toBeNull();
    // The mouse move a browser makes up after a tap does not bring it back
    fireEvent.mouseMove(plot, { clientX: 400, clientY: 220 });
    expect(tip()).toBeNull();
  });

  it("clears the hover box when the finger lifts off a line that was redrawn and left the page (round 4)", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    const plot = document.querySelector(".mtr-plot");
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0 });
    const tip = () => document.querySelector(".mtr-tooltip");
    // A stand-in for a recharts path under the finger
    const line = document.createElement("span");
    plot.appendChild(line);
    fireEvent.touchStart(line, { touches: [{ clientX: 300, clientY: 200 }] });
    expect(tip()).not.toBeNull();
    // Redrawn: the element leaves the page, so its touchend cannot bubble to the plot
    line.remove();
    fireEvent.touchEnd(line, { touches: [], changedTouches: [{ clientX: 300, clientY: 200 }] });
    expect(tip()).toBeNull();
  });

  it("switches between before, after and the change, each with its own legend", () => {
    const own = { before: step(0.4, 0.2, 0.02), after: step(0.4, 0.2, 0.02) };
    render(<MarginalRateChart sweep={sweep({ before: STEPS, after: STEPS, own })} salary={110000} yearLabel="2027-28" />);
    chooseOption(document.body, "Current law");
    expect(screen.getByText("Total rate under current law")).toBeInTheDocument();
    expect(screen.queryByText("Total rate with the policies")).not.toBeInTheDocument();
    expect(screen.getByText("Personal allowance taper")).toBeInTheDocument();
    chooseOption(document.body, "Change");
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
    expect(tip("before")).toMatch(/Total rate under current law.*42%/);
    expect(tip("before")).not.toMatch(/Total rate with the policies/);
    expect(tip("after")).toMatch(/Total rate with the policies.*45%/);
    expect(tip("after")).not.toMatch(/Total rate under current law/);
    expect(tip("change")).toMatch(/Change in marginal rate.*\+3pp/);
    expect(tip("change")).not.toMatch(/Income tax|Total rate/);
  });

  it("draws the totals alone when the API sends no parts", () => {
    render(<MarginalRateChart sweep={sweep(null)} salary={110000} yearLabel="2027-28" />);
    expect(screen.getByText("With the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("Total rate with the policies")).not.toBeInTheDocument();
    expect(screen.getByText(/^At £110,000 your marginal tax rate is 62%, so of your next/)).toBeInTheDocument();
  });
});

describe("the two Across earnings cards in step", () => {
  it("share one list of components: the same chips in the same order on both, those with nothing disabled", async () => {
    const { sweepChips, SWEEP_COMPONENTS } = await import("./sweepComponents");
    const net = sweepChips("net", new Set(["market_income", "income_tax", "national_insurance"]), { label: "Net income after", colour: "x" });
    const rate = sweepChips("rate", new Set(["income_tax", "national_insurance"]), { label: "Total rate with the policies", colour: "x" });
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
      "With no earnings, your marginal tax rate on your first £200 would be 20% under current law and 39% with the policies, so of your first £200 of earnings, you keep £160 under current law and keep £121 with them.",
    );
  });
});

describe("changeRateTicks headroom", () => {
  it("never puts the largest change on the plot's edge", async () => {
    const { changeRateTicks } = await import("./MarginalRateChart");
    expect(changeRateTicks(0.1).at(-1)).toBe(0.2);
    expect(changeRateTicks(0.03).at(-1)).toBe(0.04);
  });
});
