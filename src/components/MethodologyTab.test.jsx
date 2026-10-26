import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { measureModelling, MODELLING_NOTE, NOT_MODELLED, unavailableMeasures } from "./methodology/measures";
import { fiscalYearTick } from "../utils/chartTheme";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { measureCatalogueFixture } from "../test/measureCatalogueFixture";
const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const MEASURE_MODELLING = measureModelling(catalogue);
const UNAVAILABLE = unavailableMeasures(catalogue);
const POLICY_COLORS = catalogue.policyColors;

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  delete window.matchMedia;
});

const renderTab = (onShowTab = vi.fn()) => render(<MeasureCatalogueProvider catalogue={catalogue}><MethodologyTab onShowTab={onShowTab} /></MeasureCatalogueProvider>);

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

  it("shows each measure's modelling", () => {
    renderTab();

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

  it("shows the one modelling note under its measure's published description", () => {
    // #113's scope note: independent text, not part of the receipt
    const noted = { ...catalogue, displayable: catalogue.displayable.map((measure, index) => (index === 0 ? { ...measure, id: MODELLING_NOTE.id } : measure)) };
    render(<MeasureCatalogueProvider catalogue={noted}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    const [table] = screen.getAllByRole("table");
    const notes = table.querySelectorAll(".method-measure-note");
    expect(notes).toHaveLength(1);
    const row = within(table).getByRole("rowheader", { name: noted.displayable[0].name }).closest("tr");
    expect(row).toContainElement(notes[0]);
    expect(row).toHaveTextContent(noted.displayable[0].description);
    expect(notes[0]).toHaveTextContent(`Modelling note: ${MODELLING_NOTE.note}`);
  });

  it("shows no modelling note while its measure is not displayed", () => {
    renderTab();
    expect(document.querySelectorAll(".method-measure-note")).toHaveLength(0);
    const other = { description: "Published.", years: [2027], unsupported_years: [] };
    expect(measureModelling({ displayable: [{ ...other, id: "another_measure" }] })[0].note).toBeNull();
    expect(measureModelling({ displayable: [{ ...other, id: MODELLING_NOTE.id }] })[0].note).toBe(MODELLING_NOTE.note);
  });

  it("keeps every figure in the modelling note attributed to its outside source", () => {
    // Review of 3d52cff, finding 3: a figure of ours needs a receipt, so the
    // hand-written note may carry only dated estimates from named sources
    const sentences = MODELLING_NOTE.note.split(/(?<=\.)\s+/);
    const priced = sentences.filter((sentence) => sentence.includes("£"));
    expect(priced.length).toBeGreaterThan(0);
    for (const sentence of priced) {
      expect(sentence).toMatch(/Resolution Foundation|Tax Policy Associates|HMRC/);
    }
    expect(MODELLING_NOTE.note).not.toMatch(/\bthe model\b|PolicyEngine/i);
    expect(MODELLING_NOTE.note).toMatch(/2025-26/);
  });

  it("lists the measures the model cannot cost", () => {
    renderTab();
    const card = screen.getByRole("heading", { name: "Not modelled" }).closest(".method-card");
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
    const notes = screen.getByRole("link", { name: "Policies tab" });
    expect(notes).toHaveAttribute("href", "?tab=policies");
    fireEvent.click(notes);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    const living = document.getElementById(METHOD_SECTIONS.living);
    // The current-law cards on the Pre-measures forecast's sub-tabs
    for (const [name, sub] of [["Living standards", "living"], ["Poverty", "poverty"], ["OBR forecast", "forecast"]]) {
      const link = within(living).getByRole("link", { name });
      expect(link).toHaveAttribute("href", `?tab=outlook&sub=${sub}`);
      fireEvent.click(link);
      expect(onShowTab).toHaveBeenLastCalledWith("outlook", sub);
    }
    const young = screen.getByRole("link", { name: "Young people results" });
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

  it("opens each section with a summary, its technical details closed until asked for", () => {
    const { container } = renderTab();
    for (const { id } of METHOD_CONTENTS) {
      const section = container.querySelector(`section#${id}`);
      expect(section.querySelector(".method-summary")?.textContent.trim()).toBeTruthy();
      const details = section.querySelector("details.method-details");
      if (details) expect(details.open).toBe(false);
    }
  });

  it("says nothing tied to the Budget's date, so it stays true on and after Budget day", () => {
    const { container } = renderTab();
    expect(container.textContent).not.toMatch(
      /pre-Budget|before the Budget|after the Budget|28 October|once the OBR|candidate|likely for the Budget/i,
    );
  });
});
