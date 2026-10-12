// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseTable } from "./csv";
import { parseManifest } from "./manifest";
import {
  combinedEntryFor,
  combinedStats,
  decileSeries,
  fiscalSeries,
  isSupported,
  REASONS,
  uniqueIds,
} from "./select";
import { fixtureJson, fixtureText } from "../../test/publicationFixture";

// ---------------------------------------------------------------------------
// The fixture written by the Python publication code
// ---------------------------------------------------------------------------

const manifest = parseManifest(fixtureJson("manifest.json"));
const TABLE_NAMES = [
  "budgetary_impact",
  "distributional_impact",
  "winners_losers",
  "metrics",
];
const tablesByKey = Object.fromEntries(
  Object.entries({ ...manifest.measures, ...manifest.combined }).map(
    ([key, entry]) => [
      key,
      Object.fromEntries(
        TABLE_NAMES.map((table) => [
          table,
          parseTable(table, fixtureText(`${entry.artifact}/${table}.csv`)),
        ]),
      ),
    ],
  ),
);

describe("selection on the fixture", () => {
  it("finds the combined run of exactly the selected measures", () => {
    for (const ids of [
      ["alpha", "beta"],
      ["beta", "alpha"],
      ["beta", "alpha", "beta"],
    ]) {
      expect(combinedEntryFor(manifest, ids)?.key).toBe("combined--alpha+beta");
    }
    expect(combinedEntryFor(manifest, ["alpha", "gamma"])).toBeNull();
    expect(combinedEntryFor(manifest, ["alpha"])).toMatchObject({
      key: "alpha",
      single: true,
    });
    expect(combinedEntryFor(manifest, ["delta"])).toBeNull();
  });

  it("gives standalone, combined and interaction figures for 2030", () => {
    const [row] = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "beta"],
      years: [2030],
    });
    expect(row.standalone).toEqual({ alpha: -1.1, beta: -2.2 });
    expect(row.combined).toBe(-2.75);
    expect(row.combinedKey).toBe("combined--alpha+beta");
    expect(row.interaction).toBeCloseTo(0.55, 12);
  });

  it("shows nothing for 2031, beyond the dataset's projected years", () => {
    const [row] = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "beta"],
      years: [2031],
    });
    expect(row.standalone).toEqual({ alpha: null, beta: null });
    expect(row.reasons.alpha).toBe(REASONS.unsupportedYear);
    expect(row.combined).toBeNull();
    expect(row.combinedReason).toBe(REASONS.unsupportedYear);
    expect(row.interaction).toBeNull();
  });

  it("never shows a staged measure", () => {
    const [row] = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["delta"],
      years: [2030],
    });
    expect(row.standalone.delta).toBeNull();
    expect(row.reasons.delta).toBe("Awaiting approval");
    expect(row.combined).toBeNull();
  });

  it("marks a provisional measure's figures as provisional", () => {
    const [row] = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["gamma"],
      years: [2030],
    });
    expect(row.combined).toBe(0.5);
    expect(row.provisional).toBe(true);
  });

  it("reads combined statistics from the combined run only", () => {
    const stats = combinedStats({
      manifest,
      tablesByKey,
      selectedIds: ["beta", "alpha"],
      year: 2030,
    });
    expect(stats).toEqual({
      status: "available",
      key: "combined--alpha+beta",
      year: 2030,
      provisional: false,
      peopleAffected: 7.25,
      giniChange: -0.0275,
      povertyChangePp: -0.275,
      povertyChangePct: -2.75,
    });
  });

  it("says combined statistics are unavailable for an unrun selection", () => {
    expect(
      combinedStats({
        manifest,
        tablesByKey,
        selectedIds: ["alpha", "gamma"],
        year: 2030,
      }),
    ).toEqual({
      status: "unavailable",
      reason: REASONS.noCombinedRun,
      availableSets: [["alpha", "beta"]],
    });
  });

  it("gives decile figures under the same rules", () => {
    const rows = decileSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "beta"],
      year: 2030,
      table: "distributional_impact",
    });
    expect(rows.map((r) => r.decile)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "6th",
      "7th",
      "8th",
      "9th",
      "10th",
    ]);
    expect(rows[0].standalone).toEqual({ alpha: -1.1, beta: -2.2 });
    expect(rows[0].combined).toBe(-2.75);
    const winners = decileSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha"],
      year: 2030,
      table: "winners_losers",
    });
    expect(winners.at(-1).decile).toBe("all");
    expect(() =>
      decileSeries({
        manifest,
        tablesByKey,
        selectedIds: ["alpha"],
        year: 2030,
        table: "metrics",
      }),
    ).toThrow();
  });

  it("treats a combined run as unavailable once a member has changed", () => {
    const changed = structuredClone(manifest);
    changed.measures.alpha.outputs_sha256 = "e".repeat(64);
    expect(combinedEntryFor(changed, ["alpha", "beta"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Properties over random manifests, tables and selections
// ---------------------------------------------------------------------------

const IDS = ["a", "b", "c", "d", "e", "f"];
const YEARS = [2027, 2028, 2029];
const STATUSES = ["staged", "provisional", "approved", "stale", "withdrawn"];
const DIGESTS = ["1", "2", "3"].map((c) => c.repeat(64));
const SHARED = "0".repeat(64);

const nonZero = fc
  .double({ min: -50, max: 50, noNaN: true })
  .filter((v) => Math.abs(v) > 1e-6);

function entryArb() {
  return fc.record({
    // Mostly displayable, so combined runs are often usable.
    status: fc.oneof(
      { arbitrary: fc.constantFrom("approved", "provisional"), weight: 4 },
      { arbitrary: fc.constantFrom(...STATUSES), weight: 1 },
    ),
    outputs: fc.constantFrom(...DIGESTS),
    unsupported: fc.subarray(YEARS),
  });
}

function tablesArb() {
  // A value, or null for a deleted row, per year.
  return fc.record({
    fiscal: fc.tuple(...YEARS.map(() => fc.option(nonZero, { nil: null }))),
    metrics: fc.tuple(...YEARS.map(() => fc.option(nonZero, { nil: null }))),
  });
}

const worldArb = fc
  .integer({ min: 2, max: 6 })
  .chain((count) => {
    const ids = IDS.slice(0, count);
    return fc.record({
      ids: fc.constant(ids),
      measures: fc.tuple(...ids.map(() => entryArb())),
      measureTables: fc.tuple(...ids.map(() => tablesArb())),
      combined: fc.array(
        fc.record({
          members: fc.subarray(ids, { minLength: 2 }),
          entry: entryArb(),
          memberCurrent: fc.boolean(),
          tables: tablesArb(),
        }),
        { maxLength: 4 },
      ),
      selection: fc.array(fc.constantFrom(...ids, "unknown"), {
        maxLength: 5,
      }),
    });
  })
  .chain((world) => {
    // Half the time, select exactly a combined run's members, with
    // duplicates, so the exact-set path is exercised.
    const sets = world.combined.map((c) => c.members);
    if (sets.length === 0) return fc.constant(world);
    return fc
      .oneof(
        fc.constant(world.selection),
        fc
          .tuple(fc.constantFrom(...sets), fc.nat())
          .map(([members, n]) => [...members, ...members.slice(0, n % 2)]),
      )
      .map((selection) => ({ ...world, selection }));
  })
  .map(build);

function rowsFor(key, values) {
  const budgetary = [];
  const metrics = [];
  YEARS.forEach((year, i) => {
    if (values.fiscal[i] !== null) {
      budgetary.push({ reform_id: key, year, value: values.fiscal[i] });
    }
    if (values.metrics[i] !== null) {
      const v = values.metrics[i];
      metrics.push({
        reform_id: key,
        year,
        people_affected: 10 + v,
        gini_change: v / 100,
        poverty_change_pp: v / 10,
        poverty_change_pct: v,
      });
    }
  });
  return { budgetary_impact: budgetary, metrics };
}

function build(world) {
  const manifest = { measures: {}, combined: {} };
  const tables = {};
  world.ids.forEach((id, i) => {
    const e = world.measures[i];
    manifest.measures[id] = {
      name: id,
      status: e.status,
      outputs_sha256: e.outputs,
      execution_identity_sha256: SHARED,
      years: YEARS,
      unsupported_years: e.unsupported,
    };
    tables[id] = rowsFor(id, world.measureTables[i]);
  });
  for (const c of world.combined) {
    const members = uniqueIds(c.members);
    const key = `combined--${members.join("+")}`;
    if (manifest.combined[key]) continue;
    manifest.combined[key] = {
      name: key,
      status: c.entry.status,
      outputs_sha256: c.entry.outputs,
      execution_identity_sha256: SHARED,
      years: YEARS,
      unsupported_years: c.entry.unsupported,
      measures: members,
      member_outputs_sha256: Object.fromEntries(
        members.map((id) => [
          id,
          c.memberCurrent
            ? manifest.measures[id].outputs_sha256
            : "f".repeat(64),
        ]),
      ),
    };
    tables[key] = rowsFor(key, c.tables);
  }
  return { manifest, tables, selection: world.selection };
}

const displayable = (entry) =>
  entry && (entry.status === "approved" || entry.status === "provisional");

/** An independent statement of which entry describes a selection. */
function referenceTarget(manifest, selection) {
  const ids = [...new Set(selection)].sort();
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const entry = manifest.measures[ids[0]];
    return displayable(entry) ? ids[0] : null;
  }
  const key = `combined--${ids.join("+")}`;
  const entry = manifest.combined[key];
  if (!displayable(entry)) return null;
  const current = ids.every(
    (id) =>
      displayable(manifest.measures[id]) &&
      entry.member_outputs_sha256[id] === manifest.measures[id].outputs_sha256,
  );
  return current ? key : null;
}

function shuffledWithDuplicates(selection, seed) {
  const copy = [...selection, ...selection.slice(0, seed % 3)];
  return copy.sort((x, y) => (x + seed).localeCompare(y + seed));
}

describe("selection properties", () => {
  it("combined statistics are exactly the exact-set run's row, or unavailable", () => {
    fc.assert(
      fc.property(worldArb, fc.constantFrom(...YEARS), (world, year) => {
        const stats = combinedStats({
          manifest: world.manifest,
          tablesByKey: world.tables,
          selectedIds: world.selection,
          year,
        });
        const target = referenceTarget(world.manifest, world.selection);
        const entry = target
          ? (world.manifest.measures[target] ?? world.manifest.combined[target])
          : null;
        const row = target
          ? world.tables[target].metrics.find((r) => r.year === year)
          : undefined;
        const expectAvailable =
          target !== null &&
          !entry.unsupported_years.includes(year) &&
          row !== undefined;
        if (!expectAvailable) {
          expect(stats.status).toBe("unavailable");
          return;
        }
        expect(stats).toMatchObject({
          status: "available",
          key: target,
          peopleAffected: row.people_affected,
          giniChange: row.gini_change,
          povertyChangePp: row.poverty_change_pp,
          povertyChangePct: row.poverty_change_pct,
        });
      }),
      { numRuns: 300 },
    );
  });

  it("with several measures selected, a standalone row is never read", () => {
    fc.assert(
      fc.property(worldArb, fc.constantFrom(...YEARS), (world, year) => {
        const ids = uniqueIds(world.selection);
        fc.pre(ids.length > 1);
        const stats = combinedStats({
          manifest: world.manifest,
          tablesByKey: world.tables,
          selectedIds: world.selection,
          year,
        });
        if (stats.status === "available") {
          expect(stats.key.startsWith("combined--")).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("selection order and duplicates change nothing", () => {
    fc.assert(
      fc.property(worldArb, fc.nat(), (world, seed) => {
        const other = shuffledWithDuplicates(world.selection, seed);
        const args = { manifest: world.manifest, tablesByKey: world.tables };
        expect(
          fiscalSeries({ ...args, selectedIds: other, years: YEARS }),
        ).toEqual(
          fiscalSeries({ ...args, selectedIds: world.selection, years: YEARS }),
        );
        for (const year of YEARS) {
          expect(combinedStats({ ...args, selectedIds: other, year })).toEqual(
            combinedStats({ ...args, selectedIds: world.selection, year }),
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never yields a number for a missing row, hidden entry or unsupported year", () => {
    fc.assert(
      fc.property(worldArb, (world) => {
        const series = fiscalSeries({
          manifest: world.manifest,
          tablesByKey: world.tables,
          selectedIds: world.selection,
          years: YEARS,
        });
        for (const row of series) {
          for (const [id, value] of Object.entries(row.standalone)) {
            if (value === null) {
              expect(row.reasons[id]).not.toBe("");
              continue;
            }
            const entry = world.manifest.measures[id];
            expect(displayable(entry)).toBe(true);
            expect(isSupported(entry, row.year)).toBe(true);
            const published = world.tables[id].budgetary_impact.find(
              (r) => r.year === row.year,
            );
            expect(published?.value).toBe(value);
            expect(value).not.toBe(0);
          }
          if (row.combined !== null) {
            const published = world.tables[
              row.combinedKey
            ].budgetary_impact.find((r) => r.year === row.year);
            expect(published?.value).toBe(row.combined);
          } else {
            expect(row.combinedReason).not.toBe("");
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("the interaction exists exactly when every part does, and adds up", () => {
    fc.assert(
      fc.property(worldArb, (world) => {
        const series = fiscalSeries({
          manifest: world.manifest,
          tablesByKey: world.tables,
          selectedIds: world.selection,
          years: YEARS,
        });
        for (const row of series) {
          const parts = Object.values(row.standalone);
          const complete =
            row.combined !== null &&
            parts.length > 0 &&
            parts.every((p) => p !== null);
          expect(row.interaction !== null).toBe(complete);
          if (complete) {
            const sum = parts.reduce((s, p) => s + p, 0);
            expect(
              Math.abs(row.interaction - (row.combined - sum)),
            ).toBeLessThan(1e-9);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("the generator reaches the interesting cases", () => {
  it("produces available combined runs, unsupported years and deleted rows", () => {
    let combinedAvailable = 0;
    let unsupported = 0;
    let missing = 0;
    for (const world of fc.sample(worldArb, { numRuns: 500, seed: 7 })) {
      for (const year of YEARS) {
        const stats = combinedStats({
          manifest: world.manifest,
          tablesByKey: world.tables,
          selectedIds: world.selection,
          year,
        });
        if (
          stats.status === "available" &&
          stats.key.startsWith("combined--")
        ) {
          combinedAvailable += 1;
        }
      }
      for (const row of fiscalSeries({
        manifest: world.manifest,
        tablesByKey: world.tables,
        selectedIds: world.selection,
        years: YEARS,
      })) {
        for (const reason of Object.values(row.reasons)) {
          if (reason === REASONS.unsupportedYear) unsupported += 1;
          if (reason === REASONS.missingRow) missing += 1;
        }
      }
    }
    expect(combinedAvailable).toBeGreaterThan(10);
    expect(unsupported).toBeGreaterThan(10);
    expect(missing).toBeGreaterThan(10);
  });
});
