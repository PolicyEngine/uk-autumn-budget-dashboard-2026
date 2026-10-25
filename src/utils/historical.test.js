import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coverageOf, decimalText, shareText as text, toCsv } from "../test/historicalFixture";
import {
  accountsForEveryMeasure,
  add,
  CLASSES,
  compare,
  COMPUTED_ROW,
  COVERAGE_HEADER,
  coverageProblems,
  equals,
  formatShare,
  fraction,
  groupNotModelled,
  HistoricalDataError,
  NOT_MODELLED_HEADER,
  OBR_HEADER,
  ONE,
  parseCount,
  parseCoverage,
  parseDecimal,
  parseHistoricalObr,
  parseNotModelled,
  parseShare,
  releaseYears,
  sum,
  ZERO,
} from "./historical";

const EVENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "uk_budget_data", "events");
const EVENTS = readdirSync(EVENTS_DIR).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(EVENTS_DIR, name), "utf8")));

const GAPS = ["construction_pending", "model_or_data_gap", "dashboard_import"];

// An OBR cell's value, an exact decimal of up to four places
const cellValue = fc.record({ units: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), places: fc.integer({ min: 0, max: 4 }) })
  .map(({ units, places }) => fraction(units, 10n ** BigInt(places)));

/**
 * A synthetic event: measures with one class each (and a gap kind when not
 * expressible), each with OBR rows whose class and gap kind are drawn on
 * their own, as the scorecard allows; some expressible or partial measures
 * computed, with some of their rows constructed.
 */
const syntheticEvent = fc.array(
  fc.record({
    classification: fc.constantFrom(...CLASSES),
    gap: fc.constantFrom(...GAPS),
    computed: fc.boolean(),
    rows: fc.array(fc.record({ classification: fc.constantFrom(...CLASSES), gap: fc.option(fc.constantFrom(...GAPS), { nil: null }), value: cellValue, constructed: fc.boolean() }), { maxLength: 5 }),
  }),
  { minLength: 1, maxLength: 12 },
).map((measures) => measures.map((measure, index) => ({
  ...measure,
  id: `m${index}`,
  computed: measure.computed && (measure.classification === "expressible" || measure.classification === "partial"),
})));

describe("exact fractions", () => {
  it("reads a decimal exactly, whatever its places", () => {
    fc.assert(fc.property(cellValue, (value) => {
      expect(equals(parseDecimal(decimalText(value)), value)).toBe(true);
    }));
  });

  it("reads a share in lowest terms, and refuses anything but p/q", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), fc.bigInt({ min: 1n, max: 10n ** 30n }), fc.bigInt({ min: 1n, max: 1000n }), (num, den, k) => {
      expect(equals(parseShare(`${num * k}/${den * k}`), parseShare(`${num}/${den}`))).toBe(true);
    }));
    for (const bad of ["", "1", "1/0", "-1/2", "1.5/2", "1/2/3", " 1/2"]) expect(() => parseShare(bad)).toThrow(HistoricalDataError);
    for (const bad of ["", "1e9", "--1", "1.", ".5", "1,000"]) expect(() => parseDecimal(bad)).toThrow(HistoricalDataError);
  });

  it("formats a share to the nearest tenth of a percent, never a non-zero share as zero", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 20n }), fc.bigInt({ min: 1n, max: 10n ** 20n }), (a, b) => {
      const share = a <= b ? fraction(a, b) : fraction(b, a);
      const shown = formatShare(share);
      const exact = Number(share.num) / Number(share.den) * 100;
      if (shown === "under 0.1%") {
        expect(share.num).not.toBe(0n);
        expect(exact).toBeLessThan(0.05 + 1e-9);
      } else {
        expect(Math.abs(Number(shown.replace("%", "")) - exact)).toBeLessThanOrEqual(0.05 + 1e-9);
      }
    }));
    expect(formatShare(fraction(17n, 32n))).toBe("53.1%");
    expect(formatShare(fraction(1n, 16n))).toBe("6.3%");
    expect(formatShare(ZERO)).toBe("0.0%");
    expect(formatShare(ONE)).toBe("100.0%");
  });
});

