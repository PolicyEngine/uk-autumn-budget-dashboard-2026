import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GroupedLegend from "./GroupedLegend";

const names = [
  "Threshold freeze extension",
  "Dividend tax increase (+2pp)",
  "Savings income tax increase (+2pp)",
  "Property income tax increase (+2pp)",
  "Salary sacrifice cap",
  "Freeze student loan repayment thresholds",
  "2 child limit repeal",
  "Fuel duty freeze extension",
  "Rail fares freeze",
];

// jsdom lays nothing out: give every item 265px and the legend `width`
const layOut = (width) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 264,
    height: 16,
    top: 0,
    left: 0,
    right: 264,
    bottom: 16,
  });
};

describe("GroupedLegend", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("puts both groups in one grid of even columns, each heading spanning it", () => {
    layOut(490);
    const { container } = render(<GroupedLegend names={names} netLabel="Net change" />);
    const legend = container.querySelector(".grouped-legend");
    const grid = container.querySelector(".grouped-legend-groups");
    // A half-width card: two even columns, shared by both groups
    expect(legend.dataset.columns).toBe("2");
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, 233px)");
    const groups = [...grid.querySelectorAll(".grouped-legend-group")];
    expect(groups.map((g) => g.querySelector(".grouped-legend-heading").textContent)).toEqual([
      "Raise revenue",
      "Cost revenue",
    ]);
    expect(within(groups[0]).getAllByRole("listitem")).toHaveLength(6);
    expect(within(groups[1]).getAllByRole("listitem")).toHaveLength(3);
    // The net line stays under the groups
    expect(screen.getByText("Net change").closest(".grouped-legend-net")).not.toBeNull();
  });

  it("uses three columns at full width and one on a phone", () => {
    layOut(1100);
    const { container, unmount } = render(<GroupedLegend names={names} />);
    expect(container.querySelector(".grouped-legend").dataset.columns).toBe("3");
    unmount();
    vi.restoreAllMocks();
    layOut(326);
    const phone = render(<GroupedLegend names={names} />);
    expect(phone.container.querySelector(".grouped-legend").dataset.columns).toBe("1");
  });
});
