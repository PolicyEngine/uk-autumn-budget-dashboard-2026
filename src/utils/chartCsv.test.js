import { describe, expect, it } from "vitest";
import {
  buildChartCsv,
  decileCsv,
  fiscalYear,
  formatCsvNumber,
  householdChangeCsv,
  householdIncomeCsv,
  revenueCsv,
  unpublishedCsv,
} from "./chartCsv";
import { exampleHousehold } from "./exampleHouseholds";

/** Lines of a CSV, without the byte-order mark and final line break. */
const lines = (text) => text.replace(/^﻿/, "").replace(/\r\n$/, "").split("\r\n");

describe("chart CSV downloads", () => {
  it("start with a title line, a units and source line, then the header", () => {
    const text = buildChartCsv({
      title: "A chart",
      units: "£bn",
      source: "Somewhere",
      columns: [
        { key: "label", label: "Label" },
        { key: "value", label: "Value", decimals: 1 },
      ],
      rows: [{ label: "One", value: 1.26 }],
    });
    expect(text.startsWith("﻿")).toBe(true);
    expect(lines(text)).toEqual([
      "# A chart",
      "# Units: £bn | Source: Somewhere",
      "Label,Value",
      "One,1.3",
    ]);
  });

  it("quote fields that hold commas and leave missing values blank", () => {
    const text = buildChartCsv({
      title: "Comma, in title",
      units: "x",
      columns: [
        { key: "name", label: "Name, full" },
        { key: "value", label: "Value", decimals: 2 },
      ],
      rows: [{ name: "Smith, J", value: null }],
    });
    const [title, , header, row] = lines(text);
    expect(title).toBe('"# Comma, in title"');
    expect(header).toBe('"Name, full",Value');
    expect(row).toBe('"Smith, J",');
  });

  it("round away floating-point noise and never print -0", () => {
    expect(formatCsvNumber(0.1 + 0.2, 4)).toBe("0.3");
    expect(formatCsvNumber(-0.00001, 2)).toBe("0");
    expect(formatCsvNumber(12345.678, 0)).toBe("12346");
    expect(formatCsvNumber(undefined)).toBe("");
  });

  it("label fiscal years", () => {
    expect(fiscalYear(2029)).toBe("2029-30");
    expect(fiscalYear("2030")).toBe("2030-31");
  });

  it("write the revenue chart's years, the selected measures and the net", () => {
    const data = [
      { year: 2026, "Measure A": -1.5, "Measure B": 0, Unselected: 0, netImpact: -1.5 },
      { year: 2027, "Measure A": -1.25, "Measure B": 2.1, Unselected: 0, netImpact: 0.85 },
    ];
    const [, units, header, ...rows] = lines(revenueCsv(data, ["Measure A", "Measure B"]));
    expect(units).toMatch(/^"# Units: £ billion per fiscal year/);
    expect(header).toBe("Fiscal year,Measure A,Measure B,Net impact");
    expect(rows).toEqual(["2026-27,-1.5,0,-1.5", "2027-28,-1.25,2.1,0.85"]);
  });

  it("write deciles as numbers, in pounds or per cent", () => {
    const data = [
      { decile: "1st", "Measure A": 12.345, netChange: 12.345 },
      { decile: "10th", "Measure A": -3.2, netChange: -3.2 },
    ];
    const absolute = lines(decileCsv(data, ["Measure A"], { kind: "absolute", year: 2029 }));
    expect(absolute[0]).toBe('"# Absolute impact by income decile, 2029-30"');
    expect(absolute[1]).toMatch(/£ per household per year/);
    expect(absolute.slice(2)).toEqual([
      "Income decile,Measure A,Net change",
      "1,12.35,12.35",
      "10,-3.2,-3.2",
    ]);
    const relative = lines(decileCsv(data, ["Measure A"], { kind: "relative", year: 2029 }));
    expect(relative[0]).toBe('"# Relative impact by income decile, 2029-30"');
    expect(relative[1]).toMatch(/% change in household net income/);
  });

  it("write the example household's curves, naming the household", () => {
    const pensioners = exampleHousehold("pensioner_couple");
    const income = lines(
      householdIncomeCsv([{ income: 20000, baseline: 30000.123, reform: 31000.5 }], {
        year: 2029,
        household: pensioners,
      }),
    );
    expect(income[1]).toContain(pensioners.definition);
    expect(income.slice(2)).toEqual([
      `${pensioners.x_label},Net income before the selected policies,Net income after the selected policies`,
      "20000,30000.12,31000.5",
    ]);
    const renter = exampleHousehold("single_renter");
    const change = lines(
      householdChangeCsv(
        [{ income: 80000, difference: -512.4, positive: null, negative: -512.4 }],
        { year: 2029, household: renter },
      ),
    );
    expect(change[1]).toContain(renter.definition);
    expect(change.slice(2)).toEqual(["Employment income,Change in net income", "80000,-512.4"]);
  });
});

describe("years not yet published", () => {
  it("are a note in the revenue CSV, never a row of zeros", () => {
    const data = [
      { year: 2030, "Measure A": 1.5, netImpact: 1.5 },
      { year: 2031, unpublished: true, netImpact: null },
    ];
    const rows = lines(revenueCsv(data, ["Measure A"]));
    expect(rows.slice(2)).toEqual([
      "Fiscal year,Measure A,Net impact",
      "2030-31,1.5,1.5",
      "# 2031-32: Not yet published",
    ]);
  });

  it("give a year-specific CSV its header and a not-published line", () => {
    const text = unpublishedCsv(
      decileCsv([{ decile: "1st", netChange: 0 }], [], { kind: "absolute", year: 2031 }),
    );
    expect(lines(text)).toEqual([
      '"# Absolute impact by income decile, 2031-32"',
      expect.stringMatching(/^"# Units: /),
      "Income decile,Net change",
      "# Not yet published",
    ]);
  });
});
