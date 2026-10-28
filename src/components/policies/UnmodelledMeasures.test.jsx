import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { CERTIFIED_CAPTION, CERTIFIED_TITLE, COSTING_CAPTION, HouseholdOnlyMeasures, costingRows, UNMODELLED_SUBTITLE, UNMODELLED_TITLE, formatMillions, groupsOf } from "./UnmodelledMeasures";
import { WHY_NOT_MODELLED } from "../PolicyCards";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  OBR_POLICY_TABLE,
  UNMODELLED_MEASURES,
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
  it("groups the cards by why we do not model them, each group titled with its reason in a line", () => {
    expect(UNMODELLED_REASONS.map(({ label }) => label)).toEqual([
      "Coming soon",
      "Modelled separately",
      "Outside a household model",
      "Not in our data yet",
    ]);
    // Every measure names a reason the groups have
    expect(UNMODELLED_MEASURES.filter((m) => !UNMODELLED_REASONS.some(({ id }) => id === m.reason)).map((m) => m.id)).toEqual([]);
    for (const { id, why } of UNMODELLED_REASONS) {
      expect(why, id).toMatch(/^[A-Z].*\.$/);
      expect(why.split(/\s+/).length, id).toBeLessThanOrEqual(30);
    }
    render(<UnmodelledMeasures />);
    open();
    const shown = [...document.querySelectorAll(".umm-group")].map((group) => ({
      title: group.querySelector(".umm-group-title").textContent,
      cards: [...group.querySelectorAll(".policy-card")].map((card) => card.id.replace(/^unmodelled-/, "")),
    }));
    expect(shown).toEqual([
      // The savings rise is with the policies we model for households only
      { title: "Coming soon", cards: ["bus-fare-cap", "machine-games-duty", "cash-isa-limit"] },
      { title: "Modelled separately", cards: ["adjusted-triple-lock"] },
      { title: "Outside a household model", cards: ["bank-surcharge", "pubs-business-rates-relief", "online-marketplace-liability", "your-first-home"] },
      {
        title: "Not in our data yet",
        cards: [
          "national-living-wage",
          "universal-credit-surplus-earnings",
          "mileage-rates",
          "company-car-tax",
          "business-asset-disposal-relief",
          "first-time-buyer-isa",
          "parental-allowance",
          "gas-standing-charges",
        ],
      },
    ]);
    // Each group's list is named by its title and described by its reason
    for (const { label, why } of UNMODELLED_REASONS) {
      const list = screen.getByRole("list", { name: label });
      expect(list).toHaveAccessibleDescription(why);
    }
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

  it("keeps At a glance short and the summary one sentence, and shows every change a card names", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const item of cards()) {
      expect(item.querySelector(".policy-card-start").textContent.length, item.id).toBeLessThanOrEqual(20);
      expect(item.querySelector(".policy-card-end").textContent.length, item.id).toBeLessThanOrEqual(20);
      expect(item.querySelector(".policy-card-summary").textContent.trim(), item.id).not.toMatch(/\.\s+[A-Z]/);
    }
    // Two changes: both in the table behind "Show every change", no tiles
    for (const id of ["mileage-rates", "company-car-tax"]) {
      const card = document.getElementById(`unmodelled-${id}`);
      fireEvent.click(within(card).getByRole("button", { name: "Show every change" }));
      expect(card.querySelectorAll(".pchg table tbody tr").length, id).toBeGreaterThanOrEqual(2);
    }
    expect(document.querySelectorAll("#unmodelled-mileage-rates .pchg table tr")[1]).toHaveTextContent(/^First 10,000 business miles.*45p55p\+10p$/);
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
    expect(HOUSEHOLD_ONLY.map(({ id }) => id)).toEqual(["savings-income-tax"]);
    const heading = within(section()).getByRole("heading", { level: 2, name: HOUSEHOLD_ONLY_TITLE });
    expect(heading.closest(".section-heading")).toBeTruthy();
    expect(section()).toHaveTextContent(householdOnlyLine(1));
    expect(items().map((item) => item.id)).toEqual(["household-only-savings-income-tax"]);
    expect(within(items()[0]).getByRole("heading", { level: 3 })).toHaveTextContent("Tax on savings interest up 2 points");
    open();
    expect(document.getElementById("unmodelled-savings-income-tax")).toBeNull();
  });

  it("marks the savings measure held back from the national figures in one muted line", () => {
    render(<HouseholdOnlyMeasures />);
    const held = UNMODELLED_MEASURES.filter(({ heldBack }) => heldBack);
    expect(held.map(({ id }) => id)).toEqual(["savings-income-tax"]);
    const card = document.getElementById("household-only-savings-income-tax");
    // Our interest included ISA interest: calibrated on a different basis, not missing it (#297)
    expect(card.querySelector(".umm-held-back")).toHaveTextContent(/^Held back: we calibrated savings interest to HMRC's figures on a different basis/);
    for (const text of [held[0].heldBack, held[0].notModelled]) expect(text).not.toMatch(/miss(?:es)? ISA interest/);
  });

  // Max, 28 Oct: cite the primary source, the OBR's certified breakdown
  it("shows the government's costing as the OBR certifies it, by tax, with Table 6.1 as context", () => {
    render(<HouseholdOnlyMeasures />);
    const card = document.getElementById("household-only-savings-income-tax");
    const disclosure = within(card).getByRole("button", { name: CERTIFIED_TITLE });
    expect(within(card).queryByRole("button", { name: "Treasury costing" })).toBeNull();
    fireEvent.click(disclosure);
    expect(CERTIFIED_CAPTION).toBe("The government's costing, certified by the OBR, £m (+ is a gain to the Exchequer)");
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

  it("holds Table 6.1's row to the OBR breakdown's total, to the nearest £5m, wherever an entry has both", () => {
    const both = UNMODELLED_MEASURES.filter(({ certified }) => certified);
    expect(both.map(({ id }) => id)).toEqual(["savings-income-tax"]);
    for (const measure of both) {
      const total = costingRows(measure).find(({ key }) => key === "total").values;
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
    expect(line).toHaveTextContent("Add it to a household in the Household calculator, under the example households.");
    // First in the footer, before the held-back line
    expect(line.compareDocumentPosition(card.querySelector(".umm-held-back")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const link = within(card).getByRole("link", { name: "Household calculator" });
    expect(link).toHaveAttribute("href", "?tab=household");
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenCalledWith("household");
  });

  it("shows no figure of ours: no OBR comparison note, no Why we don't model it", () => {
    render(<HouseholdOnlyMeasures />);
    const text = section().textContent;
    // Every comparison of ours with the official costing (obrDeviationNotes.js),
    // which hold our national figures, stays off it
    const id = "savings_income_rates_up";
    const notes = [
      OBR_DEVIATION_NOTES[id],
      NOT_COMPARABLE_SHORT[id],
      OBR_COMPARISON_BASES[id],
      ...(OBR_DIFFERENCE_POINTS[id] ?? []).map((point) => point.text),
      ...Object.values(OBR_PANEL_BASES[id] ?? {}),
    ].filter(Boolean);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(text).not.toContain(note);
    expect(text).not.toMatch(/£\d+m against|ours is \d+%/);
    expect(text).not.toMatch(/PolicyEngine estimate|our estimate|we estimate/i);
    expect(within(section()).queryByText(WHY_NOT_MODELLED)).toBeNull();
    // The only figures are the card's values and the Treasury's (closed)
    expect(section().querySelector(".umm-costing-section")).toBeNull();
  });

  it("shows nothing once the measure is published, or with no household-only card, and the not-modelled section then has no copy either", () => {
    const { container } = render(<HouseholdOnlyMeasures published={["savings_income_rates_up"]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<HouseholdOnlyMeasures measures={NOT_MODELLED} />);
    expect(none).toBeEmptyDOMElement();
    render(<UnmodelledMeasures published={["savings_income_rates_up"]} />);
    open();
    expect(document.getElementById("unmodelled-savings-income-tax")).toBeNull();
  });
});
