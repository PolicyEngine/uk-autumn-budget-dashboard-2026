import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  VERIFIED_CONSTITUENCY_POLICY_IDS,
  aggregateConstituencies,
  buildRegionLookup,
  getConstituencyAvailability,
  parseConstituencyCsv,
} from "./constituencyData";
import {
  buildRankingCsv,
  rankConstituencies,
  selectTopAndBottom,
} from "./constituencyRanking";
import {
  makeConstituencies,
  makeConstituencyCsv,
  makeGeojson,
} from "../test/constituencyFixtures";

// TEST DATA ONLY: synthetic constituencies and values.
const seats = makeConstituencies(25);
const codes = seats.map((s) => s.code);
const POLICIES = ["two_child_limit", "fuel_duty_freeze"];
const syntheticRows = (value = (p, y, i) => [i - 12, (i - 12) / 10]) =>
  parseConstituencyCsv(
    makeConstituencyCsv(seats, POLICIES, [2028, 2029], value),
  );

const availability = (rows, overrides = {}) =>
  getConstituencyAvailability({
    rows,
    selectedPolicies: POLICIES,
    selectedYear: 2029,
    constituencyCodes: codes,
    ...overrides,
  });

describe("parseConstituencyCsv", () => {
  it("reads quoted names with commas and typed values", () => {
    const rows = parseConstituencyCsv(
      "reform_id,year,constituency_code,constituency_name,average_gain,relative_change\r\n" +
        'two_child_limit,2029,S14000001,"Ayr, Carrick and Cumnock",12.5,0.25\r\n',
    );
    expect(rows).toEqual([
      {
        reform_id: "two_child_limit",
        year: 2029,
        constituency_code: "S14000001",
        constituency_name: "Ayr, Carrick and Cumnock",
        average_gain: 12.5,
        relative_change: 0.25,
      },
    ]);
  });

  it("keeps blank and malformed numbers as NaN instead of zero", () => {
    const [row] = parseConstituencyCsv(
      "reform_id,year,constituency_code,constituency_name,average_gain,relative_change\n" +
        "two_child_limit,2029,E1,Seat,,12abc\n",
    );
    expect(row.average_gain).toBeNaN();
    expect(row.relative_change).toBeNaN();
  });
});

describe("buildRegionLookup", () => {
  it("uses ONS region names and the country for the devolved nations", () => {
    const lookup = buildRegionLookup(makeGeojson(seats.slice(0, 4)));
    expect([...lookup.values()]).toEqual([
      { region: "North East", country: "England" },
      { region: "London", country: "England" },
      { region: "Scotland", country: "Scotland" },
      { region: "Wales", country: "Wales" },
    ]);
  });

  it("returns an empty lookup without geography", () => {
    expect(buildRegionLookup(null).size).toBe(0);
  });
});

describe("getConstituencyAvailability", () => {
  it("is available with one finite row per constituency for each policy", () => {
    expect(availability(syntheticRows())).toEqual({
      available: true,
      reason: "available",
    });
  });

  it("is unavailable with no policy selected", () => {
    expect(availability(syntheticRows(), { selectedPolicies: [] }).reason).toBe(
      "no-policies",
    );
  });

  it("is unavailable for a policy without verified constituency results", () => {
    const result = availability(syntheticRows(), {
      selectedPolicies: ["two_child_limit", "bus_fare_cap"],
    });
    expect(result).toMatchObject({
      available: false,
      policies: ["bus_fare_cap"],
    });
  });

  it("is unavailable without the constituency geography", () => {
    expect(
      availability(syntheticRows(), { constituencyCodes: [] }).available,
    ).toBe(false);
  });

  it("is unavailable when a constituency is missing for a selected policy", () => {
    const rows = syntheticRows().filter(
      (r) =>
        !(
          r.reform_id === "fuel_duty_freeze" &&
          r.year === 2029 &&
          r.constituency_code === codes[3]
        ),
    );
    expect(availability(rows)).toMatchObject({
      available: false,
      reason: "incomplete-coverage",
      policies: ["fuel_duty_freeze"],
    });
  });

  it("is unavailable when the selected year has no rows", () => {
    expect(
      availability(syntheticRows(), { selectedYear: 2030 }).available,
    ).toBe(false);
  });

  it("is unavailable with a duplicated, unknown or non-finite row", () => {
    const rows = syntheticRows();
    const target = rows.find((r) => r.year === 2029);
    expect(availability([...rows, { ...target }]).reason).toBe("invalid-rows");
    expect(
      availability([...rows, { ...target, constituency_code: "X99" }]).reason,
    ).toBe("invalid-rows");
    expect(
      availability(
        rows.map((r) => (r === target ? { ...r, average_gain: NaN } : r)),
      ).reason,
    ).toBe("invalid-rows");
  });

  it("ignores bad rows for other years and unselected policies", () => {
    const rows = [
      ...syntheticRows(),
      {
        reform_id: "two_child_limit",
        year: 2028,
        constituency_code: "X99",
        average_gain: NaN,
        relative_change: 0,
      },
      {
        reform_id: "salary_sacrifice_cap",
        year: 2029,
        constituency_code: "X99",
        average_gain: NaN,
        relative_change: 0,
      },
    ];
    expect(availability(rows).available).toBe(true);
  });

  it("fails closed for any single dropped, duplicated or corrupted row", () => {
    const rows = syntheticRows();
    const selectedIdx = rows.flatMap((r, i) => (r.year === 2029 ? [i] : []));
    fc.assert(
      fc.property(
        fc.constantFrom(...selectedIdx),
        fc.constantFrom("drop", "duplicate", "nan", "infinity"),
        (index, change) => {
          const mutated = [...rows];
          if (change === "drop") mutated.splice(index, 1);
          if (change === "duplicate") mutated.push({ ...rows[index] });
          if (change === "nan")
            mutated[index] = { ...rows[index], relative_change: NaN };
          if (change === "infinity")
            mutated[index] = { ...rows[index], average_gain: Infinity };
          expect(availability(mutated).available).toBe(false);
        },
      ),
    );
  });
});