describe("an event's coverage", () => {
  it("adds up for any event: the classes partition it, and the gap rows make up their class", () => {
    fc.assert(fc.property(syntheticEvent, (measures) => {
      const coverage = parseCoverage(coverageOf(measures));
      expect(coverageProblems(coverage)).toEqual([]);
      // The shares sum to exactly one, for measures and, when there is any, for value
      expect(equals(sum(CLASSES.map((name) => coverage.classes[name].shareOfMeasures)), ONE)).toBe(true);
      const anyValue = CLASSES.some((name) => coverage.classes[name].absolute.num !== 0n);
      expect(equals(sum(CLASSES.map((name) => coverage.classes[name].shareOfAbsolute)), anyValue ? ONE : ZERO)).toBe(true);
    }), { numRuns: 200 });
  });

  // A table can be changed into another event's consistent table (one more
  // measure in a class that holds them all, say), so not every change is
  // visible from the table alone. These always are: a share that is not its
  // exact quotient, a gap row that no longer adds up to its class, and a
  // not-expressible class that no longer matches its gap rows.
  it("is refused when a share, a gap row, or the class its gap rows make up is changed", () => {
    const fields = ["measures", "rows", "net_gbp", "absolute_gbp", "share_of_absolute", "share_of_measures"];
    fc.assert(fc.property(syntheticEvent, fc.nat(), fc.constantFrom(...fields), (measures, pick, field) => {
      const [header, ...lines] = coverageOf(measures).trim().split("\n");
      const rows = lines.map((line) => line.split(","));
      const index = pick % rows.length;
      const [name, gap] = rows[index];
      const hasGaps = rows.some((row) => row[1] !== "");
      const detectable = field.startsWith("share") || gap !== "" || (name === "not_expressible" && hasGaps);
      const column = COVERAGE_HEADER.indexOf(field);
      const cell = rows[index][column];
      fc.pre(detectable && cell !== "");
      // One unit more: a count by one, an amount by £1, a share by 1/(q+1)
      rows[index][column] = field === "measures" || field === "rows"
        ? String(Number(cell) + 1)
        : field.startsWith("share")
          ? text(add(parseShare(cell), fraction(1n, parseShare(cell).den + 1n)))
          : decimalText(add(parseDecimal(cell), ONE));
      const changed = [header, ...rows.map((row) => row.join(","))].join("\n") + "\n";
      expect(coverageProblems(parseCoverage(changed))).not.toEqual([]);
    }), { numRuns: 300 });
  });

  it("is refused when a net value is larger than its absolute value", () => {
    fc.assert(fc.property(syntheticEvent, fc.constantFrom(...CLASSES), (measures, name) => {
      const coverage = parseCoverage(coverageOf(measures));
      coverage.classes[name].net = add(coverage.classes[name].absolute, ONE);
      expect(coverageProblems(coverage)).toContain(`${name}: its net value is larger than its absolute value`);
    }));
  });

  it("is refused when it computes more measures than are expressible or partly expressible", () => {
    const coverage = parseCoverage(coverageOf([{ id: "m0", classification: "partial", gap: "model_or_data_gap", computed: true, rows: [] }, { id: "m1", classification: "out_of_household_scope", gap: "model_or_data_gap", computed: false, rows: [] }]));
    coverage.computed.measures = 2;
    coverage.computed.shareOfMeasures = ONE;
    expect(coverageProblems(coverage)).toEqual(["more measures are computed than are expressible or partly expressible"]);
  });

  // The two counterexamples review found on Autumn Budget 2024's own table
  const AUTUMN_2024 = EVENTS.find((event) => event.release === "uk-autumn-budget-2024");
  const autumn2024 = () => parseCoverage(toCsv(COVERAGE_HEADER, AUTUMN_2024.coverage));

  it("is refused when the gap rows are deleted from a class that has measures", () => {
    const coverage = autumn2024();
    expect(coverage.classes.not_expressible.measures).toBeGreaterThan(0);
    coverage.gaps = {};
    expect(coverageProblems(coverage)).toEqual(expect.arrayContaining([
      "the gap rows' measures do not add up to the not-expressible class",
      "the gap rows' absolute do not add up to the not-expressible class",
    ]));
  });

  it("is refused when it computes more value than the event's costing holds, even with a consistent share", () => {
    const coverage = autumn2024();
    const total = sum(CLASSES.map((name) => coverage.classes[name].absolute));
    coverage.computed.absolute = add(total, total);
    coverage.computed.shareOfAbsolute = fraction(2n);
    expect(coverageProblems(coverage)).toEqual([
      `${COMPUTED_ROW}: its value share is above one`,
      "more value is computed than the event's costing holds",
    ]);
  });

  it("is refused, for any event with not-expressible measures or rows, when its gap rows are deleted", () => {
    fc.assert(fc.property(syntheticEvent, (measures) => {
      const coverage = parseCoverage(coverageOf(measures));
      const own = coverage.classes.not_expressible;
      fc.pre(own.measures > 0 || own.rows > 0);
      coverage.gaps = {};
      expect(coverageProblems(coverage).some((problem) => problem.startsWith("the gap rows'"))).toBe(true);
    }), { numRuns: 200 });
  });

  it("is refused, for any event, when it computes more rows or value than the event has", () => {
    fc.assert(fc.property(syntheticEvent, fc.bigInt({ min: 1n, max: 10n ** 15n }), fc.nat({ max: 1000 }), (measures, extra, extraRows) => {
      const coverage = parseCoverage(coverageOf(measures));
      const totalAbsolute = sum(CLASSES.map((name) => coverage.classes[name].absolute));
      const totalRows = CLASSES.reduce((total, name) => total + coverage.classes[name].rows, 0);
      // More value than the event holds, with its share the exact quotient
      const valued = parseCoverage(coverageOf(measures));
      valued.computed.absolute = add(totalAbsolute, fraction(extra));
      valued.computed.shareOfAbsolute = compare(totalAbsolute, ZERO) === 0 ? ZERO : fraction(valued.computed.absolute.num * totalAbsolute.den, valued.computed.absolute.den * totalAbsolute.num);
      expect(coverageProblems(valued)).toContain("more value is computed than the event's costing holds");
      coverage.computed.rows = totalRows + 1 + extraRows;
      expect(coverageProblems(coverage)).toContain("more costing rows are computed than the event has");
    }), { numRuns: 200 });
  });

  it("is refused when a value is negative", () => {
    fc.assert(fc.property(syntheticEvent, fc.constantFrom(...CLASSES), (measures, name) => {
      const coverage = parseCoverage(coverageOf(measures));
      coverage.classes[name].absolute = fraction(-1n);
      expect(coverageProblems(coverage)).toContain(`${name}: its absolute value is negative`);
    }));
  });

  it("reads a count only when the page can hold it exactly", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    for (const text of [String(2 ** 53), "9".repeat(309), "-1", "01", "1.0", "1e3", ""]) {
      expect(() => parseCount(text)).toThrow(HistoricalDataError);
    }
  });

  it("refuses a table missing a class or with an unknown row", () => {
    const csv = coverageOf([{ id: "m0", classification: "partial", gap: "model_or_data_gap", computed: true, rows: [] }]);
    expect(() => parseCoverage(csv.replace(/\nexpressible,[^\n]*/, ""))).toThrow("no row for expressible");
    expect(() => parseCoverage(csv.replace("partial,,", "partly,,"))).toThrow("unknown row");
    expect(() => parseCoverage(csv.replace("class,", "klass,"))).toThrow("expected columns");
    expect(() => parseCoverage(csv + "partial,,1,0,0,0,0/1,0/1\n")).toThrow("twice");
  });

  it.each(EVENTS.map((event) => [event.release, event]))("adds up for %s, and accounts for every measure", (release, event) => {
    const coverage = parseCoverage(toCsv(COVERAGE_HEADER, event.coverage));
    expect(coverageProblems(coverage)).toEqual([]);
    const notModelled = parseNotModelled(toCsv(NOT_MODELLED_HEADER, event.not_modelled.map((row) => NOT_MODELLED_HEADER.map((name) => row[name]))));
    expect(accountsForEveryMeasure(coverage, notModelled, event.measures.map((measure) => measure.id))).toBe(true);
    expect(coverage.computed.measures).toBe(event.measures.length + event.not_modelled.filter((row) => row.gap_kind === "dashboard_import").length);
  });
});

