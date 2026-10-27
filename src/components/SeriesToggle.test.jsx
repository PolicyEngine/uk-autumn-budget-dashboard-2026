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

  it("highlights a line on hover, only while it is shown", () => {
    const onHover = vi.fn();
    render(<Harness onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Alpha" }));
    expect(onHover).toHaveBeenLastCalledWith("a");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Gamma" }));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
