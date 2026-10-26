import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards, {
  BUDGET_DAY_MONTH,
  TIMELINE_START_YEAR,
  TIMELINE_YEARS,
  durationLabel,
  timelineDescription,
  timelineSpan,
} from "./PolicyCards";
import { buildMeasureCatalogue } from "../utils/measureCatalogue";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { ALPHA, BETA, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const detailsById = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));

// A published catalogue measure under a real id, so policyDetails.js adds
// its card text (#185 on #104: the catalogue decides membership and names)
// as the publication describes it (reforms.py's description, which the
// entry records as `writtenFor`)
const published = (id, name, direction = "cost") => ({
  ...catalogue.byId.get(ALPHA),
  id,
  seriesKey: `measure:${id}`,
  name,
  label: name,
  description: detailsById[id]?.writtenFor ?? catalogue.byId.get(ALPHA).description,
  direction,
});

describe("the card details (policyDetails.js)", () => {
  it("give every entry a card's fields, and a temporary one its end", () => {
    for (const policy of POLICY_DETAILS) {
      for (const field of ["summary", "starts", "type", "details", "inForce"]) {
        expect(policy[field], `${policy.id} ${field}`).toBeTruthy();
      }
      expect(Boolean(policy.ends), policy.id).toBe(Boolean(policy.inForce.to));
    }
  });

  it("never repeat a revenue figure in a card", () => {
    for (const policy of POLICY_DETAILS) {
      const text = [policy.summary, policy.details].join(" ");
      expect(text, policy.id).not.toMatch(/£[\d.]+ ?(bn|billion)/);
    }
  });
});

describe("PolicyCards", () => {
  it("shows selected verified catalogue measures grouped and coloured like the charts", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    for (const [heading, id] of [["Raises revenue", BETA], ["Costs revenue", ALPHA]]) {
      const group = screen.getByRole("region", { name: heading });
      const measure = catalogue.byId.get(id);
      expect(within(group).getAllByRole("listitem")).toHaveLength(1);
      expect(group).toHaveTextContent(measure.label);
      // No card details for a mock id: the published description
      expect(group).toHaveTextContent(measure.description);
      expect(within(group).getByRole("listitem").style.getPropertyValue("--policy-accent")).toBe(measure.color);
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).label)).not.toBeInTheDocument();
  });

  it("keeps neutral measures in their own group and leaves empty groups out", () => {
    const policy = { ...catalogue.byId.get(ALPHA), direction: "neutral" };
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} />);
    expect(screen.getByRole("heading", { name: "Other measures" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Costs revenue" })).not.toBeInTheDocument();
  });

  it("shows no cards when the catalogue has no verified measures", () => {
    const unverified = buildMeasureCatalogue({ manifest: measureCatalogueFixture().manifest });
    render(<PolicyCards policies={unverified.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("gives a card with details its type, start and end, with the modelling closed until opened", () => {
    const id = "warm_home_discount_top_up";
    render(<PolicyCards policies={[published(id, "Warm Home Discount top-up")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Warm Home Discount top-up" })).toBeTruthy();
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("EndsAfter one winter");
    expect(card.querySelector(".policy-card-topline")).toHaveTextContent("BenefitTemporary");
    expect(within(card).getByRole("img", { name: /^In force from October 2026 to March 2027 \(one winter\)\.$/ })).toBeTruthy();
    const source = within(card).getByRole("link", { name: /Warm Home Discount/ });
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("How it is modelled"));
    expect(details.open).toBe(true);
  });

  it("marks a lasting measure as continuing, with no end date", () => {
    const id = "badr_lifetime_limit_cut";
    render(<PolicyCards policies={[published(id, "Business Asset Disposal Relief restricted", "revenue")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(card).not.toHaveTextContent("Ends");
    expect(card.querySelector(".policy-card-ends")).toBeEmptyDOMElement();
    expect(card).not.toHaveTextContent("Temporary");
    const timeline = within(card).getByRole("img", { name: "In force from April 2027; no end date." });
    expect(timeline).toHaveTextContent("Continues");
    expect(timeline).toHaveTextContent("Budget");
    expect(timeline.textContent).not.toMatch(/BudgetContinues/);
    expect(timeline.querySelectorAll(".ptl-span")).toHaveLength(1);
  });

  it("shows a measure changed since its details were written as published, with none of their figures or dates", () => {
    const id = "fuel_duty_rise_deferral";
    const changed = { ...published(id, "Fuel duty rises deferred"), description: "Fuel duty stays at 52.95p a litre until April 2028." };
    render(<PolicyCards policies={[changed]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent(changed.description);
    expect(card).not.toHaveTextContent(detailsById[id].summary);
    // The rows stay, for the grid, but empty: as for a measure with no entry
    expect(card.querySelector(".policy-card-start")).toBeEmptyDOMElement();
    expect(card.querySelector(".policy-card-type")).toBeEmptyDOMElement();
    expect(card).not.toHaveTextContent("Temporary");
    expect(card.querySelector("details")).toBeNull();
    expect(screen.queryByRole("img", { name: /^In force/ })).toBeNull();
  });

  it("shows fuel duty's two-step restore as diamonds", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[published(id, "Fuel duty rises deferred")]} selectedPolicies={[id]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027;/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(2);
  });

  it("counts each group's measures", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} />);
    expect(screen.getByRole("region", { name: "Raises revenue" })).toHaveTextContent("1 measure");
    expect(screen.getByRole("region", { name: "Costs revenue" })).toHaveTextContent("1 measure");
  });

  it("asks for only that measure's effect", () => {
    const onShowEffect = vi.fn();
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA]} onShowEffect={onShowEffect} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`effect of ${catalogue.byId.get(ALPHA).label}`) }));
    expect(onShowEffect).toHaveBeenCalledWith(ALPHA);
  });
});

