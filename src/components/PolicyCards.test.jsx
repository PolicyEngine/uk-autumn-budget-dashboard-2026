import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards, {
  BUDGET_DAY_MONTH,
  CARD_SECTIONS,
  UNMODELLED_ONLY_SECTIONS,
  TIMELINE_START_YEAR,
  TIMELINE_YEARS,
  durationLabel,
  timelineDescription,
  timelineSpan,
} from "./PolicyCards";
import { buildMeasureCatalogue } from "../utils/measureCatalogue";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { explainerFor } from "../utils/explainers";
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
    render(<PolicyCards policies={[{ ...published(id, "Warm Home Discount top-up"), timeline: true }]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Warm Home Discount top-up" })).toBeTruthy();
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("EndsAfter one winter");
    expect(card.querySelector(".policy-card-topline")).toHaveTextContent(/^Energy$/);
    expect(card).not.toHaveTextContent("Temporary");
    expect(card.querySelector(".policy-card-badge")).toBeNull();
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
    render(<PolicyCards policies={[{ ...published(id, "Business Asset Disposal Relief restricted", "revenue"), timeline: true }]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    // At a glance says it once: Ends, Continues; the timeline only draws it
    expect(card.querySelector(".policy-card-ends")).toHaveTextContent(/^Ends\s*Continues$/);
    expect(card).not.toHaveTextContent("Temporary");
    const timeline = within(card).getByRole("img", { name: "In force from April 2027; no end date." });
    expect(timeline).not.toHaveTextContent("Continues");
    expect(timeline).toHaveTextContent("Budget");
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
    // The category is derived from the publication, so it stays
    expect(card.querySelector(".policy-card-type")).toHaveTextContent("Fuel duty");
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
    // The category is derived from the publication, so it stays
    expect(card.querySelector(".policy-card-type")).toHaveTextContent("VAT");
    for (const slot of [".policy-card-spec", ".policy-card-when", ".policy-card-modelling"]) {
      expect(card.querySelector(slot), slot).toBeNull();
    }
    // Every element left in the card has something in it
    for (const element of card.querySelectorAll("div, p, dl, dd, dt")) {
      expect(element.textContent.trim(), element.className).not.toBe("");
    }
    expect(within(card).getByRole("button", { name: /^See its effect/ })).toBeTruthy();
  });

  it("shows the fuel duty freeze with no restore steps", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[{ ...published(id, "Fuel duty rises deferred"), timeline: true }]} selectedPolicies={[id]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(0);
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

describe("our explainers (explainers.js)", () => {
  it("links a measure's card to our explainer of it, and no other card", () => {
    const policies = [published("trading_allowance_raise", "Trading allowance raised to £3,000"), { ...catalogue.byId.get(ALPHA) }];
    render(<PolicyCards policies={policies} selectedPolicies={policies.map((policy) => policy.id)} onShowEffect={vi.fn()} />);
    const links = screen.getAllByRole("link", { name: /^Read policy brief/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://www.policyengine.org/uk/research/uk-autumn-budget-2026-trading-allowance");
    expect(links[0]).toHaveAttribute("target", "_blank");
    cleanup();
  });

  it("gives each of the seven published measures an explainer", () => {
    for (const id of [
      "carers_allowance_earnings_taper",
      "domestic_electricity_zero_vat",
      "fuel_duty_rise_deferral",
      "household_energy_payment_2026",
      "property_income_rates_up",
      "state_pension_income_tax_protection",
      "trading_allowance_raise",
    ]) {
      expect(explainerFor(id)?.href).toMatch(/^https:\/\/www\.policyengine\.org\/uk\/research\/[a-z0-9-]+$/);
    }
    expect(explainerFor("not_a_measure")).toBeNull();
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
    expect(caveats).toHaveTextContent("The model leaves out fuel for vans, lorries and business use of cars");
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
    expect(durationLabel(detailsById.domestic_electricity_zero_vat)).toBe("9 months");
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

  it("puts the block after At a glance, before the footer", () => {
    const order = [...card(rising, { ...alpha, starts: "April 2027" }).children].map((child) => child.classList[0]);
    expect(order.indexOf("policy-card-when")).toBe(order.indexOf("policy-card-summary") + 1);
    expect(order.indexOf("policy-card-spec")).toBe(order.indexOf("policy-card-when") + 1);
  });

  it("marks a picked step on the card's timeline, and says it in words", () => {
    const item = card(rising, { ...alpha, inForce: { from: "2027-04" }, timeline: true });
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

  it("draws no Current law and With the policy tiles: a single change of value leaves no What changes block (Vahid, 28 Oct)", () => {
    const amount = tables("before-after", [
      { label: "A limit", unit: "gbp", unit_words: "£", primary: true, source, points: yearly(() => 1000, (y) => (y >= 2027 ? 500 : 1000)) },
    ]);
    const item = card(amount);
    expect(within(item).queryByRole("region", { name: /^What changes/ })).toBeNull();
    expect(item.querySelector(".pchg-tile, .pchg-ba, .policy-card-spec")).toBeNull();
    expect(item).not.toHaveTextContent(/£1,000|£500/);
  });

  it("table: only the parameters and year that differ, when asked, and no tiles", () => {
    const three = tables("table", ["A", "B", "C"].map((label, i) => ({
      label, unit: "gbp", unit_words: "£ a year", primary: i < 2, source,
      points: yearly(() => 100 * (i + 1), (y) => (y === 2031 ? 100 * (i + 1) - 10 : 100 * (i + 1))),
    })));
    const block = within(card(three)).getByRole("region", { name: /^What changes/ });
    expect(block.querySelector(".pchg-tile, .pchg-ba")).toBeNull();
    expect(block.querySelector(".pchg-svg")).toBeNull();
    expect(within(block).queryByRole("table")).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: "Show every change" }));
    const table = within(block).getByRole("table");
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "2031-32Current lawWith the policyChange", "A£100£90−£10", "B£200£190−£10", "C£300£290−£10",
    ]);
  });

  it("switch: a window or one winter leaves no What changes block, the timeline still saying how long", () => {
    const window = tables("switch", [
      { label: "A VAT rate", unit: "percent", unit_words: null, primary: true, source,
        points: [{ key: "2026-10-01/2028-03-31", label: "October 2026 to March 2028", year: 2026, before: 0.05, after: 0 }] },
    ]);
    const item = card(window, { ...alpha, inForce: { from: "2026-10", to: "2028-03" }, timeline: true });
    expect(within(item).queryByRole("region", { name: /^What changes/ })).toBeNull();
    expect(item.querySelector(".ptl-chip")).toHaveTextContent(/^18 months$/);
    cleanup();
    const winter = tables("switch", [
      { label: "A payment", unit: "gbp", unit_words: "£ a household, once", primary: true, source,
        points: [{ key: "2026", label: "Winter 2026-27", year: 2026, before: 150, after: 250 }] },
    ]);
    expect(within(card(winter)).queryByRole("region", { name: /^What changes/ })).toBeNull();
  });

  it("draws no tiles on any measure in the real file, and a plot only where it varies by year", () => {
    for (const [id, entry] of Object.entries(file.measures)) {
      render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} parameterTables={file} />);
      const item = document.querySelector(".policy-card");
      expect(item.querySelector(".pchg-tile, .pchg-ba"), id).toBeNull();
      expect(item).not.toHaveTextContent(/Current law.*→|becomes/);
      const main = entry.rows.find((row) => row.primary) ?? entry.rows[0];
      const changes = new Set(main.points.filter((p) => p.before !== p.after).map((p) => `${p.before}|${p.after}`));
      // Every measure in the file has its own visual (policies/
      // PolicyVisual.jsx), which takes the step plot's place
      expect(item.querySelector(".pviz"), id).toBeTruthy();
      expect(Boolean(item.querySelector(".pchg-svg")), id).toBe(false);
      render(<PolicyCards policies={[{ ...published(id, id), visual: undefined }]} selectedPolicies={[id]} parameterTables={file} />);
      const plain = document.querySelectorAll(".policy-card")[1];
      expect(Boolean(plain.querySelector(".pchg-svg")), id).toBe(changes.size > 1);
      // Every table behind a button
      expect(item.querySelector(".pchg table"), id).toBeNull();
      cleanup();
    }
  });

  it("leaves the real file's single changes out: no Energy payment or trading allowance figures (Vahid, 28 Oct)", () => {
    for (const id of ["household_energy_payment_2026", "trading_allowance_raise"]) {
      render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} parameterTables={file} />);
      const item = document.querySelector(".policy-card");
      expect(within(item).queryByRole("region", { name: /^What changes/ }), id).toBeNull();
      expect(item.querySelector(".pchg"), id).toBeNull();
      expect(item.querySelector(".pchg-tile"), id).toBeNull();
      cleanup();
    }
  });

  it("gives each of the seven announced measures, as the real file describes it, its summary, timing, category, what changes and caveats", () => {
    const seven = [
      ["fuel_duty_rise_deferral", "Fuel duty cut extended", "Fuel duty", "Jan 2027"],
      ["state_pension_income_tax_protection", "Pension Tax Allowance", "Income tax", "Apr 2027"],
      ["domestic_electricity_zero_vat", "Zero VAT on domestic electricity", "VAT", "Oct 2026"],
      ["property_income_rates_up", "Property income tax rates up", "Income tax", "Apr 2027"],
      ["carers_allowance_earnings_taper", "Carer's Allowance earnings taper", "Benefits", "2030-31"],
      ["household_energy_payment_2026", "Household Energy Payment", "Energy", "Jan 2027"],
      ["trading_allowance_raise", "Trading allowance raised to £3,000", "Income tax", "Apr 2027"],
    ];
    expect(Object.keys(file.measures)).toEqual(seven.map(([id]) => id));
    for (const [id, name, category, starts] of seven) {
      // The published description (reforms.py's, as the file carries it),
      // not the entry's own copy: a drift between the two fails here
      const measure = { ...published(id, name), description: file.measures[id].description };
      render(<PolicyCards policies={[measure]} selectedPolicies={[id]} parameterTables={file} />);
      const item = document.querySelector(".policy-card");
      expect(item.querySelector(".policy-card-summary"), id).toHaveTextContent(detailsById[id].summary);
      expect(item.querySelector(".policy-card-summary.is-full"), id).toBeNull();
      expect(item.querySelector(".policy-card-topline"), id).toHaveTextContent(new RegExp(`^${category}$`));
      expect(item.querySelector(".policy-card-start"), id).toHaveTextContent(starts);
      // What changes only where it has more than a single change of value
      // to show (no tiles; Vahid, 28 Oct)
      const shown = ["fuel_duty_rise_deferral", "state_pension_income_tax_protection", "domestic_electricity_zero_vat", "carers_allowance_earnings_taper", "property_income_rates_up"].includes(id);
      expect(Boolean(within(item).queryByRole("region", { name: /^What changes/ })), id).toBe(shown);
      expect(item.querySelector(".policy-card-details"), id).toBeTruthy();
      cleanup();
    }
  });

  it("names the incidence, benefit cap and Budget 2025 caveats on the three new measures", () => {
    expect(detailsById.employer_nics_secondary_threshold_raise.details).toMatch(/total cost of employment fixed.*higher wages/);
    expect(detailsById.lha_unfreeze_2027.details).toMatch(/benefit cap still applies/);
    for (const id of ["property_income_rates_up", "savings_income_rates_up"]) {
      expect(detailsById[id].details, id).toMatch(/on top of the rises Budget 2025 legislated/);
    }
    expect(detailsById.property_income_rates_up.details).toMatch(/Scottish landlords' relief also rises to 24%/);
    for (const id of ["lha_unfreeze_2027", "employer_nics_secondary_threshold_raise", "property_income_rates_up", "savings_income_rates_up"]) {
      expect(detailsById[id].source.href, id).toMatch(/^https:\/\/www\.(gov|legislation\.gov)\.uk\//);
    }
  });

  it("leads fuel duty with its plot, its periods when asked and no yearly averages (PR 290, Anthony, 19:37)", () => {
    render(<PolicyCards policies={[published("fuel_duty_rise_deferral", "Fuel duty rises deferred")]} selectedPolicies={["fuel_duty_rise_deferral"]} parameterTables={file} />);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the periods" }));
    const periods = screen.getByRole("table");
    // The rates in force, never averages: current law's period before the
    // change, the three it differs, and the return to current law
    expect(within(periods).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "PeriodCurrent lawWith the policyChange",
      "To 31 December 202652.95p52.95pno change",
      "1 January to 28 February 202755.95p52.95p−3p",
      "1 to 31 March 202757.95p52.95p−5p",
      "1 April to 30 June 202760.59p52.95p−7.64p",
      "1 July 2027 to 31 March 202860.59p60.59pno change",
    ]);
    expect(screen.queryByRole("button", { name: /yearly averages/ })).toBeNull();
    expect(document.querySelector(".policy-card")).not.toHaveTextContent("averaged over the year");
  });

  it("shows the electricity zero rate without its yearly averages, saying where it applies and what it is scored against (PR 290, Anthony 19:25, Max 19:32)", () => {
    const id = "domestic_electricity_zero_vat";
    render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} parameterTables={file} />);
    const block = screen.getByRole("region", { name: /^What changes/ });
    const note = block.querySelector(".pchg-note");
    expect(note).toHaveTextContent("0% instead of 5% in Great Britain from 1 October 2026.");
    expect(note).toHaveTextContent("expects the zero rate to apply in Northern Ireland too from April 2027");
    expect(note).toHaveTextContent("already law (SI 2026/987)");
    expect(within(block).queryByRole("button")).toBeNull();
    expect(block).not.toHaveTextContent(/2\.17%|3\.89%|in Great Britain,/);
  });

  it("lists the property rates once for 2027-28 to 2031-32, not a row a year (PR 290, Anthony, 19:36)", () => {
    const id = "property_income_rates_up";
    render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} parameterTables={file} />);
    const block = screen.getByRole("region", { name: /^What changes/ });
    fireEvent.click(within(block).getByRole("button", { name: "Show every change" }));
    expect(within(within(block).getByRole("table")).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "2027-28 to 2031-32Current lawWith the policyChange",
      "Property basic rate22%24%22% → 24%",
      "Property higher rate42%44%42% → 44%",
      "Property additional rate47%49%47% → 49%",
    ]);
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
    render(<PolicyCards policies={[{ ...published(id, "Business Asset Disposal Relief restricted", "revenue"), timeline: true }]} selectedPolicies={[id]} onShowEffect={() => {}} />);
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

  it("keeps every card's sections in one order, whatever it has", () => {
    const ids = ["household_energy_payment_2026", "fuel_duty_rise_deferral", "state_pension_income_tax_protection", "trading_allowance_raise"];
    const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
    const bare = { ...published("domestic_electricity_zero_vat", "Zero VAT"), description: "An older run's wording." };
    // The Pension Tax Allowance without its visual (which folds its
    // example in), so one card has both an example and What changes
    const withoutVisual = (policy) => (policy.id === "state_pension_income_tax_protection" ? { ...policy, visual: undefined } : policy);
    render(
      <PolicyCards
        policies={[...ids.map((id) => withoutVisual(published(id, id))), bare]}
        selectedPolicies={[...ids, bare.id]}
        parameterTables={file}
        onShowEffect={() => {}}
      />,
    );
    const selector = CARD_SECTIONS.map((name) => `.${name}`).join(", ");
    for (const item of document.querySelectorAll(".policy-cards > .policy-card")) {
      const found = [...item.querySelectorAll(selector)].map((node) => CARD_SECTIONS.find((name) => node.classList.contains(name)));
      const ranks = found.map((name) => CARD_SECTIONS.indexOf(name));
      expect(ranks, found.join(" ")).toEqual([...ranks].sort((a, b) => a - b));
      // Each section once, and the title, summary and effect on every card
      expect(new Set(found).size).toBe(found.length);
      for (const name of ["policy-card-name", "policy-card-summary", "policy-card-effect"]) expect(found).toContain(name);
      // The footer last, so it can sit at the bottom
      expect(item.lastElementChild).toHaveClass("policy-card-foot");
    }
    // A card with details and a What changes block has every section
    const full = [...document.querySelectorAll(".policy-cards > .policy-card")].find((item) => item.querySelector(".policy-card-example") && item.querySelector(".pchg"));
    for (const name of CARD_SECTIONS.filter((section) => !UNMODELLED_ONLY_SECTIONS.includes(section))) {
      expect(full.querySelector(`.${name}`), name).toBeTruthy();
    }
  });

  it("makes the two cards in a row one height, the footer pinned to the bottom, no inner box stretched", () => {
    const css = readFileSync(join(__dirname, "PolicyCards.css"), "utf8");
    const rule = (selector) => css.match(new RegExp(`\n${selector.replace(/[.]/g, "\\.").replace(/>/g, "\\s*>\\s*")} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".policy-cards")).toMatch(/align-items: stretch;/);
    expect(rule(".policy-cards > .policy-card")).toMatch(/display: flex;[\s\S]*flex-direction: column;/);
    expect(rule(".policy-cards > .policy-card > \\*")).toMatch(/flex: none;/);
    expect(rule(".policy-cards > .policy-card > .policy-card-foot")).toMatch(/margin-top: auto;/);
  });

  it("pairs the modelled cards by shape through cardOrder: the charts together, then the tiles", () => {
    const ordered = POLICY_DETAILS.filter((p) => p.cardOrder).sort((a, b) => a.cardOrder - b.cardOrder).map((p) => p.id);
    expect(ordered.slice(0, 2)).toEqual(["fuel_duty_rise_deferral", "carers_allowance_earnings_taper"]);
    expect(new Set(POLICY_DETAILS.filter((p) => p.cardOrder).map((p) => p.cardOrder)).size).toBe(ordered.length);
  });

  it("orders the cards by each entry's cardOrder, charts together, with each card's costing row and example", () => {
    const ids = ["trading_allowance_raise", "property_income_rates_up", "household_energy_payment_2026", "carers_allowance_earnings_taper"];
    render(<PolicyCards policies={ids.map((id) => published(id, id, id === "property_income_rates_up" ? "revenue" : "cost"))} selectedPolicies={ids} onShowEffect={() => {}} />);
    const cards = screen.getAllByRole("listitem").filter((item) => item.classList.contains("policy-card"));
    // cardOrder: Carer's Allowance 2, the energy payment 3, trading 4, property 6; not raises first
    expect(cards.map((item) => item.querySelector("h3").textContent)).toEqual([
      "carers_allowance_earnings_taper", "household_energy_payment_2026", "trading_allowance_raise", "property_income_rates_up",
    ]);
    const costing = within(cards[3]).getByRole("link", { name: /^Costing: Budget 2026, Table 6\.1, row 61/ });
    expect(costing).toHaveAttribute("target", "_blank");
    expect(costing.getAttribute("href")).toMatch(/^https:\/\/www\.gov\.uk\/government\/publications\/budget-2026-document\//);
    // The trading allowance's worked example, under What changes; none where no source gives one
    const example = within(cards[2]).getByRole("region", { name: /^Example: / });
    expect(example).toHaveTextContent("An employee on £30,000 with £3,000 of side income and no expenses pays £400 less income tax in 2027-28.");
    expect(cards[2].querySelector(".policy-card-spec")).toContainElement(example);
    expect(cards[0].querySelector(".policy-card-example")).toBeNull();
  });

  it("gives each Budget measure the Table 6.1 rows the reconciliation maps it to", () => {
    const csv = readFileSync(join(__dirname, "..", "..", "data_inputs", "treasury", "mapping.csv"), "utf8").trim().split("\n").slice(1);
    const mapped = {};
    for (const line of csv) {
      const [id, source, row] = line.split(",");
      if (source === "AB2026-T6.1") (mapped[id] ??= []).push(Number(row));
    }
    for (const policy of POLICY_DETAILS.filter((entry) => entry.budgetRows)) {
      expect(policy.budgetRows, policy.id).toEqual(mapped[policy.id]);
    }
    expect(Object.keys(mapped).filter((id) => detailsById[id]).every((id) => detailsById[id].budgetRows), "every mapped measure has its rows").toBe(true);
  });

  it("keeps every modelled card's text short: summary, example and each About this result point 20 words at most", () => {
    const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
    const ids = Object.keys(file.measures);
    render(<PolicyCards policies={ids.map((id) => published(id, id))} selectedPolicies={ids} parameterTables={file} />);
    const words = (node) => node.textContent.trim().split(/\s+/).length;
    const long = [];
    for (const card of document.querySelectorAll(".policy-cards > .policy-card")) {
      const toggle = within(card).queryByRole("button", { name: "About this result" });
      if (toggle) fireEvent.click(toggle);
      const blocks = [
        ...card.querySelectorAll(".policy-card-summary, .policy-card-example-text, .policy-card-example-items li, .policy-card-details li, .policy-card-details p"),
      ];
      for (const block of blocks) if (words(block) > 20) long.push(`${card.id}: ${block.textContent.trim()}`);
      expect(words(card.querySelector(".policy-card-affects dd") ?? { textContent: "" }), card.id).toBeLessThanOrEqual(12);
    }
    expect(long).toEqual([]);
  });

  it("lists a lead line's points as real bullets", () => {
    const id = "household_energy_payment_2026";
    render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} />);
    const example = screen.getByRole("region", { name: /^Who it reaches/ });
    expect(example.querySelector(".policy-card-example-text")).toHaveTextContent(/including:$/);
    const list = example.querySelector("ul.policy-card-example-items");
    expect([...list.children].map((item) => item.tagName)).toEqual(["LI", "LI"]);
    expect(list.children[0]).toHaveTextContent("83% of households spending over a tenth of their income on energy");
  });

  it("shows the Carer's Allowance cliff the taper removes, with the limit in the note (PR 290, Anthony, 19:20)", () => {
    const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
    const id = "carers_allowance_earnings_taper";
    render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} parameterTables={file} />);
    const block = screen.getByRole("region", { name: /^What changes/ });
    // No level tiles (Vahid, 28 Oct): the note, under the allowance drawn
    // against weekly earnings, the cliff in the loss colour (Anthony)
    expect(block.querySelector(".pchg-tile, .pchg-ba")).toBeNull();
    expect(within(block).getByRole("img", { name: /against weekly earnings/ })).toBeInTheDocument();
    expect(block.querySelector(".pviz-cliff")).not.toBeNull();
    expect(block).not.toHaveTextContent(/£204|£323|£119/);
    expect(block.querySelector(".pchg-note")).toHaveTextContent("£228 a week in 2030-31 and £234 in 2031-32");
    expect(block.querySelector(".pchg-note")).toHaveTextContent("runs out at £324 a week in 2030-31 and £332 in 2031-32");
    // The limit is not shown as a change the measure makes
    expect(block).not.toHaveTextContent(/Earnings limit|Weekly earnings at which/);
  });

  it("shows no year strip by default: At a glance says when", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[published(id, id)]} selectedPolicies={[id]} />);
    expect(screen.getByRole("listitem").querySelector(".ptl")).toBeNull();
  });

  it("keeps every modelled card's Starts and Ends to 20 characters", () => {
    for (const policy of POLICY_DETAILS) {
      expect(policy.starts.length, policy.id).toBeLessThanOrEqual(20);
      if (policy.ends) expect(policy.ends.length, policy.id).toBeLessThanOrEqual(20);
    }
  });
});
