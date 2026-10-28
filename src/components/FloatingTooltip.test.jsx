import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { CHART_COLOURS, POLICY_RAMPS } from "../utils/chartTheme";
import OBRDumbbellChart from "./OBRDumbbellChart";
import PolicyBars from "./personal/PolicyBars";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";

// comparisonRows() output for two years
const rowsFor = {
  2027: [{ id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", pe: -1.24, obr: -1.0, obrStatic: -1.0, obrBehavioural: -1.1 }],
  2028: [{ id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", pe: -0.31, obr: -0.3, obrStatic: -0.3, obrBehavioural: -0.3 }],
};
const dumbbell = (year) => <OBRDumbbellChart rows={rowsFor[year]} yearLabel={`${year}-${String(year + 1).slice(-2)}`} obrKind="static" tooltipKey={`${year}-false`} />;

describe("tooltips on hand-drawn charts", () => {
  it("the official costings dumbbell shows PolicyEngine, the official costing and the difference, with the year", () => {
    const { container, rerender } = render(
      dumbbell(2027),
    );
    const row = container.querySelector(".obr-dumbbell-row");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.mouseEnter(row, { clientX: 100, clientY: 20 });
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Fuel duty rises deferred, 2027-28");
    expect(tip).toHaveTextContent("PolicyEngine (static)−£1.2bn");
    expect(tip).toHaveTextContent("Official costing (static)−£1.0bn");
    expect(tip).toHaveTextContent("Difference (PolicyEngine − official)−£200m");
    // A new year (the Play button) clears it: no last year's figures
    rerender(dumbbell(2028));
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Keyboard focus shows it too
    fireEvent.focus(container.querySelector(".obr-dumbbell-row"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("2028-29");
    fireEvent.blur(container.querySelector(".obr-dumbbell-row"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the change-by-policy bars show each policy's change a year, with the year", () => {
    const { container } = render(
      <PolicyBars
        rows={[{ id: "threshold_freeze_2031_32", name: "Threshold freeze", color: POLICY_RAMPS.raise[0], rounded: -250 }]}
        noEffect={[]}
        yearLabel="2031-32"
      />,
    );
    const bar = container.querySelector(".policy-bar");
    fireEvent.focus(bar);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Threshold freeze, 2031-32");
    expect(tip).toHaveTextContent(/Change in net income.*£250 a year/);
    fireEvent.mouseLeave(bar);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("is never shown under an old key", () => {
    function Probe({ year }) {
      const ref = useRef(null);
      const { tip, handlers } = useFloatingTooltip(ref, year);
      return (
        <div ref={ref} style={{ position: "relative" }}>
          <button type="button" {...handlers("a", <TooltipRows label={`A, ${year}`} rows={[{ key: "v", name: "Value", text: "1", color: CHART_COLOURS.net }]} />)}>
            point
          </button>
          <FloatingTooltip tip={tip} />
        </div>
      );
    }
    const { rerender } = render(<Probe year="2027-28" />);
    fireEvent.mouseEnter(screen.getByRole("button"), { clientX: 5, clientY: 5 });
    expect(within(screen.getByRole("tooltip")).getByText("A, 2027-28")).toBeInTheDocument();
    rerender(<Probe year="2028-29" />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
