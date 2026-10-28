import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { UNMODELLED_SUBTITLE, UNMODELLED_TITLE, formatMillions } from "./UnmodelledMeasures";
import { WHY_NOT_MODELLED } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  UNMODELLED_MEASURES,
} from "../../utils/unmodelledMeasures";


// Every string an entry shows, for the wording checks
const entryText = (measure) =>
  [
    measure.name,
    measure.starts,
    measure.changes,
    measure.reaches,
    measure.household,
    measure.noCosting,
    measure.notModelled,
    ...measure.costings.map((costing) => costing.note),
    ...measure.sources.map((source) => source.label),
  ]
    .filter(Boolean)
    .join(" ");

describe("the unmodelled measures (unmodelledMeasures.js)", () => {
  it("give every measure each part of an entry, under a unique id", () => {
    for (const measure of UNMODELLED_MEASURES) {
      for (const field of ["id", "name", "starts", "changes", "reaches", "household", "notModelled"]) {
        expect(measure[field], `${measure.id} ${field}`).toBeTruthy();
      }
      expect(measure.sources.length, measure.id).toBeGreaterThan(0);
      // A Table 6.1 row, or a line saying why there is none
      expect(measure.costings.length > 0 || Boolean(measure.noCosting), measure.id).toBe(true);
    }
    const ids = UNMODELLED_MEASURES.map((measure) => measure.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("give each Table 6.1 row its number and a figure for each of the table's six years", () => {
    expect(COSTING_YEARS).toEqual(["2026-27", "2027-28", "2028-29", "2029-30", "2030-31", "2031-32"]);
    for (const measure of UNMODELLED_MEASURES) {
      for (const { row, values } of measure.costings) {
        expect(Number.isInteger(row) && row > 0, measure.id).toBe(true);
        expect(values, measure.id).toHaveLength(COSTING_YEARS.length);
        for (const value of values) expect(Number.isFinite(value), measure.id).toBe(true);
      }
    }
  });

  it("cite the Budget document by paragraph, over https", () => {
    expect(BUDGET_DOCUMENT.url).toBe("https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html");
    for (const measure of UNMODELLED_MEASURES) {
      const budget = measure.sources.find((source) => source.href === BUDGET_DOCUMENT.url);
      expect(budget, measure.id).toBeDefined();
      expect(budget.label, measure.id).toMatch(/^Budget 2026, paragraphs? \d+\.\d+/);
      for (const source of measure.sources) expect(source.href, source.label).toMatch(/^https:\/\//);
    }
  });

  it("carry no PolicyEngine figure and no evaluative wording", () => {
    const text = UNMODELLED_MEASURES.map(entryText).join(" ");
    expect(text).not.toMatch(/PolicyEngine|our estimate|we estimate/i);
    expect(text).not.toMatch(
      /\b(winners?|losers?|hits?|hard-hit|boosts?|boosted|generous|unfair|fairer|significant(ly)?|huge|massive|slashe[sd]|welcome)\b/i,
    );
  });

  it("leave out the measures the dashboard models", () => {
    const names = UNMODELLED_MEASURES.map((measure) => measure.name).join(" | ");
    expect(names).not.toMatch(
      /fuel duty|VAT|Household Energy Payment|Pension Tax Allowance|Carer's Allowance|Trading Allowance|property income|savings income/i,
    );
  });

  it("call the State Pension change by the Budget's own name", () => {
    const names = UNMODELLED_MEASURES.map((measure) => measure.name).join(" | ");
    expect(names).toMatch(/Adjusted Triple Lock/);
    expect(names).not.toMatch(/double lock/i);
  });
});

describe("formatMillions", () => {
  it("prints Table 6.1's figures with a sign, a true minus and thousands separators", () => {
    expect(formatMillions(-2625)).toBe("−2,625");
    expect(formatMillions(135)).toBe("+135");
    expect(formatMillions(0)).toBe("0");
  });
});

const toggle = () => screen.getByRole("button", { name: UNMODELLED_TITLE });
const open = () => fireEvent.click(toggle());

describe("UnmodelledMeasures", () => {
  const cards = () => [...document.querySelectorAll(".policy-cards > .policy-card")];

  it("is a section like Policies we model: its heading (a native button) and subtitle, the cards closed", () => {
    render(<UnmodelledMeasures />);
    const section = screen.getByRole("region", { name: UNMODELLED_TITLE });
    const heading = within(section).getByRole("heading", { level: 2, name: UNMODELLED_TITLE });
    expect(heading.closest(".section-heading")).toBeTruthy();
    expect(section).toHaveTextContent(UNMODELLED_SUBTITLE);
    const button = toggle();
    expect(heading).toContainElement(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(cards()).toHaveLength(0);
  });

  it("opens and closes its cards from the heading", () => {
    render(<UnmodelledMeasures />);
    open();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const content = document.getElementById(toggle().getAttribute("aria-controls"));
    expect(content).not.toHaveAttribute("hidden");
    expect(cards()).toHaveLength(UNMODELLED_MEASURES.length);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(cards()).toHaveLength(0);
  });

  it("lists every measure in order as a Policies card, with each part labelled", () => {
    render(<UnmodelledMeasures />);
    open();
    const items = cards();
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(
      UNMODELLED_MEASURES.map((measure) => measure.name),
    );
    items.forEach((item, index) => {
      const measure = UNMODELLED_MEASURES[index];
      expect(item.id).toBe(`unmodelled-${measure.id}`);
      expect(item.querySelector(".policy-card-start")).toHaveTextContent(measure.starts);
      expect(item.querySelector(".policy-card-affects")).toHaveTextContent(measure.reaches);
      for (const term of ["What changes", "For a household", WHY_NOT_MODELLED]) {
        expect(within(item).getByText(term), `${measure.id} ${term}`).toBeInTheDocument();
      }
      expect(within(item).getByRole("region", { name: `Treasury costing: ${measure.name}` })).toBeInTheDocument();
      expect(item).toHaveTextContent(measure.changes);
      expect(item).toHaveTextContent(measure.household);
      expect(item).toHaveTextContent(measure.notModelled);
      // A model card's parts are not there
      expect(within(item).queryByRole("button", { name: /See its effect/ })).toBeNull();
      expect(within(item).queryByRole("button", { name: "About this result" })).toBeNull();
      // Its Table 6.1 rows on the card itself, so no separate Costing link, and no timeline
      expect(item.querySelector(".policy-card-costing"), measure.id).toBeNull();
      expect(item.querySelector(".ptl"), measure.id).toBeNull();
      // At a glance, What changes, For a household, Why we don't model it, Treasury costing, Sources, in that order
      const order = [".policy-card-when", ".pchg", ".policy-card-example", ".policy-card-why", ".umm-costing-section", ".policy-card-sources"]
        .map((selector) => item.querySelector(selector));
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${measure.id} ${i}`).toBeTruthy();
      }
    });
  });

  it("draws What changes' values only where the entry gives them, and a plot only for a change over time", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const item of cards()) {
      const id = item.id.replace(/^unmodelled-/, "");
      const parameters = UNMODELLED_CARDS[id]?.parameters;
      expect(item.querySelectorAll(".pchg-tile").length, id).toBe(parameters ? 2 : 0);
      expect(Boolean(item.querySelector(".pchg-svg")), id).toBe(parameters?.display === "switch");
    }
    const wage = document.getElementById("unmodelled-national-living-wage");
    expect(wage.querySelector(".pchg-tile.is-before")).toHaveTextContent("£12.71");
    expect(wage.querySelector(".pchg-tile.is-after")).toHaveTextContent("£13.21+£0.50");
  });

  it("shows a measure's Table 6.1 rows by year, in £ million, on the card", () => {
    render(<UnmodelledMeasures />);
    open();
    const measure = UNMODELLED_MEASURES.find(({ id }) => id === "first-time-buyer-isa");
    const item = document.getElementById(`unmodelled-${measure.id}`);
    const table = within(item).getByRole("table", { name: "£ million, Budget 2026 Table 6.1; positive = gain to the Exchequer" });
    for (const year of COSTING_YEARS) expect(within(table).getByRole("columnheader", { name: year })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual(
      measure.costings.map(({ values }) => values.map(formatMillions)),
    );
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["38", "39"]);
  });

  it("says in one muted line where Table 6.1 has no row", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const measure of UNMODELLED_MEASURES.filter(({ costings }) => !costings.length)) {
      const item = document.getElementById(`unmodelled-${measure.id}`);
        expect(within(item).queryByRole("table")).toBeNull();
      expect(item.querySelector(".umm-no-costing")).toHaveTextContent(/^No Table 6\.1 row$/);
    }
  });

  it("links every source in a new tab, saying so to screen readers", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const measure of UNMODELLED_MEASURES) {
      const item = document.getElementById(`unmodelled-${measure.id}`);
      for (const source of measure.sources) {
        const label = source.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const link = within(item).getByRole("link", { name: new RegExp(`^${label}\\s*\\(opens in a new tab\\)$`) });
        expect(link).toHaveAttribute("href", source.href);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
  });

  it("links PolicyEngine's own work where it models a measure, after the reason this dashboard does not", () => {
    render(<UnmodelledMeasures />);
    open();
    const linked = UNMODELLED_MEASURES.filter(({ seeAlso }) => seeAlso);
    expect(linked.map(({ id }) => id)).toEqual(["adjusted-triple-lock"]);
    for (const { id, seeAlso, notModelled } of linked) {
      expect(seeAlso.href).toMatch(/^https:\/\/www\.policyengine\.org\//);
      // A pointer, never a figure of our own
      expect(`${seeAlso.before}${seeAlso.label}${seeAlso.after}`).not.toMatch(/£|%|\bbn\b|billion|million/);
      const card = document.getElementById(`unmodelled-${id}`);
      expect(card).toHaveTextContent(notModelled);
      const label = seeAlso.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const link = within(card).getByRole("link", { name: new RegExp(`^${label}\\s*\\(opens in a new tab\\)$`) });
      expect(link).toHaveAttribute("href", seeAlso.href);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("links PolicyEngine's post on a measure as \"Our explainer\" in its card's footer, in a new tab", () => {
    render(<UnmodelledMeasures />);
    open();
    const explained = UNMODELLED_MEASURES.filter(({ explainer }) => explainer);
    expect(explained.map(({ id }) => id)).toEqual(["adjusted-triple-lock"]);
    for (const measure of UNMODELLED_MEASURES) {
      const card = document.getElementById(`unmodelled-${measure.id}`);
      const links = within(card).queryAllByRole("link", { name: /^Our explainer/ });
      if (!measure.explainer) {
        expect(links, measure.id).toHaveLength(0);
        continue;
      }
      const { label, href } = measure.explainer;
      expect(href).toMatch(/^https:\/\/www\.policyengine\.org\/uk\/research\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(label.trim().length, measure.id).toBeGreaterThan(0);
      expect(links, measure.id).toHaveLength(1);
      const [link] = links;
      expect(link).toHaveAccessibleName(new RegExp(`^Our explainer: ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(opens in a new tab\\)$`));
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // In the footer's actions, where the modelled cards have it
      expect(link.closest(".policy-card-actions")).not.toBeNull();
    }
  });

  it("shows nothing for an empty list", () => {
    const { container } = render(<UnmodelledMeasures measures={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the section's text", () => {
  it("has only its heading and subtitle above the cards: no intro, no closing note", () => {
    render(<UnmodelledMeasures />);
    const section = screen.getByRole("region", { name: UNMODELLED_TITLE });
    expect(section.querySelector(".umm-intro")).toBeNull();
    expect(section.querySelector(".umm-note")).toBeNull();
  });

  it("keeps each card's What changes, For a household and Why we don't model it to 30 words, and who it affects to 15", () => {
    for (const measure of UNMODELLED_MEASURES) {
      expect(measure.reaches.split(/\s+/).length, `${measure.id} reaches`).toBeLessThanOrEqual(15);
      for (const field of ["changes", "household", "notModelled"]) {
        expect(measure[field].split(/\s+/).length, `${measure.id} ${field}`).toBeLessThanOrEqual(30);
      }
    }
  });
});
