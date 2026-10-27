import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberField } from "./FormControls";

describe("NumberField's out-of-range message", () => {
  it("marks the box invalid and ties the message to it while the value is out of range", () => {
    render(<NumberField id="age" label="Age" value={5} onChange={vi.fn()} min={0} max={18} step={1} outOfRangeMessage="Enter an age from 0 to 18." />);
    const box = screen.getByRole("spinbutton", { name: "Age" });
    expect(box).not.toHaveAttribute("aria-invalid");
    fireEvent.change(box, { target: { value: "40" } });
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Enter an age from 0 to 18.");
    fireEvent.change(box, { target: { value: "7" } });
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box).not.toHaveAttribute("aria-describedby");
  });
});
