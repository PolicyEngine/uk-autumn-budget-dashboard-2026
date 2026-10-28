import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import LocalAuthorityField from "./LocalAuthorityField";

const REGION_NAMES = { NORTH_WEST: "North West", LONDON: "London", WALES: "Wales", SOUTH_EAST: "South East" };

/** The picker in a form that keeps what is picked, as the calculator does. */
function Harness({ onPick = () => {}, start = { council: null, region: "NORTH_WEST" } }) {
  const [inputs, setInputs] = useState(start);
  return (
    <LocalAuthorityField
      id="council"
      label="Local authority"
      value={inputs.council}
      regionLabel={REGION_NAMES[inputs.region] ?? inputs.region}
      hint="Your council sets your region."
      onChange={(council) => {
        onPick(council);
        setInputs({ council: council.name, region: council.region });
      }}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: "Local authority" });
const list = () => screen.getByRole("listbox", { hidden: true });
const options = () => within(list()).queryAllByRole("option");
const type = (text) => fireEvent.change(input(), { target: { value: text } });
const key = (k) => fireEvent.keyDown(input(), { key: k });
const regionNote = () => document.getElementById("region-council");

describe("the local authority picker", () => {
  it("is an ARIA combobox with a listbox, closed at first, the region under it", () => {
    render(<Harness />);
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveAttribute("aria-controls", list().id);
    expect(list()).not.toBeVisible();
    expect(input()).toHaveAttribute("placeholder", "Search 361 local authorities");
    expect(regionNote()).toHaveTextContent("North West, until you pick your council");
    // The region and the "i" note describe the box
    expect(input()).toHaveAccessibleDescription(/North West.*Your council sets your region/);
  });

  it("lists the local authorities that match as you type, ignoring case and punctuation", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("st helens");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(options().map((o) => o.textContent)).toEqual(["St. Helens"]);
    type("zzz");
    expect(options()).toHaveLength(0);
    expect(within(list()).getByText("No local authority matches")).toBeInTheDocument();
  });

  it("moves through the list with the arrow keys and picks with Enter, setting the region", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.focus(input());
    type("black");
    // The first match is active as you type
    const first = options()[0];
    expect(input()).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    key("ArrowDown");
    const second = options()[1];
    expect(input()).toHaveAttribute("aria-activedescendant", second.id);
    const name = second.textContent;
    key("Enter");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name, region: "NORTH_WEST" }));
    expect(input()).toHaveValue(name);
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(regionNote()).toHaveTextContent(/^North West$/);
  });

  it("picks with a click or tap, and shows the new region", () => {
    render(<Harness />);
    fireEvent.focus(input());
    type("camden");
    fireEvent.click(within(list()).getByRole("option", { name: "Camden" }));
    expect(input()).toHaveValue("Camden");
    expect(regionNote()).toHaveTextContent(/^London$/);
  });

  it("closes with Escape and goes back to the council picked before", () => {
    render(<Harness start={{ council: "Rushmoor", region: "SOUTH_EAST" }} />);
    expect(input()).toHaveValue("Rushmoor");
    fireEvent.focus(input());
    type("Cardiff");
    key("Escape");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveValue("Rushmoor");
    expect(regionNote()).toHaveTextContent(/^South East$/);
  });

  it("on leaving the box, keeps a name typed in full and drops a part of one", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.focus(input());
    type("isle of anglesey");
    fireEvent.blur(input());
    expect(onPick).toHaveBeenCalledWith({ name: "Isle of Anglesey", key: "ISLE_OF_ANGLESEY", region: "WALES" });
    expect(input()).toHaveValue("Isle of Anglesey");
    fireEvent.focus(input());
    type("Isle");
    fireEvent.blur(input());
    expect(input()).toHaveValue("Isle of Anglesey");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("opens on ArrowDown with every local authority, the picked one active", () => {
    render(<Harness start={{ council: "Rushmoor", region: "SOUTH_EAST" }} />);
    fireEvent.focus(input());
    key("ArrowDown");
    expect(options()).toHaveLength(361);
    const active = document.getElementById(input().getAttribute("aria-activedescendant"));
    expect(active).toHaveTextContent("Rushmoor");
  });
});
