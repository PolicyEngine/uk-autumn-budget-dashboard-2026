import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { SELECTABLE_YEARS } from "./displayYears";
import { buildHouseholdRequest, isRenting, requestKey } from "./householdImpactApi";
import { cardFigures } from "../components/personal/HouseholdCards";
import { presetCacheEntries, presetChanges, presetInputs, presetRequests } from "./householdPresets";
import { approvedDefinition } from "../test/definitionsFixture";
import { IDENTITY_FIELDS } from "./publication/definitions";

const committed = JSON.parse(readFileSync("public/data/household_presets.json", "utf8"));
// What the receipts approved for each of the file's measures (synthetic),
// and the file recording them, as the precompute writes them (#136): the
// page uses its answers only then. The committed file's own are checked
// below; these tests are of its answers.
const DEFINITIONS = Object.fromEntries(committed.policies.map((id) => [id, approvedDefinition(id)]));
const file = { ...committed, definitions: DEFINITIONS };
// The receipts' engine and definitions when they are the file's: the page
// uses the answers then
const published = { expectedEngine: file.engine, expectedDefinitions: DEFINITIONS };
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
      const asked = buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies: file.policies });
      expect(requestKey(entry.request), entry.preset_id).toBe(requestKey(asked));
    }
    expect(presetCacheEntries(file, published)).toHaveLength(file.entries.length);
  });

  it("hold every example card's own request, in every year: a stale file fails here, not as 'Calculated when chosen'", () => {
    const keys = new Set(file.entries.map((entry) => requestKey(entry.request)));
    for (const example of HOUSEHOLD_EXAMPLES) {
      for (const year of SELECTABLE_YEARS) {
        const asked = buildHouseholdRequest(presetInputs(example), { year, policies: file.policies });
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
      expect(Object.keys(byPolicy).sort()).toEqual([...file.policies].sort());
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
    // The middle earner's own measure (the threshold freeze) changes
    // nothing before 2031-32
    expect(figures("middle-earner", 2027).top.own).toBe(false);
    expect(Math.round(figures("middle-earner", 2031).ownPart)).not.toBe(0);
    // The part-time worker's own measure gives most of its change
    expect(figures("part-time-worker", 2027).top).toMatchObject({ own: true });
    // A bar for each year a reader can choose
    expect(figures("part-time-worker", 2027).series.map((point) => point.year)).toEqual([...SELECTABLE_YEARS]);
  });
});

describe("the examples' precomputed results under another engine (PR 104)", () => {
  const packages = Object.keys(file.engine);

  it("are never used when no engine is known: with no measure selected the page has none to check them against", () => {
    for (const expectedEngine of [undefined, null, {}]) {
      expect(presetCacheEntries(file, { expectedEngine, expectedDefinitions: DEFINITIONS })).toEqual([]);
      expect(presetChanges(file, { expectedEngine, expectedDefinitions: DEFINITIONS })).toEqual({});
    }
  });

  it("are never used when any package the receipts record differs from the file's", () => {
    fc.assert(
      fc.property(fc.subarray(packages, { minLength: 1 }), fc.string(), (changed, suffix) => {
        const expectedEngine = { ...file.engine };
        for (const name of changed) expectedEngine[name] = `${file.engine[name]}+other${suffix}`;
        expect(presetCacheEntries(file, { expectedEngine, expectedDefinitions: DEFINITIONS })).toEqual([]);
        expect(presetChanges(file, { expectedEngine, expectedDefinitions: DEFINITIONS })).toEqual({});
      }),
    );
  });

  it("are all used when the receipts record exactly the file's packages, or any of them", () => {
    fc.assert(
      fc.property(fc.subarray(packages, { minLength: 1 }), (named) => {
        const expectedEngine = Object.fromEntries(named.map((name) => [name, file.engine[name]]));
        expect(presetCacheEntries(file, { expectedEngine, expectedDefinitions: DEFINITIONS })).toHaveLength(file.entries.length);
      }),
      { numRuns: 20 },
    );
  });
});

