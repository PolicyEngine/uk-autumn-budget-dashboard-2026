import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
import {
  SKETCHES_2025,
  UNCERTIFIED_2025_SHA256,
  carriedOver2025Policies,
  checkCertificationManifest,
  crossCheckConstituencyRows,
  carriesOver2025Year,
  parseDemographicCsv,
  policyValueSketch,
} from "../test/constituencyChecks";

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
    // The shipped set is empty; these tests verify the synthetic policies.
    verifiedPolicyIds: new Set(POLICIES),
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

  it("uses the shipped verified set when none is passed", () => {
    const result = getConstituencyAvailability({
      rows: syntheticRows(),
      selectedPolicies: POLICIES,
      selectedYear: 2029,
      constituencyCodes: codes,
    });
    expect(result).toMatchObject({
      available: false,
      reason: "unverified-policy",
      policies: POLICIES,
    });
  });

  it("is unavailable when the data failed to load", () => {
    expect(availability([], { loadFailed: true }).reason).toBe("load-failed");
  });

  it("refuses to sum a combined reform with any other policy", () => {
    const combined = "autumn_budget_2025_combined";
    const rows = parseConstituencyCsv(
      makeConstituencyCsv(seats, [...POLICIES, combined], [2029], () => [
        1, 0.1,
      ]),
    );
    const verifiedPolicyIds = new Set([...POLICIES, combined]);
    expect(
      availability(rows, {
        selectedPolicies: [combined, POLICIES[0]],
        verifiedPolicyIds,
      }).reason,
    ).toBe("overlapping-policies");
    expect(
      availability(rows, { selectedPolicies: [combined], verifiedPolicyIds })
        .available,
    ).toBe(true);
  });

  it("counts a repeated policy ID once", () => {
    const repeated = [POLICIES[0], POLICIES[0]];
    expect(
      availability(syntheticRows(), { selectedPolicies: repeated }).available,
    ).toBe(true);
  });

  it("is unavailable when finite rows sum to a non-finite value", () => {
    const rows = syntheticRows(() => [1e308, 0.1]);
    expect(availability(rows).reason).toBe("invalid-sums");
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

describe("local-area cross-check", () => {
  // TEST DATA ONLY: one synthetic constituency with two demographic groups.
  const published = (gain) => [
    { reform_id: "p", year: 2029, constituency_code: "E1", average_gain: gain },
  ];
  const groups = [
    {
      reform_id: "p",
      year: 2029,
      constituency_code: "E1",
      average_gain: 10,
      household_count: 3,
    },
    {
      reform_id: "p",
      year: 2029,
      constituency_code: "E1",
      average_gain: 30,
      household_count: 1,
    },
  ];
  const check = (rows, demographic = groups) =>
    crossCheckConstituencyRows(rows, demographic, {
      policyIds: ["p"],
      years: [2029],
    });

  it("passes when the constituency equals its household-weighted groups", () => {
    expect(check(published(15))).toEqual([]);
    expect(check(published(15.04))).toEqual([]);
  });

  it("flags a constituency more than £0.05 from its groups", () => {
    expect(check(published(15.06))).toHaveLength(1);
    expect(check(published(NaN))).toHaveLength(1);
  });

  it("flags a constituency with no demographic rows", () => {
    expect(check(published(15), [])).toEqual([
      "p|2029|E1: no demographic rows",
    ]);
  });
});

describe("certification manifest", () => {
  // TEST DATA ONLY: made-up release name and hashes.
  const files = {
    constituencySha256: "a".repeat(64),
    demographicSha256: "b".repeat(64),
  };
  const manifest = {
    dataset_release: "microcosm-uk-2025-26-local-test",
    constituency_weights_sha256: "c".repeat(64),
    constituency_csv_sha256: files.constituencySha256,
    demographic_constituency_csv_sha256: files.demographicSha256,
    reform_ids: ["two_child_limit"],
  };
  const check = (m, f = files, ids = ["two_child_limit"]) =>
    checkCertificationManifest(m, f, ids);

  it("accepts a Microcosm release that pins both files", () => {
    expect(check(manifest)).toEqual([]);
  });

  it("rejects a missing manifest or a non-Microcosm release", () => {
    expect(check(undefined).length).toBeGreaterThan(0);
    expect(check({ ...manifest, dataset_release: "efrs-2023" })).toEqual([
      "dataset_release must name a Microcosm release",
    ]);
    expect(check({ ...manifest, constituency_weights_sha256: "" })).toEqual([
      "constituency_weights_sha256 must be a SHA-256",
    ]);
  });

  it("rejects files that changed after certification", () => {
    expect(
      check(manifest, { ...files, constituencySha256: "d".repeat(64) }),
    ).toEqual(["constituency.csv does not match the certified SHA-256"]);
    expect(
      check(manifest, { ...files, demographicSha256: "d".repeat(64) }),
    ).toEqual([
      "demographic_constituency.csv does not match the certified SHA-256",
    ]);
  });

  it("rejects the 2025 dashboard's files even if a manifest pins them", () => {
    const [stale] = UNCERTIFIED_2025_SHA256;
    const pinned = { ...manifest, constituency_csv_sha256: stale };
    expect(check(pinned, { ...files, constituencySha256: stale })).toEqual([
      `${stale} is the 2025 dashboard's uncertified file`,
    ]);
  });

  it("spots carried-over values through rounding, but not regenerated ones", () => {
    // TEST DATA ONLY: synthetic rows for one policy in 2028 and 2029, plus a
    // policy with no effect at all.
    const base = syntheticRows((p, y, i) =>
      p === POLICIES[0] ? [37.123456789 * (i - 9), 0.0123456789 * i] : [0, 0],
    );
    const reference = policyValueSketch(base, POLICIES[0]);
    const carried = (rows, id = POLICIES[0], ref = reference) =>
      carriesOver2025Year(policyValueSketch(rows, id), ref);
    const remap = (f) =>
      base.map((r) => ({
        ...r,
        average_gain: f(r.average_gain, 2),
        relative_change: f(r.relative_change, 4),
      }));

    // Re-saved at lower precision, reordered or renamed: still carried over.
    expect(carried(remap((v) => Number(v.toPrecision(12))))).toBe(true);
    expect(carried(remap((v) => Number(v.toFixed(6))))).toBe(true);
    expect(carried(remap((v) => Math.fround(v)))).toBe(true);
    expect(carried(remap((v, dp) => Number(v.toFixed(dp))))).toBe(true);
    expect(
      carried(
        [...base].reverse().map((r) => ({ ...r, constituency_name: "x" })),
      ),
    ).toBe(true);
    // One carried-over year is enough, even next to a new year.
    const extraYear = base
      .filter((r) => r.year === 2029)
      .map((r) => ({ ...r, year: 2031, average_gain: r.average_gain * 2 }));
    expect(
      carried([...base.filter((r) => r.year === 2029), ...extraYear]),
    ).toBe(true);

    // Regenerated on new data (here 30% different): not carried over.
    expect(carried(remap((v) => v * 1.3))).toBe(false);
    // A measure with no effect in any year never counts as carried over.
    const none = policyValueSketch(base, POLICIES[1]);
    expect(carried(base, POLICIES[1], none)).toBe(false);
  });

  // These two read the 2025 file, so they run only while main carries it.
  const csvBytes = readFileSync("public/data/constituency.csv");
  const carries2025File = UNCERTIFIED_2025_SHA256.has(
    createHash("sha256").update(csvBytes).digest("hex"),
  );
  const rows2025 = carries2025File
    ? parseConstituencyCsv(csvBytes.toString("utf8"))
    : [];

  it.runIf(carries2025File)("pins every reform ID's 2025 values", () => {
    const ids = Object.keys(SKETCHES_2025);
    expect(new Set(rows2025.map((r) => r.reform_id))).toEqual(new Set(ids));
    for (const id of ids) {
      expect(policyValueSketch(rows2025, id)).toEqual(SKETCHES_2025[id]);
    }
    expect(carriedOver2025Policies(rows2025, ids)).toEqual(ids);
  });

  it.runIf(carries2025File)(
    "spots 2025 rows carried over inside a changed file or at lower precision",
    () => {
      // TEST DATA ONLY: one fabricated row added; the 2025 rows untouched.
      const changedFile = [
        ...rows2025,
        {
          reform_id: "bus_fare_cap",
          year: 2027,
          constituency_code: "E14001063",
          average_gain: 1,
          relative_change: 0.1,
        },
      ];
      expect(
        carriedOver2025Policies(changedFile, [
          "savings_tax_increase_2pp",
          "bus_fare_cap",
        ]),
      ).toEqual(["savings_tax_increase_2pp"]);

      const resaved = rows2025.map((r) => ({
        ...r,
        average_gain: Number(r.average_gain.toFixed(2)),
        relative_change: Math.fround(r.relative_change),
      }));
      expect(
        carriedOver2025Policies(resaved, ["savings_tax_increase_2pp"]),
      ).toEqual(["savings_tax_increase_2pp"]);

      // Regenerated values (here 30% different) are not carried over.
      const regenerated = rows2025.map((r) =>
        r.reform_id === "savings_tax_increase_2pp"
          ? {
              ...r,
              average_gain: r.average_gain * 1.3,
              relative_change: r.relative_change * 1.3,
            }
          : r,
      );
      expect(
        carriedOver2025Policies(regenerated, ["savings_tax_increase_2pp"]),
      ).toEqual([]);
    },
  );

  it("rejects a verified ID the manifest does not certify", () => {
    expect(check(manifest, files, ["two_child_limit", "bus_fare_cap"])).toEqual(
      ["bus_fare_cap is not in reform_ids"],
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

  // Tripwire for VERIFIED_CONSTITUENCY_POLICY_IDS. Every ID in the set needs
  // a certification manifest naming the Microcosm release and pinning both
  // local files' bytes; full coverage in every year it has rows for; and
  // agreement with demographic_constituency.csv. Empty set: nothing to check.
  it("admits only certified policies whose rows pass the local-area checks", () => {
    const verified = [...VERIFIED_CONSTITUENCY_POLICY_IDS];
    if (!verified.length) return;

    const manifestPath = "public/data/constituency_certification.json";
    expect(existsSync(manifestPath), `${manifestPath} is missing`).toBe(true);
    const sha256 = (path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(
      checkCertificationManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")),
        {
          constituencySha256: sha256("public/data/constituency.csv"),
          demographicSha256: sha256("public/data/demographic_constituency.csv"),
        },
        verified,
      ),
    ).toEqual([]);
    // Rows carried over from the 2025 file cannot be certified, even inside
    // an otherwise regenerated file.
    expect(carriedOver2025Policies(rows, verified)).toEqual([]);

    const demographic = parseDemographicCsv(
      readFileSync("public/data/demographic_constituency.csv", "utf8"),
    );
    for (const policyId of verified) {
      const years = [
        ...new Set(
          rows.filter((r) => r.reform_id === policyId).map((r) => r.year),
        ),
      ];
      expect(
        years.length,
        `${policyId} has no constituency rows`,
      ).toBeGreaterThan(0);
      for (const year of years) {
        expect(
          getConstituencyAvailability({
            rows,
            selectedPolicies: [policyId],
            selectedYear: year,
            constituencyCodes: geoCodes,
          }),
        ).toEqual({ available: true, reason: "available" });
      }
      expect(
        crossCheckConstituencyRows(rows, demographic, {
          policyIds: [policyId],
          years,
        }),
      ).toEqual([]);
    }
  });

  // Shape only: these rows are the 2025 dashboard's and are NOT verified.
  // The test passes them in explicitly to exercise the pipeline on 650 seats.
  it("ranks 650 real constituencies with a region for each", () => {
    const shapeOnly = ["two_child_limit", "fuel_duty_freeze"];
    expect(
      getConstituencyAvailability({
        rows,
        selectedPolicies: shapeOnly,
        selectedYear: 2029,
        constituencyCodes: geoCodes,
        verifiedPolicyIds: new Set(shapeOnly),
      }).available,
    ).toBe(true);

    const aggregated = aggregateConstituencies(rows, shapeOnly, 2029);
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
      yearLabel: "2029-30",
      policies: shapeOnly,
    });
    expect(csv.trimEnd().split("\n")).toHaveLength(651);

    const { top, bottom } = selectTopAndBottom(
      rankConstituencies(aggregated, "pct"),
    );
    const topCodes = new Set(top.map((e) => e.constituency_code));
    expect(bottom.filter((e) => topCodes.has(e.constituency_code))).toEqual([]);
  });
});
