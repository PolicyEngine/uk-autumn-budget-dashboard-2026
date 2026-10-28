import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledMeasures, { UNMODELLED_TITLE, formatMillions } from "./UnmodelledMeasures";
import PolicyCards from "../PolicyCards";
import {
  BUDGET_DOCUMENT,
  COSTING_YEARS,
  OTHER_MEASURES_NOTE,
  UNMODELLED_MEASURES,
} from "../../utils/unmodelledMeasures";
import { buildMeasureCatalogue } from "../../utils/measureCatalogue";
import { ALPHA, BETA, measureCatalogueFixture } from "../../test/measureCatalogueFixture";

const toggle = () => screen.getByRole("button", { name: UNMODELLED_TITLE });
const open = () => fireEvent.click(toggle());

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
    const text = [...UNMODELLED_MEASURES.map(entryText), OTHER_MEASURES_NOTE].join(" ");
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

describe("UnmodelledMeasures", () => {
  it("starts closed: the button only, its measures out of the page", () => {
    render(<UnmodelledMeasures />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: UNMODELLED_MEASURES[0].name })).not.toBeInTheDocument();
    // The closed preview counts the measures
    expect(toggle()).toHaveTextContent(`${UNMODELLED_MEASURES.length} measures`);
  });

  it("opens and closes from a native button, so the keyboard works it too", () => {
    render(<UnmodelledMeasures />);
    const button = toggle();
    // A <button> takes focus and answers Enter and Space with a click
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("tabindex", "-1");
    button.focus();
    expect(button).toHaveFocus();
    open();
    expect(button).toHaveAttribute("aria-expanded", "true");
    const content = document.getElementById(button.getAttribute("aria-controls"));
    expect(content).toBeInTheDocument();
    expect(within(content).getAllByRole("listitem")).toHaveLength(UNMODELLED_MEASURES.length);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("names its region after its title", () => {
    render(<UnmodelledMeasures />);
    expect(screen.getByRole("region", { name: UNMODELLED_TITLE })).toContainElement(toggle());
  });

  it("lists every measure in order, each with its name as a heading and each part labelled", () => {
    render(<UnmodelledMeasures />);
    open();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(
      UNMODELLED_MEASURES.map((measure) => measure.name),
    );
    items.forEach((item, index) => {
      const measure = UNMODELLED_MEASURES[index];
      expect(item).toHaveTextContent(`Starts ${measure.starts}`);
      for (const term of ["What changes", "Who it reaches", "For a household", "Treasury costing", "Why it is not modelled"]) {
        expect(within(item).getByText(term).tagName, `${measure.id} ${term}`).toBe("DT");
      }
      expect(item).toHaveTextContent(measure.changes);
      expect(item).toHaveTextContent(measure.household);
      expect(item).toHaveTextContent(measure.notModelled);
    });
  });

  it("shows a measure's Table 6.1 rows by year, in £ million", () => {
    render(<UnmodelledMeasures />);
    open();
    const measure = UNMODELLED_MEASURES.find(({ id }) => id === "first-time-buyer-isa");
    const item = document.getElementById(`unmodelled-${measure.id}`);
    const table = within(item).getByRole("table", { name: "£ million, Budget 2026 Table 6.1" });
    for (const year of COSTING_YEARS) expect(within(table).getByRole("columnheader", { name: year })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual(
      measure.costings.map(({ values }) => values.map(formatMillions)),
    );
    expect(within(table).getByRole("columnheader", { name: "Row" })).toBeInTheDocument();
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["38", "39"]);
  });

  it("says what stands in for a costing where Table 6.1 has no row", () => {
    render(<UnmodelledMeasures />);
    open();
    for (const measure of UNMODELLED_MEASURES.filter(({ costings }) => !costings.length)) {
      const item = document.getElementById(`unmodelled-${measure.id}`);
      expect(within(item).queryByRole("table")).toBeNull();
      expect(item).toHaveTextContent(measure.noCosting);
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

  it("shows nothing for an empty list", () => {
    const { container } = render(<UnmodelledMeasures measures={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the Policies tab (PolicyCards)", () => {
  const catalogue = buildMeasureCatalogue(measureCatalogueFixture());

  it("ends with the unmodelled measures, closed, after the cards", () => {
    const { container } = render(
      <PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} parameterTables={null} />,
    );
    const cards = container.querySelector(".policy-cards");
    const section = screen.getByRole("region", { name: UNMODELLED_TITLE });
    expect(cards).toBeInTheDocument();
    expect(cards.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.nextElementSibling).toBeNull();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("still lists them when no measure is published", () => {
    const unverified = buildMeasureCatalogue({ manifest: measureCatalogueFixture().manifest });
    render(<PolicyCards policies={unverified.measures} selectedPolicies={[ALPHA, BETA]} parameterTables={null} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
