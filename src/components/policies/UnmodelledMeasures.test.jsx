import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { CERTIFIED_CAPTION, CERTIFIED_TITLE, COSTING_CAPTION, HOUSEHOLD_ONLY_WHY_LABEL, HouseholdOnlyMeasures, costingRows, UNMODELLED_TITLE, formatMillions, groupsOf, unmodelledSubtitle } from "./UnmodelledMeasures";
import { WHY_NOT_MODELLED } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  OBR_POLICY_TABLE,
  UNMODELLED_MEASURES,
  UNMODELLED_POINT_LABELS,
  UNMODELLED_REASONS,
} from "../../utils/unmodelledMeasures";
import { HOUSEHOLD_ONLY_TITLE, householdOnlyLine, splitUnmodelled } from "../../utils/measureClass";
import { NOT_COMPARABLE_SHORT, OBR_COMPARISON_BASES, OBR_DEVIATION_NOTES, OBR_DIFFERENCE_POINTS, OBR_PANEL_BASES } from "../../utils/obrDeviationNotes";

// The cards the section shows: the list without those of the policies we
// model for households only (utils/measureClass.js), which have their own
const { household: HOUSEHOLD_ONLY, none: NOT_MODELLED } = splitUnmodelled();

// Every string an entry shows, for the wording checks
const entryText = (measure) =>
  [
    measure.name,
    measure.starts,
    measure.summary,
    ...(measure.points ?? []).map((point) => point.text),
    measure.noCosting,
    ...measure.costings.map((costing) => costing.note),
    ...measure.sources.map((source) => source.label),
  ]
    .filter(Boolean)
    .join(" ");

