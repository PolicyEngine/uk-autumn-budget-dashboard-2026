import { chooseOption, optionsLabel } from "../../test/optionsPills";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EarningsChart, { pointerOnPlot, tipPlacement } from "./EarningsChart";
import { layerLegendItems, layerRows, layersInUse, stackLayers } from "./netIncomeParts";
import { CHART_COLOURS } from "../../utils/chartTheme";
import { RATE_PARTS } from "./marginalRateParts";

const incomes = [0, 50000, 100000, 150000];
const sweep = {
  points: incomes.map((income) => ({
    income,
    before: income * 0.7 + 10000,
    after: income * 0.7 + 10100,
    change: 100,
  })),
  rates: [],
  own: null,
  min: 0,
  max: 150000,
};

// Net income's parts, adding up to each point's net income: income tax
// cut by £100 after the policies
const parts = (side) =>
  incomes.map((income) => ({
    employment_income: income,
    other_income: 0,
    universal_credit: income === 0 ? 8000 : 0,
    child_benefit: 2000,
    other_benefits: 0,
    income_tax: -(income * 0.2) + (side === "after" ? 100 : 0),
    national_insurance: -(income * 0.1),
    student_loan: 0,
    council_tax: -2000,
    child_benefit_charge: income >= 100000 ? -2000 : 0,
    pension_contributions: 0,
    other_taxes: 0,
  }));
const withParts = (side) => {
  const values = parts(side);
  return values.map((point) => Object.values(point).reduce((sum, v) => sum + v, 0));
};
const stackedSweep = {
  ...sweep,
  points: incomes.map((income, i) => ({
    income,
    before: withParts("before")[i],
    after: withParts("after")[i],
    change: withParts("after")[i] - withParts("before")[i],
  })),
  netParts: { names: Object.keys(parts("after")[0]), before: parts("before"), after: parts("after") },
};

const hover = () => {
  const target = document.querySelector("svg.earnings-svg rect[fill='transparent']");
  // Above the plot's top: on no layer, so the tooltip lists them all (the
  // pointer is measured from the plot's own corner, HH7)
  fireEvent.mouseMove(target, { clientX: 400, clientY: -500 });
  return document.querySelector(".earnings-tooltip")?.textContent ?? "";
};

describe("EarningsChart", () => {
  it("is one card with Before / After / Change in its Options pill, as the marginal rate card, After first", () => {
    const { container } = render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Household net income, 2027-28" })).toBeInTheDocument();
    expect(container.querySelector(".chart-controls .control-bar-button")).not.toBeNull();
    expect(optionsLabel(container)).toBe("With the policies");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("after");
  });

  it("without the parts: one side's line in the key and tooltip, and You marked", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getByText("With the selected policies")).toBeInTheDocument();
    expect(document.querySelector(".earnings-layer")).toBeNull();
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
    expect(hover()).toMatch(/Net income with the policies/);
    chooseOption(document.body, "Current law");
    expect(screen.getByText("Under current law")).toBeInTheDocument();
    expect(screen.queryByText("With the selected policies")).not.toBeInTheDocument();
  });

  it("without the parts, change: the gain and loss key, the change alone in the tooltip", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    chooseOption(document.body, "Change");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("change");
    expect(screen.getByText("Higher net income")).toBeInTheDocument();
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
    const tip = hover();
    expect(tip).toMatch(/Change in net income/);
    expect(tip).not.toMatch(/Before|After/);
    expect(screen.getByRole("heading", { name: "Household net income, 2027-28" })).toBeInTheDocument();
  });

  it("with the parts: a layer per programme in use, the total over them, each layer's £ on hover", () => {
    render(<EarningsChart sweep={stackedSweep} salary={35000} yearLabel="2027-28" />);
    const drawn = [...document.querySelectorAll(".earnings-layer")].map((path) => path.dataset.layer);
    expect(drawn).toEqual([
      "market_income",
      "universal_credit",
      "child_benefit",
      "income_tax",
      "national_insurance",
      "council_tax",
      "child_benefit_charge",
    ]);
    expect(document.querySelector(".earnings-total")).not.toBeNull();
    expect(screen.getByText("Net income with the policies")).toBeInTheDocument();
    // Child Benefit and its charge: one key
    expect(screen.getByText("Child Benefit and its charge")).toBeInTheDocument();
    expect(screen.queryByText("Child Benefit charge")).not.toBeInTheDocument();
    const tip = hover();
    expect(tip).toMatch(/Income tax/);
    expect(tip).toMatch(/Council Tax/);
    expect(tip).toMatch(/Net income with the policies/);
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
  });

  it("with the parts, change: only the programmes the policies change", () => {
    render(<EarningsChart sweep={stackedSweep} salary={35000} yearLabel="2027-28" />);
    chooseOption(document.body, "Change");
    const drawn = [...document.querySelectorAll(".earnings-layer")].map((path) => path.dataset.layer);
    expect(drawn).toEqual(["income_tax"]);
    expect(document.querySelector(".chart-legend")).toHaveTextContent("Change in net income");
    expect(hover()).toMatch(/Income tax£100/);
  });
});

