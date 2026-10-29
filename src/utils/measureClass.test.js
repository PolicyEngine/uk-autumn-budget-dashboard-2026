import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CALCULATOR_ONLY_MEASURES, isCalculatorOnly, withCalculatorOnly, withoutCalculatorOnly } from "./calculatorOnlyMeasures";
import { HOUSEHOLD_ONLY_TITLE, MEASURE_CLASSES, classOf, householdOnlyLine, splitUnmodelled } from "./measureClass";
import { UNMODELLED_MEASURES } from "./unmodelledMeasures";

// A not-modelled list (cards c0, c1, ...), calculator-only measures (m0,
// m1, ...) that may name a card in it, one outside it or none, and the
// published ids, which may include calculator-only ones
const world = fc
  .record({
    cards: fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 18 }),
    measures: fc.uniqueArray(fc.integer({ min: 0, max: 12 }), { maxLength: 6 }),
  })
  .chain(({ cards, measures }) =>
    fc.record({
      list: fc.constant(cards.map((n) => ({ id: `c${n}`, name: `Card ${n}` }))),
      calculatorOnly: fc
        .tuple(...measures.map(() => fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined })))
        .map((picks) =>
          Object.fromEntries(
            measures.map((n, index) => [`m${n}`, { id: `m${n}`, name: `Measure ${n}`, note: "", ...(picks[index] === undefined ? {} : { card: `c${picks[index]}` }) }]),
          ),
        ),
      published: fc.subarray([...measures.map((n) => `m${n}`), "p0", "p1", "p2"]),
    }),
  )
  // A card names one measure at most (calculatorOnlyMeasures.js; a test
  // below checks the real list)
  .filter(({ calculatorOnly }) => {
    const cards = Object.values(calculatorOnly).map(({ card }) => card).filter(Boolean);
    return new Set(cards).size === cards.length;
  });

const ids = (items) => items.map(({ id }) => id);
const isSubsequence = (part, whole) => {
  let at = 0;
  for (const id of whole) if (id === part[at]) at += 1;
  return at === part.length;
};

describe("the three classes (measureClass.js)", () => {
  it("put every policy in exactly one class, published first", () => {
    fc.assert(
      fc.property(world, fc.string(), ({ calculatorOnly, published }, other) => {
        for (const id of [...Object.keys(calculatorOnly), ...published, other]) {
          const cls = classOf(id, { published, calculatorOnly });
          expect(MEASURE_CLASSES).toContain(cls);
          expect(cls === "population").toBe(published.includes(id));
          expect(cls === "household").toBe(!published.includes(id) && Object.hasOwn(calculatorOnly, id));
        }
      }),
    );
  });

  it("split the not-modelled cards into disjoint classes that cover the list, each in the list's order", () => {
    fc.assert(
      fc.property(world, ({ list, calculatorOnly, published }) => {
        const split = splitUnmodelled(list, { calculatorOnly, published });
        const parts = [split.population, split.household, split.none].map(ids);
        expect(parts.flat().sort()).toEqual(ids(list).sort());
        expect(new Set(parts.flat()).size).toBe(list.length);
        for (const part of parts) expect(isSubsequence(part, ids(list))).toBe(true);
      }),
    );
  });

  it("give a household-only card the calculator-only measure that names it, never a published one", () => {
    fc.assert(
      fc.property(world, ({ list, calculatorOnly, published }) => {
        const split = splitUnmodelled(list, { calculatorOnly, published });
        for (const card of split.household) {
          expect(calculatorOnly[card.measure].card).toBe(card.id);
          expect(published).not.toContain(card.measure);
          // The card's own words, unchanged
          expect(card).toEqual({ ...list.find(({ id }) => id === card.id), measure: card.measure });
        }
        // Every card a calculator-only measure names is household-only
        // until we publish that measure, and then in neither section
        for (const { id, card } of Object.values(calculatorOnly)) {
          if (!card || !ids(list).includes(card)) continue;
          expect(ids(published.includes(id) ? split.population : split.household)).toContain(card);
          expect(ids(split.none)).not.toContain(card);
        }
      }),
    );
  });

  it("leave the not-modelled list as it is when no calculator-only measure names a card in it", () => {
    fc.assert(
      fc.property(world, ({ list, calculatorOnly, published }) => {
        const bare = Object.fromEntries(Object.entries(calculatorOnly).map(([id, { card, ...rest }]) => [id, rest]));
        // No card named at all: the very list, so the section renders as before
        expect(splitUnmodelled(list, { calculatorOnly: bare, published })).toEqual({ population: [], household: [], none: list });
        expect(splitUnmodelled(list, { calculatorOnly: bare, published }).none).toBe(list);
        expect(splitUnmodelled(list, { calculatorOnly: {}, published }).none).toBe(list);
        // Cards named outside the list: the same cards, in the same order
        const outside = Object.fromEntries(Object.entries(calculatorOnly).map(([id, measure]) => [id, { ...measure, card: `outside-${id}` }]));
        expect(splitUnmodelled(list, { calculatorOnly: outside, published }).none).toEqual(list);
      }),
    );
  });

  it("say the class plainly, for one policy or several", () => {
    expect(HOUSEHOLD_ONLY_TITLE).toBe("Policies we model for households only");
    expect(householdOnlyLine(1)).toBe("Household calculator only: our survey data can't yet estimate its national effect.");
    expect(householdOnlyLine(2)).toBe("Household calculator only: our survey data can't yet estimate their national effects.");
  });
});

