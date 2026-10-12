// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import { parseTable } from "./csv";
import { parseManifest } from "./manifest";
import { bandLabel, scatterSeries, SCATTER_BINS } from "./scatter";
import { REASONS } from "./select";
import { fixtureJson, fixtureText } from "../../test/publicationFixture";

const manifest = parseManifest(fixtureJson("manifest.json"));
const tablesByKey = Object.fromEntries(
  Object.entries({ ...manifest.measures, ...manifest.combined }).map(
    ([key, entry]) => [
      key,
      {
        household_scatter_binned: parseTable(
          "household_scatter_binned",
          fixtureText(`${entry.artifact}/household_scatter_binned.csv`),
        ),
      },
    ],
  ),
);

describe("the published scatter table", () => {
  it("has no household ids or weights", () => {
    const columns = contract.tables.household_scatter_binned.columns.map(
      ([name]) => name,
    );
    expect(columns).not.toContain("household_id");
    expect(columns).not.toContain("household_weight");
    expect(contract.tables).not.toHaveProperty("household_scatter");
  });
});

describe("scatterSeries", () => {
  it("reads the combined run's cells for a combined selection", () => {
    const series = scatterSeries({
      manifest,
      tablesByKey,
      selectedIds: ["beta", "alpha"],
      year: 2030,
    });
    expect(series.status).toBe("available");
    expect(series.key).toBe("combined--alpha+beta");
    expect(series.points).toEqual([
      {
        income: 20000 + SCATTER_BINS.income_band_width / 2,
        change: -100 + SCATTER_BINS.change_band_width / 2,
        households: 1000,
        incomeBand: 20000,
        changeBand: -100,
      },
    ]);
  });

  it("is unavailable for a selection with no combined run, or beyond the data", () => {
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["alpha", "gamma"],
        year: 2030,
      }),
    ).toEqual({ status: "unavailable", reason: REASONS.noCombinedRun });
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["alpha"],
        year: 2031,
      }),
    ).toEqual({ status: "unavailable", reason: REASONS.unsupportedYear });
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["delta"],
        year: 2030,
      }).status,
    ).toBe("unavailable");
  });
});

describe("bandLabel", () => {
  const pounds = (v) => `£${v}`;
  it("names inner bands and shows the outer ones as open-ended", () => {
    expect(bandLabel(-2000, 100, -2000, 2000, pounds)).toBe("under £-1900");
    expect(bandLabel(1900, 100, -2000, 2000, pounds)).toBe("£1900 and over");
    expect(bandLabel(0, 100, -2000, 2000, pounds)).toBe("£0 to £100");
  });

  it("never mislabels an inner band", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 38 }), (i) => {
        const lower = -2000 + i * 100;
        expect(bandLabel(lower, 100, -2000, 2000, pounds)).toBe(
          `£${lower} to £${lower + 100}`,
        );
      }),
    );
  });
});
