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
  it("shows selected verified catalogue measures, raises first, coloured like the charts, with no revenue tag", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    const cards = screen.getAllByRole("listitem");
    expect(cards.map((card) => card.querySelector("h3").textContent)).toEqual([
      catalogue.byId.get(BETA).label, catalogue.byId.get(ALPHA).label,
    ]);
    for (const [card, id] of [[cards[0], BETA], [cards[1], ALPHA]]) {
      const measure = catalogue.byId.get(id);
      expect(card).not.toHaveTextContent(/Raises revenue|Costs revenue/);
      // No card details for a mock id: the published description
      expect(card).toHaveTextContent(measure.description);
      expect(card.style.getPropertyValue("--policy-accent")).toBe(measure.color);
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).label)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).toBeNull();
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
    const toggle = within(card).getByRole("button", { name: "About this result" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
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
    // No empty blocks: as for a measure with no entry
    expect(card.querySelector(".policy-card-start")).toBeNull();
    expect(card.querySelector(".policy-card-when")).toBeNull();
    expect(card.querySelector(".policy-card-type")).toBeNull();
    expect(card).not.toHaveTextContent("Temporary");
    expect(card.querySelector(".policy-card-details")).toBeNull();
    expect(screen.queryByRole("img", { name: /^In force/ })).toBeNull();
  });

  it("shows a run's older description in full, with no empty labelled box and no reserved space", () => {
    const id = "domestic_electricity_zero_vat";
    const description = `An older run's wording. ${detailsById[id].writtenFor}`;
    const older = { ...published(id, "Zero VAT on domestic electricity"), description };
    render(<PolicyCards policies={[older]} selectedPolicies={[id]} onShowEffect={() => {}} />);
    const card = screen.getByRole("listitem");
    expect(card).toHaveClass("is-bare");
    const summary = card.querySelector(".policy-card-summary");
    expect(summary).toHaveClass("is-full");
    expect(summary.textContent).toBe(description);
    expect(card).not.toHaveTextContent(detailsById[id].summary);
    expect(card).not.toHaveTextContent("Starts");
    expect(card).not.toHaveTextContent("Ends");
    for (const slot of [".policy-card-spec", ".policy-card-when", ".policy-card-modelling", ".policy-card-type"]) {
      expect(card.querySelector(slot), slot).toBeNull();
    }
    // Every element left in the card has something in it
    for (const element of card.querySelectorAll("div, p, dl, dd, dt")) {
      expect(element.textContent.trim(), element.className).not.toBe("");
    }
    expect(within(card).getByRole("button", { name: /^See its effect/ })).toBeTruthy();
  });

  it("shows fuel duty's two-step restore as diamonds", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[published(id, "Fuel duty rises deferred")]} selectedPolicies={[id]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027;/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(2);
  });

  it("has no revenue filter: every selected card shows, whatever the address says", () => {
    window.history.replaceState(null, "", "/?tab=policies&pf=raises");
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} />);
    expect(screen.queryByRole("group", { name: "Show measures" })).toBeNull();
    expect(screen.getAllByRole("listitem").map((card) => card.querySelector("h3").textContent)).toEqual([
      catalogue.byId.get(BETA).label, catalogue.byId.get(ALPHA).label,
    ]);
    window.history.replaceState(null, "", "/");
  });

  it("asks for only that measure's effect", () => {
    const onShowEffect = vi.fn();
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA]} onShowEffect={onShowEffect} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`effect: ${catalogue.byId.get(ALPHA).label},`) }));
    expect(onShowEffect).toHaveBeenCalledWith(ALPHA);
  });
});