describe("the calculator-only measures' requests (calculatorOnlyMeasures.js)", () => {
  // Any selection of published ids, with or without a calculator-only one
  const selection = fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e", "f", "g", ...Object.keys(CALCULATOR_ONLY_MEASURES)), { maxLength: 8 });

  it("always add every one after the selection, once each, and take them off again for every national figure", () => {
    fc.assert(
      fc.property(selection, (selected) => {
        const request = withCalculatorOnly(selected);
        // Nothing selected: no request, so nothing added
        if (selected.length === 0) {
          expect(request).toEqual([]);
          return;
        }
        expect(request.slice(0, selected.length)).toEqual(selected);
        expect(new Set(request).size).toBe(request.length);
        for (const id of request.slice(selected.length)) expect(isCalculatorOnly(id)).toBe(true);
        for (const id of Object.keys(CALCULATOR_ONLY_MEASURES)) expect(request).toContain(id);
        expect(withoutCalculatorOnly(request)).toEqual(withoutCalculatorOnly(selected));
        // Idempotent: a request that has them all gains nothing
        expect(withCalculatorOnly(request)).toEqual(request);
      }),
    );
  });
});

describe("the page's own lists", () => {
  it("name, for each calculator-only measure with a card, one card the not-modelled list has", () => {
    const cards = Object.values(CALCULATOR_ONLY_MEASURES).map(({ card }) => card).filter(Boolean);
    expect(new Set(cards).size).toBe(cards.length);
    for (const card of cards) expect(ids(UNMODELLED_MEASURES), card).toContain(card);
  });

  it("show the savings income tax rise as household-only, on its card, until we publish it", () => {
    const split = splitUnmodelled();
    expect(split.household.map(({ id, measure }) => [id, measure])).toEqual([["savings-income-tax", "savings_income_rates_up"]]);
    expect(ids(split.none)).not.toContain("savings-income-tax");
    expect(split.none).toHaveLength(UNMODELLED_MEASURES.length - 1);
    expect(splitUnmodelled(undefined, { published: ["savings_income_rates_up"] }).household).toEqual([]);
  });

  // No household-only measure in any national figure: the manifest, its
  // package (combined) runs, the downloads or any other published file.
  // The example households' answers (household_presets.json, one household
  // each) carry it in every entry, as every household request does
  // (calculatorOnlyMeasures.js, Vahid, 28 October 2026)
  it("keep every calculator-only measure out of everything published in public/data but the examples' answers, which all carry it", () => {
    const root = join(process.cwd(), "public", "data");
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const PRESETS = "household_presets.json";
    const presets = JSON.parse(readFileSync(join(root, PRESETS), "utf8"));
    expect(presets.entries.length).toBeGreaterThan(0);
    for (const id of Object.keys(CALCULATOR_ONLY_MEASURES)) {
      // Published after all? Then it is no longer calculator-only: take it
      // out of calculatorOnlyMeasures.js in the same change
      expect(Object.keys(manifest.measures), id).not.toContain(id);
      for (const combined of Object.values(manifest.combined ?? {})) expect(combined.measures ?? [], id).not.toContain(id);
      const naming = files.filter((path) => relative(root, path) !== PRESETS && readFileSync(path, "utf8").includes(id));
      expect(naming, id).toEqual([]);
      // The examples' shared selection never has it; every example's
      // answers do, for every year
      expect(presets.policies, id).not.toContain(id);
      for (const entry of presets.entries) {
        expect(JSON.stringify(entry).includes(id), `${entry.preset_id} ${entry.year}: ${id}`).toBe(true);
      }
    }
  });
});
