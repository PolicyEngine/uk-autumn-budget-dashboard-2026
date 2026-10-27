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
import { POLICY_DETAILS } from "../utils/policyDetails";

const FUEL = { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", muted: false };
const FREEZE = { id: "threshold_freeze_2031_32", name: "Threshold freeze to 2031-32", muted: true };
const NI = { id: "employer_ni_relief_under_25s", name: "Employer NI relief for under-25s", muted: true };
// The series key every chart draws a measure under (the catalogue's, #104)
const keyOf = (member) => `measure:${member.id}`;

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
  it("lists the measures with no group labels, folds those with no effect, and keeps them listed", () => {
    const { container } = render(<MeasureKey members={[FUEL, FREEZE, NI]} netLabel="Net change" />);
    expect(screen.queryByText("Costs revenue")).toBeNull();
    expect(screen.queryByText("Raises revenue")).toBeNull();
    expect(container.querySelector(".measure-key-heading")).toBeNull();
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
    expect(card.dataset.highlight).toBe(keyOf(FUEL));
    fireEvent.mouseLeave(chip);
    expect(card.dataset.highlight).toBe("");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(card.dataset.highlight).toBe(keyOf(FUEL));
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
    expect(screen.getByTestId("a").dataset.highlight).toBe(keyOf(NI));
    expect(screen.getByTestId("b").dataset.highlight).toBe(keyOf(NI));
  });
});

describe("the chips' names", () => {
  it("show policyDetails.js's short name only while it describes the published measure", () => {
    const { writtenFor } = POLICY_DETAILS.find((entry) => entry.id === FUEL.id);
    const { rerender } = render(<MeasureKey members={[{ ...FUEL, description: writtenFor }]} />);
    // Its name starts with the short text it shows, then the full name
    const chip = screen.getByRole("button", { name: `Fuel duty deferral: ${FUEL.name}` });
    expect(chip.querySelector(".measure-key-label")).toHaveTextContent("Fuel duty deferral");
    // Changed since (on Budget day, say): its published name
    rerender(<MeasureKey members={[{ ...FUEL, description: "Fuel duty rises are deferred for two years." }]} />);
    expect(screen.getByRole("button", { name: FUEL.name }).querySelector(".measure-key-label")).toHaveTextContent(FUEL.name);
  });
});

