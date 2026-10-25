import { describe, expect, it } from "vitest";
import { toChangeAxis } from "./publication/scatter";
import {
  allocateDots,
  changeBandLabel,
  edgeOf,
  householdsPerDot,
  incomeBandLabel,
  panelDots,
  parseScatterCsv,
  scatterCsv,
  scatterDots,
  scatterView,
} from "./householdScatter";

const HEADER =
  "reform_id,reform_name,year,income_band,change_band,change_band_upper,households,income_basis_year";
const CSV = [
  HEADER,
  "a,Measure A,2029,20000.0,-150.0,-100.0,151000.0,2027",
  "a,Measure A,2029,25000.0,-1.0,1.0,98000.0,2027",
  "a,Measure A,2029,25000.0,5000.0,5000.0,7000.0,2027",
  "a,Measure A,2030,20000.0,-150.0,-100.0,140000.0,2027",
  'all_combined,"All, together",2029,20000.0,-200.0,-150.0,250000.0,2027',
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
      income_basis_year: 2027,
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
    expect(() => parseScatterCsv(`${HEADER}\na,A,2029,x,0,1,1,2027\n`)).toThrow(
      /income_band/,
    );
    // The file before households were banded by one year's income
    expect(() =>
      parseScatterCsv(
        "reform_id,reform_name,year,income_band,change_band,change_band_upper,households\na,A,2029,0,0,1,1\n",
      ),
    ).toThrow(/unexpected columns/);
  });
});

describe("scatterView", () => {
  const view = (selectedIds, year = 2029, data = ready) =>
    scatterView({ data, selectedIds, policyIds: POLICY_IDS, year });

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
    { incomeBand: 145000, changeBand: -5000, changeBandUpper: -5000, households: 40000 },
    { incomeBand: 145000, changeBand: 100, changeBandUpper: 150, households: 45000 },
  ];
  const total = 40;
  const of = (dots, cell) =>
    dots.filter(
      (dot) =>
        dot.incomeBand === cell.incomeBand &&
        dot.changeBand === cell.changeBand &&
        dot.changeBandUpper === cell.changeBandUpper,
    );

  it("shares the dots out by households, adding up to the total exactly", () => {
    // 400,000 households over 40 dots: 10,000 a dot
    expect(householdsPerDot(cells, total)).toBe(10000);
    const counts = allocateDots(cells, total);
    expect(counts).toEqual([15, 6, 0, 4, 6, 4, 5]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(allocateDots(cells).reduce((a, b) => a + b, 0)).toBe(500);
  });

  it("places the same dots on every call", () => {
    expect(scatterDots(cells, { total })).toEqual(scatterDots(cells, { total }));
  });

  it("keeps each dot inside its own cell, in £, and carries the cell's count", () => {
    for (const dot of scatterDots(cells, { total })) {
      expect(dot.income).toBeGreaterThanOrEqual(dot.incomeBand);
      expect(dot.income).toBeLessThan(dot.incomeBand + 5000);
      expect(dot.income).toBeLessThanOrEqual(150000);
      expect(dot.change).toBeGreaterThanOrEqual(dot.changeBand);
      expect(dot.change).toBeLessThanOrEqual(dot.changeBandUpper);
      expect(cells.map((cell) => cell.households)).toContain(dot.households);
    }
  });

  it("spreads each band within its own edges", () => {
    const dots = scatterDots(cells, { total });
    for (const dot of of(dots, cells[0])) {
      expect(dot.change).toBeGreaterThan(-400);
      expect(dot.change).toBeLessThan(-300);
    }
    for (const dot of of(dots, cells[3])) {
      expect(dot.change).toBeGreaterThan(-10);
      expect(dot.change).toBeLessThan(-1);
    }
    const zero = of(dots, cells[1]);
    expect(zero).toHaveLength(6);
    for (const dot of zero) expect(Math.abs(dot.change)).toBeLessThan(1);
    expect(new Set(zero.map((dot) => dot.income)).size).toBe(6);
  });

  it("counts the open outer bands but leaves them off the plot, as in 2025", () => {
    expect(edgeOf(-5000, -5000)).toBe("lower");
    expect(edgeOf(5000, 5000)).toBe("upper");
    expect(edgeOf(3000, 5000)).toBeNull();
    expect(edgeOf(-1, 1)).toBeNull();
    const dots = scatterDots(cells, { total });
    expect(of(dots, cells[4])).toHaveLength(0);
    expect(of(dots, cells[5])).toHaveLength(0);
    expect(dots).toHaveLength(total - 6 - 4);
    for (const dot of dots) expect(Math.abs(dot.change)).toBeLessThan(5000);
  });
});