describe("the in-force timeline", () => {
  it("places each measure's months on the charts' years", () => {
    const vat = timelineSpan({ from: "2026-12", to: "2027-05" });
    expect(vat.left).toBeCloseTo(8 / 72);
    expect(vat.width).toBeCloseTo(6 / 72);
    const freeze = timelineSpan({ from: `${TIMELINE_START_YEAR + TIMELINE_YEARS - 1}-04` });
    expect(freeze.left).toBeCloseTo(5 / 6);
    expect(freeze.left + freeze.width).toBeCloseTo(1);
  });

  it("counts a temporary measure's months", () => {
    expect(durationLabel(detailsById.road_fuel_vat_cut)).toBe("6 months");
    expect(durationLabel(detailsById.domestic_electricity_zero_vat)).toBe("18 months");
    expect(durationLabel(detailsById.warm_home_discount_top_up)).toBe("One winter");
    expect(timelineDescription(detailsById.road_fuel_vat_cut)).toBe(
      "In force from December 2026 to May 2027 (6 months).",
    );
  });

  it("puts Budget day in late October 2026", () => {
    expect(BUDGET_DAY_MONTH).toBeGreaterThan(6.8);
    expect(BUDGET_DAY_MONTH).toBeLessThan(7);
  });

  it("keeps every measure's span on the timeline", () => {
    for (const policy of POLICY_DETAILS) {
      const { left, width } = timelineSpan(policy.inForce);
      expect(left, policy.id).toBeGreaterThanOrEqual(0);
      expect(width, policy.id).toBeGreaterThan(0);
      expect(left + width, policy.id).toBeLessThanOrEqual(1);
    }
  });
});

