import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { COSTING_CAPTION, UNMODELLED_SUBTITLE, UNMODELLED_TITLE, formatMillions, groupsOf } from "./UnmodelledMeasures";
import { WHY_NOT_MODELLED } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  UNMODELLED_MEASURES,
  UNMODELLED_REASONS,
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
  const cards = () => [...document.querySelectorAll(".umm-list > .policy-card")];

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

  it("lists every measure in order as a Policies card, in the modelled cards' style", () => {
    render(<UnmodelledMeasures />);
    open();
    const items = cards();
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(
      UNMODELLED_MEASURES.map((measure) => measure.name),
    );
    items.forEach((item, index) => {
      const measure = UNMODELLED_MEASURES[index];
      expect(item.id).toBe(`unmodelled-${measure.id}`);
      expect(item.querySelector(".policy-card-type"), measure.id).toBeTruthy();
      // What changes as the summary line
      expect(item.querySelector(".policy-card-summary")).toHaveTextContent(measure.changes);
      // At a glance: Starts, Ends, Affects
      expect(item.querySelector(".policy-card-glance-title")).toHaveTextContent("At a glance");
      expect(item.querySelector(".policy-card-start")).toHaveTextContent(measure.starts);
      expect(item.querySelector(".policy-card-affects")).toHaveTextContent(measure.reaches);
      expect(within(item).getByText("For a household")).toBeInTheDocument();
      expect(item).toHaveTextContent(measure.household);
      // No "Why we don't model it": the section title says so
      expect(within(item).queryByText(WHY_NOT_MODELLED)).toBeNull();
      expect(item).not.toHaveTextContent(measure.notModelled);
      // Treasury costing: one disclosure, closed, last in the footer, holding the strip and the sources
      const costing = within(item).getByRole("button", { name: "Treasury costing" });
      expect(costing).toHaveAttribute("aria-expanded", "false");
      expect(item.querySelector(".umm-costing-section")).toBeNull();
      fireEvent.click(costing);
      expect(costing).toHaveAttribute("aria-expanded", "true");
      expect(within(item).getByRole("region", { name: `Treasury costing: ${measure.name}` })).toBeInTheDocument();
      for (const source of measure.sources) expect(item).toHaveTextContent(source.label);
      expect(item.querySelector("details")).toBeNull();
      // Summary, At a glance, What changes, For a household, costing: in that order
      const order = [".policy-card-summary", ".policy-card-when", ".pchg", ".policy-card-example", ".umm-costing-disclosure"]
        .map((selector) => item.querySelector(selector))
        .filter(Boolean);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${measure.id} ${i}`).toBeTruthy();
      }
      // Compact: no chart, timeline, effect button or reason block
      expect(item.querySelector(".pchg-svg, .ptl, .policy-card-effect, .policy-card-why"), measure.id).toBeNull();
    });
  });

  it("draws no Current law and With the policy tiles on any card (Vahid, 28 Oct)", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const item of cards()) expect(item.querySelector(".pchg-tile, .pchg-ba"), item.id).toBeNull();
  });

  it("shows a measure's Table 6.1 rows by year, in £ million, on the card", () => {
    render(<UnmodelledMeasures />);
    open();
    const measure = UNMODELLED_MEASURES.find(({ id }) => id === "first-time-buyer-isa");
    const item = document.getElementById(`unmodelled-${measure.id}`);
    fireEvent.click(within(item).getByRole("button", { name: "Treasury costing" }));
    const table = within(item).getByRole("table", { name: COSTING_CAPTION });
    for (const year of COSTING_YEARS) expect(within(table).getByRole("columnheader", { name: year })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual(
      measure.costings.map(({ values }) => values.map(formatMillions)),
    );
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent.trim())).toEqual(["Row 38", "Row 39"]);
  });

  it("says in one muted line where Table 6.1 has no row", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const measure of UNMODELLED_MEASURES.filter(({ costings }) => !costings.length)) {
      const item = document.getElementById(`unmodelled-${measure.id}`);
      expect(within(item).getByRole("button", { name: "Treasury costing" })).toHaveTextContent("No Table 6.1 row");
      fireEvent.click(within(item).getByRole("button", { name: "Treasury costing" }));
      expect(within(item).queryByRole("table")).toBeNull();
      expect(item.querySelector(".umm-no-costing")).toHaveTextContent(/^No Table 6\.1 row$/);
    }
  });

  it("links every source in a new tab, saying so to screen readers", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const measure of UNMODELLED_MEASURES) {
      const item = document.getElementById(`unmodelled-${measure.id}`);
      fireEvent.click(within(item).getByRole("button", { name: "Treasury costing" }));
      for (const source of measure.sources) {
        const label = source.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const link = within(item).getByRole("link", { name: new RegExp(`^${label}\\s*\\(opens in a new tab\\)$`) });
        expect(link).toHaveAttribute("href", source.href);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
  });

  it("links PolicyEngine's own work where it models a measure, with the card's sources", () => {
    render(<UnmodelledMeasures />);
    open();
    const linked = UNMODELLED_MEASURES.filter(({ seeAlso }) => seeAlso);
    expect(linked.map(({ id }) => id)).toEqual(["adjusted-triple-lock"]);
    for (const { id, seeAlso } of linked) {
      expect(seeAlso.href).toMatch(/^https:\/\/www\.policyengine\.org\//);
      // A pointer, never a figure of our own
      expect(`${seeAlso.before}${seeAlso.label}${seeAlso.after}`).not.toMatch(/£|%|\bbn\b|billion|million/);
      const card = document.getElementById(`unmodelled-${id}`);
      fireEvent.click(within(card).getByRole("button", { name: "Treasury costing" }));
      const label = seeAlso.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const link = within(card).getByRole("link", { name: new RegExp(`^${label}\\s*\\(opens in a new tab\\)$`) });
      expect(link).toHaveAttribute("href", seeAlso.href);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("orders the cards by the data's own order field, group by group, pairing cards of a like shape", () => {
    expect(UNMODELLED_MEASURES.map((m) => m.order)).toEqual(UNMODELLED_MEASURES.map((_, index) => index + 1));
    // The data's order is the groups' order, so the list reads as shown
    expect(groupsOf(UNMODELLED_MEASURES).flatMap(({ items }) => items.map((m) => m.id))).toEqual(UNMODELLED_MEASURES.map((m) => m.id));
    render(<UnmodelledMeasures />);
    open();
    expect(cards().map((card) => card.id.replace(/^unmodelled-/, ""))).toEqual(UNMODELLED_MEASURES.map((m) => m.id));
    // Within each group, each row of two has the same shape: one pair of
    // tiles, two, or none
    const shape = (card) => card.querySelectorAll(".pchg-ba").length;
    const mismatched = [];
    for (const list of document.querySelectorAll(".umm-list")) {
      const items = [...list.querySelectorAll(":scope > .policy-card")];
      for (let i = 0; i + 1 < items.length; i += 2) if (shape(items[i]) !== shape(items[i + 1])) mismatched.push(items[i].id);
    }
    expect(mismatched).toEqual([]);
  });

  // #297: by why we do not model each one, and whether we will
  it("shows the cards as one list, with no group titles (Vahid, 29 Oct)", () => {
    render(<UnmodelledMeasures />);
    open();
    expect(document.querySelectorAll(".umm-group-title")).toHaveLength(0);
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.queryByText("Modelled separately")).toBeNull();
    expect(document.querySelectorAll("ul.umm-list")).toHaveLength(1);
    const cards = [...document.querySelectorAll(".umm-list .policy-card")].map((card) => card.id.replace(/^unmodelled-/, ""));
    expect(cards).toHaveLength(UNMODELLED_MEASURES.length);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("puts a measure with no known reason last, unlabelled, and leaves out an empty group", () => {
    const [first, second] = UNMODELLED_MEASURES;
    const groups = groupsOf([{ ...second, reason: "unknown" }, first]);
    expect(groups.map(({ id, label }) => [id, label])).toEqual([
      [first.reason, UNMODELLED_REASONS.find(({ id }) => id === first.reason).label],
      ["other", null],
    ]);
    expect(groups[1].items.map((m) => m.id)).toEqual([second.id]);
  });

  it("keeps names short: 10 words at most", () => {
    for (const measure of UNMODELLED_MEASURES) expect(measure.name.split(/\s+/).length, measure.id).toBeLessThanOrEqual(10);
  });

  it("renders only short text on every card: summary and For a household in 20 words, who it affects in 12, nothing over 30", () => {
    render(<UnmodelledMeasures />);
    open();
    const words = (node) => node.textContent.trim().split(/\s+/).length;
    for (const item of cards()) {
      expect(words(item.querySelector(".policy-card-summary")), item.id).toBeLessThanOrEqual(20);
      expect(words(item.querySelector(".policy-card-affects dd")), item.id).toBeLessThanOrEqual(12);
      expect(words(item.querySelector(".policy-card-example-text")), item.id).toBeLessThanOrEqual(20);
      // What changes is said once: the summary line, then only the values
      expect(item.querySelector(".pchg-lead")).toBeNull();
      for (const block of item.querySelectorAll("p, dd, li")) {
        expect(words(block), `${item.id}: ${block.textContent.slice(0, 60)}`).toBeLessThanOrEqual(30);
      }
    }
  });

  it("marks the savings measure held back from this release in one muted line", () => {
    render(<UnmodelledMeasures />);
    open();
    const held = UNMODELLED_MEASURES.filter(({ heldBack }) => heldBack);
    expect(held.map(({ id }) => id)).toEqual(["savings-income-tax"]);
    const card = document.getElementById("unmodelled-savings-income-tax");
    // Our interest included ISA interest: calibrated on a different basis, not missing it (#297)
    expect(card.querySelector(".umm-held-back")).toHaveTextContent(/^Held back: we calibrated savings interest to HMRC's figures on a different basis/);
    for (const text of [held[0].heldBack, held[0].notModelled]) expect(text).not.toMatch(/miss(?:es)? ISA interest/);
    fireEvent.click(within(card).getByRole("button", { name: "Treasury costing" }));
    expect(within(card).getByRole("table", { name: COSTING_CAPTION })).toHaveTextContent("+590");
  });

  it("keeps At a glance short and the summary one sentence, and shows every change a card names", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const item of cards()) {
      expect(item.querySelector(".policy-card-start").textContent.length, item.id).toBeLessThanOrEqual(20);
      expect(item.querySelector(".policy-card-end").textContent.length, item.id).toBeLessThanOrEqual(20);
      expect(item.querySelector(".policy-card-summary").textContent.trim(), item.id).not.toMatch(/\.\s+[A-Z]/);
    }
    // Two changes: both in the card's picture, and no table of the same values beside it
    const mileage = document.getElementById("unmodelled-mileage-rates");
    expect(within(mileage).getByRole("img").getAttribute("aria-label")).toMatch(/55p a mile for the first 10,000 business miles, made permanent; above 10,000 miles the rate rises from 25p to 35p/);
    const car = document.getElementById("unmodelled-company-car-tax");
    expect(within(car).getByRole("img").getAttribute("aria-label")).toMatch(/zero-emission cars 9% to 10%, cars emitting 1 to 50g CO2 a kilometre 19% to 20%/);
    for (const card of [mileage, car]) {
      expect(within(card).queryByRole("button", { name: "Show every change" })).toBeNull();
      expect(card.querySelector(".pchg table")).toBeNull();
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
      expect(measure.reaches.split(/\s+/).length, `${measure.id} reaches`).toBeLessThanOrEqual(12);
      for (const field of ["changes", "household"]) {
        expect(measure[field].split(/\s+/).length, `${measure.id} ${field}`).toBeLessThanOrEqual(20);
      }
      for (const field of ["notModelled"]) {
        expect(measure[field].split(/\s+/).length, `${measure.id} ${field}`).toBeLessThanOrEqual(30);
      }
    }
  });
});
