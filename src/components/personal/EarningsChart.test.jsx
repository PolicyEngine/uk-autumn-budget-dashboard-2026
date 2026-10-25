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
  it("shows one view at a time, the change first, and its tooltip gives only that view's series", () => {
    render(<EarningsChart sweep={sweep} salary={35000} yearLabel="2027-28" />);
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("svg.earnings-svg").dataset.view).toBe("change");
    let tip = hover();
    expect(tip).toMatch(/Change in net income/);
    expect(tip).not.toMatch(/Net income before|Net income after/);

    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    tip = hover();
    expect(tip).toMatch(/Net income before/);
    expect(tip).not.toMatch(/Net income after|Change in net income/);
    expect(screen.getByText("Before the selected policies")).toBeInTheDocument();
    expect(screen.queryByText("After the selected policies")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "After" }));
    tip = hover();
    expect(tip).toMatch(/Net income after/);
    expect(tip).not.toMatch(/Net income before|Change in net income/);
  });
});