describe("the measures not modelled", () => {
  const row = fc.record({
    classification: fc.constantFrom(...CLASSES),
    gap: fc.constantFrom(...GAPS),
    obr: cellValue.map((value) => (value.num < 0n ? fraction(-value.num, value.den) : value)),
    name: fc.string({ maxLength: 8 }),
  });

  it("fall into exactly one group each, in class then gap order, largest first", () => {
    fc.assert(fc.property(fc.array(row, { maxLength: 30 }), (rows) => {
      const parsed = parseNotModelled(toCsv(NOT_MODELLED_HEADER, rows.map((item, index) => [`id${index}`, item.name, item.classification, item.classification === "not_expressible" ? item.gap : "", "why", 1, decimalText(item.obr)])));
      const groups = groupNotModelled(parsed);
      expect(groups.flatMap((group) => group.items.map((item) => item.id)).sort()).toEqual(parsed.map((item) => item.id).sort());
      const order = groups.map((group) => CLASSES.indexOf(group.classification));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      for (const group of groups) {
        expect(group.items.every((item) => item.classification === group.classification && (group.classification !== "not_expressible" || item.gap === group.gap))).toBe(true);
        for (let i = 1; i < group.items.length; i += 1) expect(compare(group.items[i - 1].obrAbsolute, group.items[i].obrAbsolute)).toBeGreaterThanOrEqual(0);
      }
    }));
  });

  it("account for the event only together with the page's measures, each once", () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 20 }), fc.nat(), (ids, split) => {
      const cut = ids.length ? split % (ids.length + 1) : 0;
      const onPage = ids.slice(0, cut).map(String);
      const listed = ids.slice(cut).map((id) => ({ id: String(id) }));
      const coverage = { classes: Object.fromEntries(CLASSES.map((name, index) => [name, { measures: index === 0 ? ids.length : 0 }])) };
      expect(accountsForEveryMeasure(coverage, listed, onPage)).toBe(true);
      if (ids.length) {
        expect(accountsForEveryMeasure(coverage, listed.slice(1), onPage)).toBe(listed.length === 0);
        expect(accountsForEveryMeasure(coverage, [...listed, { id: String(ids[0]) }], onPage)).toBe(false);
      }
    }));
  });

  it("refuse an unknown class", () => {
    expect(() => parseNotModelled(toCsv(NOT_MODELLED_HEADER, [["a", "A", "partly", "", "", 1, "1"]]))).toThrow(HistoricalDataError);
  });
});