describe("the unmodelled measures (unmodelledMeasures.js)", () => {
  it("give every measure each part of an entry, under a unique id", () => {
    for (const measure of UNMODELLED_MEASURES) {
      for (const field of ["id", "name", "starts", "summary"]) {
        expect(measure[field], `${measure.id} ${field}`).toBeTruthy();
      }
      // What changes, who it reaches and why we leave it out, as three labelled points
      expect(measure.points.map((point) => point.label), measure.id).toEqual(UNMODELLED_POINT_LABELS);
      for (const point of measure.points) expect(point.text, `${measure.id} ${point.label}`).toBeTruthy();
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
    const button = toggle();
    expect(heading).toContainElement(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(cards()).toHaveLength(0);
  });

  it("says, while closed, how many policies it holds, as the button's description; open, no line (Vahid, 29 Oct)", () => {
    render(<UnmodelledMeasures />);
    // Its own cards only: the household-only ones have their section
    const line = unmodelledSubtitle(NOT_MODELLED.length);
    expect(line).toBe(`${NOT_MODELLED.length} policies · what each changes and why we leave it out`);
    expect(document.querySelector(".umm-subtitle")).toHaveTextContent(line);
    expect(toggle()).toHaveAccessibleDescription(line);
    open();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".umm-subtitle")).toBeNull();
    expect(toggle()).not.toHaveAttribute("aria-describedby");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAccessibleDescription(line);
  });

  it("counts the policies it is given", () => {
    render(<UnmodelledMeasures measures={NOT_MODELLED.slice(0, 1)} />);
    expect(toggle()).toHaveAccessibleDescription("1 policy · what each changes and why we leave it out");
  });

  it("opens from its line too", () => {
    render(<UnmodelledMeasures />);
    fireEvent.click(document.querySelector(".umm-subtitle"));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens and closes its cards from the heading", () => {
    render(<UnmodelledMeasures />);
    open();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const content = document.getElementById(toggle().getAttribute("aria-controls"));
    expect(content).not.toHaveAttribute("hidden");
    expect(cards()).toHaveLength(NOT_MODELLED.length);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(cards()).toHaveLength(0);
  });

  it("lists every measure in order as a Policies card, in the modelled cards' style", () => {
    render(<UnmodelledMeasures />);
    open();
    const items = cards();
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(
      NOT_MODELLED.map((measure) => measure.name),
    );
    items.forEach((item, index) => {
      const measure = NOT_MODELLED[index];
      expect(item.id).toBe(`unmodelled-${measure.id}`);
      expect(item.querySelector(".policy-card-type"), measure.id).toBeTruthy();
      // The change as the summary line
      expect(item.querySelector(".policy-card-summary")).toHaveTextContent(measure.summary);
      // At a glance: Starts and Ends only; who it reaches is a point (each fact once)
      expect(item.querySelector(".policy-card-glance-title")).toHaveTextContent("At a glance");
      expect(item.querySelector(".policy-card-start")).toHaveTextContent(measure.starts);
      expect(item.querySelector(".policy-card-affects")).toBeNull();
      // The three points, labelled, as a real list; no For a household box
      const points = item.querySelector("ul.policy-card-points.is-labelled");
      expect([...points.querySelectorAll(":scope > li > .policy-card-point-label")].map((label) => label.textContent)).toEqual(UNMODELLED_POINT_LABELS);
      for (const point of measure.points) expect(points).toHaveTextContent(point.text);
      expect(item.querySelector(".policy-card-example")).toBeNull();
      // No "Why we don't model it" block: the reason is a point
      expect(within(item).queryByText(WHY_NOT_MODELLED)).toBeNull();
      // Treasury costing: one disclosure, closed, last in the footer, holding the strip and the sources
      const costing = within(item).getByRole("button", { name: "Treasury costing" });
      expect(costing).toHaveAttribute("aria-expanded", "false");
      expect(item.querySelector(".umm-costing-section")).toBeNull();
      fireEvent.click(costing);
      expect(costing).toHaveAttribute("aria-expanded", "true");
      expect(within(item).getByRole("region", { name: `Treasury costing: ${measure.name}` })).toBeInTheDocument();
      for (const source of measure.sources) expect(item).toHaveTextContent(source.label);
      expect(item.querySelector("details")).toBeNull();
      // Summary, At a glance, What changes, the points, costing: in that order
      const order = [".policy-card-summary", ".policy-card-when", ".pchg", ".policy-card-points", ".umm-costing-disclosure"]
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
    for (const measure of NOT_MODELLED.filter(({ costings }) => !costings.length)) {
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
    for (const measure of NOT_MODELLED) {
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
    expect(cards().map((card) => card.id.replace(/^unmodelled-/, ""))).toEqual(NOT_MODELLED.map((m) => m.id));
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
    expect(cards).toHaveLength(NOT_MODELLED.length);
    // The savings rise is with the policies we model for households only
    expect(HOUSEHOLD_ONLY.length).toBeGreaterThan(0);
    for (const { id } of HOUSEHOLD_ONLY) expect(cards).not.toContain(id);
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

  it("renders only short text on every card: a summary of 15 words, points of 12, nothing over 30", () => {
    render(<UnmodelledMeasures />);
    open();
    const words = (node) => node.textContent.trim().split(/\s+/).length;
    for (const item of cards()) {
      expect(words(item.querySelector(".policy-card-summary")), item.id).toBeLessThanOrEqual(15);
      for (const point of item.querySelectorAll(".policy-card-point-text")) expect(words(point), `${item.id}: ${point.textContent}`).toBeLessThanOrEqual(12);
      // What changes is said once: the summary line, then only the values
      expect(item.querySelector(".pchg-lead")).toBeNull();
      for (const block of item.querySelectorAll("p, dd, li")) {
        expect(words(block), `${item.id}: ${block.textContent.slice(0, 60)}`).toBeLessThanOrEqual(30);
      }
    }
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
  it("has only its heading and, while closed, its line above the cards: no intro, no closing note", () => {
    render(<UnmodelledMeasures />);
    const section = screen.getByRole("region", { name: UNMODELLED_TITLE });
    expect(section.querySelector(".umm-intro")).toBeNull();
    expect(section.querySelector(".umm-note")).toBeNull();
  });

  it("keeps each card's summary to 15 words and each point to 12", () => {
    for (const measure of UNMODELLED_MEASURES) {
      expect(measure.summary.split(/\s+/).length, `${measure.id} summary`).toBeLessThanOrEqual(15);
      for (const point of measure.points) {
        expect(point.text.split(/\s+/).length, `${measure.id} ${point.label}`).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe("HouseholdOnlyMeasures", () => {
  const section = () => screen.getByRole("region", { name: HOUSEHOLD_ONLY_TITLE });
  const items = () => [...section().querySelectorAll(".umm-list > .policy-card")];

  it("is a section of its own with its class said plainly, its cards shown, and not in the not-modelled section", () => {
    render(
      <>
        <HouseholdOnlyMeasures />
        <UnmodelledMeasures />
      </>,
    );
    expect(HOUSEHOLD_ONLY.map(({ id }) => id)).toEqual(["savings-income-tax", "cash-isa-limit"]);
    const heading = within(section()).getByRole("heading", { level: 2, name: HOUSEHOLD_ONLY_TITLE });
    expect(heading.closest(".section-heading")).toBeTruthy();
    expect(section()).toHaveTextContent(householdOnlyLine(2));
    expect(items().map((item) => item.id)).toEqual(["household-only-savings-income-tax", "household-only-cash-isa-limit"]);
    expect(items().map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Tax on savings interest up 2 points",
      "Cash ISA limit kept at £20,000",
    ]);
    open();
    expect(document.getElementById("unmodelled-savings-income-tax")).toBeNull();
    expect(document.getElementById("unmodelled-cash-isa-limit")).toBeNull();
  });

  it("says the savings measure is held back from this release in its Why we leave it out point", () => {
    render(<HouseholdOnlyMeasures />);
    const why = (measure) => measure.points.find((point) => point.label === "Why we leave it out").text;
    const held = UNMODELLED_MEASURES.filter((measure) => /^Held back\b/.test(why(measure)));
    expect(held.map(({ id }) => id)).toEqual(["savings-income-tax"]);
    const card = document.getElementById("household-only-savings-income-tax");
    // Our interest included ISA interest: calibrated on a different basis, not missing it (#297)
    expect(card.querySelector(".policy-card-points")).toHaveTextContent(/Held back: calibrated on another basis/);
    expect(why(held[0])).not.toMatch(/miss(?:es)? ISA interest/);
  });

  it("labels each card's last point by what leaves it out: the national results", () => {
    render(<HouseholdOnlyMeasures />);
    for (const item of items()) {
      const labels = [...item.querySelectorAll(".policy-card-points > li > .policy-card-point-label")].map((label) => label.textContent);
      expect(labels, item.id).toEqual([...UNMODELLED_POINT_LABELS.slice(0, -1), HOUSEHOLD_ONLY_WHY_LABEL]);
    }
    // The not-modelled cards keep the list's label
    expect(HOUSEHOLD_ONLY_WHY_LABEL).not.toBe(UNMODELLED_POINT_LABELS.at(-1));
  });

  it("says the cash ISA limit is in the Household calculator only, not the national results", () => {
    render(<HouseholdOnlyMeasures />);
    const measure = UNMODELLED_MEASURES.find(({ id }) => id === "cash-isa-limit");
    // Not in our data yet (#368): the survey data hold no payments into ISAs
    expect(measure.reason).toBe("data");
    const card = document.getElementById("household-only-cash-isa-limit");
    expect(card.querySelector(".policy-card-points")).toHaveTextContent(
      /Household calculator only, not the national results: our data lack ISA payments\./,
    );
  });

  // Max, 28 Oct: cite the primary source, the OBR's certified breakdown
  it("shows the government's costing as the OBR certifies it, by tax, with Table 6.1 as context", () => {
    render(<HouseholdOnlyMeasures />);
    const card = document.getElementById("household-only-savings-income-tax");
    const disclosure = within(card).getByRole("button", { name: CERTIFIED_TITLE });
    expect(within(card).queryByRole("button", { name: "Treasury costing" })).toBeNull();
    fireEvent.click(disclosure);
    expect(CERTIFIED_CAPTION).toBe("The government's costing, which the OBR certified, £m (+ is a gain to the Exchequer)");
    const table = within(card).getByRole("table", { name: CERTIFIED_CAPTION });
    const rows = within(table).getAllByRole("row").slice(1);
    // OBR detailed forecast tables (policy), Table 1.1, measure 62
    expect(rows.map((row) => [within(row).getByRole("rowheader").textContent, ...within(row).getAllByRole("cell").map((cell) => cell.textContent)])).toEqual([
      ["Income tax", "0", "+63", "+483", "+443", "+475", "+510"],
      ["Onshore corporation tax", "+13", "+63", "+74", "+78", "+80", "+81"],
      ["Total", "+13", "+126", "+557", "+521", "+555", "+591"],
    ]);
    const obrLink = within(card).getByRole("link", { name: /^OBR, Economic and fiscal outlook – October 2026, detailed forecast tables, Table 1\.1, measure 62/ });
    expect(obrLink).toHaveAttribute("href", OBR_POLICY_TABLE.href);
    expect(card).toHaveTextContent("Budget 2026, Table 6.1, row 62 (opens in a new tab) gives the total to the nearest £5m.");
  });

  it("shows the cash ISA's costing as the OBR certifies it, income tax only, with Table 6.1 as context", () => {
    render(<HouseholdOnlyMeasures />);
    const card = document.getElementById("household-only-cash-isa-limit");
    fireEvent.click(within(card).getByRole("button", { name: CERTIFIED_TITLE }));
    const table = within(card).getByRole("table", { name: CERTIFIED_CAPTION });
    const rows = within(table).getAllByRole("row").slice(1);
    // OBR detailed forecast tables (policy), Table 1.1, measure 11, to the nearest £1m
    expect(rows.map((row) => [within(row).getByRole("rowheader").textContent, ...within(row).getAllByRole("cell").map((cell) => cell.textContent)])).toEqual([
      ["Income tax", "0", "\u22124", "\u221220", "\u221235", "\u221252", "\u221272"],
    ]);
    expect(within(card).getByRole("link", { name: /Table 1\.1, measure 11/ })).toHaveAttribute("href", OBR_POLICY_TABLE.href);
    expect(card).toHaveTextContent("Budget 2026, Table 6.1, row 11 (opens in a new tab) gives the total to the nearest £5m.");
  });

  it("holds Table 6.1's row to the OBR breakdown's total, to the nearest £5m, wherever an entry has both", () => {
    const both = UNMODELLED_MEASURES.filter(({ certified }) => certified);
    expect(both.map(({ id }) => id)).toEqual(["savings-income-tax", "cash-isa-limit"]);
    for (const measure of both) {
      const total = COSTING_YEARS.map((_, index) => measure.certified.heads.reduce((sum, { values }) => sum + values[index], 0));
      // The table's last row is that total, named "Total" only where there are several taxes
      expect(costingRows(measure).at(-1).values, measure.id).toEqual(total);
      expect(costingRows(measure).some(({ key }) => key === "total"), measure.id).toBe(measure.certified.heads.length > 1);
      expect(measure.costings).toHaveLength(1);
      expect(measure.costings[0].values, measure.id).toEqual(total.map((value) => Math.round(value / 5) * 5));
      for (const { values } of measure.certified.heads) expect(values).toHaveLength(COSTING_YEARS.length);
    }
  });

  it("links each card to the Household calculator, switched to in place", () => {
    const onShowTab = vi.fn();
    render(<HouseholdOnlyMeasures onShowTab={onShowTab} />);
    const card = items()[0];
    const line = card.querySelector(".umm-calculator");
    // Always: every household request carries it (calculatorOnlyMeasures.js, #306)
    expect(line).toHaveTextContent(/^The Household calculator always includes it\.$/);
    // First in the footer, before the costing
    expect(line.compareDocumentPosition(card.querySelector(".policy-card-modelling")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const link = within(card).getByRole("link", { name: "Household calculator" });
    expect(link).toHaveAttribute("href", "?tab=household");
    // A modified click opens a new tab or window, as the browser does
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      expect(fireEvent.click(link, { [modifier]: true }), modifier).toBe(true);
    }
    expect(onShowTab).not.toHaveBeenCalled();
    expect(fireEvent.click(link)).toBe(false);
    expect(onShowTab).toHaveBeenCalledWith("household");
  });

  it("shows no figure of ours: no OBR comparison note, no Why we don't model it", () => {
    render(<HouseholdOnlyMeasures />);
    const text = section().textContent;
    // Every comparison of ours with the official costing (obrDeviationNotes.js),
    // which hold our national figures, stays off it
    const notes = ["savings_income_rates_up", "cash_isa_limit_kept"].flatMap((id) => [
      OBR_DEVIATION_NOTES[id],
      NOT_COMPARABLE_SHORT[id],
      OBR_COMPARISON_BASES[id],
      ...(OBR_DIFFERENCE_POINTS[id] ?? []).map((point) => point.text),
      ...Object.values(OBR_PANEL_BASES[id] ?? {}),
    ]).filter(Boolean);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(text).not.toContain(note);
    expect(text).not.toMatch(/£\d+m against|ours is \d+%/);
    expect(text).not.toMatch(/PolicyEngine estimate|our estimate|we estimate/i);
    expect(within(section()).queryByText(WHY_NOT_MODELLED)).toBeNull();
    // The only figures are the card's values and the Treasury's (closed)
    expect(section().querySelector(".umm-costing-section")).toBeNull();
  });

  it("shows nothing once we publish the measure, or with no household-only card, and the not-modelled section then has no copy either", () => {
    const { container: one } = render(<HouseholdOnlyMeasures published={["savings_income_rates_up"]} />);
    expect([...one.querySelectorAll(".umm-list > .policy-card")].map((item) => item.id)).toEqual(["household-only-cash-isa-limit"]);
    const { container } = render(<HouseholdOnlyMeasures published={["savings_income_rates_up", "cash_isa_limit_kept"]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<HouseholdOnlyMeasures measures={NOT_MODELLED} />);
    expect(none).toBeEmptyDOMElement();
    render(<UnmodelledMeasures published={["savings_income_rates_up"]} />);
    open();
    expect(document.getElementById("unmodelled-savings-income-tax")).toBeNull();
  });
});
