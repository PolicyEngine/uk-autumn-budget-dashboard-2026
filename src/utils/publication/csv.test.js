// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsv, parseTable, TableError, TABLES } from "./csv";
import { fixtureJson, fixtureText } from "../../test/publicationFixture";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b,c","d ""e""","f\ng"\n1,2,3,4\n')).toEqual([
      ["a", "b,c", 'd "e"', "f\ng"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("accepts CRLF and a missing final line ending", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv('a,,""\n')).toEqual([["a", "", ""]]);
  });

  it("refuses malformed quoting", () => {
    expect(() => parseCsv('"open')).toThrow(TableError);
    expect(() => parseCsv('a"b')).toThrow(TableError);
    expect(() => parseCsv('"a"b')).toThrow(TableError);
  });

  it("round-trips any grid of cells written with RFC 4180 quoting", () => {
    const quote = (cell) => `"${cell.replaceAll('"', '""')}"`;
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string(), { minLength: 1, maxLength: 4 }), {
          minLength: 1,
          maxLength: 5,
        }),
        (grid) => {
          const text = grid.map((row) => row.map(quote).join(",")).join("\r\n");
          expect(parseCsv(text)).toEqual(grid);
        },
      ),
    );
  });
});

const header = TABLES.budgetary_impact.columns.map(([c]) => c).join(",");

describe("parseTable", () => {
  it("types each column as the publication format declares", () => {
    expect(
      parseTable("budgetary_impact", `${header}\nx,X,2030,-1.5\n`),
    ).toEqual([{ reform_id: "x", reform_name: "X", year: 2030, value: -1.5 }]);
  });

  it("refuses a missing, non-numeric or non-finite number, never zero", () => {
    for (const bad of [
      "",
      "abc",
      "Infinity",
      "NaN",
      "1e999",
      "0x10",
      " 1",
      "1e-400",
    ]) {
      expect(() =>
        parseTable("budgetary_impact", `${header}\nx,X,2030,${bad}\n`),
      ).toThrow(TableError);
    }
  });

  it("still reads a real zero", () => {
    for (const zero of ["0", "0.0", "-0.0", "0e5"]) {
      expect(
        parseTable("budgetary_impact", `${header}\nx,X,2030,${zero}\n`)[0]
          .value === 0,
      ).toBe(true);
    }
  });

  it("refuses a fractional or out-of-range year", () => {
    for (const bad of ["2030.5", "1e3", "99999999999999999"]) {
      expect(() =>
        parseTable("budgetary_impact", `${header}\nx,X,${bad},1\n`),
      ).toThrow(TableError);
    }
  });

  it("refuses a different header or a short row", () => {
    expect(() =>
      parseTable("budgetary_impact", "reform_id,year,value\nx,2030,1\n"),
    ).toThrow(/columns/);
    expect(() =>
      parseTable("budgetary_impact", `${header}\nx,X,2030\n`),
    ).toThrow(/cells/);
  });

  it("refuses an unknown table", () => {
    expect(() => parseTable("other", "a\n1\n")).toThrow(TableError);
  });

  it("parses every table in the fixture", () => {
    const manifest = fixtureJson("manifest.json");
    const entries = { ...manifest.measures, ...manifest.combined };
    for (const entry of Object.values(entries)) {
      const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
      for (const file of Object.keys(receipt.dashboard.files)) {
        const table = Object.keys(TABLES).find(
          (name) => TABLES[name].file === file,
        );
        const rows = parseTable(
          table,
          fixtureText(`${entry.artifact}/${file}`),
        );
        expect(rows.length).toBeGreaterThan(0);
      }
    }
  });
});
