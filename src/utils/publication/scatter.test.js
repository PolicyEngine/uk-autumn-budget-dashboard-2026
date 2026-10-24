// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import { parseTable } from "./csv";
import { parseManifest } from "./manifest";
import {
  bandLabel,
  changeBandLabel,
  changeBandMiddle,
  changeKind,
  fromChangeAxis,
  openEdge,
  scatterSeries,
  SCATTER_BINS,
  toChangeAxis,
} from "./scatter";
import { REASONS } from "./select";
import {
  BEYOND_DATA,
  fixtureJson,
  fixtureText,
  IN_DATA,
} from "../../test/publicationFixture";

const manifest = parseManifest(fixtureJson("manifest.json"));
// A not-computable entry's artifact is its receipt alone: it has no tables.
const tablesByKey = Object.fromEntries(
  Object.entries({ ...manifest.measures, ...manifest.combined })
    .filter(([, entry]) => entry.status !== "not_computable")
    .map(([key, entry]) => [
      key,
      {
        household_scatter_binned: parseTable(
          "household_scatter_binned",
          fixtureText(`${entry.artifact}/household_scatter_binned.csv`),
        ),
      },
    ]),
);

describe("the published scatter tables", () => {
  it("bins cells with no household ids or weights", () => {
    const columns = contract.tables.household_scatter_binned.columns.map(
      ([name]) => name,
    );
    expect(columns).not.toContain("household_id");
    expect(columns).not.toContain("household_weight");
  });

  it("keeps the household scatter's published columns, and no more", () => {
    // Max kept the household-level scatter as published (cos d1397): the
    // same columns as public/data/household_scatter.csv.
    expect(
      contract.tables.household_scatter.columns.map(([name]) => name),
    ).toEqual([
      "reform_id",
      "reform_name",
      "year",
      "baseline_income",
      "income_change",
      "household_weight",
      "household_id",
    ]);
  });
});

describe("scatterSeries", () => {
  it("reads the combined run's cells for a combined selection", () => {
    const series = scatterSeries({
      manifest,
      tablesByKey,
      selectedIds: ["beta", "alpha"],
      year: IN_DATA,
    });
    expect(series.status).toBe("available");
    expect(series.key).toBe("combined--alpha+beta");
    expect(series.points).toEqual([
      {
        income: 20000 + SCATTER_BINS.income_band_width / 2,
        change: changeBandMiddle(-75, -50),
        households: 1000,
        incomeBand: 20000,
        changeBand: -75,
        changeBandUpper: -50,
      },
    ]);
  });

  it("is unavailable for a selection with no combined run, or beyond the data", () => {
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["alpha", "gamma"],
        year: IN_DATA,
      }),
    ).toEqual({ status: "unavailable", reason: REASONS.noCombinedRun });
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["alpha"],
        year: BEYOND_DATA,
      }),
    ).toEqual({ status: "unavailable", reason: REASONS.unsupportedYear });
    expect(
      scatterSeries({
        manifest,
        tablesByKey,
        selectedIds: ["delta"],
        year: IN_DATA,
      }),
    ).toEqual({ status: "unavailable", reason: "Awaiting approval" });
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

describe("change bands", () => {
  const pounds = (v) => `£${v}`;
  const edges = SCATTER_BINS.change_edges;

  it("are mirrored about zero, with a no-change band and open outer bands", () => {
    expect(edges).toEqual([...edges].map((edge) => -edge).reverse());
    expect(edges).toContain(-1);
    expect(edges).toContain(1);
    expect(edges[edges.length - 1]).toBe(5000);
  });

  it("classifies the no-change, gain, loss and open bands", () => {
    expect(changeKind(-1, 1)).toBe("zero");
    expect(changeKind(1, 10)).toBe("gain");
    expect(changeKind(-10, -1)).toBe("loss");
    expect(changeKind(5000, 5000)).toBe("gain");
    expect(changeKind(-5000, -5000)).toBe("loss");
    expect(openEdge(5000, 5000)).toBe("upper");
    expect(openEdge(-5000, -5000)).toBe("lower");
    expect(openEdge(3000, 5000)).toBeNull();
  });

  it("labels each band as a range", () => {
    expect(changeBandLabel(-1, 1, pounds)).toBe("No change");
    expect(changeBandLabel(100, 150, pounds)).toBe("£100 to £150");
    expect(changeBandLabel(-150, -100, pounds)).toBe("£-150 to £-100");
    expect(changeBandLabel(5000, 5000, pounds)).toBe("£5000 or more");
    expect(changeBandLabel(-5000, -5000, pounds)).toBe("£-5000 or less");
  });

  it("puts every inner band's middle between its edges", () => {
    for (let i = 0; i < edges.length - 1; i += 1) {
      const [lower, upper] = [edges[i], edges[i + 1]];
      const middle = changeBandMiddle(lower, upper);
      if (changeKind(lower, upper) === "zero") {
        expect(middle).toBe(0);
      } else {
        expect(middle).toBeGreaterThan(lower);
        expect(middle).toBeLessThan(upper);
      }
    }
  });

  it("maps the symlog axis back to pounds", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (value) => {
        expect(fromChangeAxis(toChangeAxis(value))).toBeCloseTo(value, 6);
      }),
    );
    expect(toChangeAxis(0)).toBe(0);
    expect(toChangeAxis(-250)).toBe(-toChangeAxis(250));
  });
});
