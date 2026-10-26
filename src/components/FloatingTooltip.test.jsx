import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { CHART_COLOURS, POLICY_RAMPS } from "../utils/chartTheme";
import OBRDumbbellChart from "./OBRDumbbellChart";
import PolicyBars from "./personal/PolicyBars";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import { seatTooltipRows } from "./ConstituencyMap";

const policies = [
  [
    "fuel_duty_rise_deferral",
    {
      name: "Fuel duty rises deferred",
      years: {
        2027: { policyengine: -1.24, obr_static: -1.0, obr_behavioural: -1.1 },
        2028: { policyengine: -0.31, obr_static: -0.3, obr_behavioural: -0.3 },
      },
    },
  ],
];

describe("tooltips on hand-drawn charts", () => {
  it("the OBR dumbbell shows PolicyEngine, the OBR and the difference, with the year", () => {
    const { container, rerender } = render(
      <OBRDumbbellChart policies={policies} year={2027} showBehavioural={false} />,
    );
    const row = container.querySelector(".obr-dumbbell-row");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.mouseEnter(row, { clientX: 100, clientY: 20 });
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Fuel duty rises deferred, 2027-28");
    expect(tip).toHaveTextContent("PolicyEngine (static)−£1.2bn");
    expect(tip).toHaveTextContent("OBR (static)−£1.0bn");
    expect(tip).toHaveTextContent("Difference (PolicyEngine − OBR)−£0.2bn");
    // A new year (the Play button) clears it: no last year's figures
    rerender(<OBRDumbbellChart policies={policies} year={2028} showBehavioural={false} />);
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

  it("a hovered seat shows its figure and 90% interval, or its notes", () => {
    const rows = seatTooltipRows({
      title: "Bath",
      lines: [
        { kind: "value", text: "+£120", direction: "gain" },
        { kind: "label", text: "Average change in net income" },
        { kind: "interval", text: "90% interval: £80 to £160" },
        { kind: "detail", text: "Reported" },
      ],
    });
    expect(rows.map((row) => [row.name, row.text])).toEqual([
      ["Average change in net income", "+£120"],
      ["90% interval", "£80 to £160"],
    ]);
    const withheld = seatTooltipRows({
      title: "Bath",
      lines: [{ kind: "note", text: "Withheld: too few survey households." }],
    });
    expect(withheld[0].name).toBe("Withheld: too few survey households.");
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