describe("aggregateConstituencies", () => {
  it("sums each constituency across the selected policies and keeps the breakdown", () => {
    const [first] = aggregateConstituencies(
      syntheticRows((p) => (p === "two_child_limit" ? [10, 1] : [-4, -0.5])),
      POLICIES,
      2029,
    );
    expect(first).toMatchObject({ average_gain: 6, relative_change: 0.5 });
    expect(first.policyBreakdown).toEqual({
      two_child_limit: { average_gain: 10, relative_change: 1 },
      fuel_duty_freeze: { average_gain: -4, relative_change: -0.5 },
    });
  });

  // Differential test: a naive per-constituency filter-and-sum must agree
  // exactly with the single-pass aggregation the map and tables share.
  it("matches a naive per-constituency sum (property-based)", () => {
    const valueArb = fc.double({ min: -1e4, max: 1e4, noNaN: true });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(valueArb, valueArb), {
          minLength: seats.length * 4,
          maxLength: seats.length * 4,
        }),
        fc.subarray(POLICIES, { minLength: 1 }),
        (values, selected) => {
          const rows = syntheticRows(
            (p, y, i) =>
              values[
                POLICIES.indexOf(p) * 2 * seats.length +
                  (y - 2028) * seats.length +
                  i
              ],
          );
          const aggregated = aggregateConstituencies(rows, selected, 2029);
          expect(aggregated).toHaveLength(seats.length);
          for (const entry of aggregated) {
            const matching = rows.filter(
              (r) =>
                r.year === 2029 &&
                selected.includes(r.reform_id) &&
                r.constituency_code === entry.constituency_code,
            );
            expect(entry.average_gain).toBe(
              matching.reduce((sum, r) => sum + r.average_gain, 0),
            );
            expect(entry.relative_change).toBe(
              matching.reduce((sum, r) => sum + r.relative_change, 0),
            );
          }
          expect(
            availability(rows, { selectedPolicies: selected }).available,
          ).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("checked-in constituency data", () => {
  const rows = parseConstituencyCsv(
    readFileSync("public/data/constituency.csv", "utf8"),
  );
  const geoData = JSON.parse(
    readFileSync("public/data/uk_constituencies_2024.geojson", "utf8"),
  );
  const geoCodes = geoData.features.map((f) => f.properties.GSScode);
  const regionLookup = buildRegionLookup(geoData);
  const selected = [...VERIFIED_CONSTITUENCY_POLICY_IDS].filter(
    (id) => id !== "autumn_budget_2025_combined",
  );

  it("ranks all 650 constituencies with a region for each", () => {
    const result = getConstituencyAvailability({
      rows,
      selectedPolicies: selected,
      selectedYear: 2029,
      constituencyCodes: geoCodes,
    });
    expect(result.available).toBe(true);

    const aggregated = aggregateConstituencies(rows, selected, 2029);
    expect(aggregated).toHaveLength(650);
    expect(
      aggregated.every((e) => regionLookup.get(e.constituency_code)?.region),
    ).toBe(true);
    expect(new Set([...regionLookup.values()].map((p) => p.region))).toEqual(
      new Set([
        "North East",
        "North West",
        "Yorkshire and The Humber",
        "East Midlands",
        "West Midlands",
        "East of England",
        "London",
        "South East",
        "South West",
        "Wales",
        "Scotland",
        "Northern Ireland",
      ]),
    );

    const csv = buildRankingCsv(aggregated, {
      metric: "gbp",
      regionLookup,
      year: 2029,
      policies: selected,
    });
    expect(csv.trimEnd().split("\n")).toHaveLength(651);

    const { top, bottom } = selectTopAndBottom(
      rankConstituencies(aggregated, "pct"),
    );
    const topCodes = new Set(top.map((e) => e.constituency_code));
    expect(bottom.filter((e) => topCodes.has(e.constituency_code))).toEqual([]);
  });

  it("covers every verified policy for every published year", () => {
    for (const policyId of VERIFIED_CONSTITUENCY_POLICY_IDS) {
      for (const year of [2026, 2027, 2028, 2029, 2030]) {
        expect(
          getConstituencyAvailability({
            rows,
            selectedPolicies: [policyId],
            selectedYear: year,
            constituencyCodes: geoCodes,
          }).available,
        ).toBe(true);
      }
    }
  });
});
