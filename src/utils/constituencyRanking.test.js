import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsvLine } from "./constituencyData";
import {
  RANKING_CSV_COLUMNS,
  buildRankingCsv,
  rankConstituencies,
  selectTopAndBottom,
} from "./constituencyRanking";

// TEST DATA ONLY: synthetic constituencies.
const entry = (code, name, gain, relative = gain / 100) => ({
  constituency_code: code,
  constituency_name: name,
  average_gain: gain,
  relative_change: relative,
});

const synthetic = (count, value = (i) => count - i) =>
  Array.from({ length: count }, (_, i) =>
    entry(`E${String(i).padStart(8, "0")}`, `Seat ${i}`, value(i)),
  );

const csvOptions = (regionLookup = new Map()) => ({
  metric: "gbp",
  regionLookup,
  year: 2029,
  policies: ["two_child_limit", "fuel_duty_freeze"],
});

const dataLines = (csv) => csv.trimEnd().split("\n").slice(1);

describe("rankConstituencies", () => {
  it("orders constituencies from highest to lowest change", () => {
    const ranked = rankConstituencies(
      [
        entry("A", "Alpha", -50),
        entry("B", "Beta", 200),
        entry("C", "Gamma", 75),
      ],
      "gbp",
    );
    expect(ranked.map((e) => e.constituency_name)).toEqual([
      "Beta",
      "Gamma",
      "Alpha",
    ]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("ranks by the percentage change independently of the pound change", () => {
    const ranked = rankConstituencies(
      [entry("A", "Alpha", 500, 0.1), entry("B", "Beta", 100, 0.9)],
      "pct",
    );
    expect(ranked.map((e) => e.constituency_name)).toEqual(["Beta", "Alpha"]);
  });

  it("gives exact ties a shared rank and skips the next rank", () => {
    const ranked = rankConstituencies(
      [
        entry("D", "Delta", 10),
        entry("C", "Charlie", 50),
        entry("B", "Bravo", 50),
        entry("A", "Alpha", 100),
      ],
      "gbp",
    );
    expect(ranked.map((e) => [e.constituency_name, e.rank, e.tied])).toEqual([
      ["Alpha", 1, false],
      ["Bravo", 2, true],
      ["Charlie", 2, true],
      ["Delta", 4, false],
    ]);
  });

  it("treats 0 and -0 as a tie", () => {
    const ranked = rankConstituencies(
      [entry("A", "A", -0), entry("B", "B", 0)],
      "gbp",
    );
    expect(ranked.map((e) => e.rank)).toEqual([1, 1]);
  });

  it("breaks ties by name, then by code, whatever the input order", () => {
    const tied = [
      entry("Z2", "Same", 5),
      entry("Z1", "Same", 5),
      entry("Y", "Earlier", 5),
    ];
    const expected = ["Y", "Z1", "Z2"];
    expect(
      rankConstituencies(tied, "gbp").map((e) => e.constituency_code),
    ).toEqual(expected);
    expect(
      rankConstituencies([...tied].reverse(), "gbp").map(
        (e) => e.constituency_code,
      ),
    ).toEqual(expected);
  });

  it("does not mutate its input", () => {
    const input = [entry("A", "A", 1), entry("B", "B", 2)];
    const snapshot = structuredClone(input);
    rankConstituencies(input, "gbp");
    expect(input).toEqual(snapshot);
  });
});

describe("selectTopAndBottom", () => {
  it("returns disjoint top and bottom 10 when there are at least 20", () => {
    for (const count of [20, 21, 650]) {
      const { top, bottom } = selectTopAndBottom(
        rankConstituencies(synthetic(count), "gbp"),
      );
      expect(top).toHaveLength(10);
      expect(bottom).toHaveLength(10);
      const topCodes = new Set(top.map((e) => e.constituency_code));
      expect(bottom.some((e) => topCodes.has(e.constituency_code))).toBe(false);
    }
  });

  it("lists the bottom lowest first, with ranks counting down", () => {
    const { top, bottom } = selectTopAndBottom(
      rankConstituencies(synthetic(650), "gbp"),
    );
    expect(top.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(bottom.map((e) => e.rank)).toEqual([
      650, 649, 648, 647, 646, 645, 644, 643, 642, 641,
    ]);
  });

  it("never repeats a constituency when there are fewer than 20", () => {
    const { top, bottom } = selectTopAndBottom(
      rankConstituencies(synthetic(15), "gbp"),
    );
    expect(top).toHaveLength(10);
    expect(bottom).toHaveLength(5);
    expect(
      selectTopAndBottom(rankConstituencies(synthetic(4), "gbp")).bottom,
    ).toEqual([]);
  });

  it("keeps all-tied lists disjoint", () => {
    const { top, bottom } = selectTopAndBottom(
      rankConstituencies(
        synthetic(25, () => 7),
        "gbp",
      ),
    );
    const topCodes = new Set(top.map((e) => e.constituency_code));
    expect(bottom.filter((e) => topCodes.has(e.constituency_code))).toEqual([]);
    expect([...top, ...bottom].every((e) => e.rank === 1 && e.tied)).toBe(true);
  });
});

describe("buildRankingCsv", () => {
  it("has one row per constituency plus a header", () => {
    const entries = synthetic(650);
    const csv = buildRankingCsv(entries, csvOptions());
    expect(csv.trimEnd().split("\n")).toHaveLength(651);
    expect(csv.split("\n")[0]).toBe(RANKING_CSV_COLUMNS.join(","));
  });

  it("quotes names with commas and quotes, and joins regions", () => {
    const regionLookup = new Map([
      ["S1", { region: "Scotland", country: "Scotland" }],
      ["E1", { region: "North East", country: "England" }],
    ]);
    const csv = buildRankingCsv(
      [
        entry("S1", "Ayr, Carrick and Cumnock", 120.456, 0.33333),
        entry("E1", 'The "Quoted" Seat', -4.004, -0.01),
      ],
      csvOptions(regionLookup),
    );
    const rows = dataLines(csv);
    expect(rows[0]).toBe(
      '1,1,S1,"Ayr, Carrick and Cumnock",Scotland,Scotland,120.46,0.3333,2029,two_child_limit;fuel_duty_freeze',
    );
    expect(parseCsvLine(rows[1])).toEqual([
      "2",
      "2",
      "E1",
      'The "Quoted" Seat',
      "North East",
      "England",
      "-4.00",
      "-0.0100",
      "2029",
      "two_child_limit;fuel_duty_freeze",
    ]);
  });

  it("writes values that round to zero without a minus sign", () => {
    const csv = buildRankingCsv(
      [entry("A", "A", -0.001, -0.00001)],
      csvOptions(),
    );
    expect(dataLines(csv)[0]).toContain(",0.00,0.0000,");
  });

  it("sorts rows by the chosen metric and keeps both ranks", () => {
    const entries = [entry("A", "A", 500, 0.1), entry("B", "B", 100, 0.9)];
    const byPct = dataLines(
      buildRankingCsv(entries, { ...csvOptions(), metric: "pct" }),
    );
    expect(byPct.map((line) => line.split(",").slice(0, 3))).toEqual([
      ["2", "1", "B"],
      ["1", "2", "A"],
    ]);
  });

  it("labels every row of a mock build as MOCK", () => {
    const csv = buildRankingCsv(synthetic(3), { ...csvOptions(), mock: true });
    const [header, ...rows] = csv.trimEnd().split("\n");
    expect(header.startsWith("data_status,")).toBe(true);
    expect(rows.every((line) => line.startsWith("MOCK,"))).toBe(true);
  });
});

// Property-based tests of the ranking invariants.

const valueArb = fc.oneof(
  // Small integers make exact ties common.
  fc.integer({ min: -3, max: 3 }),
  fc.double({ min: -5000, max: 5000, noNaN: true }),
);

const entriesArb = (options = {}) =>
  fc.uniqueArray(
    fc.record({
      // GSS-like codes; the CSV reader trims fields, and real codes have no spaces.
      constituency_code: fc.stringMatching(/^[A-Z][0-9A-Z]{1,8}$/),
      // Real names never start or end with spaces; the CSV reader trims them.
      constituency_name: fc.string({ maxLength: 12 }).map((s) => s.trim()),
      average_gain: valueArb,
      relative_change: valueArb,
    }),
    { selector: (e) => e.constituency_code, maxLength: 60, ...options },
  );

const metricArb = fc.constantFrom("gbp", "pct");
const fieldOf = { gbp: "average_gain", pct: "relative_change" };

describe("ranking invariants (property-based)", () => {
  it("is a permutation of the input, sorted high to low", () => {
    fc.assert(
      fc.property(entriesArb(), metricArb, (entries, metric) => {
        const field = fieldOf[metric];
        const ranked = rankConstituencies(entries, metric);
        expect(ranked.map((e) => e.constituency_code).sort()).toEqual(
          entries.map((e) => e.constituency_code).sort(),
        );
        for (let i = 1; i < ranked.length; i++) {
          expect(ranked[i - 1][field] >= ranked[i][field]).toBe(true);
        }
      }),
    );
  });

  it("ranks each constituency one above the count strictly higher", () => {
    fc.assert(
      fc.property(entriesArb(), metricArb, (entries, metric) => {
        const field = fieldOf[metric];
        for (const e of rankConstituencies(entries, metric)) {
          const higher = entries.filter((o) => o[field] > e[field]).length;
          const equal = entries.filter((o) => o[field] === e[field]).length;
          expect(e.rank).toBe(higher + 1);
          expect(e.tied).toBe(equal > 1);
        }
      }),
    );
  });

  it("gives equal ranks exactly to equal values", () => {
    fc.assert(
      fc.property(entriesArb(), metricArb, (entries, metric) => {
        const field = fieldOf[metric];
        const ranked = rankConstituencies(entries, metric);
        for (const a of ranked) {
          for (const b of ranked) {
            expect(a.rank === b.rank).toBe(a[field] === b[field]);
          }
        }
      }),
    );
  });

  it("does not depend on input order", () => {
    fc.assert(
      fc.property(
        entriesArb().chain((entries) =>
          fc.tuple(
            fc.constant(entries),
            fc.shuffledSubarray(entries, {
              minLength: entries.length,
              maxLength: entries.length,
            }),
          ),
        ),
        metricArb,
        ([entries, shuffled], metric) => {
          expect(rankConstituencies(shuffled, metric)).toEqual(
            rankConstituencies(entries, metric),
          );
        },
      ),
    );
  });

  it("mirrors under negation: rank(v) + rank(-v) + tie size = n + 2", () => {
    fc.assert(
      fc.property(entriesArb(), (entries) => {
        const negated = entries.map((e) => ({
          ...e,
          average_gain: -e.average_gain,
        }));
        const negRank = new Map(
          rankConstituencies(negated, "gbp").map((e) => [
            e.constituency_code,
            e.rank,
          ]),
        );
        for (const e of rankConstituencies(entries, "gbp")) {
          const tieSize = entries.filter(
            (o) => o.average_gain === e.average_gain,
          ).length;
          expect(e.rank + negRank.get(e.constituency_code) + tieSize).toBe(
            entries.length + 2,
          );
        }
      }),
    );
  });

  it("splits into disjoint top and bottom lists that bound the rest", () => {
    fc.assert(
      fc.property(
        entriesArb({ maxLength: 80 }),
        metricArb,
        fc.integer({ min: 1, max: 15 }),
        (entries, metric, n) => {
          const field = fieldOf[metric];
          const { top, bottom } = selectTopAndBottom(
            rankConstituencies(entries, metric),
            n,
          );
          const topCodes = new Set(top.map((e) => e.constituency_code));
          const bottomCodes = new Set(bottom.map((e) => e.constituency_code));

          expect(bottom.some((e) => topCodes.has(e.constituency_code))).toBe(
            false,
          );
          expect(top).toHaveLength(Math.min(n, entries.length));
          if (entries.length >= 2 * n) expect(bottom).toHaveLength(n);
          expect(top.length + bottom.length).toBe(
            Math.min(2 * n, entries.length),
          );

          const rest = entries.filter(
            (e) => !topCodes.has(e.constituency_code),
          );
          for (const t of top)
            for (const r of rest) expect(t[field] >= r[field]).toBe(true);
          const above = entries.filter(
            (e) => !bottomCodes.has(e.constituency_code),
          );
          for (const b of bottom)
            for (const a of above) expect(b[field] <= a[field]).toBe(true);
          for (let i = 1; i < bottom.length; i++) {
            expect(bottom[i - 1][field] <= bottom[i][field]).toBe(true);
          }
        },
      ),
    );
  });

  it("always yields top and bottom 10 that are disjoint with at least 20", () => {
    fc.assert(
      fc.property(
        entriesArb({ minLength: 20, maxLength: 80 }),
        metricArb,
        (entries, metric) => {
          const { top, bottom } = selectTopAndBottom(
            rankConstituencies(entries, metric),
            10,
          );
          expect(top).toHaveLength(10);
          expect(bottom).toHaveLength(10);
          const codes = new Set(
            [...top, ...bottom].map((e) => e.constituency_code),
          );
          expect(codes.size).toBe(20);
        },
      ),
    );
  });

  it("writes a CSV that round-trips every constituency once", () => {
    fc.assert(
      fc.property(entriesArb(), metricArb, (entries, metric) => {
        const csv = buildRankingCsv(entries, { ...csvOptions(), metric });
        const rows = dataLines(csv).map(parseCsvLine);
        expect(rows).toHaveLength(entries.length);

        const gbpRank = new Map(
          rankConstituencies(entries, "gbp").map((e) => [
            e.constituency_code,
            e.rank,
          ]),
        );
        const pctRank = new Map(
          rankConstituencies(entries, "pct").map((e) => [
            e.constituency_code,
            e.rank,
          ]),
        );
        const byCode = new Map(entries.map((e) => [e.constituency_code, e]));
        const sortRank = metric === "gbp" ? 0 : 1;

        rows.forEach((row, i) => {
          const original = byCode.get(row[2]);
          expect(original).toBeDefined();
          expect(row[3]).toBe(original.constituency_name);
          expect(Number(row[0])).toBe(gbpRank.get(row[2]));
          expect(Number(row[1])).toBe(pctRank.get(row[2]));
          expect(
            Math.abs(Number(row[6]) - original.average_gain),
          ).toBeLessThanOrEqual(0.005 + 1e-9);
          expect(
            Math.abs(Number(row[7]) - original.relative_change),
          ).toBeLessThanOrEqual(0.00005 + 1e-9);
          if (i > 0)
            expect(Number(rows[i - 1][sortRank]) <= Number(row[sortRank])).toBe(
              true,
            );
        });
        expect(new Set(rows.map((row) => row[2])).size).toBe(entries.length);
      }),
    );
  });
});
