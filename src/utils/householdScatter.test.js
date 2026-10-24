import { describe, expect, it } from "vitest";
import { toChangeAxis } from "./publication/scatter";
import {
  CHANGE_AXIS_DOMAIN,
  changeBandLabel,
  EDGE_STRIP,
  edgeOf,
  incomeBandLabel,
  parseScatterCsv,
  scatterCsv,
  scatterDots,
  scatterView,
} from "./householdScatter";

const CSV = [
  "reform_id,reform_name,year,income_band,change_band,change_band_upper,households",
  "a,Measure A,2029,20000.0,-150.0,-100.0,151000.0",
  "a,Measure A,2029,25000.0,-1.0,1.0,98000.0",
  "a,Measure A,2029,25000.0,5000.0,5000.0,7000.0",
  "a,Measure A,2030,20000.0,-150.0,-100.0,140000.0",
  'all_combined,"All, together",2029,20000.0,-200.0,-150.0,250000.0',
].join("\n");

const ready = { status: "ready", rows: parseScatterCsv(CSV), error: null };
const POLICY_IDS = ["a", "b"];

describe("parseScatterCsv", () => {
  it("reads the published columns, numbers as numbers", () => {
    const rows = parseScatterCsv(`﻿${CSV}\n`);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      reform_id: "a",
      reform_name: "Measure A",
      year: 2029,
      income_band: 20000,
      change_band: -150,
      change_band_upper: -100,
      households: 151000,
    });
    expect(rows[4].reform_name).toBe("All, together");
  });

  it("refuses a file with other columns", () => {
    expect(() => parseScatterCsv("reform_id,household_id\na,1\n")).toThrow(
      /unexpected columns/,
    );
    // The fixed-width layout, without the band's upper edge
    expect(() =>
      parseScatterCsv(
        "reform_id,reform_name,year,income_band,change_band,households\na,A,2029,0,0,1\n",
      ),
    ).toThrow(/unexpected columns/);
  });

  it("refuses a value that is not a number", () => {
    expect(() =>
      parseScatterCsv(
        "reform_id,reform_name,year,income_band,change_band,change_band_upper,households\na,A,2029,x,0,1,1\n",
      ),
    ).toThrow(/income_band/);
  });
});

describe("scatterView", () => {
  const view = (selectedIds, year = 2029, data = ready) =>
    scatterView({ data, selectedIds, policyIds: POLICY_IDS, year, packageId: "all_combined" });

  it("shows one measure's cells for that measure and year, centred in their bands", () => {
    const result = view(["a"]);
    expect(result.kind).toBe("points");
    expect(result.points.map(({ change, ...rest }) => rest)).toEqual([
      { income: 22500, households: 151000, incomeBand: 20000, changeBand: -150, changeBandUpper: -100 },
      { income: 27500, households: 98000, incomeBand: 25000, changeBand: -1, changeBandUpper: 1 },
      { income: 27500, households: 7000, incomeBand: 25000, changeBand: 5000, changeBandUpper: 5000 },
    ]);
    const [loss, zero, open] = result.points.map((point) => point.change);
    // The middle on the symlog axis, between the band's edges
    expect(loss).toBeGreaterThan(-150);
    expect(loss).toBeLessThan(-100);
    expect(toChangeAxis(loss)).toBeCloseTo((toChangeAxis(-150) + toChangeAxis(-100)) / 2);
    expect(zero).toBe(0);
    expect(open).toBe(5000);
  });

  it("shows the package's cells when every measure is selected", () => {
    const result = view(["a", "b"]);
    expect(result.kind).toBe("points");
    expect(result.reform).toBe("all_combined");
    expect(result.points).toHaveLength(1);
  });

  it("never adds measures together", () => {
    const result = scatterView({
      data: ready,
      selectedIds: ["a", "b"],
      policyIds: ["a", "b", "c"],
      year: 2029,
    });
    expect(result.kind).toBe("notice");
    expect(result.reason).toMatch(/one measure at a time/);
  });

  it("says when nothing is published", () => {
    expect(view(["a"], 2029, { status: "unavailable", rows: null }).reason).toBe(
      "Household results are not yet published.",
    );
    expect(view(["b"]).reason).toMatch(/not yet published for this measure/);
    expect(view(["a"], 2031).reason).toMatch(/2031-32/);
    expect(view([]).reason).toMatch(/Select a measure/);
    expect(view(["a"], 2029, { status: "loading", rows: null }).kind).toBe("loading");
  });
});

