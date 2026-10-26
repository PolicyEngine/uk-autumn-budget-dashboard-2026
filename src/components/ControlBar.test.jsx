import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ControlBar, { optionsSummary } from "./ControlBar";
import { expectCompletePills } from "../test/optionsPills";

function Harness() {
  const [prices, setPrices] = useState("real");
  const [housing, setHousing] = useState("bhc");
  return (
    <ControlBar
      name="Incomes over time"
      options={[
        {
          label: "Housing costs",
          value: housing,
          onChange: setHousing,
          options: [
            { value: "bhc", label: "Before housing costs" },
            { value: "ahc", label: "After housing costs" },
          ],
        },
        {
          label: "Prices",
          value: prices,
          onChange: setPrices,
          options: [
            { value: "real", label: "Real" },
            { value: "nominal", label: "Cash terms", disabled: true, title: "Not published" },
          ],
        },
      ]}
    >
      <button type="button">Primary</button>
    </ControlBar>
  );
}

describe("ControlBar", () => {
  it("sums up the choices on one Options button that opens a dialog", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Options: Before housing costs · Real" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Incomes over time options" });
    // Focus goes to the first group's chosen option
    expect(screen.getByRole("radio", { name: "Before housing costs" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("radio", { name: "After housing costs" }));
    expect(screen.getByRole("button", { name: "Options: After housing costs · Real" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Cash terms" })).toBeDisabled();
  });

  it("moves with the arrow keys, keeps focus inside, and closes on Escape", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: /^Options:/ });
    fireEvent.click(button);
    const housing = screen.getByRole("radiogroup", { name: "Housing costs" });
    fireEvent.keyDown(housing, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "After housing costs" })).toHaveAttribute("aria-checked", "true");
    // Shift+Tab from the first stop wraps to the last
    const dialog = screen.getByRole("dialog");
    screen.getByRole("button", { name: "Done" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("radio", { name: "Real" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("has no Options button when every choice is a pill", () => {
    render(<ControlBar><button type="button">Primary</button></ControlBar>);
    expect(screen.queryByRole("button", { name: /^Options/ })).toBeNull();
  });

  it("labels the pill with every choice, in the dialog's order, a show/hide only when not at its default", () => {
    const group = (label, value, extra = {}) => ({ label, value, onChange: () => {}, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], ...extra });
    expect(optionsSummary([group("One", "a"), group("Two", "b")])).toBe("A · B");
    expect(optionsSummary([group("One", "a"), group("Hide", "a", { omitAtDefault: "a" })])).toBe("A");
    expect(optionsSummary([group("One", "a"), group("Hide", "b", { omitAtDefault: "a" })])).toBe("A · B");
    const { container } = render(<Harness />);
    expect(expectCompletePills(container)).toBe(1);
  });
});

