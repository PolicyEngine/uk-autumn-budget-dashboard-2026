import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { METHOD_ANCHORS } from "./methodology/anchors";
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
    // Other views (e.g. the map and Household calculator) link to these
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
    const link = within(nav).getByRole("link", { name: "Population impact" });
    fireEvent.click(link);
    expect(link).toHaveAttribute("aria-current", "location");
    expect(window.location.hash).toBe("#method-population");
    expect(screen.getByRole("heading", { level: 2, name: "Population impact" })).toHaveFocus();

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
    const summary = model.querySelector(".section-heading p");
    expect(summary).toHaveTextContent("what each policy does and how it is modelled is on Policies.");
    const link = within(summary).getByRole("link", { name: "Policies" });
    expect(link).toHaveAttribute("href", "?tab=policies");
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    for (const measure of catalogue.displayable) expect(container).not.toHaveTextContent(measure.name);
    expect(within(model).queryByRole("button", { name: /See the effect/ })).toBeNull();
  });

  it("lists the unavailable measures only when there are any", () => {
    renderTab();
    const heading = screen.queryByRole("button", { name: "Unavailable policies" });
    if (UNAVAILABLE.length === 0) {
      expect(heading).toBeNull();
    } else {
      const card = heading.closest(".method-topic");
      expect(card.querySelectorAll("li")).toHaveLength(UNAVAILABLE.length);
      for (const measure of UNAVAILABLE) expect(card).toHaveTextContent(`${measure.name}${measure.why}`);
    }
    const empty = { ...catalogue, measures: catalogue.measures.filter((measure) => measure.displayable) };
    cleanup();
    render(<MeasureCatalogueProvider catalogue={empty}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    expect(screen.queryByRole("button", { name: "Unavailable policies" })).toBeNull();
  });

  it("says under Limitations that fuel duty covers households' own fuel, naming no measure", () => {
    const { container } = renderTab();
    const limitations = container.querySelector(`#${METHOD_SECTIONS.limitations}`);
    const card = within(limitations).getByRole("button", { name: "Business fuel use" }).closest(".method-topic");
    expect(card).toHaveTextContent("roughly half of fuel duty receipts");
  });

  it("says under Policies added up that separate runs leave out interactions, and nothing on survey values no measure replaces", () => {
    const { container } = renderTab();
    const limitations = container.querySelector(`#${METHOD_SECTIONS.limitations}`);
    const card = within(limitations).getByRole("button", { name: "Policies added up" }).closest(".method-topic");
    expect(card).toHaveTextContent("so they leave out interactions between policies");
    expect(card).not.toHaveTextContent(/values reported in the survey/);
  });

  it("counts a change in VAT in the inequality income, not VAT itself, and says in-kind services once", () => {
    const { container } = renderTab();
    const text = container.textContent;
    expect(text).toContain("after fuel duty and other duties, counting any change in VAT");
    expect(text).toContain("fuel duty and any change in VAT included");
    expect(text).not.toMatch(/after indirect taxes/);
    expect(text.match(/such as the NHS and schools/g)).toHaveLength(1);
  });

  it("lists the measures the model cannot cost", () => {
    renderTab();
    const card = screen.getByRole("button", { name: "Not modelled" }).closest(".method-topic");
    fireEvent.click(within(card).getByRole("button", { name: "Not modelled" }));
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
    expect(card.querySelector("ul").textContent).not.toMatch(/£|\d+(\.\d+)?%/);
  });

  it("points to the household calculation from its slot", () => {
    renderTab();
    const slot = document.getElementById(METHOD_SECTIONS.singleYear);
    // One line: the tab it is about; the calculation is said once, folded below
    expect(within(slot).getByRole("link", { name: "Household calculator tab" })).toBeInTheDocument();
    expect(slot).not.toHaveTextContent("OBR's average earnings forecast");
    const calc = document.getElementById(METHOD_ANCHORS.householdCalc);
    expect(within(calc).getByRole("button", { name: "How the household calculation works" })).toBeInTheDocument();
    const terms = [...calc.querySelectorAll(".method-fact dt")].map((term) => term.textContent);
    expect(terms).toEqual(expect.arrayContaining(["Engine and policies", "Salary", "Marginal tax rate", "Who counts as a child", "Council Tax"]));
  });

  it("switches views from its links, in place", () => {
    const onShowTab = vi.fn();
    renderTab(onShowTab);
    const notes = screen.getByRole("link", { name: "policy notes", hidden: true });
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
    // Household calculator is the "household" view (it was linked as "personal",
    // a view that does not exist)
    const household = document.getElementById(METHOD_SECTIONS.singleYear);
    const tabLink = within(household).getByRole("link", { name: "Household calculator tab" });
    expect(tabLink).toHaveAttribute("href", "?tab=household");
    fireEvent.click(tabLink);
    expect(onShowTab).toHaveBeenLastCalledWith("household");
    // By age, with 16 to 24 chosen (the Young people sub-tab was merged into it)
    const young = screen.getAllByRole("link", { name: "results by age", hidden: true }).find((a) => a.getAttribute("href").startsWith("?tab="));
    expect(young).toHaveAttribute("href", "?tab=dashboard&sub=age&age=16-24#young-people");
    fireEvent.click(young);
    expect(onShowTab).toHaveBeenLastCalledWith("dashboard", "age", { age: "16-24" });
  });

  it("sums up how the data is built, linking the pipeline, the calibration targets and Microcosm, and quotes no counts", () => {
    renderTab();
    const card = screen.getByRole("button", { name: "The dataset" }).closest(".method-topic");
    const terms = [...card.querySelectorAll(".method-fact dt")].map((term) => term.textContent);
    expect(terms).toEqual(["Dataset", "Pipeline", "Survey", "Weights", "Projection", "Small groups"]);
    // The pipeline page describes the current build, which may be newer than the dashboard's data
    const pipeline = within(card).getByRole("link", { name: /^Read how Microcosm UK is built today/, hidden: true });
    expect(pipeline).toHaveAttribute("href", "https://www.policyengine.org/uk/model/data/pipeline");
    expect(pipeline.parentElement).toHaveTextContent("may be newer than this dashboard's data");
    const targets = within(card).getByRole("link", { name: /^calibration targets/, hidden: true });
    expect(targets).toHaveAttribute("href", "https://www.policyengine.org/uk/model/data/calibration");
    const microcosm = within(card).getByRole("link", { name: /^Microcosm\s*\(opens in a new tab\)$/, hidden: true });
    expect(microcosm).toHaveAttribute("href", "https://microcosm.institute");
    // Aggregate words only: no record or household counts from the pipeline page
    expect(card.textContent).not.toMatch(/\d{1,3}(,\d{3})+/);
  });

  it("states the floor of 3 survey households for the deciles and ages, and that the age filter counts records", () => {
    const { container } = renderTab();
    const small = [...container.querySelectorAll(".method-fact")].find(
      (fact) => fact.querySelector("dt")?.textContent === "Small groups",
    );
    expect(within(small).getByRole("link", { name: "income deciles", hidden: true })).toHaveAttribute(
      "href",
      `#${METHOD_ANCHORS.byIncome}`,
    );
    const text = container.textContent;
    expect(text).toContain("comes from only one or two survey households, its figures are not published, and nor is that year's winners and losers figure for all households; a package also leaves out the cells its members withhold");
    expect(text).not.toContain("any figures that would give them back");
    expect(text).toContain("The rest of the measure is shown.");
    expect(text).toContain("so this counts records, not households");
    expect(text).toContain("In the age and decile tables, a figure resting on one or two survey households is not published, nor any figure in the same table that would give it back.");
    expect(text).not.toContain("survey records is not shown");
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

  it("renders every section with its icon, so a missing icon name fails", () => {
    const { container } = renderTab();
    for (const { id } of METHOD_CONTENTS) {
      const section = container.querySelector(`section#${id}`);
      expect(section).not.toBeNull();
      expect(section.querySelector(".section-heading .section-icon svg")).not.toBeNull();
    }
    // Every defined term has its icon
    for (const term of container.querySelectorAll(".method-fact dt")) {
      expect(term.querySelector("svg")).not.toBeNull();
    }
  });

  it("opens each section with a one-line summary, its topics folded until asked for", () => {
    const { container } = renderTab();
    for (const { id } of METHOD_CONTENTS) {
      const section = container.querySelector(`section#${id}`);
      expect(section.querySelector(".section-heading p")?.textContent.trim()).toBeTruthy();
      for (const toggle of section.querySelectorAll(".method-topic > .disclosure-toggle")) {
        expect(toggle).toHaveAttribute("aria-expanded", "false");
      }
    }
    // No "Back to top" after every section: the contents stay in view
    expect(container).not.toHaveTextContent("Back to top");
  });

  it("opens a folded topic when a link leads into it", async () => {
    const { container } = renderTab();
    const glossary = document.getElementById(METHOD_ANCHORS.glossary);
    const toggle = within(glossary).getByRole("button", { name: /Terms used on the charts/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A term link inside another topic leads to the glossary
    fireEvent.click(container.querySelector('a[href="#term-netIncome"]'));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(window.location.hash).toBe("#term-netIncome");
  });

  it("defines each shared term in one line", () => {
    const { container } = renderTab();
    const rows = [...container.querySelectorAll(".method-glossary-row")];
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.querySelector("dd").textContent.length).toBeLessThan(200);
    }
    expect(container.textContent).not.toMatch(/66 in 2026-27/);
  });

  it("says nothing tied to the Budget's date, so it stays true on and after Budget day", () => {
    const { container } = renderTab();
    expect(container.textContent).not.toMatch(
      /pre-Budget|before the Budget|after the Budget|28 October|once the OBR|candidate|likely for the Budget/i,
    );
  });
});
