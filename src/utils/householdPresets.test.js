import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { SELECTABLE_YEARS } from "./displayYears";
import { buildHouseholdRequest, requestKey } from "./householdImpactApi";
import { PRESET_POLICIES, presetCacheEntries, presetChanges, presetInputs, presetRequests } from "./householdPresets";

const file = JSON.parse(readFileSync("public/data/household_presets.json", "utf8"));
const lock = readFileSync("uv.lock", "utf8");
/** A package's version in uv.lock. */
const locked = (name) => lock.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`))?.[1];

describe("the examples' precomputed results (public/data/household_presets.json)", () => {
  it("cover every example in every year a reader can choose, with every measure", () => {
    expect(file.years).toEqual([...SELECTABLE_YEARS]);
    expect(file.policies).toEqual(PRESET_POLICIES);
    expect(file.entries.map((entry) => `${entry.preset_id} ${entry.year}`).sort()).toEqual(
      presetRequests()
        .map((entry) => `${entry.preset_id} ${entry.year}`)
        .sort(),
    );
  });

  it("answer the page's own requests: re-run the precompute if an example or the form changes", () => {
    for (const entry of file.entries) {
      const preset = HOUSEHOLD_EXAMPLES.find((example) => example.id === entry.preset_id);
      const asked = buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies: PRESET_POLICIES });
      expect(requestKey(entry.request), entry.preset_id).toBe(requestKey(asked));
    }
    expect(presetCacheEntries(file)).toHaveLength(file.entries.length);
  });

  it("come from the engine the live API runs: re-run the precompute after a bundle upgrade", () => {
    expect(file.engine.policyengine).toBe(locked("policyengine"));
    expect(file.engine["policyengine-uk"]).toBe(locked("policyengine-uk"));
    // Each answer carries it, as a live one does, for the breakdown's Versions line
    for (const [, data] of presetCacheEntries(file)) {
      expect(data.engine.policyengine).toBe(locked("policyengine"));
    }
  });

  it("drop an entry whose example has changed, so the live API answers it", () => {
    const [first] = file.entries;
    const edited = { ...first, request: { ...first.request, household: { ...first.request.household, age: 99 } } };
    expect(presetCacheEntries({ entries: [edited] })).toEqual([]);
  });

  it("give each example's change in net income by year, for its card", () => {
    const changes = presetChanges(file);
    expect(Object.keys(changes).sort()).toEqual(HOUSEHOLD_EXAMPLES.map((example) => example.id).sort());
    for (const entry of file.entries) {
      expect(changes[entry.preset_id][entry.year]).toBe(entry.response.net_income.change);
    }
    // An entry whose example has changed gives no figure
    const [first] = file.entries;
    const edited = { ...first, request: { ...first.request, household: { ...first.request.household, age: 99 } } };
    expect(presetChanges({ entries: [edited] })).toEqual({});
  });
});
