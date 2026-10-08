import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import YearSlider from "./YearSlider";

it("selects the terminal year through the keyboard-accessible slider", () => {
  const onYearChange = vi.fn();
  render(<YearSlider selectedYear={2026} onYearChange={onYearChange} />);
  const slider = screen.getByRole("slider", { name: "Select year" });
  expect(slider).toHaveAttribute("max", "5");
  fireEvent.change(slider, { target: { value: "5" } });
  expect(onYearChange).toHaveBeenCalledWith(2031);
});