describe("how it is modelled (measureModelling.js)", () => {
  const caveat = "The base is likely 1.5 to 1.7 times too high.";
  const modelled = (description, id = ALPHA) => ({ ...catalogue.byId.get(ALPHA), id, description: `${description} ${caveat}` });

  // Open a card's "About this result" and return it
  const open = () => {
    const details = document.querySelector(".policy-card-details");
    fireEvent.click(within(details).getByRole("button", { name: "About this result" }));
    return details;
  };

  it("has no modelling disclosure when the card's own text already says all of it", () => {
    // The card shows the whole published description, so its fact and its
    // limitation are not said again
    const policy = modelled("Prices are day-weighted to fiscal years.", "a_mock_measure");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    expect(document.querySelector(".policy-card-details")).toBeNull();
    cleanup();
  });

  it("names the caveats in the closed preview, with no count chip", () => {
    const policy = published("badr_lifetime_limit_cut", "Business Asset Disposal Relief restricted", "revenue");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    const details = document.querySelector(".policy-card-details");
    expect(within(details).getByRole("button", { name: "About this result" })).toHaveAttribute("aria-expanded", "false");
    expect(details.querySelector(".disclosure-preview")).toHaveTextContent(/Caveats/);
    expect(details.querySelector(".disclosure-chip")).toBeNull();
    cleanup();
  });

  it("gives a limitation its sentence under Caveats when the card's own text does not state it", () => {
    const policy = published("badr_lifetime_limit_cut", "Business Asset Disposal Relief restricted", "revenue");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    const details = open();
    const caveats = details.querySelector(".info-caveats");
    expect(caveats).toHaveTextContent("1.5 to 1.7 times too high");
    cleanup();
  });

  it("says the fuel duty figure covers households' own fuel, as a caveat, once", () => {
    const policy = published("fuel_duty_rise_deferral", "Fuel duty rises deferred");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    const details = open();
    const caveats = details.querySelector(".info-caveats");
    expect(caveats).toHaveTextContent("vans, lorries and business use of cars is not modelled");
    expect(details.textContent.match(/lorries/g)).toHaveLength(1);
    cleanup();
  });

  it("says each caveat once: the details' own words, not the description's again", () => {
    // The Warm Home Discount card's details say it is paid in Great Britain
    // and that eligibility in Scotland is approximate
    const policy = published("warm_home_discount_top_up", "Warm Home Discount top-up");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    const details = open();
    expect(details).not.toHaveTextContent("Great Britain only");
    const caveats = details.querySelector(".info-caveats");
    expect(caveats.textContent.match(/Scotland/g)).toHaveLength(1);
    cleanup();
  });

  it("shows the modelling note as caveats in its measure's card", () => {
    const policy = published("employer_ni_relief_under_25s", "Employer NI relief for under-25s");
    render(<PolicyCards policies={[policy]} selectedPolicies={[policy.id]} />);
    const caveats = open().querySelector(".info-caveats");
    expect(caveats.querySelectorAll("li").length).toBeGreaterThan(1);
    expect(caveats).toHaveTextContent("HMRC");
    cleanup();
  });

  it("has no modelling disclosure for a measure with nothing to say", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} />);
    expect(document.querySelector(".policy-card-details")).toBeNull();
    cleanup();
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
    const block = within(card(rising)).getByRole("region", { name: /^What changes/ });
    expect(block.querySelector(".pchg-caption")).toHaveTextContent("A threshold, £ a year");
    const plot = within(block).getByRole("img");
    expect(plot.getAttribute("aria-label")).toContain("2029-30: £1,000 → £1,300 (+£300)");
    expect(plot.querySelector(".pchg-gap").getAttribute("d")).not.toBe("");
    expect([...plot.querySelectorAll(".pchg-gap-label")].map((label) => label.textContent)).toEqual(["+£500"]);
    expect(plot).toHaveClass("is-gain");
    // The years behind a button, closed until asked for
    expect(block.querySelector("table")).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: "Show the years" }));
    expect(within(block).getAllByRole("row")).toHaveLength(6);
  });

  it("puts the block between the card's summary and its timing", () => {
    const order = [...card(rising, { ...alpha, starts: "April 2027" }).children].map((child) => child.classList[0]);
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
    let block = within(card(amount)).getByRole("region", { name: /^What changes/ });
    // When it applies is on the timeline, so not in the label
    expect(block.querySelector(".pchg-ba-label")).toHaveTextContent(/^A limit$/);
    expect(block.querySelector(".pchg-tile.is-before")).toHaveTextContent("Current law£1,000");
    expect(block.querySelector(".pchg-tile.is-after")).toHaveTextContent("With the policy£500−£500");
    cleanup();
    const rate = tables("before-after", [
      { label: "A rate", unit: "percent", unit_words: null, primary: true, source, points: yearly(() => 0.15, (y) => (y >= 2027 ? 0 : 0.15)) },
    ]);
    block = within(card(rate)).getByRole("region", { name: /^What changes/ });
    expect(block.querySelector(".pchg-tile.is-before")).toHaveTextContent("Current law15%");
    expect(block.querySelector(".pchg-tile.is-after")).toHaveTextContent("With the policy0%−15 points");
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
      "2031-32Current lawWith the policyChange", "A£100£90−£10", "B£200£190−£10", "C£300£290−£10",
    ]);
  });

  it("switch: the two values, with the window drawn on the card's timeline", () => {
    const window = tables("switch", [
      { label: "A VAT rate", unit: "percent", unit_words: null, primary: true, source,
        points: [{ key: "2026-10-01/2028-03-31", label: "October 2026 to March 2028", year: 2026, before: 0.05, after: 0 }] },
    ]);
    const item = card(window, { ...alpha, inForce: { from: "2026-10", to: "2028-03" } });
    const block = within(item).getByRole("region", { name: /^What changes/ });
    expect(block.querySelector(".pchg-ba-label")).toHaveTextContent(/^A VAT rate$/);
    expect(block.querySelector(".pchg-tile.is-after")).toHaveTextContent("With the policy0%−5 points");
    // Each fact once: the timeline says how long, not the rates again
    expect(item.querySelector(".ptl-chip")).toHaveTextContent(/^18 months$/);
  });

  it("draws the real file's nine measures each their own way", () => {
    const cases = [
      ["fuel_duty_rise_deferral", "Fuel duty rises deferred", "cost", ".pchg-svg"],
      ["state_pension_income_tax_protection", "State Pension income tax protection", "cost", ".pchg-svg"],
      ["plan_2_threshold_unfreeze", "Plan 2 student loan threshold unfrozen", "cost", ".pchg-svg"],
      ["badr_lifetime_limit_cut", "Business Asset Disposal Relief restricted", "revenue", ".pchg-ba"],
      ["employer_ni_relief_under_25s", "Employer NI relief for under-25s", "cost", ".pchg-ba"],
      ["threshold_freeze_2031_32", "Threshold freeze to 2031-32", "revenue", ".pchg-table"],
      ["warm_home_discount_top_up", "Warm Home Discount top-up", "cost", ".pchg-ba", "£150£250+£100"],
      ["domestic_electricity_zero_vat", "Zero VAT on domestic electricity", "cost", ".pchg-ba", "5%0%−5 points"],
      ["road_fuel_vat_cut", "VAT cut on road fuel", "cost", ".pchg-ba", "20%15%−5 points"],
    ];
    for (const [id, name, direction, selector, values] of cases) {
      render(<PolicyCards policies={[published(id, name, direction)]} selectedPolicies={[id]} parameterTables={file} />);
      // The card (its modelling note has list items of its own)
      const item = document.querySelector(".policy-card");
      expect(item.querySelector(selector), id).toBeTruthy();
      if (values) {
        const tiles = [...item.querySelectorAll(".pchg-tile-value, .pchg-tile .pchg-chip")].map((node) => node.textContent).join("");
        expect(tiles, id).toBe(values);
      }
      cleanup();
    }
  });

  it("leads fuel duty with its plot: the dates and the yearly averages only when asked", () => {
    render(<PolicyCards policies={[published("fuel_duty_rise_deferral", "Fuel duty rises deferred")]} selectedPolicies={["fuel_duty_rise_deferral"]} parameterTables={file} />);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the dates" }));
    const dates = screen.getByRole("table");
    // From 1 January 2027 on: the timeline's first day equals current law, so is left out
    expect(within(dates).getAllByRole("row")).toHaveLength(10);
    expect(within(dates).getAllByRole("row")[1]).toHaveTextContent("1 January 202755.95p52.95p−3p");
    fireEvent.click(screen.getByRole("button", { name: "Show the yearly averages" }));
    const averages = screen.getByRole("table", { name: /As modelled/ });
    expect(within(averages).getAllByRole("row")[1]).toHaveTextContent("2026-2753.95p52.95p−1p");
  });

  it("shows nothing for a measure described otherwise than when the file was built, with no empty slot", () => {
    const item = card(rising, { ...alpha, description: "Changed on Budget day." });
    expect(within(item).queryByRole("region", { name: /^What changes/ })).toBeNull();
    expect(item.querySelector(".policy-card-spec")).toBeNull();
  });

  it("shows nothing without the file", () => {
    expect(within(card(null)).queryByRole("region", { name: /^What changes/ })).toBeNull();
  });
});

