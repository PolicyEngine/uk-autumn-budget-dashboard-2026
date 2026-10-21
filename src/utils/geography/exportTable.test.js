import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS } from "./columns";
import {
  buildCsv,
  buildTxt,
  csvField,
  formatGenerated,
  regionExportRows,
} from "./exportTable";
import { parseGeographyTable } from "./parse";
import { parseCsv } from "../publication/csv";
import { geographyFixture } from "../../test/geographyFixture";

const constituency = parseGeographyTable(geographyFixture("constituency.csv"), {
  level: "constituency",
});
const regional = parseGeographyTable(geographyFixture("regional.csv"), {
  level: "region",
});

describe("exports", () => {
  it("quote a field only when RFC 4180 needs it", () => {
    expect(csvField("Westmoor")).toBe("Westmoor");
    expect(csvField("Harbour, Mill and Quay")).toBe('"Harbour, Mill and Quay"');
    expect(csvField('A "quoted" name')).toBe('"A ""quoted"" name"');
  });

  it("write CSV that reads back to the published cells", () => {
    const rows = constituency.rows.slice(0, 6);
    const text = buildCsv(rows, [["Year", "2029-30"]]);
    expect(text.startsWith("﻿# Year: 2029-30\r\n")).toBe(true);
    const [, header, ...records] = parseCsv(text.slice(1).replace(/\r\n$/, ""));
    expect(header).toEqual([...EXPORT_COLUMNS]);
    expect(records).toEqual(
      rows.map((row) => EXPORT_COLUMNS.map((column) => row.cells[column])),
    );
  });

  it("quote a metadata line that holds a comma", () => {
    const text = buildCsv([], [["Measures", "One, two"]]);
    expect(parseCsv(text.slice(1))[0]).toEqual(["# Measures: One, two"]);
  });

  it("align text columns and keep blanks blank", () => {
    const rows = constituency.rows.filter((row) => row.areaCode === "Z14000003");
    const text = buildTxt(rows, { title: "Title", metadata: [["Year", "2029-30"]], notes: [] });
    const lines = text.split("\n");
    expect(lines.slice(0, 3)).toEqual(["Title", "Year: 2029-30", ""]);
    expect(lines[4]).toMatch(/^Z14000003\s+Westmoor\s+autumn_budget_2026_combined\s+2029\s+\w+\s+withheld\s+disclosure_control$/);
  });

  it("list regions in the canonical order, each outcome in turn", () => {
    const rows = regionExportRows(regional, {
      reform: "autumn_budget_2026_combined",
      year: 2030,
    });
    // 2030 publishes no £ rows, and nothing for Scotland.
    expect(rows.map((row) => row.areaCode)).toEqual([
      "E12000001",
      "E12000002",
      "E12000003",
      "E12000004",
      "E12000005",
      "E12000006",
      "E12000007",
      "E12000008",
      "E12000009",
      "W92000004",
      "N92000002",
    ]);
  });

  it("date the export in en-GB words", () => {
    expect(formatGenerated(new Date(2026, 9, 15, 11, 20))).toBe(
      "15 October 2026 at 11:20",
    );
  });
});
