import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { SELECTABLE_YEARS } from "./displayYears";
import { buildHouseholdRequest, isRenting, requestKey } from "./householdImpactApi";
import { cardFigures } from "../components/personal/HouseholdCards";
import { presetCacheEntries, presetChanges, presetInputs, presetPolicies, presetRequests } from "./householdPresets";

const file = JSON.parse(readFileSync("public/data/household_presets.json", "utf8"));
// The receipts' engine when it is the file's: the page uses the answers then
const published = { expectedEngine: file.engine };
const lock = readFileSync("uv.lock", "utf8");
/** A package's version in uv.lock. */
const locked = (name) => lock.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`))?.[1];

describe("the examples' precomputed results (public/data/household_presets.json)", () => {
  it("cover every example in every year a reader can choose, with every measure", () => {
    expect(file.years).toEqual([...SELECTABLE_YEARS]);
    expect(file.policies.length).toBeGreaterThan(0);
    expect(file.entries.map((entry) => `${entry.preset_id} ${entry.year}`).sort()).toEqual(
      presetRequests(file.policies)
        .map((entry) => `${entry.preset_id} ${entry.year}`)
        .sort(),
    );
  });

  it("answer the page's own requests: re-run the precompute if an example or the form changes", () => {
    for (const entry of file.entries) {
      const preset = HOUSEHOLD_EXAMPLES.find((example) => example.id === entry.preset_id);
      // The saver's with the calculator-only savings rise it turns on
      const asked = buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies: presetPolicies(preset, file.policies) });
      expect(requestKey(entry.request), entry.preset_id).toBe(requestKey(asked));
    }
    expect(presetCacheEntries(file, published)).toHaveLength(file.entries.length);
  });

  it("hold every example card's own request, in every year: a stale file fails here, not as 'Calculated when chosen'", () => {
    const keys = new Set(file.entries.map((entry) => requestKey(entry.request)));
    for (const example of HOUSEHOLD_EXAMPLES) {
      for (const year of SELECTABLE_YEARS) {
        const asked = buildHouseholdRequest(presetInputs(example), { year, policies: presetPolicies(example, file.policies) });
        expect(keys.has(requestKey(asked)), `${example.id} ${year}: re-run the precompute`).toBe(true);
      }
    }
  });

  it("are for examples that fix every answer: the form's defaults and prefills change no example's request", () => {
    for (const example of HOUSEHOLD_EXAMPLES) {
      for (const year of SELECTABLE_YEARS) {
        const options = { year, policies: file.policies };
        // The example's answers alone, and over the form's defaults: the same
        expect(requestKey(buildHouseholdRequest(example.inputs, options)), `${example.id} ${year}`).toBe(
          requestKey(buildHouseholdRequest(presetInputs(example), options)),
        );
      }
      // A renter's rent is a fixed figure, never the area's prefilled rate
      if (isRenting(example.inputs.tenure)) {
        expect(Number.isFinite(example.inputs.monthly_rent), example.id).toBe(true);
      }
    }
  });

  it("come from the engine the live API runs: re-run the precompute after a bundle upgrade", () => {
    expect(file.engine.policyengine).toBe(locked("policyengine"));
    expect(file.engine["policyengine-uk"]).toBe(locked("policyengine-uk"));
    // Each answer carries it, as a live one does, for the breakdown's Versions line
    for (const [, data] of presetCacheEntries(file, published)) {
      expect(data.engine.policyengine).toBe(locked("policyengine"));
    }
  });

  it("drop an entry whose example has changed, so the live API answers it", () => {
    const [first] = file.entries;
    const edited = { ...first, request: { ...first.request, household: { ...first.request.household, age: 99 } } };
    expect(presetCacheEntries({ ...file, entries: [edited] }, published)).toEqual([]);
  });

  it("give each example's change in net income by year, for its card", () => {
    const changes = presetChanges(file, published);
    expect(Object.keys(changes).sort()).toEqual(HOUSEHOLD_EXAMPLES.map((example) => example.id).sort());
    for (const entry of file.entries) {
      const { change, byPolicy } = changes[entry.preset_id][entry.year];
      expect(change).toBe(entry.response.net_income.change);
      // Each measure's own part (alone, so the parts need not add up to
      // the change when measures interact)
      const preset = HOUSEHOLD_EXAMPLES.find((example) => example.id === entry.preset_id);
      expect(Object.keys(byPolicy).sort()).toEqual(presetPolicies(preset, file.policies).sort());
    }
    // An entry whose example has changed gives no figure
    const [first] = file.entries;
    const edited = { ...first, request: { ...first.request, household: { ...first.request.household, age: 99 } } };
    expect(presetChanges({ ...file, entries: [edited] }, published)).toEqual({});
  });

  it("give each card its figures, never crediting a measure with a change it does not make", () => {
    const changes = presetChanges(file, published);
    const figures = (id, year) => cardFigures(HOUSEHOLD_EXAMPLES.find((example) => example.id === id), changes[id], year);
    // The pensioner's own measure: its chip names the measure giving most
    const pensioner = figures("pensioner-70", 2027);
    expect(Math.round(pensioner.ownPart)).toBe(Math.round(changes["pensioner-70"][2027].byPolicy.state_pension_income_tax_protection));
    expect(Math.round(pensioner.ownPart)).not.toBe(0);
    // The carer's own measure (the Carer's Allowance taper) changes
    // nothing before 2030-31, so its chip names another measure then
    expect(Math.round(figures("carer", 2027).ownPart)).toBe(0);
    expect(figures("carer", 2027).top.own).toBe(false);
    expect(Math.round(figures("carer", 2031).ownPart)).not.toBe(0);
    expect(figures("carer", 2031).top).toMatchObject({ own: true });
    // The household from the post on the savings and property income
    // rates: the property rate alone (the savings rate is not in the
    // release) is £120 a year more income tax (the post's £150 was both),
    // and its own measure gives most of its change
    expect(Math.round(figures("landlord-45k", 2027).ownPart)).toBe(-120);
    expect(Math.round(figures("landlord-45k", 2031).ownPart)).toBe(-120);
    expect(figures("landlord-45k", 2027).top).toMatchObject({ own: true });
    // The pensioner on the full State Pension: its own measure gives most
    // of its change
    expect(figures("pensioner-full-state-pension", 2027).top).toMatchObject({ own: true });
    // A bar for each year a reader can choose
    expect(figures("pensioner-full-state-pension", 2027).series.map((point) => point.year)).toEqual([...SELECTABLE_YEARS]);
  });
});

describe("the examples' precomputed results under another engine (PR 104)", () => {
  const packages = Object.keys(file.engine);

  it("are never used when no engine is known: with no measure selected the page has none to check them against", () => {
    for (const expectedEngine of [undefined, null, {}]) {
      expect(presetCacheEntries(file, { expectedEngine })).toEqual([]);
      expect(presetChanges(file, { expectedEngine })).toEqual({});
    }
  });

  it("are never used when any package the receipts record differs from the file's", () => {
    fc.assert(
      fc.property(fc.subarray(packages, { minLength: 1 }), fc.string(), (changed, suffix) => {
        const expectedEngine = { ...file.engine };
        for (const name of changed) expectedEngine[name] = `${file.engine[name]}+other${suffix}`;
        expect(presetCacheEntries(file, { expectedEngine })).toEqual([]);
        expect(presetChanges(file, { expectedEngine })).toEqual({});
      }),
    );
  });

  it("are all used when the receipts record exactly the file's packages, or any of them", () => {
    fc.assert(
      fc.property(fc.subarray(packages, { minLength: 1 }), (named) => {
        const expectedEngine = Object.fromEntries(named.map((name) => [name, file.engine[name]]));
        expect(presetCacheEntries(file, { expectedEngine })).toHaveLength(file.entries.length);
      }),
      { numRuns: 20 },
    );
  });
});
