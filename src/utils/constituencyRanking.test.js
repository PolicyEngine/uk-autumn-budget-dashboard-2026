import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsv } from "./publication/csv";
import { indexRows } from "./geography/rows";
import {
  RANKING_CSV_COLUMNS,
  buildRankingCsv,
  describeList,
  isAllTied,
  rankConstituencies,
  rankingEntries,
  selectTopAndBottom,
} from "./constituencyRanking";

const parseCsvLine = (line) => parseCsv(line)[0];

// TEST DATA ONLY: synthetic constituencies, shaped as rankingEntries
// builds them from published rows.
const published = (value, tier = "reported") =>
  tier === "withheld"
    ? { value: "", lo: "", hi: "", tier }
    : {
        value: String(value),
        lo: String(value - 1),
        hi: String(value + 1),
        tier,
      };

const withRows = (e) => ({
  region: "",
  country: "",
  ...e,
  rows: {
    average_change: published(e.average_gain),
    relative_change: published(e.relative_change),
  },
});

const entry = (code, name, gain, relative = gain / 100) =>
  withRows({
    constituency_code: code,
    constituency_name: name,
    average_gain: gain,
    relative_change: relative,
  });

const synthetic = (count, value = (i) => count - i) =>
  Array.from({ length: count }, (_, i) =>
    entry(`E${String(i).padStart(8, "0")}`, `Seat ${i}`, value(i)),
  );