describe("what changes (the model's parameters, policy_parameters.json)", () => {
  // The file the page serves, written by `uk-budget-data policy-table`
  const file = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"),
  );
  const alpha = catalogue.byId.get(ALPHA);
  const yearly = (before, after) =>
    [2026, 2027, 2028, 2029, 2030, 2031].map((year) => ({
      key: String(year),
      label: `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
      year,
      before: before(year),
      after: after(year),
    }));
  const source = { before: { kind: "engine_parameter" }, after: { kind: "modifier_constant" } };
  const tables = (display, rows) => ({ measures: { [ALPHA]: { description: alpha.description, display, rows } } });
  const rising = tables("path", [
    { label: "A threshold", unit: "gbp", unit_words: "£ a year", primary: true, source,
      points: yearly(() => 1000, (year) => (year >= 2027 ? 1000 + 100 * (year - 2026) : 1000)) },
  ]);
  const card = (parameterTables, policy = alpha) => {
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} parameterTables={parameterTables} />);
    return screen.getByRole("listitem");
  };

  it("path: a step plot of current law against the measure, labelled once, values hidden for screen readers", () => {
    const block = within(card(rising)).getByRole("region", { name: "What changes" });
    expect(block.querySelector(".pchg-caption")).toHaveTextContent("A threshold, £ a year");
    const plot = within(block).getByRole("img");
    expect(plot.getAttribute("aria-label")).toContain("2029-30: £1,000 → £1,300 (+£300)");
    expect(plot.querySelector(".pchg-gap").getAttribute("d")).not.toBe("");
    expect([...plot.querySelectorAll(".pchg-gap-label")].map((label) => label.textContent)).toEqual(["+£500"]);
    expect(plot).toHaveClass("is-gain");
    // The values' table sits inside a visually hidden box (a table ignores
    // a 1px width of its own)
    const hidden = block.querySelector("table");
    expect(hidden.parentElement).toHaveClass("policy-sr-only");
    expect(within(hidden).getAllByRole("row")).toHaveLength(7);
  });

  it("puts the block between the card's summary and its timing", () => {
    const order = [...card(rising).children].map((child) => child.className);
    expect(order.indexOf("policy-card-spec")).toBe(order.indexOf("policy-card-summary") + 1);
    expect(order.indexOf("policy-card-when")).toBe(order.indexOf("policy-card-spec") + 1);
  });

  it("marks a picked step on the card's timeline, and says it in words", () => {
    const item = card(rising, { ...alpha, inForce: { from: "2027-04" } });
    const plot = item.querySelector(".pchg-svg");
    plot.focus();
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(item.querySelector(".pchg-tip")).toHaveTextContent("2029-30: £1,000 → £1,300 (+£300)");
    const band = item.querySelector(".ptl-year-band");
    expect(parseFloat(band.style.left)).toBeCloseTo(300 / 6);
    expect(item.querySelector(".policy-timeline-labels > .is-lit").textContent).toContain("2029-30");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(item.querySelector(".ptl-year-band")).toBeNull();
  });

  it("before-after: the two values and, for an amount, the change; a rate as two rates", () => {
    const amount = tables("before-after", [
      { label: "A limit", unit: "gbp", unit_words: "£", primary: true, source, points: yearly(() => 1000, (y) => (y >= 2027 ? 500 : 1000)) },
    ]);
    let block = within(card(amount)).getByRole("region", { name: "What changes" });
    expect(block).toHaveTextContent("A limit, from 2027-28£1,000 → £500−£500");
    cleanup();
    const rate = tables("before-after", [
      { label: "A rate", unit: "percent", unit_words: null, primary: true, source, points: yearly(() => 0.15, (y) => (y >= 2027 ? 0 : 0.15)) },
    ]);
    block = within(card(rate)).getByRole("region", { name: "What changes" });
    expect(block).toHaveTextContent("A rate, from 2027-2815% → 0%");
    expect(block.textContent).not.toMatch(/pp\b/);
    expect(block.querySelector("svg.pchg-svg, table")).toBeNull();
  });

  it("table: only the parameters and year that differ", () => {
    const three = tables("table", ["A", "B", "C"].map((label, i) => ({
      label, unit: "gbp", unit_words: "£ a year", primary: i < 2, source,
      points: yearly(() => 100 * (i + 1), (y) => (y === 2031 ? 100 * (i + 1) - 10 : 100 * (i + 1))),
    })));
    const table = within(card(three)).getByRole("table");
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "2031-32Current lawWith the measureChange", "A£100£90−£10", "B£200£190−£10", "C£300£290−£10",
    ]);
  });

  it("switch: nothing in the block; the timeline's in-force span says the change", () => {
    const window = tables("switch", [
      { label: "A VAT rate", unit: "percent", unit_words: null, primary: true, source,
        points: [{ key: "2026-10-01/2028-03-31", label: "October 2026 to March 2028", year: 2026, before: 0.05, after: 0 }] },
    ]);
    const item = card(window, { ...alpha, inForce: { from: "2026-10", to: "2028-03" } });
    expect(within(item).queryByRole("region", { name: "What changes" })).toBeNull();
    expect(item.querySelector(".policy-card-spec")).toBeEmptyDOMElement();
    expect(item.querySelector(".ptl-chip")).toHaveTextContent("5% → 0%18 months");
    expect(within(item).getByRole("img", { name: /While in force: 5% → 0%\.$/ })).toBeTruthy();
  });

  it("draws the real file's nine measures each their own way", () => {
    const cases = [
      ["fuel_duty_rise_deferral", "Fuel duty rises deferred", "cost", ".pchg-svg"],
      ["state_pension_income_tax_protection", "State Pension income tax protection", "cost", ".pchg-svg"],
      ["plan_2_threshold_unfreeze", "Plan 2 student loan threshold unfrozen", "cost", ".pchg-svg"],
      ["badr_lifetime_limit_cut", "Business Asset Disposal Relief restricted", "revenue", ".pchg-ba"],
      ["employer_ni_relief_under_25s", "Employer NI relief for under-25s", "cost", ".pchg-ba"],
      ["threshold_freeze_2031_32", "Threshold freeze to 2031-32", "revenue", ".pchg-table"],
      ["warm_home_discount_top_up", "Warm Home Discount top-up", "cost", null],
      ["domestic_electricity_zero_vat", "Zero VAT on domestic electricity", "cost", null],
      ["road_fuel_vat_cut", "VAT cut on road fuel", "cost", null],
    ];
    const chips = { warm_home_discount_top_up: "£150 → £250", domestic_electricity_zero_vat: "5% → 0%", road_fuel_vat_cut: "20% → 15%" };
    for (const [id, name, direction, selector] of cases) {
      render(<PolicyCards policies={[published(id, name, direction)]} selectedPolicies={[id]} parameterTables={file} />);
      const item = screen.getByRole("listitem");
      if (selector) expect(item.querySelector(selector), id).toBeTruthy();
      else expect(item.querySelector(".ptl-change"), id).toHaveTextContent(chips[id]);
      cleanup();
    }
  });

  it("shows the fuel duty yearly averages only when asked", () => {
    render(<PolicyCards policies={[published("fuel_duty_rise_deferral", "Fuel duty rises deferred")]} selectedPolicies={["fuel_duty_rise_deferral"]} parameterTables={file} />);
    const button = screen.getByRole("button", { name: "Show the yearly averages" });
    expect(screen.queryByRole("table", { name: /As modelled/ })).toBeNull();
    fireEvent.click(button);
    const table = screen.getByRole("table", { name: /As modelled/ });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("2026-2753.95p52.95p−1p");
  });

  it("shows nothing for a measure described otherwise than when the file was built, keeping the empty slot", () => {
    const item = card(rising, { ...alpha, description: "Changed on Budget day." });
    expect(within(item).queryByRole("region", { name: "What changes" })).toBeNull();
    expect(item.querySelector(".policy-card-spec")).toBeEmptyDOMElement();
  });

  it("shows nothing without the file", () => {
    expect(within(card(null)).queryByRole("region", { name: "What changes" })).toBeNull();
  });
});
