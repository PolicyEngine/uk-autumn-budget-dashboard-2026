import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { MEASURE_MODELLING, NOT_MODELLED } from "./methodology/measures";
import { EXAMPLE_HOUSEHOLDS } from "../utils/exampleHouseholds";
import { POLICY_COLORS } from "../utils/policyConfig";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  delete window.matchMedia;
});

const renderTab = (onShowTab = vi.fn()) => render(<MethodologyTab onShowTab={onShowTab} />);

describe("MethodologyTab", () => {
  it("keeps the anchors other views link to", () => {
    // Other views (e.g. the map and Household impact) link to these
    expect(METHOD_SECTIONS.geography).toBe("method-area");
    expect(METHOD_SECTIONS.singleYear).toBe("method-single-year");
    const { container } = renderTab();
    for (const id of Object.values(METHOD_SECTIONS)) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("lists every section in a contents nav, each linking to its titled section", () => {
    const { container } = renderTab();
    const nav = screen.getByRole("navigation", { name: "Methodology contents" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      METHOD_CONTENTS.map((section) => section.title),
    );
    for (const { id, title } of METHOD_CONTENTS) {
      const link = within(nav).getByRole("link", { name: title });
      expect(link).toHaveAttribute("href", `#${id}`);
      const section = container.querySelector(`section#${id}`);
      expect(section).not.toBeNull();
      expect(within(section).getAllByRole("heading", { level: 2 })[0]).toHaveTextContent(title);
    }
    // The phone's jump menu offers the same sections
    const options = within(nav).getAllByRole("option");
    expect(options.map((option) => option.value)).toEqual(METHOD_CONTENTS.map((s) => s.id));
  });

  it("marks the chosen section current, puts it in the address and focuses its title", () => {
    renderTab();
    const nav = screen.getByRole("navigation", { name: "Methodology contents" });
    const link = within(nav).getByRole("link", { name: "Figures by area" });
    fireEvent.click(link);
    expect(link).toHaveAttribute("aria-current", "location");
    expect(window.location.hash).toBe("#method-area");
    expect(screen.getByRole("heading", { level: 2, name: "Figures by area" })).toHaveFocus();

    fireEvent.change(within(nav).getByRole("combobox"), {
      target: { value: METHOD_SECTIONS.limitations },
    });
    expect(window.location.hash).toBe("#method-limitations");
    expect(within(nav).getByRole("link", { name: "Limitations" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("keeps headings in order, never skipping a level", () => {
    const { container } = renderTab();
    const levels = [...container.querySelectorAll("h2, h3, h4, h5, h6")].map((heading) =>
      Number(heading.tagName[1]),
    );
    expect(levels[0]).toBe(2);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it("shows the five steps, each measure's modelling and the example households", () => {
    renderTab();
    const flow = screen.getByRole("list", { name: "How the numbers are made" });
    expect(within(flow).getAllByRole("listitem")).toHaveLength(5);

    const [table, notModelled] = screen.getAllByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(MEASURE_MODELLING.length);
    // The likely measures the model cannot cost, each with its reason
    const notModelledRows = within(notModelled).getAllByRole("row").slice(1);
    expect(notModelledRows).toHaveLength(NOT_MODELLED.length);
    for (const measure of NOT_MODELLED) {
      expect(within(notModelled).getByRole("rowheader", { name: measure.name })).toBeInTheDocument();
      expect(notModelled).toHaveTextContent(measure.why);
    }
    for (const measure of MEASURE_MODELLING) {
      // Every measure is one the charts colour, by the same name
      expect(POLICY_COLORS[measure.name]).toBeDefined();
      expect(within(table).getByRole("rowheader", { name: measure.name })).toBeInTheDocument();
    }

    const panel = document.getElementById(METHOD_SECTIONS.population);
    for (const household of EXAMPLE_HOUSEHOLDS) {
      expect(panel).toHaveTextContent(household.definition);
    }
  });

  it("points to the household calculation from its slot", () => {
    renderTab();
    const slot = document.getElementById(METHOD_SECTIONS.singleYear);
    expect(within(slot).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Household calculation",
    );
    // The calculation is said once, in Household impact's "About these
    // figures"; this slot points there.
    expect(slot).toHaveTextContent("About these figures");
    expect(within(slot).getByRole("link", { name: "Household impact tab" })).toBeInTheDocument();
    expect(slot).not.toHaveTextContent("OBR's average earnings forecast");
  });

  it("switches views from its links, in place", () => {
    const onShowTab = vi.fn();
    renderTab(onShowTab);
    fireEvent.click(screen.getByRole("link", { name: "policy notes on Population impact" }));
    expect(onShowTab).toHaveBeenLastCalledWith("dashboard");
    const living = document.getElementById(METHOD_SECTIONS.living);
    fireEvent.click(within(living).getByRole("link", { name: "Living standards" }));
    expect(onShowTab).toHaveBeenLastCalledWith("living");
    const young = screen.getByRole("link", { name: "See Young people under Population impact" });
    expect(young).toHaveAttribute("href", "?tab=dashboard&sub=young#young-people");
    fireEvent.click(young);
    expect(onShowTab).toHaveBeenLastCalledWith("dashboard", "young");
  });

  it("renders every section with its icon, so a missing icon import fails", () => {
    const { container } = renderTab();
    for (const { id } of METHOD_CONTENTS) {
      const section = container.querySelector(`section#${id}`);
      expect(section).not.toBeNull();
      expect(section.querySelector(".method-section-heading .method-icon svg")).not.toBeNull();
    }
    // Every defined term has its icon
    for (const term of container.querySelectorAll(".method-fact dt")) {
      expect(term.querySelector("svg")).not.toBeNull();
    }
  });

  it("starts each section after the first collapsed on a phone, and opens it from the jump menu", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    renderTab();
    const data = document.getElementById(`${METHOD_SECTIONS.data}-body`);
    expect(data).not.toBeVisible();
    expect(document.getElementById(`${METHOD_SECTIONS.overview}`)).toHaveTextContent("Survey data");
    const nav = screen.getByRole("navigation", { name: "Methodology contents" });
    fireEvent.change(within(nav).getByRole("combobox"), {
      target: { value: METHOD_SECTIONS.data },
    });
    expect(data).toBeVisible();
    const toggle = within(document.getElementById(METHOD_SECTIONS.data)).getByRole("button", {
      name: "Hide details",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(data).not.toBeVisible();
  });

  it("says nothing tied to the Budget's date, so it stays true on and after Budget day", () => {
    const { container } = renderTab();
    expect(container.textContent).not.toMatch(
      /pre-Budget|before the Budget|after the Budget|28 October|once the OBR|candidate|likely for the Budget/i,
    );
  });
});
