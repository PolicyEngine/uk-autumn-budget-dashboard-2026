import { describe, expect, it } from "vitest";
import { COLUMNS } from "./columns";
import { GeographyTableError, parseGeographyTable } from "./parse";
import { hasReform, lookupRow, rowsFor, yearsFor } from "./rows";
import { geographyFixture } from "../../test/geographyFixture";

const REPORTED = {
  level: "region",
  area_code: "E12000001",
  area_name: "North East",
  reform: "fuel_duty_freeze",
  year: "2029",
  outcome: "average_change",
  value: "30.0",
  lo: "20.0",
  hi: "40.0",
  direction: "gain",
  tier: "reported",
  reason: "",
  support_band: "30+",
  noise: "False",
  estimator: "direct",
};

const WITHHELD = {
  ...REPORTED,
  area_code: "N92000002",
  area_name: "Northern Ireland",
  value: "",
  lo: "",
  hi: "",
  direction: "",
  tier: "withheld",
  reason: "disclosure_control",
  support_band: "",
};

const cell = (text) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

function csv(rows, columns = COLUMNS) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column] ?? "")).join(",")),
  ].join("\n");
}

const parseRegions = (text) => parseGeographyTable(text, { level: "region" });

function rejection(rows, columns) {
  try {
    parseRegions(csv(rows, columns));
  } catch (error) {
    expect(error).toBeInstanceOf(GeographyTableError);
    return error.message;
  }
  throw new Error("the table was accepted");
}

