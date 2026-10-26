import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MethodologyTab, { METHOD_CONTENTS, METHOD_SECTIONS } from "./MethodologyTab";
import { measureModelling, measureSummary, modellingFacts, MODELLING_NOTE, NOT_MODELLED, remainingPoints, sentences, unavailableMeasures, usualFirstYear } from "./methodology/measures";
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

  const descriptionsCard = () => screen.getByRole("heading", { name: "Published measure descriptions" }).closest(".method-card");

  it("shows each measure as a row grouped as the Policies tab groups them", () => {
    renderTab();
    const card = descriptionsCard();
    expect(within(card).queryByRole("table")).toBeNull();
    const toggles = within(card).getAllByRole("button", { expanded: false }).filter((button) => button.classList.contains("mm-toggle"));
    expect(toggles).toHaveLength(MEASURE_MODELLING.length);
    for (const measure of MEASURE_MODELLING) {
      // Every measure is one the charts colour, by the same name
      expect(POLICY_COLORS[measure.seriesKey]).toBeDefined();
      const toggle = within(card).getByRole("button", { name: measure.name });
      const group = toggle.closest(".mm-group");
      expect(group).toHaveClass(`is-${measure.direction}`);
      expect(toggle.closest(".mm-item")).toHaveTextContent(measure.summary);
    }
    // The group headings are the Policies tab's
    const headings = within(card).getAllByRole("heading", { level: 4 }).map((heading) => heading.firstChild.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Raises revenue", "Costs revenue"]));
  });

  it("opens a row to the rest of its published description, with links to its card and effect", () => {
    const onShowTab = vi.fn();
    const onShowEffect = vi.fn();
    render(<MeasureCatalogueProvider catalogue={catalogue}><MethodologyTab onShowTab={onShowTab} onShowEffect={onShowEffect} /></MeasureCatalogueProvider>);
    const [measure] = MEASURE_MODELLING;
    const toggle = within(descriptionsCard()).getByRole("button", { name: measure.name });
    const body = document.getElementById(toggle.getAttribute("aria-controls"));
    expect(body).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).toBeVisible();
    // Each sentence once: the summary line is not repeated inside
    expect(body).not.toHaveTextContent(measure.summary);
    const link = within(body).getByRole("link", { name: "What it does" });
    expect(link).toHaveAttribute("href", `?tab=policies#policy-card-${measure.id}`);
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    fireEvent.click(within(body).getByRole("button", { name: `See the effect of ${measure.name} on Population impact` }));
    expect(onShowEffect).toHaveBeenLastCalledWith(measure.id);
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

  it("labels the first year with results only for a measure that differs from the rest", () => {
    // Review of 62febdd, finding 6: results cover every scored year, so a
    // measure that starts in 2031-32 can have results from 2026-27. A label
    // the same on every row says nothing, so only a different year shows.
    renderTab();
    expect(descriptionsCard()).not.toHaveTextContent("Results from");
    const later = { ...catalogue, displayable: catalogue.displayable.map((measure, index) => (index === 0 ? { ...measure, unsupported_years: [2026] } : measure)) };
    const twin = { ...later, displayable: [...later.displayable, { ...catalogue.displayable[1], id: "twin", name: "Twin", seriesKey: "measure:twin" }] };
    cleanup();
    render(<MeasureCatalogueProvider catalogue={twin}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    const row = within(descriptionsCard()).getByRole("button", { name: later.displayable[0].name }).closest(".mm-item");
    expect(row).toHaveTextContent(`Results from ${fiscalYearTick(2027)}`);
    expect(descriptionsCard().textContent.match(/Results from/g)).toHaveLength(1);
    // The first supported year: an unsupported year has no results
    const partly = { displayable: [{ description: "From 6 April 2031", years: [2028, 2026, 2027], unsupported_years: [2026] }] };
    expect(measureModelling(partly)[0].from).toBe(2027);
    expect(usualFirstYear([{ from: 2026 }, { from: 2027 }, { from: 2026 }])).toBe(2026);
  });

  it("shows the one modelling note, as bullets, in its measure's row", () => {
    // #113's scope note: independent text, not part of the receipt
    const noted = { ...catalogue, displayable: catalogue.displayable.map((measure, index) => (index === 0 ? { ...measure, id: MODELLING_NOTE.id } : measure)) };
    render(<MeasureCatalogueProvider catalogue={noted}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    const notes = document.querySelectorAll(".mm-note");
    expect(notes).toHaveLength(1);
    const row = within(descriptionsCard()).getByRole("button", { name: noted.displayable[0].name }).closest(".mm-item");
    expect(row).toContainElement(notes[0]);
    expect(row).toHaveTextContent(noted.displayable[0].description);
    expect(within(notes[0]).getAllByRole("listitem", { hidden: true }).map((item) => item.textContent)).toEqual(sentences(MODELLING_NOTE.note));
  });

  it("shows no modelling note while its measure is not displayed", () => {
    renderTab();
    expect(document.querySelectorAll(".mm-note")).toHaveLength(0);
    const other = { description: "Published.", years: [2027], unsupported_years: [] };
    expect(measureModelling({ displayable: [{ ...other, id: "another_measure" }] })[0].note).toBeNull();
    expect(measureModelling({ displayable: [{ ...other, id: MODELLING_NOTE.id }] })[0].note).toBe(MODELLING_NOTE.note);
  });

  it("keeps the modelling note neutral: no outside organisation, and only a government figure", () => {
    // Dashboard text names no think tank or outside analyst and compares
    // with no outside estimate. A figure of ours needs a receipt (review of
    // 3d52cff, finding 3), so the note's one figure is HMRC's, dated.
    expect(MODELLING_NOTE.note).not.toMatch(/Resolution Foundation|Tax Policy Associates|Institute|Foundation|Associates|think tank/i);
    const priced = sentences(MODELLING_NOTE.note).filter((sentence) => sentence.includes("£"));
    expect(priced.length).toBeGreaterThan(0);
    for (const sentence of priced) {
      expect(sentence).toMatch(/\bHMRC\b/);
      expect(sentence).toMatch(/2025-26/);
    }
    expect(MODELLING_NOTE.note).not.toMatch(/\bthe model\b|PolicyEngine/i);
  });

  it("reads a summary and modelling chips from the published wording alone", () => {
    const text = "Candidate measure. VAT falls to 15%, fully passed through to pump prices; spending on fuel is held fixed. Day-weighted to fiscal years. Applied in Great Britain, so households in Scotland are approximate. The data identify no apprentices, so the cost includes them. Gains are imputed, so the base is likely 1.5 to 1.7 times too high.";
    expect(measureSummary(text)).toBe("VAT falls to 15%, fully passed through to pump prices; spending on fuel is held fixed.");
    expect(measureSummary("Drill 5 mock measure. It does one thing.")).toBe("It does one thing.");
    const { facts, limits } = modellingFacts(text);
    expect(facts).toEqual(["Day-weighted", "Spending held fixed", "Full pass-through", "Great Britain only", "Imputed data"]);
    expect(limits.map((limit) => limit.label)).toEqual(["Approximate for Scotland", "Data limit: no apprentices flagged", "Known limitation"]);
    expect(limits[2].sentence).toBe("Gains are imputed, so the base is likely 1.5 to 1.7 times too high.");
    expect(modellingFacts("Wages are held fixed.").facts).toEqual(["Wages held fixed"]);
    expect(modellingFacts("A plain measure.")).toEqual({ facts: [], limits: [] });
  });

  it("says each published sentence once: an opened row leaves out the label, the summary and chip sentences", () => {
    const text = "Candidate measure. Employers pay no NI for under-25s. Wages are held fixed, so it changes revenue, not household incomes. The data identify no apprentices, so the cost includes them. Costs follow the Treasury's 2027-28 rates and are rounded to the nearest £10 million for every year shown here.";
    const summary = measureSummary(text);
    const { limits } = modellingFacts(text);
    expect(remainingPoints(text, summary, limits)).toEqual([
      "Costs follow the Treasury's 2027-28 rates and are rounded to the nearest £10 million for every year shown here.",
    ]);
    // A longer sentence a fact chip comes from says more than the chip, so it stays
    const long = "Day-weighted to fiscal years, with each rate applied from the day it takes effect to the day the next one does.";
    expect(remainingPoints(`A label here. First sentence of it. ${long}`, "First sentence of it.", [])).toEqual([long]);
    expect(remainingPoints("Only one sentence here.", "Only one sentence here.", [])).toEqual([]);
  });

  it("keeps a stated limitation in view: its chip opens to the sentence without opening the row", () => {
    const caveat = "The base is likely 1.5 to 1.7 times too high.";
    const limited = { ...catalogue, displayable: catalogue.displayable.map((measure, index) => (index === 0 ? { ...measure, description: `${measure.description} ${caveat}` } : measure)) };
    render(<MeasureCatalogueProvider catalogue={limited}><MethodologyTab onShowTab={vi.fn()} /></MeasureCatalogueProvider>);
    const row = within(descriptionsCard()).getByRole("button", { name: limited.displayable[0].name }).closest(".mm-item");
    const chip = within(row).getByRole("button", { name: "Known limitation" });
    const sentence = document.getElementById(chip.getAttribute("aria-controls"));
    expect(sentence).not.toBeVisible();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(sentence).toBeVisible();
    expect(sentence).toHaveTextContent(caveat);
    expect(row.querySelector(".mm-body")).not.toBeVisible();
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
    const notes = screen.getByRole("link", { name: "Policies tab" });
    expect(notes).toHaveAttribute("href", "?tab=policies");
    fireEvent.click(notes);
    expect(onShowTab).toHaveBeenLastCalledWith("policies");
    const living = document.getElementById(METHOD_SECTIONS.living);
    // The current-law cards on the OBR forecast's sub-tabs
    for (const [name, sub] of [["Living standards", "living"], ["Poverty", "poverty"], ["Forecast changes", "forecast"]]) {
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
