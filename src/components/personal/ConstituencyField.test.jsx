import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ConstituencyField from "./ConstituencyField";

const REGION_NAMES = { NORTH_WEST: "North West", LONDON: "London", WALES: "Wales", SOUTH_EAST: "South East" };

/** The picker in a form that keeps what is picked, as the calculator does. */
function Harness({ onPick = () => {}, start = { constituency: null, region: "NORTH_WEST" } }) {
  const [inputs, setInputs] = useState(start);
  return (
    <ConstituencyField
      id="constituency"
      label="Constituency"
      value={inputs.constituency}
      regionLabel={REGION_NAMES[inputs.region] ?? inputs.region}
      hint="Your constituency sets your region."
      onChange={(seat) => {
        onPick(seat);
        setInputs({ constituency: seat.name, region: seat.region });
      }}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: "Constituency" });
const list = () => screen.getByRole("listbox", { hidden: true });
const options = () => within(list()).queryAllByRole("option");
const type = (text) => fireEvent.change(input(), { target: { value: text } });
const key = (k) => fireEvent.keyDown(input(), { key: k });
const regionNote = () => document.getElementById("region-constituency");

describe("the constituency picker", () => {
  it("is an ARIA combobox with a listbox, closed at first, the region under it", () => {
    render(<Harness />);
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveAttribute("aria-controls", list().id);
    expect(list()).not.toBeVisible();
    expect(input()).toHaveAttribute("placeholder", "Search 650 constituencies");
    expect(regionNote()).toHaveTextContent("North West, until you pick a constituency");
    // The region and the "i" note describe the box
    expect(input()).toHaveAccessibleDescription(/North West.*Your constituency sets your region/);
  });

  it("lists the constituencies that match as you type, ignoring accents", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("glyndwr");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(options().map((o) => o.textContent)).toEqual(["Montgomeryshire and Glyndŵr"]);
    type("zzz");
    expect(options()).toHaveLength(0);
    expect(within(list()).getByText("No constituency matches")).toBeInTheDocument();
  });

  it("moves through the list with the arrow keys and picks with Enter, setting the region", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.focus(input());
    type("manchester");
    // The first match is active as you type
    const first = options()[0];
    expect(input()).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    key("ArrowDown");
    const second = options()[1];
    expect(input()).toHaveAttribute("aria-activedescendant", second.id);
    const name = second.textContent;
    key("Enter");
    expect(onPick).toHaveBeenCalledWith({ name, region: "NORTH_WEST" });
    expect(input()).toHaveValue(name);
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(regionNote()).toHaveTextContent(/^North West$/);
  });

  it("picks with a click or tap, and shows the new region", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("holborn");
    fireEvent.click(within(list()).getByRole("option", { name: "Holborn and St Pancras" }));
    expect(input()).toHaveValue("Holborn and St Pancras");
    expect(regionNote()).toHaveTextContent(/^London$/);
  });

  it("closes with Escape and goes back to the constituency picked before", () => {
    render(<Harness start={{ constituency: "Aldershot", region: "SOUTH_EAST" }} />);
    expect(input()).toHaveValue("Aldershot");
    fireEvent.focus(input());
    type("Cardiff");
    key("Escape");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveValue("Aldershot");
    expect(regionNote()).toHaveTextContent(/^South East$/);
  });

  it("on leaving the box, keeps a name typed in full and drops a part of one", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.focus(input());
    type("ynys mon");
    fireEvent.blur(input());
    expect(onPick).toHaveBeenCalledWith({ name: "Ynys Môn", region: "WALES" });
    expect(input()).toHaveValue("Ynys Môn");
    fireEvent.focus(input());
    type("Ynys");
    fireEvent.blur(input());
    expect(input()).toHaveValue("Ynys Môn");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("opens on ArrowDown with every constituency, the picked one active", () => {
    render(<Harness start={{ constituency: "Aldershot", region: "SOUTH_EAST" }} />);
    fireEvent.focus(input());
    key("ArrowDown");
    expect(options()).toHaveLength(650);
    const active = document.getElementById(input().getAttribute("aria-activedescendant"));
    expect(active).toHaveTextContent("Aldershot");
  });
});
