import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import YearSlider from "./YearSlider";

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Year 2029-30" }));

describe("YearSlider", () => {
  it("opens a list of the choosable years, from 2027-28 by default, the chosen one selected", () => {
    render(<YearSlider selectedYear={2029} onYearChange={() => {}} />);
    open();
    const list = screen.getByRole("listbox", { name: "Year" });
    const options = Array.from(list.querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.textContent)).toEqual([
      "2027-28",
      "2028-29",
      "2029-30",
      "2030-31",
      "2031-32",
    ]);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    // Selected by weight and colour only: no tick mark in the list
    expect(list.textContent).not.toMatch(/[✓✔]/);
  });

  it("lists 2026-27 first when the selection's years include it (a policy with an effect in it)", () => {
    render(<YearSlider years={[2026, 2027, 2028, 2029, 2030, 2031]} selectedYear={2029} onYearChange={() => {}} />);
    open();
    const options = Array.from(screen.getByRole("listbox", { name: "Year" }).querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.textContent)[0]).toBe("2026-27");
    expect(options).toHaveLength(6);
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
    expect(screen.getByRole("button", { name: "Year 2029-30" })).toHaveFocus();
  });

  it("plays from the list, and the pill pauses it", () => {
    render(<YearSlider selectedYear={2029} onYearChange={() => {}} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "▶ Play through years" }));
    const pause = screen.getByRole("button", { name: "Playing 2029-30: pause" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Year 2029-30" })).toBeInTheDocument();
  });
});
