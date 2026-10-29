import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS, REPORT_PDF } from "./MethodologyTab";
import { EXPLAINERS } from "../utils/explainers";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { unavailableMeasures } from "./methodology/measures";
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
  it("offers our PDF report, a file in public/, and links each explainer", () => {
    renderTab();
    const download = screen.getByRole("link", { name: /^Download our report \(PDF\)/ });
    expect(download).toHaveAttribute("href", `/${REPORT_PDF.file}`);
    expect(download).toHaveAttribute("download");
    const pdf = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "..", "public", REPORT_PDF.file));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    for (const { slug, title } of EXPLAINERS) {
      expect(screen.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveAttribute(
        "href",
        `https://www.policyengine.org/uk/research/${slug}`,
      );
    }
  });

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
    // Policies cards, so Methodology names a measure only where its method
    // differs (the costing bands, the poverty income)
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

  it("says why some Budget policies are not modelled and links to their list on Policies, listing none itself", () => {
    // Each fact once: the list and each reason live at the foot of Policies
    const onShowTab = vi.fn();
    renderTab(onShowTab);
    const card = screen.getByRole("button", { name: "Not modelled" }).closest(".method-topic");
    expect(card.querySelectorAll("li")).toHaveLength(0);
    expect(card).toHaveTextContent("cannot be costed household by household");
    const link = within(card).getByRole("link", { name: "Budget policies we do not model", hidden: true });
    expect(link).toHaveAttribute("href", "?tab=policies#budget-measures-not-modelled");
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    expect(card.textContent).not.toMatch(/£|\d+(\.\d+)?%/);
  });

  it("compares with the Budget's post-behavioural costings, with the wider band where they include behaviour", () => {
    const { container } = renderTab();
    const finances = document.getElementById(METHOD_ANCHORS.publicFinances);
    expect(finances).toHaveTextContent("Budget 2026 publishes one costing per measure, after behavioural responses (Table 6.1");
    expect(finances).toHaveTextContent("larger of 25% of the official one and £50m");
    expect(finances).toHaveTextContent("larger of 10% and £50m");
    expect(finances).not.toHaveTextContent(/static costing, like ours|Choose Post-behavioural/);
    expect(within(finances).getByRole("link", { name: "business fuel use", hidden: true })).toHaveAttribute("href", "#method-business-fuel");
    expect(container.querySelector("#method-business-fuel")).not.toBeNull();
  });

  it("leaves the energy payment out of poverty, and calls the local-area file uncertified", () => {
    const { container } = renderTab();
    expect(container.textContent).toContain(
      "The poverty figures leave out the £100 energy payment to households, as policyengine-uk treats the 2022 council tax rebate.",
    );
    expect(container.textContent).not.toContain("certified together");
    expect(container.textContent).toContain("which that certificate does not cover");
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

  it("says under Data, not the household scatter, what the checks on public files do, with no named reviewer while sign-off is off", () => {
    const { container } = renderTab();
    const data = container.querySelector(`#${METHOD_SECTIONS.data}`);
    const card = within(data).getByRole("button", { name: "Published files" }).closest(".method-topic");
    expect(card).toHaveTextContent("Automated checks run on every public data file before it is published");
    expect(card).toHaveTextContent("no named reviewer signs each file off");
    expect(card).toHaveTextContent("household, benefit unit or person ids or weights");
    expect(card).toHaveTextContent("must match the digest its run's receipt records");
    expect(card).toHaveTextContent("under the floor of survey households");
    // #333: sign-off is off (sign_off.REQUIRED, #308), so no pending window
    expect(card).not.toHaveTextContent("pending");
    expect(card).not.toHaveTextContent("listed with a named reviewer");
    const scatter = document.getElementById(METHOD_ANCHORS.scatter);
    expect(scatter).not.toHaveTextContent("Sign-off");
    expect(scatter).not.toHaveTextContent("Automated checks run");
    expect(container).not.toHaveTextContent("signs off every public data file before it is published");
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
    // The age sentence says what is withheld, as the deciles' does
    expect(text).toContain("When an age band or single year of age rests on one or two survey households, it is not published: a single year takes the other single years of its band with it, and a band takes every row but all ages.");
    expect(text).not.toContain("would give it back");
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
