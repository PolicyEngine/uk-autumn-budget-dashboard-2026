import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SeriesToggle from "./SeriesToggle";

const SERIES = [
  { key: "a", label: "Alpha", colour: "currentColor" },
  { key: "b", label: "Beta", colour: "currentColor", dash: "4 3" },
  { key: "c", label: "Gamma", colour: "currentColor" },
];

function Harness({ onHover }) {
  const [shown, setShown] = useState(["a", "b"]);
  return (
    <>
      <SeriesToggle series={SERIES} shown={shown} onChange={setShown} onHover={onHover} />
      <output>{shown.join(",")}</output>
    </>
  );
}

describe("SeriesToggle", () => {
  it("shows and hides several lines, in series order, and keeps the last one on", () => {
    render(<Harness />);
    const chip = (name) => screen.getByRole("button", { name });
    // A first-visit hint, gone after the first click
    expect(screen.getByText("Click to show or hide")).toBeInTheDocument();
    // On a touch screen the CSS shows "Tap" in its place
    expect(screen.getByText("Tap to show or hide")).toHaveClass("series-toggle-hint-tap");
    expect(chip("Alpha")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Gamma")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip("Gamma"));
    expect(document.querySelector("output")).toHaveTextContent("a,b,c");
    expect(screen.queryByText("Click to show or hide")).toBeNull();
    fireEvent.click(chip("Alpha"));
    fireEvent.click(chip("Beta"));
    expect(document.querySelector("output")).toHaveTextContent("c");
    // The last line on stays on
    fireEvent.click(chip("Gamma"));
    expect(document.querySelector("output")).toHaveTextContent("c");
    expect(chip("Gamma")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a chip that is on by its fill and border only, never a tick", () => {
    render(<Harness />);
    const on = screen.getByRole("button", { name: "Alpha" });
    expect(on).toHaveClass("is-on");
    expect(on.querySelector(".series-toggle-check")).toBeNull();
    expect(on.querySelectorAll("path")).toHaveLength(0);
  });

  it("highlights a line on hover, only while it is shown", () => {
    const onHover = vi.fn();
    render(<Harness onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Alpha" }));
    expect(onHover).toHaveBeenLastCalledWith("a");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Gamma" }));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});

describe("SeriesToggle chip tips", () => {
  it("shows an enabled chip's tip on hover and focus, and adds that the last one stays on", async () => {
    const { chipTip } = await import("./SeriesToggle");
    const series = [
      { key: "a", label: "Alpha", colour: "currentColor", tip: "Alpha: no effect on your marginal tax rate." },
      { key: "b", label: "Beta", colour: "currentColor" },
    ];
    render(<SeriesToggle series={series} shown={["a", "b"]} onChange={() => {}} />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    fireEvent.mouseEnter(alpha);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alpha: no effect on your marginal tax rate.");
    expect(alpha.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(alpha);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // A chip with no tip shows none
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Beta" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(chipTip(series[0], true)).toBe("Alpha: no effect on your marginal tax rate. At least one line stays on.");
    expect(chipTip(series[1], true)).toBe("Beta: at least one line stays on");
    expect(chipTip({ ...series[0], disabled: true }, false)).toBe(series[0].tip);
  });
});
