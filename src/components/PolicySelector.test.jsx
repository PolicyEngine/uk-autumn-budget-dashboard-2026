import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PolicySelector from "./PolicySelector";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { measureCatalogueFixture } from "../test/measureCatalogueFixture";
import { shortNameOf } from "../utils/policyDetails";

afterEach(cleanup);

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const allIds = catalogue.displayable.map((measure) => measure.id);

// The page's own wiring: a toggle that reads the selection of its render
// (App's handlePolicyToggle), and a setter for the whole selection
function Harness({ initial }) {
  const [selected, setSelected] = useState(initial);
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <MeasureCatalogueProvider catalogue={catalogue}>
      <PolicySelector selectedPolicies={selected} onPolicyToggle={toggle} onPoliciesSet={setSelected} />
      <output data-testid="selection">{selected.join(",")}</output>
    </MeasureCatalogueProvider>
  );
}

const open = () => {
  const pill = screen.getByRole("button", { name: /^Policies / });
  fireEvent.click(pill);
  return pill;
};
const boxes = () => screen.getAllByRole("checkbox");
const selection = () => screen.getByTestId("selection").textContent.split(",").filter(Boolean);

describe("PolicySelector Select all and Clear", () => {
  it("Clear unticks every policy at once, keeps the menu open, and disables itself", () => {
    expect(allIds.length).toBeGreaterThan(1);
    render(<Harness initial={allIds} />);
    const pill = open();
    const clear = screen.getByRole("button", { name: "Clear" });
    const selectAll = screen.getByRole("button", { name: "Select all" });
    expect(selectAll).toBeDisabled();
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(selection()).toEqual([]);
    expect(boxes().every((box) => !box.checked)).toBe(true);
    expect(pill).toHaveTextContent(new RegExp(`0 of ${allIds.length}`));
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(clear).toBeDisabled();
    expect(selectAll).toBeEnabled();
    // Focus moves to the button that still does something
    expect(selectAll).toHaveFocus();
  });

  it("Select all ticks every policy at once from a partial selection, and disables itself", () => {
    render(<Harness initial={[allIds[0]]} />);
    const pill = open();
    const selectAll = screen.getByRole("button", { name: "Select all" });
    fireEvent.click(selectAll);
    expect([...selection()].sort()).toEqual([...allIds].sort());
    expect(boxes().every((box) => box.checked)).toBe(true);
    expect(pill).toHaveTextContent(new RegExp(`All ${allIds.length}`));
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(selectAll).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
  });

  it("Select all from none and Clear from all both work after single toggles", () => {
    render(<Harness initial={[]} />);
    open();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(selection()).toHaveLength(allIds.length);
    fireEvent.click(boxes()[0]);
    expect(selection()).toHaveLength(allIds.length - 1);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(selection()).toEqual([]);
  });

  it("Done closes the menu and returns nothing to the selection", () => {
    render(<Harness initial={allIds} />);
    const pill = open();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(selection()).toEqual(allIds);
  });
});

describe("PolicySelector info tips", () => {
  it("gives every published measure an info tip, with or without a policyDetails entry", () => {
    render(<Harness initial={allIds} />);
    open();
    expect(boxes()).toHaveLength(catalogue.displayable.length);
    for (const measure of catalogue.displayable) {
      expect(screen.getByRole("button", { name: `About ${shortNameOf(measure)}` })).toBeTruthy();
    }
  });
});