describe("labels and CSV", () => {
  it("labels bands, with the outer bands open-ended", () => {
    expect(incomeBandLabel(0)).toBe("under £5,000");
    expect(incomeBandLabel(145000)).toBe("£145,000 and over");
  });

  it("labels the no-change band", () => {
    expect(changeBandLabel(-1, 1)).toBe("No change");
  });

  it("labels the mirrored half-open bands as ranges", () => {
    expect(changeBandLabel(100, 150)).toBe("£100 to £150");
    expect(changeBandLabel(-150, -100)).toBe("−£150 to −£100");
    expect(changeBandLabel(1, 10)).toBe("£1 to £10");
    expect(changeBandLabel(-10, -1)).toBe("−£10 to −£1");
  });

  it("labels the open outer bands by their edge", () => {
    expect(changeBandLabel(5000, 5000)).toBe("£5,000 or more");
    expect(changeBandLabel(-5000, -5000)).toBe("−£5,000 or less");
  });

  it("writes the cells, not households, with both band edges", () => {
    const text = scatterCsv(view_points(), { title: "Household income impacts, 2029-30" });
    expect(text).toContain(
      "Baseline income band,Change band,Change band lower edge,Change band upper edge,Households",
    );
    expect(text).toContain('"£20,000 to £25,000",−£150 to −£100,-150,-100,151000');
    expect(text).toContain('"£25,000 to £30,000",No change,-1,1,98000');
    expect(text).toContain('"£25,000 to £30,000","£5,000 or more",5000,5000,7000');
    expect(text).not.toMatch(/household_id|household_weight/);
  });
});

function view_points() {
  return scatterView({ data: ready, selectedIds: ["a"], policyIds: POLICY_IDS, year: 2029 })
    .points;
}

describe("scatterDots", () => {
  const cells = [
    { incomeBand: 20000, changeBand: -400, changeBandUpper: -300, households: 151000 },
    { incomeBand: 25000, changeBand: -1, changeBandUpper: 1, households: 60000 },
    { incomeBand: 30000, changeBand: 1, changeBandUpper: 10, households: 4000 },
    { incomeBand: 35000, changeBand: -10, changeBandUpper: -1, households: 40000 },
    { incomeBand: 60000, changeBand: 5000, changeBandUpper: 5000, households: 60000 },
    { incomeBand: 90000, changeBand: -5000, changeBandUpper: -5000, households: 40000 },
  ];
  const of = (dots, cell) =>
    dots.filter(
      (dot) =>
        dot.incomeBand === cell.incomeBand &&
        dot.changeBand === cell.changeBand &&
        dot.changeBandUpper === cell.changeBandUpper,
    );

  it("draws about one dot per 20,000 households, and at least one a cell", () => {
    const dots = scatterDots(cells);
    expect(cells.map((cell) => of(dots, cell).length)).toEqual([8, 3, 1, 2, 3, 2]);
  });

  it("places the same dots on every call", () => {
    expect(scatterDots(cells)).toEqual(scatterDots(cells));
  });

  it("keeps each dot inside its own cell on the symlog axis, and carries the cell's count", () => {
    for (const dot of scatterDots(cells).filter((d) => !d.edge)) {
      expect(dot.income).toBeGreaterThan(dot.incomeBand);
      expect(dot.income).toBeLessThan(dot.incomeBand + 5000);
      expect(dot.y).toBeCloseTo(toChangeAxis(dot.change));
      expect(cells.map((cell) => cell.households)).toContain(dot.households);
    }
  });

  it("spreads the mirrored half-open bands within their own edges", () => {
    const dots = scatterDots(cells);
    for (const dot of of(dots, cells[0])) {
      expect(dot.change).toBeGreaterThan(-400);
      expect(dot.change).toBeLessThan(-300);
    }
    for (const dot of of(dots, cells[2])) {
      expect(dot.change).toBeGreaterThan(1);
      expect(dot.change).toBeLessThan(10);
    }
    for (const dot of of(dots, cells[3])) {
      expect(dot.change).toBeGreaterThan(-10);
      expect(dot.change).toBeLessThan(-1);
    }
  });

  it("draws the no-change band as a line of dots at £0", () => {
    const zero = of(scatterDots(cells), cells[1]);
    expect(zero).toHaveLength(3);
    for (const dot of zero) {
      expect(dot.y).toBe(0);
      expect(dot.change).toBe(0);
      expect(dot.edge).toBeNull();
    }
    expect(new Set(zero.map((dot) => dot.income)).size).toBe(3);
  });

  it("draws the open-ended outer bands in the strips beyond the plotted range", () => {
    expect(edgeOf(-5000, -5000)).toBe("lower");
    expect(edgeOf(5000, 5000)).toBe("upper");
    expect(edgeOf(3000, 5000)).toBeNull();
    expect(edgeOf(-1, 1)).toBeNull();
    const dots = scatterDots(cells);
    const upper = dots.filter((d) => d.edge === "upper");
    const lower = dots.filter((d) => d.edge === "lower");
    expect(upper).toHaveLength(3);
    expect(lower).toHaveLength(2);
    for (const dot of upper) {
      expect(dot.y).toBeGreaterThan(toChangeAxis(5000));
      expect(dot.y).toBeLessThan(toChangeAxis(5000) + EDGE_STRIP);
      expect(dot.y).toBeLessThan(CHANGE_AXIS_DOMAIN[1]);
    }
    for (const dot of lower) {
      expect(dot.y).toBeLessThan(toChangeAxis(-5000));
      expect(dot.y).toBeGreaterThan(CHANGE_AXIS_DOMAIN[0]);
    }
  });
});