describe("EarningsChart's About this chart (W6 G1)", () => {
  const how = () => {
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    return document.querySelector(".chart-more-info").textContent;
  };

  it("says what each view draws: in Change, the parts of the change and the change as the line", () => {
    render(<EarningsChart sweep={stackedSweep} salary={35000} yearLabel="2027-28" />);
    chooseOption(document.body, "Change");
    const text = how();
    expect(text).toContain("Each layer is one tax or benefit's part of the change: above zero where it adds to net income, below where it takes away. The line is the change in net income.");
    expect(text).not.toMatch(/part of net income|the line is net income/);
  });

  it("in a level view, the parts of net income, saying held fixed once", () => {
    render(<EarningsChart sweep={stackedSweep} salary={35000} yearLabel="2027-28" />);
    const text = how();
    expect(text).toContain("Each layer is one part of net income (earnings, a benefit or a tax), and the line is net income.");
    expect(text).toContain("Your household is calculated again at each salary from £0 up.");
    expect(text.match(/everything else held fixed/g)).toHaveLength(1);
  });

  it("without the parts, Change: the shaded area, never a line it does not draw", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    chooseOption(document.body, "Change");
    const text = how();
    expect(text).toContain("The shaded area is the change: above zero a gain, below a loss.");
    expect(text).not.toMatch(/The line is your household's net income/);
  });
});

describe("net income's layers", () => {
  it("add up to net income, stacked outward from zero", () => {
    const rows = layerRows(stackedSweep.points, stackedSweep.netParts, "after");
    const layers = layersInUse(rows);
    rows.forEach((row) => {
      const sum = layers.reduce((total, layer) => total + row[layer.key], 0);
      expect(sum).toBeCloseTo(row.total, 6);
    });
    const { bands } = stackLayers(rows, layers);
    // At £150k: earnings from 0 up, Child Benefit above them; income tax
    // from 0 down, National Insurance below it
    expect(bands.market_income[3]).toEqual({ lo: 0, hi: 150000 });
    expect(bands.child_benefit[3]).toEqual({ lo: 150000, hi: 152000 });
    expect(bands.income_tax[3]).toEqual({ lo: -29900, hi: 0 });
    expect(bands.national_insurance[3]).toEqual({ lo: -44900, hi: -29900 });
  });

  it("take the marginal rate card's colour for the same programme", () => {
    const mtr = Object.fromEntries(RATE_PARTS.map((part) => [part.name, part.color]));
    const rows = layerRows(stackedSweep.points, stackedSweep.netParts, "after");
    const colour = Object.fromEntries(layersInUse(rows).map((layer) => [layer.key, layer.color]));
    expect(colour.income_tax).toBe(mtr.income_tax);
    expect(colour.national_insurance).toBe(mtr.national_insurance);
    expect(colour.universal_credit).toBe(mtr.universal_credit);
    expect(colour.child_benefit_charge).toBe(mtr.child_benefit_charge);
    expect(colour.child_benefit).toBe(mtr.child_benefit_charge);
    expect(colour.council_tax).toBe(CHART_COLOURS.netCouncilTax);
    expect(layerLegendItems(layersInUse(rows)).map((item) => item.label)).toContain("Child Benefit and its charge");
  });
});

describe("the change view's y axis", () => {
  it("keeps a +£110 change and its You dot inside the plot, with a tick above it", async () => {
    const { ticksToDomain } = await import("./EarningsChart");
    const { divergingAxis } = await import("../../utils/chartTheme");
    const ticks = ticksToDomain(divergingAxis([110, -110], { pad: 0.1 }));
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(121);
    expect(ticks[0]).toBeLessThanOrEqual(-121);
    expect(ticks).toContain(0);
  });
});

describe("pointerOnPlot: the hover follows the pointer (Pavel's review, HH7)", () => {
  const plot = { plotW: 400, plotH: 200, xMax: 150_000, yLo: -100_000, yHi: 200_000 };
  it("maps the plot's left edge to £0 and its right edge to the axis's end", () => {
    expect(pointerOnPlot(0, 100, plot).income).toBe(0);
    expect(pointerOnPlot(400, 100, plot).income).toBe(150_000);
    expect(pointerOnPlot(200, 100, plot).income).toBe(75_000);
  });
  it("maps the plot's top to the axis's top and its foot to the bottom", () => {
    expect(pointerOnPlot(0, 0, plot).value).toBe(200_000);
    expect(pointerOnPlot(0, 200, plot).value).toBe(-100_000);
  });
});

describe("tipPlacement: the hover box keeps room for its names on a phone (phone check)", () => {
  it("sits 12px right of the guide while there is room, left of it past 60%", () => {
    expect(tipPlacement(40, 1000)).toEqual({ left: 52 });
    expect(tipPlacement(700, 1000)).toEqual({ right: 312 });
  });

  it("moves in from the edge rather than squeezing below 220px", () => {
    // A 309px phone plot, the guide near the middle: 309 - 182 left only
    // 127px, and "Earnings and other income" took four lines
    expect(tipPlacement(170, 309)).toEqual({ left: 89 });
    expect(tipPlacement(250, 309)).toEqual({ right: 71 });
    // Narrower than the box: flush with the open edge
    expect(tipPlacement(100, 200)).toEqual({ left: 0 });
  });
});