describe("parseGeographyTable", () => {
  it("reads the published fixtures", () => {
    const regional = parseRegions(geographyFixture("regional.csv"));
    expect(regional.reforms).toEqual([
      "autumn_budget_2026_combined",
      "fuel_duty_freeze",
    ]);
    const constituency = parseGeographyTable(
      geographyFixture("constituency.csv"),
      { level: "constituency" },
    );
    expect(constituency.rows).toHaveLength(16);
  });

  it("keeps every cell as published", () => {
    const table = parseRegions(csv([REPORTED, WITHHELD]));
    const [row, withheld] = table.rows;
    expect(row.value).toBe("30.0");
    expect(row.cells).toEqual(REPORTED);
    expect(row.year).toBe(2029);
    expect(row.noise).toBe(false);
    expect(withheld.value).toBe("");
    expect(withheld.lo).toBe("");
    expect(withheld.direction).toBe("");
  });

  it("accepts a quoted area name with commas", () => {
    const table = parseGeographyTable(geographyFixture("constituency.csv"), {
      level: "constituency",
    });
    const row = lookupRow(table, {
      areaCode: "Z14000002",
      reform: "autumn_budget_2026_combined",
      year: 2029,
      outcome: "relative_change",
    });
    expect(row.areaName).toBe("Harbour, Mill and Quay");
    expect(row.tier).toBe("approximate");
  });

  it("reads the columns by name, in any order", () => {
    const reversed = [...COLUMNS].reverse();
    const table = parseRegions(csv([REPORTED], reversed));
    expect(table.rows[0].cells).toEqual(REPORTED);
  });

  it("rejects the 2025 constituency table", () => {
    expect(() =>
      parseGeographyTable(geographyFixture("legacy-constituency-2025.csv"), {
        level: "constituency",
      }),
    ).toThrow(/columns are not the published ones/);
  });

  it("rejects missing, extra and repeated columns", () => {
    expect(
      rejection([REPORTED], COLUMNS.filter((column) => column !== "noise")),
    ).toMatch(/missing noise/);
    expect(rejection([REPORTED], [...COLUMNS, "household_count"])).toMatch(
      /unexpected "household_count"/,
    );
    expect(rejection([REPORTED], [...COLUMNS, "tier"])).toMatch(/"tier" twice/);
    expect(() => parseRegions("")).toThrow(GeographyTableError);
  });

  it("rejects a blank outside a withheld row's figures", () => {
    for (const column of ["value", "lo", "hi", "direction", "support_band"]) {
      expect(rejection([{ ...REPORTED, [column]: "" }])).toMatch(
        new RegExp(`no ${column} in a reported row`),
      );
    }
    for (const column of [
      "area_code",
      "area_name",
      "reform",
      "year",
      "outcome",
      "tier",
      "noise",
      "estimator",
    ]) {
      expect(() => parseRegions(csv([{ ...REPORTED, [column]: "" }])), column).toThrow(
        GeographyTableError,
      );
    }
    // An approximate row needs its reason; a reported row may leave it blank.
    expect(
      rejection([{ ...REPORTED, tier: "approximate", support_band: "10–29" }]),
    ).toMatch(/reason must be "thin_support"/);
  });

  it("rejects a withheld row that carries any figure", () => {
    for (const [column, text] of [
      ["value", "30.0"],
      ["lo", "20.0"],
      ["hi", "40.0"],
      ["direction", "gain"],
      ["support_band", "30+"],
    ]) {
      const message = rejection([{ ...WITHHELD, [column]: text }]);
      expect(message).toMatch(new RegExp(`a withheld row carries ${column}`));
      // The message never repeats the figure.
      if (column !== "direction" && column !== "support_band") {
        expect(message).not.toContain(text);
      }
    }
    expect(rejection([{ ...WITHHELD, reason: "" }])).toMatch(
      /reason must be "disclosure_control"/,
    );
  });

  it("rejects unknown tiers, outcomes, directions, bands and estimators", () => {
    expect(rejection([{ ...REPORTED, tier: "fallback" }])).toMatch(
      /tier "fallback" is not one of/,
    );
    expect(rejection([{ ...REPORTED, outcome: "poverty_change" }])).toMatch(
      /outcome/,
    );
    expect(rejection([{ ...REPORTED, direction: "up" }])).toMatch(/direction/);
    // A hyphen is not the published en dash.
    expect(rejection([{ ...REPORTED, support_band: "10-29" }])).toMatch(
      /support_band/,
    );
    expect(rejection([{ ...REPORTED, estimator: "modelled" }])).toMatch(
      /estimator/,
    );
    expect(rejection([{ ...REPORTED, noise: "false" }])).toMatch(/noise/);
  });

  it("rejects figures that are not numbers, never reading them as zero", () => {
    for (const text of ["n/a", "NaN", "inf", "1,000", " 30"]) {
      const message = rejection([{ ...REPORTED, value: text }]);
      expect(message).toMatch(/value is not a number/);
    }
  });

  it("never quotes a figure, even from a file with no header", () => {
    const headless = csv([REPORTED]).split("\n").slice(1).join("\n");
    let message = "";
    try {
      parseRegions(headless);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/columns are not the published ones/);
    expect(message).not.toMatch(/30\.0|20\.0|40\.0/);
    // A figure shifted into a word column is not quoted either.
    expect(rejection([{ ...REPORTED, direction: "30.0" }])).not.toContain(
      "30.0",
    );
  });

  it("rejects a value outside its interval, or a direction it contradicts", () => {
    expect(rejection([{ ...REPORTED, value: "45.0" }])).toMatch(
      /not within its interval/,
    );
    expect(rejection([{ ...REPORTED, direction: "loss" }])).toMatch(
      /direction "loss" does not match/,
    );
    expect(
      rejection([{ ...REPORTED, value: "0", lo: "-5", hi: "5", direction: "gain" }]),
    ).toMatch(/does not match/);
    expect(
      rejection([{ ...REPORTED, value: "0", lo: "0", hi: "5", direction: "no_change" }]),
    ).toMatch(/does not match/);
    // Zero cells and calls too close to call are consistent.
    expect(() =>
      parseRegions(
        csv([
          { ...REPORTED, value: "0", lo: "0", hi: "0", direction: "no_change" },
          {
            ...REPORTED,
            area_code: "E12000002",
            value: "5",
            lo: "-5",
            hi: "15",
            direction: "too_close_to_call",
          },
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects rows of another level, and areas that are not regions", () => {
    expect(rejection([{ ...REPORTED, level: "constituency" }])).toMatch(
      /level "constituency" is not "region"/,
    );
    expect(rejection([{ ...REPORTED, area_code: "E14000001" }])).toMatch(
      /not a UK region/,
    );
    expect(rejection([{ ...REPORTED, area_code: "North East" }])).toMatch(
      /not an ONS code/,
    );
  });

  it("rejects two rows for the same area, reform, year and outcome", () => {
    expect(rejection([REPORTED, { ...REPORTED, value: "35.0" }])).toMatch(
      /a second row for E12000001/,
    );
  });

  it("rejects ragged rows and malformed quoting", () => {
    expect(() =>
      parseRegions(`${COLUMNS.join(",")}\nregion,E12000001`),
    ).toThrow(/2 cells, not 15/);
    expect(() =>
      parseRegions(`${COLUMNS.join(",")}\nregion,"E12000001`),
    ).toThrow(/not valid CSV/);
  });

  it("indexes rows by area, reform, year and outcome", () => {
    const table = parseRegions(geographyFixture("regional.csv"));
    const key = {
      areaCode: "E12000007",
      reform: "autumn_budget_2026_combined",
      year: 2029,
      outcome: "average_change",
    };
    expect(lookupRow(table, key).value).toBe("1234.5");
    expect(lookupRow(table, { ...key, year: 2031 })).toBeNull();
    expect(lookupRow(null, key)).toBeNull();
    expect(hasReform(table, "fuel_duty_freeze")).toBe(true);
    expect(hasReform(table, "two_child_limit")).toBe(false);
    expect(
      rowsFor(table, {
        reform: "autumn_budget_2026_combined",
        year: 2030,
        outcome: "relative_change",
      }),
    ).toHaveLength(11);
    expect(yearsFor(table, "autumn_budget_2026_combined")).toEqual([2029, 2030]);
  });
});