describe("the OBR comparison", () => {
  it("reads pounds as £bn, and an empty replay cell as missing, never zero", () => {
    const rows = parseHistoricalObr(toCsv(OBR_HEADER, [["a", "A, B", "2026", "1500000000", "-250000000.5", "", "policyengine-uk 2.130.1, x.h5 at revision 1"]]));
    expect(rows).toEqual([{ id: "a", name: "A, B", year: 2026, obr: 1.5, obrModelled: -0.2500000005, replay: null, pair: "policyengine-uk 2.130.1, x.h5 at revision 1" }]);
    expect(() => parseHistoricalObr(toCsv(OBR_HEADER, [["a", "A", "2026", "nan", "", "", ""]]))).toThrow(HistoricalDataError);
    expect(() => parseHistoricalObr(toCsv(OBR_HEADER.slice(0, -1), []))).toThrow("expected columns");
  });
});

describe("a release's years", () => {
  it("are the displayable measures' published years, in order", () => {
    fc.assert(fc.property(fc.array(fc.record({ displayable: fc.boolean(), years: fc.uniqueArray(fc.integer({ min: 2020, max: 2035 })), cut: fc.nat() })), (measures) => {
      const catalogue = { displayable: measures.filter((measure) => measure.displayable).map((measure) => ({ years: measure.years, unsupported_years: measure.years.slice(0, measure.cut % (measure.years.length + 1)) })) };
      const years = releaseYears(catalogue);
      const expected = new Set(catalogue.displayable.flatMap((measure) => measure.years.filter((year) => !measure.unsupported_years.includes(year))));
      expect(years).toEqual([...expected].sort((a, b) => a - b));
    }));
  });
});
