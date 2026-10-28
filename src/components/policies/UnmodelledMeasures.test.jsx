import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { COSTING_CAPTION, UNMODELLED_SUBTITLE, UNMODELLED_TITLE, WHY_LABEL, formatMillions } from "./UnmodelledMeasures";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  UNMODELLED_GROUPS,
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
  const cards = () => [...document.querySelectorAll(".umm-list > .umm-card")];

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

  it("lists every measure in order as a compact card, each part in its place", () => {
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
      expect(item.querySelector(".umm-card-changes")).toHaveTextContent(measure.changes);
      // When and whom, in one line
      const meta = item.querySelector(".umm-meta");
      expect(meta).toHaveTextContent(measure.starts.replace(/\.$/, ""));
      expect(meta).toHaveTextContent(measure.reaches.replace(/\.$/, ""));
      expect(within(item).getByText("For a household:").tagName).toBe("DT");
      expect(within(item).getByText(WHY_LABEL).tagName).toBe("DT");
      expect(item).toHaveTextContent(measure.household);
      expect(item).toHaveTextContent(measure.notModelled);
      expect(within(item).getByRole("region", { name: `Treasury costing: ${measure.name}` })).toBeInTheDocument();
      // Sources closed at the foot
      const sources = item.querySelector("details.umm-sources");
      expect(sources).not.toHaveAttribute("open");
      expect(item.lastElementChild).toBe(sources);
      // Name, What changes, headline, when and whom, the two lines, costing, sources: in that order
      const order = [".umm-card-name", ".umm-card-changes", ".umm-headline", ".umm-meta", ".umm-lines", ".umm-costing-section", ".umm-sources"]
        .map((selector) => item.querySelector(selector))
        .filter(Boolean);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${measure.id} ${i}`).toBeTruthy();
      }
      // No model card's parts: no plot, timeline or effect button
      expect(item.querySelector(".pchg-svg, .ptl, .policy-card-effect"), measure.id).toBeNull();
    });
  });

  it("leads with the values before and after where the entry gives them", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const item of cards()) {
      const id = item.id.replace(/^unmodelled-/, "");
      expect(Boolean(item.querySelector(".umm-headline")), id).toBe(Boolean(UNMODELLED_CARDS[id]?.parameters));
    }
    const wage = document.getElementById("unmodelled-national-living-wage").querySelector(".umm-headline-values");
    expect(wage).toHaveTextContent("£12.71£13.21");
    expect(wage).toHaveAttribute("aria-label", "National Living Wage: £12.71 becomes £13.21");
    const cars = document.getElementById("unmodelled-company-car-tax").querySelector(".umm-headline");
    expect(cars).toHaveTextContent("9%10%");
    expect(cars).toHaveTextContent("Cars emitting 1 to 50g CO2/km: 19% → 20%");
  });

  it("shows a measure's Table 6.1 rows by year, in £ million, on the card", () => {
    render(<UnmodelledMeasures />);
    open();
    const measure = UNMODELLED_MEASURES.find(({ id }) => id === "first-time-buyer-isa");
    const item = document.getElementById(`unmodelled-${measure.id}`);
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
        expect(within(item).queryByRole("table")).toBeNull();
      expect(item.querySelector(".umm-no-costing")).toHaveTextContent(/No Table 6\.1 row$/);
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

  it("shows the cards in their groups, by who a measure touches, each under its label", () => {
    render(<UnmodelledMeasures />);
    open();
    const groups = [...document.querySelectorAll(".umm-group")];
    expect(groups.map((group) => group.querySelector(".umm-group-title").textContent)).toEqual(UNMODELLED_GROUPS.map(({ label }) => label));
    for (const [index, group] of groups.entries()) {
      const ids = [...group.querySelectorAll(".umm-card")].map((card) => card.id.replace(/^unmodelled-/, ""));
      expect(ids).toEqual(UNMODELLED_MEASURES.filter((m) => m.group === UNMODELLED_GROUPS[index].id).map((m) => m.id));
    }
    expect(UNMODELLED_MEASURES.every((m) => UNMODELLED_GROUPS.some(({ id }) => id === m.group))).toBe(true);
  });

  it("keeps names short: 10 words at most", () => {
    for (const measure of UNMODELLED_MEASURES) expect(measure.name.split(/\s+/).length, measure.id).toBeLessThanOrEqual(10);
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
