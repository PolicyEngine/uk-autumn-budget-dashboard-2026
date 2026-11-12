import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICY_DETAILS } from "./policyDetails";
import {
  energyReachView,
  pensionAllowanceView,
  propertyRatesView,
} from "./policyVisuals";

const document = JSON.parse(readFileSync(join(process.cwd(), "public/data/policy_parameters.json"), "utf8"));
const details = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));
const entry = (id) => document.measures[id];
const visual = (id) => details[id].visual;

describe("source-bound optional policy visuals", () => {
  it("keeps distinct visuals only where the source-bound example remains valid", () => {
    const kinds = Object.keys(document.measures).map((id) => visual(id)?.kind).filter(Boolean);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const id of ["fuel_duty_rise_deferral", "carers_allowance_earnings_taper", "domestic_electricity_zero_vat", "trading_allowance_raise", "bus_fare_cap_2027"]) {
      expect(visual(id), id).toBeUndefined();
      expect(details[id].example, id).toBeUndefined();
    }
  });

  it("each entry is written for the description the file carries", () => {
    for (const id of Object.keys(document.measures)) {
      expect(details[id].writtenFor, id).toBe(entry(id).description);
    }
  });
});



describe("energyReachView", () => {
  const id = "household_energy_payment_2026";
  const view = energyReachView(entry(id), visual(id));

  it("pays £100 in bands A to D of England's eight", () => {
    expect(view.amount).toBe(100);
    expect(view.paid).toEqual(["A", "B", "C", "D"]);
    expect(view.bands).toHaveLength(8);
    expect(details[id].writtenFor).toMatch(/bands A to D \(the lowest four of England's eight\)/);
  });

  it("states the example's reach, and England's households as 20 million over 80%", () => {
    const { text, items } = details[id].example;
    expect(text).toContain(`Up to ${view.millions} million households in England (about ${view.share * 100}%)`);
    view.groups.forEach((group, i) => expect(items[i]).toMatch(new RegExp(`^${Math.round(group.share * 100)}% of households`)));
    expect(view.totalMillions).toBe(25);
  });
});



describe("propertyRatesView", () => {
  it("gives the three rates from 2027-28", () => {
    const view = propertyRatesView(entry("property_income_rates_up"));
    expect(view.year).toBe("6 April 2027");
    expect(view.rates.map((rate) => [rate.label, rate.before, rate.after])).toEqual([
      ["basic rate", 0.22, 0.24],
      ["higher rate", 0.42, 0.44],
      ["additional rate", 0.47, 0.49],
    ]);
  });
});

describe("pensionAllowanceView", () => {
  const id = "state_pension_income_tax_protection";
  const view = pensionAllowanceView(entry(id), visual(id));

  it("pays £94 up to £13,036.40 and is gone at about £13,319, as the description says", () => {
    expect(view).toMatchObject({ year: "2027-28", largest: 94, fullPension: 13036.4, goneAt: 13319, taper: 3 });
    expect(details[id].writtenFor).toMatch(/£13,036\.40 in 2027-28/);
    expect(details[id].writtenFor).toMatch(/£1 for every £3/);
    expect(details[id].writtenFor).toMatch(/about £13,319/);
  });

  it("puts the explainer's examples on the taper", () => {
    expect(Math.round(view.at(13186))).toBe(44);
    expect(details[id].example.text).toMatch(/at £13,186, the allowance is £44/);
  });

  it("draws nothing for an example off the taper", () => {
    const off = { ...visual(id), examples: [{ income: 13186, allowance: 60 }] };
    expect(pensionAllowanceView(entry(id), off)).toBeNull();
  });
});
