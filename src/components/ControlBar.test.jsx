import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ControlBar, { dialogPlacement, optionsSummary } from "./ControlBar";
import { yearsOption } from "./livingStandards/controlOptions";
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

  it("hides chart tooltips while its popover is open (Pavel's review, LS2)", () => {
    render(<Harness />);
    const root = document.documentElement;
    expect(root.hasAttribute("data-options-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    expect(root.hasAttribute("data-options-open")).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(root.hasAttribute("data-options-open")).toBe(false);
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
    screen.getByRole("radio", { name: "After housing costs" }).focus();
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

  it("applies a clicked choice and closes, handing focus back to the pill; no Done for single choices", async () => {
    render(<Harness />);
    const pill = screen.getByRole("button", { name: /^Options:/ });
    fireEvent.click(pill);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: "After housing costs" }));
    expect(pill).toHaveAccessibleName(/After housing costs/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pill).toHaveFocus();
  });

  it("keeps a multi-select popover open, with Done", () => {
    render(
      <ControlBar
        name="Lines"
        options={[{ label: "Lines", multi: true, value: "a", onChange: () => {}, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  });

  it("keeps the years open after From and closes after To", async () => {
    function Years() {
      const [range, setRange] = useState(["2027-28", "2031-32"]);
      return <ControlBar name="Years" options={[yearsOption(["2027-28", "2028-29", "2029-30", "2030-31", "2031-32"], range, (a, b) => setRange([a, b]))]} />;
    }
    render(<Years />);
    const pill = screen.getByRole("button", { name: /^Options:/ });
    fireEvent.click(pill);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "From" })).getByRole("radio", { name: "2028-29" }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "To" })).getByRole("radio", { name: "2030-31" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pill).toHaveAccessibleName(/2028-29 → 2030-31/);
    expect(pill).toHaveFocus();
  });
});


describe("dialogPlacement", () => {
  it("leaves the dialog under its pill when it fits", () => {
    expect(dialogPlacement({ height: 300, pillTop: 200, pillBottom: 232, windowHeight: 1024, sticky: 120 })).toBeNull();
  });

  it("flips it above the pill, clear of the sticky band, when it would run below the window and fits above", () => {
    // The growth card at 768: 88px below the window under the pill
    expect(dialogPlacement({ height: 420, pillTop: 640, pillBottom: 672, windowHeight: 1024, sticky: 120 })).toEqual({
      above: true,
      maxHeight: null,
    });
  });

  it("scrolls inside on the roomier side when it fits on neither", () => {
    expect(dialogPlacement({ height: 900, pillTop: 400, pillBottom: 432, windowHeight: 800, sticky: 120 })).toEqual({
      above: false,
      maxHeight: 800 - 432 - 20,
    });
    expect(dialogPlacement({ height: 900, pillTop: 600, pillBottom: 632, windowHeight: 800, sticky: 120 })).toEqual({
      above: true,
      maxHeight: 600 - 20 - 120,
    });
  });
});
