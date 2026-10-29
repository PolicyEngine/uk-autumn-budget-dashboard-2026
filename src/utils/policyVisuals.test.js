import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICY_DETAILS } from "./policyDetails";
import {
  carersTaperView,
  electricityVatView,
  energyReachView,
  fuelDutyView,
  pensionAllowanceView,
  propertyRatesView,
  tradingAllowanceView,
  wholePounds,
} from "./policyVisuals";

const document = JSON.parse(readFileSync(join(process.cwd(), "public/data/policy_parameters.json"), "utf8"));
const details = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));
const entry = (id) => document.measures[id];
const visual = (id) => details[id].visual;

describe("every modelled measure has a visual", () => {
  it("one per measure in policy_parameters.json, each of its own kind", () => {
    const kinds = Object.keys(document.measures).map((id) => visual(id)?.kind);
    expect(kinds.every(Boolean)).toBe(true);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("each entry is written for the description the file carries", () => {
    for (const id of Object.keys(document.measures)) {
      expect(details[id].writtenFor, id).toBe(entry(id).description);
    }
  });
});

describe("fuelDutyView", () => {
  const view = fuelDutyView(entry("fuel_duty_rise_deferral"), visual("fuel_duty_rise_deferral"));

  it("gives each period of the cut, and the duty saved on a 50-litre fill", () => {
    expect(view.cuts.map((cut) => [cut.months, Math.round(cut.gap * 100) / 100, cut.fill.toFixed(2)])).toEqual([
      ["Jan to Feb 2027", 3, "1.50"],
      ["Mar 2027", 5, "2.50"],
      ["Apr to Jun 2027", 7.64, "3.82"],
    ]);
    expect(view.largest.gap).toBeCloseTo(7.64, 6);
    expect([view.low, view.high]).toEqual([52.95, 60.59]);
  });

  it("is null without a schedule", () => {
    expect(fuelDutyView(entry("trading_allowance_raise"), visual("fuel_duty_rise_deferral"))).toBeNull();
  });
});

describe("carersTaperView", () => {
  it("reads the limit and where the taper runs out from the row's figures, the rate from its points", () => {
    const view = carersTaperView(entry("carers_allowance_earnings_taper"));
    expect(view).toMatchObject({ year: "2030-31", limit: 228, runsOut: 324, rate: 96.44 });
  });

  it("draws nothing when the figures and the row disagree, or are missing", () => {
    const original = entry("carers_allowance_earnings_taper");
    const changed = {
      ...original,
      rows: [{ ...original.rows[0], figures: { ...original.rows[0].figures, runs_out: { "2030-31": 400 } } }],
    };
    expect(carersTaperView(changed)).toBeNull();
    const { figures: _figures, ...bare } = original.rows[0];
    expect(carersTaperView({ ...original, rows: [bare] })).toBeNull();
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

describe("tradingAllowanceView", () => {
  const id = "trading_allowance_raise";

  it("gives the band before and after, and the example's figures as its text says them", () => {
    const view = tradingAllowanceView(entry(id), visual(id));
    expect(view).toMatchObject({ before: 1000, after: 3000, year: "2027-28" });
    const { income, sideIncome, saving } = view.example;
    expect(details[id].example.text).toBe(
      `An employee on ${wholePounds(income)} with ${wholePounds(sideIncome)} of side income and no expenses pays ${wholePounds(saving)} less income tax in 2027-28.`,
    );
  });
});

describe("electricityVatView", () => {
  const id = "domestic_electricity_zero_vat";
  const view = electricityVatView(entry(id), visual(id));

  it("zero-rates October 2026 to June 2027 in Great Britain, April to June 2027 in Northern Ireland (expected)", () => {
    expect([view.before, view.after]).toEqual([0.05, 0]);
    const zero = (name) => view.regions.find((region) => region.name === name).cells.filter((cell) => cell.zero).map((cell) => cell.month);
    expect(zero("Great Britain")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
    expect(zero("Northern Ireland")).toEqual(["2027-04", "2027-05", "2027-06"]);
    expect(view.regions[1].expected).toBe(true);
    // The row's own dates and note
    expect(entry(id).rows[0].points[0].key).toBe("2026-10-01/2027-06-30");
    expect(view.note).toBe("0% instead of 5% from October 2026 (Northern Ireland from April 2027).");
  });

  it("marks October to March as law before the Budget", () => {
    expect([view.months[view.law.first], view.months[view.law.last]]).toEqual(["2026-10", "2027-03"]);
  });
});

describe("propertyRatesView", () => {
  it("gives the three rates from 2027-28", () => {
    const view = propertyRatesView(entry("property_income_rates_up"));
    expect(view.year).toBe("2027-28");
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
