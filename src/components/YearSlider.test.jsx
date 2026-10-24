import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import YearSlider from "./YearSlider";

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Year, 2029-30" }));

describe("YearSlider", () => {
  it("opens a list of the shown years, from 2026-27, the chosen one selected", () => {
    render(<YearSlider selectedYear={2029} onYearChange={() => {}} />);
    open();
    const list = screen.getByRole("listbox", { name: "Year" });
    const options = Array.from(list.querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.textContent.replace("✓", ""))).toEqual([
      "2026-27",
      "2027-28",
      "2028-29",
      "2029-30",
      "2030-31",
      "2031-32",
    ]);
    expect(options[3]).toHaveAttribute("aria-selected", "true");
  });

  it("chooses by click or by arrow keys and Enter, then closes", () => {
    const onYearChange = vi.fn();
    render(<YearSlider selectedYear={2029} onYearChange={onYearChange} />);
    open();
    fireEvent.click(screen.getByRole("option", { name: /2027-28/ }));
    expect(onYearChange).toHaveBeenLastCalledWith(2027);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    open();
    const list = screen.getByRole("listbox", { name: "Year" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onYearChange).toHaveBeenLastCalledWith(2030);
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<YearSlider selectedYear={2029} onYearChange={() => {}} />);
    open();
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Year" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year, 2029-30" })).toHaveFocus();
  });

  it("plays from the list, and the pill pauses it", () => {
    render(<YearSlider selectedYear={2029} onYearChange={() => {}} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "▶ Play through years" }));
    const pause = screen.getByRole("button", { name: "Playing, 2029-30: pause" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Year, 2029-30" })).toBeInTheDocument();
  });
});
