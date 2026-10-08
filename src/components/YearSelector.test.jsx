import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import YearSelector from "./YearSelector";

it("offers the closing policy year", () => {
  const onYearChange = vi.fn();
  render(<YearSelector selectedYear={2030} onYearChange={onYearChange} />);
  fireEvent.click(screen.getByRole("button", { name: /Year: 2030/ }));
  fireEvent.click(screen.getByRole("button", { name: "2031" }));
  expect(onYearChange).toHaveBeenCalledWith(2031);
});
