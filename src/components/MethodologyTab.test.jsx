import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { HOUSEHOLD_ABOUT_ID } from "./methodology/anchors";
import { NOT_MODELLED, unavailableMeasures } from "./methodology/measures";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { measureCatalogueFixture } from "../test/measureCatalogueFixture";
const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const UNAVAILABLE = unavailableMeasures(catalogue);

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

  it("points to Policies for what each measure does and how it is modelled, listing none itself", () => {
    // Each fact once: the measures' descriptions and modelling live on the
    // Policies cards, so Methodology names no published measure
    const onShowTab = vi.fn();
    const { container } = renderTab(onShowTab);
    expect(screen.queryByRole("heading", { name: "Published measure descriptions" })).toBeNull();
    const model = container.querySelector(`#${METHOD_SECTIONS.model}`);
    const summary = model.querySelector(".method-summary");
    expect(summary.querySelectorAll("p")).toHaveLength(1);
    expect(summary).toHaveTextContent("What each measure does and how it is modelled is on Policies");
    const link = summary.querySelector("a.method-pointer");
    expect(link).toHaveAccessibleName("Policies");
    expect(link).toHaveAttribute("href", "?tab=policies");
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    for (const measure of catalogue.displayable) expect(container).not.toHaveTextContent(measure.name);
    expect(within(model).queryByRole("button", { name: /See the effect/ })).toBeNull();
  });

  it("lists the unavailable measures only when there are any", () => {
    renderTab();
    const heading = screen.queryByRole("heading", { name: "Unavailable measures" });
    if (UNAVAILABLE.length === 0) {
      expect(heading).toBeNull();
    } else {
      const card = heading.closest(".method-card");
      expect(within(card).getAllByRole("listitem")).toHaveLength(UNAVAILABLE.length);
      for (const measure of UNAVAILABLE) expect(card).toHaveTextContent(`${measure.name}${measure.why}`);
    }
    const empty = { ...catalogue, measures: catalogue.measures.filter((measure) => measure.displayable) };
    cleanup();
    render(<MeasureCatalogueProvider catalogue={empty}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    expect(screen.queryByRole("heading", { name: "Unavailable measures" })).toBeNull();
  });

  it("lists the measures the model cannot cost", () => {
    renderTab();
    const card = screen.getByRole("heading", { name: "Not modelled" }).closest(".method-card");
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(NOT_MODELLED.length);
    expect(NOT_MODELLED.length).toBeGreaterThan(0);
    for (const measure of NOT_MODELLED) {
      expect(card).toHaveTextContent(`${measure.name}${measure.why}`);
    }
    // Text only: no measure the catalogue publishes, and no figure
    for (const measure of catalogue.measures) {
      expect(items.some((item) => item.querySelector(".mm-reason-name").textContent === measure.name)).toBe(false);
    }
    expect(within(card).getByRole("list").textContent).not.toMatch(/£|\d+(\.\d+)?%/);
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
    const notes = screen.getByRole("link", { name: "policy notes" });
    expect(notes).toHaveAttribute("href", "?tab=policies");
    fireEvent.click(notes);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    const living = document.getElementById(METHOD_SECTIONS.living);
    // The current-law cards on the Pre-measures forecast's sub-tabs
    for (const [name, sub] of [["Living standards", "living"], ["Poverty", "poverty"], ["Forecast changes", "forecast"]]) {
      const link = within(living).getAllByRole("link", { name }).find((a) => a.getAttribute("href") === `?tab=outlook&sub=${sub}`);
      fireEvent.click(link);
      expect(onShowTab).toHaveBeenLastCalledWith("outlook", sub);
    }
    // The twins with the measures, on Population impact
    for (const [name, sub] of [["Living standards", "living"], ["Poverty", "poverty"]]) {
      const link = within(living).getAllByRole("link", { name }).find((a) => a.getAttribute("href") === `?tab=dashboard&sub=${sub}`);
      fireEvent.click(link);
      expect(onShowTab).toHaveBeenLastCalledWith("dashboard", sub);
    }
    // Household impact is the "household" view (it was linked as "personal",
    // a view that does not exist)
    const household = document.getElementById(METHOD_SECTIONS.singleYear);
    const about = within(household).getByRole("link", { name: "“About these figures”" });
    expect(about).toHaveAttribute("href", `?tab=household#${HOUSEHOLD_ABOUT_ID}`);
    fireEvent.click(about);
    expect(onShowTab).toHaveBeenLastCalledWith("household");
    const young = screen.getByRole("link", { name: "Young people results" });
    expect(young).toHaveAttribute("href", "?tab=dashboard&sub=young#young-people");
    fireEvent.click(young);
    expect(onShowTab).toHaveBeenLastCalledWith("dashboard", "young");
  });

  it("links every external source in a new tab, saying so, and every shared term to its definition", () => {
    const { container } = renderTab();
    const external = [...container.querySelectorAll('a[href^="http"]')];
    expect(external.length).toBeGreaterThan(5);
    for (const link of external) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("(opens in a new tab)");
    }
    expect(external.map((link) => link.getAttribute("href"))).toEqual(
      expect.arrayContaining(["https://policyengine.org/uk/model", "https://github.com/PolicyEngine/policyengine-uk"]),
    );
    // Each term link lands on a term the glossary defines
    const terms = [...container.querySelectorAll('a[href^="#term-"]')];
    expect(terms.length).toBeGreaterThan(5);
    for (const link of terms) {
      expect(container.querySelector(link.getAttribute("href"))).not.toBeNull();
    }
    // In-view anchors exist too
    for (const link of container.querySelectorAll('a[href^="#method-"]')) {
      expect(container.querySelector(link.getAttribute("href")), link.getAttribute("href")).not.toBeNull();
    }
  });

  it("keeps the space after every link: no JSX text after a tag that loses it in the build", () => {
    // Next's compiler (SWC) drops the leading space of JSX text that runs on
    // to another line after a closing tag ("net income</Term> under ...",
    // shown as "net incomeunder"); jsdom's transform keeps it, so a render
    // test cannot see it. Such text needs an explicit {" "}.
    const root = join(fileURLToPath(import.meta.url), "..");
    const files = [
      "MethodologyTab.jsx",
      "GeographyMethodology.jsx",
      ...readdirSync(join(root, "methodology")).filter((f) => f.endsWith(".jsx")).map((f) => `methodology/${f}`),
      "personal/singleYearMethodNotes.jsx",
    ];
    const tag = /(<\/[A-Za-z][\w.]*>|\/>) +(?=[^\s{<])/g;
    const glued = [];
    for (const file of files) {
      const lines = readFileSync(join(root, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(tag)) {
          const rest = line.slice(match.index + match[0].length);
          const next = (lines[index + 1] ?? "").trim();
          if (/[<{]/.test(rest) || /^\s*(\/\/|\*)/.test(line) || !next || /^[<{)}/]/.test(next)) continue;
          glued.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(glued).toEqual([]);
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