describe("panelDots", () => {
  const cell = (incomeBand, changeBand, changeBandUpper, households) => ({
    incomeBand,
    changeBand,
    changeBandUpper,
    households,
  });
  // Two income bands, banded by 2027 income. 2027: 300,000 and 100,000
  // households, so 30 and 10 of 40 dots.
  const basis = [
    cell(20000, -1, 1, 200000),
    cell(20000, 10, 25, 100000),
    cell(40000, 100, 150, 100000),
  ];
  // A later year: the same households, more of them gaining, by more; the
  // £40,000 band's cell is now too small to publish.
  const later = [
    cell(20000, -1, 1, 60000),
    cell(20000, 25, 50, 180000),
    cell(20000, 5000, 5000, 70000),
    cell(30000, 1, 10, 50000),
  ];
  const total = 40;

  it("gives each income band the same dots in every year, by its basis-year households", () => {
    const first = panelDots(basis, basis, { total });
    const second = panelDots(basis, later, { total });
    expect(first.map((dot) => dot.key)).toEqual(second.map((dot) => dot.key));
    const rows = (dots) =>
      dots.reduce((count, dot) => ({ ...count, [dot.incomeBand]: (count[dot.incomeBand] ?? 0) + 1 }), {});
    expect(rows(first)).toEqual({ 20000: 30, 40000: 10 });
    expect(rows(second)).toEqual({ 20000: 30, 40000: 10 });
    // A band that only appears in a later year gets no dots
    expect(second.some((dot) => dot.incomeBand === 30000)).toBe(false);
  });

  it("keeps each dot's income, so it moves only sideways", () => {
    const first = panelDots(basis, basis, { total });
    const second = panelDots(basis, later, { total });
    first.forEach((dot, i) => {
      expect(second[i].income).toBe(dot.income);
      expect(dot.income).toBeGreaterThanOrEqual(dot.incomeBand);
      expect(dot.income).toBeLessThan(dot.incomeBand + 5000);
    });
  });

  it("places the k-th dot at the band's k-th weighted quantile of change", () => {
    const first = panelDots(basis, basis, { total }).filter((d) => d.incomeBand === 20000);
    // 2027: two thirds no change, then £10 to £25
    expect(first.slice(0, 20).every((dot) => dot.changeBand === -1)).toBe(true);
    expect(first.slice(20).every((dot) => dot.changeBand === 10)).toBe(true);
    const second = panelDots(basis, later, { total }).filter((d) => d.incomeBand === 20000);
    // Later: about a fifth no change, three fifths £25 to £50, the rest
    // beyond £5,000 (off the plot, kept but hidden)
    const bands = second.map((dot) => dot.changeBand);
    expect(bands.slice(0, 5)).toEqual(Array(5).fill(-1));
    expect(bands.slice(6, 23)).toEqual(Array(17).fill(25));
    expect(bands.slice(24)).toEqual(Array(6).fill(5000));
    expect(second.slice(24).every((dot) => dot.hidden)).toBe(true);
    // Changes never go down with rank across bands
    for (const dot of second.filter((d) => !d.hidden)) {
      expect(dot.change).toBeGreaterThanOrEqual(dot.changeBand);
      expect(dot.change).toBeLessThanOrEqual(dot.changeBandUpper);
    }
  });

  it("hides a band's dots in a year with no published cell, keeping them", () => {
    const second = panelDots(basis, later, { total }).filter((d) => d.incomeBand === 40000);
    expect(second).toHaveLength(10);
    expect(second.every((dot) => dot.hidden)).toBe(true);
  });

  it("is deterministic", () => {
    expect(panelDots(basis, later, { total })).toEqual(panelDots(basis, later, { total }));
  });
});

describe("scatterView across years", () => {
  it("carries the basis year and its cells", () => {
    const result = scatterView({
      data: ready,
      selectedIds: ["a"],
      policyIds: POLICY_IDS,
      year: 2030,
    });
    expect(result.basisYear).toBe(2027);
    // No 2027 cells in this file: the year's own cells share the dots out
    expect(result.basisPoints).toEqual(result.points);
  });
});