// #136: the household API's answers are shown only when it reports each
// selected measure's approved definition; the file's are held to the same.
describe("the examples' precomputed results and the receipts' definitions (PR 136)", () => {
  const ids = [...file.policies].sort();
  const options = (expectedDefinitions) => ({ expectedEngine: file.engine, expectedDefinitions });
  const unused = (candidate, expectedDefinitions) => {
    expect(presetCacheEntries(candidate, options(expectedDefinitions))).toEqual([]);
    expect(presetChanges(candidate, options(expectedDefinitions))).toEqual({});
  };

  it("are never used from a file that records none (one written before them)", () => {
    const { definitions, ...before } = file;
    expect(definitions).toBeDefined();
    unused(before, DEFINITIONS);
    unused({ ...file, definitions: null }, DEFINITIONS);
  });

  it("are never used when no definitions are expected: the page then has none to check them against", () => {
    for (const expectedDefinitions of [undefined, null]) unused(file, expectedDefinitions);
  });

  // One measure's recorded definition changed in any field the check
  // compares, or missing, or one the code could not bind, or a measure
  // without an approved one: never used
  const changed = fc.oneof(
    fc.constant((definition) => undefined),
    fc.constant((definition) => ({ git_sha: definition.git_sha, error: "not a measure the running code registers" })),
    fc.constantFrom("0".repeat(40), "f".repeat(40)).map((sha) => (definition) => ({ ...definition, git_sha: sha })),
    fc.tuple(fc.constantFrom("baseline", "reform"), fc.constantFrom(...IDENTITY_FIELDS), fc.string({ minLength: 1 })).map(
      ([side, field, value]) => (definition) => ({ ...definition, [side]: { ...definition[side], [field]: `${definition[side][field]}${value}` } }),
    ),
  );

  it("are never used when any measure's recorded definition is not its approved one", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), changed, (id, change) => {
        const recorded = { ...DEFINITIONS };
        const next = change(DEFINITIONS[id]);
        if (next === undefined) delete recorded[id];
        else recorded[id] = next;
        unused({ ...file, definitions: recorded }, DEFINITIONS);
        // And the same the other way: the receipt approved the changed one
        if (next !== undefined) unused(file, { ...DEFINITIONS, [id]: next });
      }),
      { numRuns: 60 },
    );
  });

  it("are never used when a measure of the file's has no approved definition", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), (id) => {
        const { [id]: _, ...rest } = DEFINITIONS;
        unused(file, rest);
      }),
    );
  });

  it("are all used, each carrying the file's definitions for useHouseholdImpact's own check, when every one is the approved one", () => {
    const entries = presetCacheEntries(file, published);
    expect(entries).toHaveLength(file.entries.length);
    for (const [, data] of entries) expect(data.definitions).toEqual(DEFINITIONS);
    // Only the measures' own: one approved for another measure besides changes nothing
    expect(presetCacheEntries(file, options({ ...DEFINITIONS, other_measure: approvedDefinition("other_measure") }))).toHaveLength(
      file.entries.length,
    );
  });

  it("give each answer the file's record when it reports none of its own, as the precompute's answers don't", () => {
    for (const own of [{}, undefined, null]) {
      const candidate = {
        ...file,
        entries: file.entries.map((entry) => ({ ...entry, response: { ...entry.response, definitions: own } })),
      };
      const entries = presetCacheEntries(candidate, published);
      expect(entries).toHaveLength(file.entries.length);
      for (const [, data] of entries) expect(data.definitions).toEqual(DEFINITIONS);
      expect(Object.keys(presetChanges(candidate, published)).sort()).toEqual(
        [...new Set(file.entries.map((entry) => entry.preset_id))].sort(),
      );
    }
  });

  it("leave out an answer that reports a definition of its own other than the approved one, from the cards and the calculator", () => {
    fc.assert(
      fc.property(fc.nat(file.entries.length - 1), fc.constantFrom(...ids), changed, (index, id, change) => {
        const next = change(DEFINITIONS[id]);
        // Missing from the answer's own report: the file's record stands
        fc.pre(next !== undefined);
        const entries = file.entries.map((entry, i) =>
          i === index ? { ...entry, response: { ...entry.response, definitions: { [id]: next } } } : entry,
        );
        const candidate = { ...file, entries };
        const cached = presetCacheEntries(candidate, published);
        expect(cached).toHaveLength(file.entries.length - 1);
        // Every answer the calculator gets passes its own check
        for (const [, data] of cached) expect(data.definitions).toEqual(DEFINITIONS);
        const { preset_id: presetId, year } = file.entries[index];
        expect(presetChanges(candidate, published)[presetId]?.[year]).toBeUndefined();
        // The others are all there
        expect(presetChanges(file, published)[presetId]?.[year]).toBeDefined();
      }),
      { numRuns: 60 },
    );
  });

  it("the committed file records one for each of its measures at a full commit, or none (a file written before them)", () => {
    if (committed.definitions === undefined) return;
    expect(Object.keys(committed.definitions).sort()).toEqual(ids);
    for (const id of ids) expect(committed.definitions[id].git_sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
