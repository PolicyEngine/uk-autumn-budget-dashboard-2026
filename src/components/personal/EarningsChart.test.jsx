import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EarningsChart from "./EarningsChart";

const sweep = {
  points: [0, 50000, 100000, 150000].map((income) => ({
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

const hover = () => {
  const target = document.querySelector("svg.earnings-svg rect[fill='transparent']");
  fireEvent.mouseMove(target, { clientX: 400, clientY: 100 });
  return document.querySelector(".earnings-tooltip")?.textContent ?? "";
};

describe("EarningsChart", () => {
  it("is one card with a Net income / Change switch, net income first", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Household net income, 2027-28" })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Net income view" });
    expect(group.closest(".chart-controls")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Net income" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("net");
  });

  it("net income: both lines in the key and the tooltip, and You marked", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getByText("Before the selected policies")).toBeInTheDocument();
    expect(screen.getByText("After the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("Higher net income")).not.toBeInTheDocument();
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
    const tip = hover();
    expect(tip).toMatch(/Before/);
    expect(tip).toMatch(/After/);
  });

  it("change: the gain and loss key, the change alone in the tooltip, You still marked", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("change");
    expect(screen.getByText("Higher net income")).toBeInTheDocument();
    expect(screen.queryByText("Before the selected policies")).not.toBeInTheDocument();
    expect(document.querySelector(".earnings-you")).toHaveTextContent("You");
    const tip = hover();
    expect(tip).toMatch(/Change in net income/);
    expect(tip).not.toMatch(/Before|After/);
    // The title stays the same in either view
    expect(screen.getByRole("heading", { name: "Household net income, 2027-28" })).toBeInTheDocument();
  });
});
