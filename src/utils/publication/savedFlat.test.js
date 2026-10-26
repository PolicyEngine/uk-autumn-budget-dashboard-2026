/**
 * The files the pipeline's _save_all writes, parsed by the page's real CSV
 * parser. tests/test_publication_metadata.py regenerates them through
 * _save_all and checks they equal this fixture byte for byte, so a change
 * to what the pipeline writes fails one test or the other.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv, parseTable, TABLES } from "./csv";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/flat");
const read = (file) => readFileSync(join(FIXTURE, file), "utf8");

// TEST DATA ONLY: the synthetic name the Python test writes
const NAME = 'Mock, "alpha"\nwith a second line, £ and é';

describe("the pipeline's saved flat files", () => {
  it.each(["budgetary_impact", "distributional_impact", "winners_losers", "metrics", "income_curve", "age_impact"])(
    "%s keeps its canonical columns and parses, quoted cells included",
    (table) => {
      const [row, ...rest] = parseTable(table, read(TABLES[table].file));
      expect(rest).toEqual([]);
      expect(Object.keys(row)).toEqual(TABLES[table].columns.map(([column]) => column));
      expect(row.reform_id).toBe("ab2026_mock_alpha");
      expect(row.reform_name).toBe(NAME);
      expect(row.year).toBe(2026);
      expect(Object.keys(row)).not.toContain("reform_description");
    },
  );

  it("obr_comparison.csv has the six columns the OBR table reads", () => {
    const [header, row, ...rest] = parseCsv(read("obr_comparison.csv"));
    expect(header).toEqual([
      "reform_id", "reform_name", "year", "policyengine_value", "obr_static_value", "obr_post_behavioural_value",
    ]);
    expect(rest).toEqual([]);
    expect(row[1]).toBe(NAME);
  });
});