const csvOptions = () => ({
  metric: "gbp",
  year: 2029,
  yearLabel: "2029-30",
  measures: ["Two-child limit", "Fuel duty freeze"],
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

describe("ties across the cut", () => {
  it("reports a tied group that the top 10 splits", () => {
    // Values 20..13 (8 seats), then 12 seats tied at 0, then 5 below.
    const values = [
      20,
      19,
      18,
      17,
      16,
      15,
      14,
      13,
      ...Array(12).fill(0),
      -1,
      -2,
      -3,
      -4,
      -5,
    ];
    const ranked = rankConstituencies(
      synthetic(values.length, (i) => values[i]),
      "gbp",
    );
    const { top, topTie, bottomTie } = selectTopAndBottom(ranked);
    expect(top.map((e) => e.rank).slice(-2)).toEqual([9, 9]);
    expect(topTie).toEqual({ rank: 9, total: 12, shown: 2 });
    // The bottom 10 holds five tied seats plus the five below them.
    expect(bottomTie).toEqual({ rank: 9, total: 12, shown: 5 });
  });

  it("reports nothing when no tie crosses a cut", () => {
    const { topTie, bottomTie } = selectTopAndBottom(
      rankConstituencies(synthetic(30), "gbp"),
    );
    expect(topTie).toBeNull();
    expect(bottomTie).toBeNull();
  });
});

describe("isAllTied", () => {
  it("is true only when every constituency shares one value", () => {
    expect(
      isAllTied(
        rankConstituencies(
          synthetic(25, () => 0),
          "gbp",
        ),
      ),
    ).toBe(true);
    expect(isAllTied(rankConstituencies(synthetic(25), "gbp"))).toBe(false);
    expect(isAllTied(rankConstituencies(synthetic(1), "gbp"))).toBe(false);
  });
});

describe("describeList", () => {
  const rows = (...values) => values.map((v, i) => entry(`C${i}`, `C${i}`, v));

  it("names gains and losses by the sign of every value in the list", () => {
    expect(describeList(rows(30, 20), "gbp", "top")).toBe("Largest gains");
    expect(describeList(rows(2, 1), "gbp", "bottom")).toBe("Smallest gains");
    expect(describeList(rows(-1, -2), "gbp", "top")).toBe("Smallest losses");
    expect(describeList(rows(-30, -20), "gbp", "bottom")).toBe(
      "Largest losses",
    );
  });

  it("falls back to neutral wording for mixed signs or zero", () => {
    expect(describeList(rows(5, 0), "gbp", "top")).toBe(
      "Highest average change",
    );
    expect(describeList(rows(1, -1), "pct", "bottom")).toBe(
      "Lowest average change",
    );
  });
});

describe("buildRankingCsv", () => {
  it("has one row per constituency plus a header", () => {
    const entries = synthetic(650);
    const csv = buildRankingCsv(entries, csvOptions());
    expect(csv.trimEnd().split("\n")).toHaveLength(651);
    expect(csv.split("\n")[0]).toBe(RANKING_CSV_COLUMNS.join(","));
  });

  it("quotes names with commas and quotes, and writes regions and intervals as published", () => {
    const csv = buildRankingCsv(
      [
        {
          ...entry("S1", "Ayr, Carrick and Cumnock", 120.5, 0.0033),
          region: "Scotland",
          country: "Scotland",
        },
        {
          ...entry("E1", 'The "Quoted" Seat', -4, -0.0001),
          region: "North East",
          country: "England",
        },
      ],
      csvOptions(),
    );
    const rows = dataLines(csv);
    expect(rows[0]).toBe(
      '1,1,S1,"Ayr, Carrick and Cumnock",Scotland,Scotland,120.5,119.5,121.5,reported,0.0033,-0.9967,1.0033,reported,2029,2029-30,Two-child limit; Fuel duty freeze',
    );
    expect(parseCsvLine(rows[1]).slice(0, 7)).toEqual([
      "2",
      "2",
      "E1",
      'The "Quoted" Seat',
      "North East",
      "England",
      "-4",
    ]);
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

  it("lists a withheld constituency last, with no rank and no figure", () => {
    const withheld = {
      ...entry("W", "Aardvark", 0),
      average_gain: null,
      relative_change: null,
      rows: {
        average_change: published(null, "withheld"),
        relative_change: published(null, "withheld"),
      },
    };
    const entries = [withheld, entry("A", "Zed", 5), entry("B", "Yew", -5)];
    expect(
      rankConstituencies(entries, "gbp").map((e) => e.constituency_code),
    ).toEqual(["A", "B"]);
    const rows = dataLines(buildRankingCsv(entries, csvOptions())).map(
      parseCsvLine,
    );
    expect(rows.map((row) => row[2])).toEqual(["A", "B", "W"]);
    expect(rows[2].slice(0, 2)).toEqual(["", ""]);
    expect(rows[2].slice(6, 14)).toEqual([
      "",
      "",
      "",
      "withheld",
      "",
      "",
      "",
      "withheld",
    ]);
  });

  it("labels every row of a mock build as MOCK", () => {
    const csv = buildRankingCsv(synthetic(3), { ...csvOptions(), mock: true });
    const [header, ...rows] = csv.trimEnd().split("\n");
    expect(header.startsWith("data_status,")).toBe(true);
    expect(rows.every((line) => line.startsWith("MOCK,"))).toBe(true);
  });
});

describe("rankingEntries", () => {
  const row = (areaCode, outcome, value, tier = "reported") => ({
    areaCode,
    areaName: `Published ${areaCode}`,
    reform: "r",
    year: 2029,
    outcome,
    value: tier === "withheld" ? "" : value,
    lo: "",
    hi: "",
    tier,
  });
  const table = indexRows("constituency", [
    row("E1", "average_change", "120.0"),
    row("E1", "relative_change", "0.01"),
    row("S1", "average_change", "", "withheld"),
    row("S1", "relative_change", "", "withheld"),
  ]);
  const features = [
    {
      properties: {
        GSScode: "E1",
        Name: "Boundary E1",
        Country: "England",
        CTR_REG: "Greater London",
      },
    },
    {
      properties: {
        GSScode: "S1",
        Name: "Boundary S1",
        Country: "Scotland",
        CTR_REG: "",
      },
    },
    {
      properties: {
        GSScode: "W1",
        Name: "Boundary W1",
        Country: "Wales",
        CTR_REG: "",
      },
    },
  ];

  it("gives every seat on the map an entry, with a figure only where one is published", () => {
    const entries = rankingEntries(features, table, {
      reform: "r",
      year: 2029,
    });
    expect(
      entries.map((e) => [
        e.constituency_code,
        e.constituency_name,
        e.region,
        e.average_gain,
        e.relative_change,
      ]),
    ).toEqual([
      ["E1", "Published E1", "London", 120, 0.01],
      ["S1", "Published S1", "Scotland", null, null],
      ["W1", "Boundary W1", "Wales", null, null],
    ]);
    expect(
      rankConstituencies(entries, "gbp").map((e) => e.constituency_code),
    ).toEqual(["E1"]);
    expect(dataLines(buildRankingCsv(entries, csvOptions()))).toHaveLength(3);
  });

  it("is empty without a reform, a table or boundaries", () => {
    expect(
      rankingEntries(features, table, { reform: null, year: 2029 }),
    ).toEqual([]);
    expect(rankingEntries(null, table, { reform: "r", year: 2029 })).toEqual(
      [],
    );
    expect(rankingEntries(features, null, { reform: "r", year: 2029 })).toEqual(
      [],
    );
  });
});

// Property-based tests of the ranking invariants.

const valueArb = fc.oneof(
  // Small integers make exact ties common.
  fc.integer({ min: -3, max: 3 }),
  fc.double({ min: -5000, max: 5000, noNaN: true }),
);

const entriesArb = (options = {}) =>
  fc
    .uniqueArray(
      fc.record({
        // GSS-like codes; the CSV reader trims fields, and real codes have no spaces.
        constituency_code: fc.stringMatching(/^[A-Z][0-9A-Z]{1,8}$/),
        // Real names never start or end with spaces; the CSV reader trims them.
        constituency_name: fc.string({ maxLength: 12 }).map((s) => s.trim()),
        average_gain: valueArb,
        relative_change: valueArb,
      }),
      { selector: (e) => e.constituency_code, maxLength: 60, ...options },
    )
    .map((entries) => entries.map(withRows));

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

  it("reports a tie at a cut exactly when the cut splits a tied group", () => {
    fc.assert(
      fc.property(
        entriesArb({ maxLength: 80 }),
        metricArb,
        (entries, metric) => {
          const ranked = rankConstituencies(entries, metric);
          const { top, bottom, topTie, bottomTie } = selectTopAndBottom(
            ranked,
            10,
          );
          const split = (list, next) =>
            list.length > 0 &&
            next !== undefined &&
            list.some((e) => e.rank === next.rank);
          expect(topTie !== null).toBe(split(top, ranked[top.length]));
          expect(bottomTie !== null).toBe(
            split(bottom, ranked[ranked.length - bottom.length - 1]),
          );
          for (const [tie, list] of [
            [topTie, top],
            [bottomTie, bottom],
          ]) {
            if (!tie) continue;
            expect(tie.shown).toBe(
              list.filter((e) => e.rank === tie.rank).length,
            );
            expect(tie.total).toBe(
              ranked.filter((e) => e.rank === tie.rank).length,
            );
            expect(tie.total).toBeGreaterThan(tie.shown);
          }
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
          // Figures are the published strings, unrounded.
          // (=== so that -0 and 0 compare equal)
          expect(Number(row[6]) === original.average_gain).toBe(true);
          expect(Number(row[10]) === original.relative_change).toBe(true);
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