describe("MeasureKey: more than one measure", () => {
  const RAISE = { id: "road_fuel_vat_cut", name: "VAT cut on road fuel", muted: false };

  it("pins several measures, unpins one on a second click, and clears them all", () => {
    render(<Card members={[FUEL, RAISE, { ...NI, muted: false }]} label="multi" />);
    const card = screen.getByTestId("multi");
    const fuel = screen.getByRole("button", { name: FUEL.name });
    const raise = screen.getByRole("button", { name: RAISE.name });
    expect(screen.queryByRole("button", { name: /^Clear/ })).toBeNull();
    fireEvent.click(fuel);
    fireEvent.click(raise);
    expect(fuel).toHaveAttribute("aria-pressed", "true");
    expect(raise).toHaveAttribute("aria-pressed", "true");
    expect(card.dataset.highlight.split(",").sort()).toEqual([keyOf(FUEL), keyOf(RAISE)].sort());
    // A second click takes one out
    fireEvent.click(fuel);
    expect(fuel).toHaveAttribute("aria-pressed", "false");
    expect(card.dataset.highlight).toBe(keyOf(RAISE));
    // Clear unpins the rest and goes
    fireEvent.click(fuel);
    fireEvent.click(screen.getByRole("button", { name: "Clear the 2 highlighted policies" }));
    expect(card.dataset.highlight).toBe("");
    expect(screen.queryByRole("button", { name: /^Clear/ })).toBeNull();
  });

  it("previews a hovered measure on top of the pinned set", () => {
    render(<Card members={[FUEL, RAISE, { ...NI, muted: false }]} label="hover" />);
    const card = screen.getByTestId("hover");
    fireEvent.click(screen.getByRole("button", { name: FUEL.name }));
    const ni = screen.getByRole("button", { name: NI.name });
    fireEvent.mouseEnter(ni);
    expect(card.dataset.highlight).toBe(`${keyOf(FUEL)},${keyOf(NI)}`);
    fireEvent.mouseLeave(ni);
    expect(card.dataset.highlight).toBe(keyOf(FUEL));
  });

  it("toggles from the keyboard: each chip is a button", () => {
    render(<Card members={[FUEL, RAISE]} label="keys" />);
    const raise = screen.getByRole("button", { name: RAISE.name });
    raise.focus();
    // Enter and Space activate a native button (a click)
    fireEvent.click(raise);
    expect(raise).toHaveAttribute("aria-pressed", "true");
    expect(raise.tagName).toBe("BUTTON");
  });

  it("shares the pinned set across a section's cards", () => {
    render(
      <MeasureKeyProvider>
        <SectionMeasureKey />
        <Card members={[FUEL, RAISE]} label="a" />
        <Card members={[RAISE]} label="b" />
      </MeasureKeyProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: FUEL.name }));
    fireEvent.click(screen.getByRole("button", { name: RAISE.name }));
    for (const id of ["a", "b"]) {
      expect(screen.getByTestId(id).dataset.highlight.split(",").sort()).toEqual([keyOf(FUEL), keyOf(RAISE)].sort());
    }
  });

  it("keeps every highlighted measure full colour and fades the rest", () => {
    const set = [keyOf(FUEL), keyOf(RAISE)];
    expect(measureOpacity(set, keyOf(FUEL))).toBe(1);
    expect(measureOpacity(set, keyOf(RAISE))).toBe(1);
    expect(measureOpacity(set, keyOf(NI))).toBe(FADED_OPACITY);
    expect(measureOpacity([], keyOf(NI))).toBe(1);
  });
});

describe("mergeMembers and measureOpacity", () => {
  it("mutes a measure only when every card mutes it", () => {
    const merged = mergeMembers([[FUEL, NI], [{ ...NI, muted: false }, FREEZE]]);
    expect(merged.find((member) => member.id === NI.id).muted).toBe(false);
    expect(merged.find((member) => member.id === FREEZE.id).muted).toBe(true);
  });

  it("fades every measure but the highlighted one", () => {
    expect(measureOpacity(null, keyOf(FUEL))).toBe(1);
    expect(measureOpacity(keyOf(FUEL), keyOf(FUEL))).toBe(1);
    expect(measureOpacity(keyOf(FUEL), keyOf(NI))).toBe(FADED_OPACITY);
  });
});

describe("the net chip", () => {
  it("is chosen like a measure: alone it fades the measures, with them it stays", async () => {
    const { netOpacity, NET_KEY } = await import("./MeasureKey");
    function NetCard() {
      const key = useMeasureKey([FUEL, NI], "Net change");
      return (
        <div data-testid="net" data-highlight={key.highlight ?? ""}>
          <MeasureKey members={[FUEL, NI]} netLabel="Net change" highlight={key.highlight} onHighlight={key.setHighlight} />
        </div>
      );
    }
    render(<NetCard />);
    const card = screen.getByTestId("net");
    const net = screen.getByRole("button", { name: "Net change" });
    expect(net).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(net);
    expect(net).toHaveAttribute("aria-pressed", "true");
    expect(card.dataset.highlight).toBe(NET_KEY);
    // Alone: the measures fade, the net line does not
    expect(measureOpacity([NET_KEY], keyOf(FUEL))).toBe(FADED_OPACITY);
    expect(netOpacity([NET_KEY])).toBe(1);
    // With a measure: both stay
    fireEvent.click(screen.getByRole("button", { name: FUEL.name }));
    expect(card.dataset.highlight.split(",").sort()).toEqual([keyOf(FUEL), NET_KEY].sort());
    // A measure alone fades the net line; nothing chosen fades nothing
    expect(netOpacity([keyOf(FUEL)])).toBe(FADED_OPACITY);
    expect(netOpacity(null)).toBe(1);
  });
});