describe("the card's frame", () => {
  it("stacks the footer: how it is modelled across the card, then the source and the effect; the arrow says no end date", () => {
    const id = "badr_lifetime_limit_cut";
    render(<PolicyCards policies={[published(id, "Business Asset Disposal Relief restricted", "revenue")]} selectedPolicies={[id]} onShowEffect={() => {}} />);
    const foot = screen.getByRole("listitem").querySelector(".policy-card-foot");
    expect([...foot.children].map((child) => child.className)).toEqual(["policy-card-modelling", "policy-card-actions"]);
    expect(foot.querySelector(".policy-card-modelling .policy-card-details")).toBeTruthy();
    // A tip's wrapper (display: contents) is looked through
    const actions = [...foot.querySelector(".policy-card-actions").children].map((child) =>
      (child.classList.contains("tip-anchor") ? child.firstElementChild : child).className);
    expect(actions).toEqual(["policy-card-source", "policy-card-effect"]);
    expect(within(foot).getByRole("link", { name: /^Source: Business Asset Disposal Relief/ })).toBeTruthy();
    const arrow = screen.getByRole("listitem").querySelector(".ptl-arrow");
    fireEvent.mouseEnter(arrow);
    expect(document.getElementById(arrow.getAttribute("aria-describedby"))).toHaveTextContent("No end date");
  });
});
