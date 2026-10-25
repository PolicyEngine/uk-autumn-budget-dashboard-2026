import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { measureModelling, NOT_MODELLED, unavailableMeasures } from "./methodology/measures";
import { fiscalYearTick } from "../utils/chartTheme";
import { EXAMPLE_HOUSEHOLDS } from "../utils/exampleHouseholds";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { measureCatalogueFixture } from "../test/measureCatalogueFixture";
const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const MEASURE_MODELLING = measureModelling(catalogue);
const UNAVAILABLE = unavailableMeasures(catalogue);
const POLICY_COLORS = catalogue.policyColors;

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

const renderTab = (onShowTab = vi.fn()) => render(<MeasureCatalogueProvider catalogue={catalogue}><MethodologyTab onShowTab={onShowTab} /></MeasureCatalogueProvider>);

describe("MethodologyTab", () => {
  it("keeps the anchors other views link to", () => {
    // Other views (e.g. the map and Personal impact) link to these
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

    const [table, unavailable] = screen.getAllByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(MEASURE_MODELLING.length);
    // The catalogue's measures without verified results, each with its reason
    const unavailableRows = within(unavailable).getAllByRole("row").slice(1);
    expect(unavailableRows).toHaveLength(UNAVAILABLE.length);
    for (const measure of UNAVAILABLE) {
      expect(within(unavailable).getByRole("rowheader", { name: measure.name })).toBeInTheDocument();
      expect(unavailable).toHaveTextContent(measure.why);
    }
    for (const measure of MEASURE_MODELLING) {
      // Every measure is one the charts colour, by the same name
      expect(POLICY_COLORS[measure.seriesKey]).toBeDefined();
      expect(within(table).getByRole("rowheader", { name: measure.name })).toBeInTheDocument();
    }

    const panel = document.getElementById(METHOD_SECTIONS.population);
    for (const household of EXAMPLE_HOUSEHOLDS) {
      expect(panel).toHaveTextContent(household.definition);
    }
  });

  it("labels the first year with results as that, not as when a policy starts", () => {
    // Review of 62febdd, finding 6: results cover every scored year, so a
    // measure that starts in 2031-32 can have results from 2026-27
    renderTab();
    const [table] = screen.getAllByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Measure", "Published description", "Results from"]);
    for (const measure of MEASURE_MODELLING) {
      const row = within(table).getByRole("rowheader", { name: measure.name }).closest("tr");
      expect(row.querySelector(".method-measure-year")).toHaveTextContent(`Results from ${fiscalYearTick(2026)}`);
    }
    // The first supported year: an unsupported year has no results
    const partly = { displayable: [{ description: "From 6 April 2031", years: [2028, 2026, 2027], unsupported_years: [2026] }] };
    expect(measureModelling(partly)[0].from).toBe(2027);
  });

  it("lists the measures reported as likely that the model cannot cost", () => {
    renderTab();
    const card = screen.getByRole("heading", { name: "Likely but not modelled" }).closest(".method-card");
    const table = within(card).getByRole("table");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(NOT_MODELLED.length);
    expect(NOT_MODELLED.length).toBeGreaterThan(0);
    for (const measure of NOT_MODELLED) {
      expect(within(table).getByRole("rowheader", { name: measure.name })).toBeInTheDocument();
      expect(table).toHaveTextContent(measure.why);
    }
    // Text only: no measure the catalogue publishes, and no figure
    for (const measure of catalogue.measures) {
      expect(within(table).queryByRole("rowheader", { name: measure.name })).toBeNull();
    }
    expect(table.textContent).not.toMatch(/£|\d+(\.\d+)?%/);
  });

  it("describes the household calculation in its slot", () => {
    renderTab();
    const slot = document.getElementById(METHOD_SECTIONS.singleYear);
    expect(within(slot).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Household calculation",
    );
    expect(slot).not.toHaveTextContent("To follow");
    expect(slot).toHaveTextContent("same measures as the national figures");
    expect(slot).toHaveTextContent("OBR's average earnings forecast");
    expect(slot).not.toHaveTextContent("in the national figures only");
    expect(slot).toHaveTextContent("Every policy applied");
    expect(slot).toHaveTextContent("employer NI relief for under-25s");
    expect(slot).toHaveTextContent("if received");
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
});
