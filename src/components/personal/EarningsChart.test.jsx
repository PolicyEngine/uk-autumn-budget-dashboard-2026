import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EarningsChart from "./EarningsChart";
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
  fireEvent.mouseMove(target, { clientX: 400, clientY: 100 });
  return document.querySelector(".earnings-tooltip")?.textContent ?? "";
};

describe("EarningsChart", () => {
  it("is one card with a Before / After / Change switch, as the marginal rate card, After first", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Household net income, 2027-28" })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Net income view" });
    expect(group.closest(".chart-controls")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Before" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "After" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("after");
  });

  it("without the parts: one side's line in the key and tooltip, and You marked", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getByText("After the selected policies")).toBeInTheDocument();
    expect(document.querySelector(".earnings-layer")).toBeNull();
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
    expect(hover()).toMatch(/Net income after/);
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    expect(screen.getByText("Before the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("After the selected policies")).not.toBeInTheDocument();
  });

  it("without the parts, change: the gain and loss key, the change alone in the tooltip", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
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
    expect(screen.getByText("Net income after")).toBeInTheDocument();
    // Child Benefit and its charge: one key
    expect(screen.getByText("Child Benefit and its charge")).toBeInTheDocument();
    expect(screen.queryByText("Child Benefit charge")).not.toBeInTheDocument();
    const tip = hover();
    expect(tip).toMatch(/Income tax/);
    expect(tip).toMatch(/Council Tax/);
    expect(tip).toMatch(/Net income after/);
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
  });

  it("with the parts, change: only the programmes the policies change", () => {
    render(<EarningsChart sweep={stackedSweep} salary={35000} yearLabel="2027-28" />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const drawn = [...document.querySelectorAll(".earnings-layer")].map((path) => path.dataset.layer);
    expect(drawn).toEqual(["income_tax"]);
    expect(document.querySelector(".chart-legend")).toHaveTextContent("Change in net income");
    expect(hover()).toMatch(/Income tax£100/);
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
