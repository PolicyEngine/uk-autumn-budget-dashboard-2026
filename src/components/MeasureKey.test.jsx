import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MeasureKey, {
  FADED_OPACITY,
  MeasureKeyProvider,
  SectionMeasureKey,
  measureOpacity,
  mergeMembers,
  useMeasureKey,
} from "./MeasureKey";

const FUEL = { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", muted: false };
const FREEZE = { id: "threshold_freeze_2031_32", name: "Threshold freeze to 2031-32", muted: true };
const NI = { id: "employer_ni_relief_under_25s", name: "Employer NI relief for under-25s", muted: true };

/** A card that reads the key: its highlight, and whether it draws a key. */
function Card({ members, label }) {
  const key = useMeasureKey(members, "Net change");
  return (
    <div data-testid={label} data-highlight={key.highlight ?? ""}>
      {!key.shared && <MeasureKey members={members} highlight={key.highlight} onHighlight={key.setHighlight} />}
    </div>
  );
}

describe("MeasureKey", () => {
  it("groups the measures, folds those with no effect, and keeps them listed", () => {
    const { container } = render(<MeasureKey members={[FUEL, FREEZE, NI]} netLabel="Net change" />);
    expect(screen.getByText("Costs revenue")).toBeInTheDocument();
    // The raise-revenue measure is muted, so its group has no active chip
    expect(screen.queryByText("Raises revenue")).toBeNull();
    const more = screen.getByRole("button", { name: "+2 with no effect" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const muted = container.querySelector(".measure-key-muted");
    expect(muted).not.toBeVisible();
    expect([...muted.querySelectorAll("[data-measure]")].map((node) => node.title)).toEqual([FREEZE.name, NI.name]);
    fireEvent.click(more);
    expect(muted).toBeVisible();
    screen.getByText("Net change");
  });

  it("highlights a measure on hover and keeps it on a click", () => {
    render(<Card members={[FUEL, NI]} label="alone" />);
    const card = screen.getByTestId("alone");
    const chip = screen.getByRole("button", { name: FUEL.name });
    fireEvent.mouseEnter(chip);
    expect(card.dataset.highlight).toBe(FUEL.name);
    fireEvent.mouseLeave(chip);
    expect(card.dataset.highlight).toBe("");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(card.dataset.highlight).toBe(FUEL.name);
  });

  it("shares one key and one highlight across a section's cards", () => {
    const { container } = render(
      <MeasureKeyProvider>
        <SectionMeasureKey />
        <Card members={[FUEL, NI]} label="a" />
        <Card members={[{ ...NI, muted: false }]} label="b" />
      </MeasureKeyProvider>,
    );
    // One key, above the cards; NI has an effect in one card, so it is not folded
    expect(container.querySelectorAll(".measure-key")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /with no effect/ })).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button", { name: NI.name }));
    expect(screen.getByTestId("a").dataset.highlight).toBe(NI.name);
    expect(screen.getByTestId("b").dataset.highlight).toBe(NI.name);
  });
});

describe("mergeMembers and measureOpacity", () => {
  it("mutes a measure only when every card mutes it", () => {
    const merged = mergeMembers([[FUEL, NI], [{ ...NI, muted: false }, FREEZE]]);
    expect(merged.find((member) => member.id === NI.id).muted).toBe(false);
    expect(merged.find((member) => member.id === FREEZE.id).muted).toBe(true);
  });

  it("fades every measure but the highlighted one", () => {
    expect(measureOpacity(null, FUEL.name)).toBe(1);
    expect(measureOpacity(FUEL.name, FUEL.name)).toBe(1);
    expect(measureOpacity(FUEL.name, NI.name)).toBe(FADED_OPACITY);
  });
});
