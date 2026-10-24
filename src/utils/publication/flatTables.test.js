/**
 * The flat CSVs under public/data that the page reads, checked against the
 * columns and types the publication contract gives them (contract.json, from
 * uk_budget_data.publication.tables). The build checks only that each file
 * was reviewed and carries no record-level ids; a regenerated file with a
 * renamed column or a blank cell would otherwise reach the page and show as
 * zero or nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv, parseTable } from "./csv";
import { AGE_BANDS } from "../ageImpact";
import { COMBINED_REFORM_ID } from "../policyConfig";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../../public/data");
const read = (file) => readFileSync(join(DATA, file), "utf8");

// Every flat table a tab fetches, by its contract name.
const CONTRACT_TABLES = [
  ["budgetary_impact", "budgetary_impact.csv"], // Population: public finances, OBR table
  ["distributional_impact", "distributional_impact.csv"], // Population: deciles
  ["winners_losers", "winners_losers.csv"], // Population: deciles
  ["metrics", "metrics.csv"], // Population: headline metrics
  ["income_curve", "income_curve.csv"], // Population: example household
  ["age_impact", "age_impact.csv"], // Young people
];

// obr_comparison.csv has no contract entry: these are the columns
// OBRComparisonTable reads, by position for the first three.
const OBR_COLUMNS = [
  ["reform_id", "str"],
  ["reform_name", "str"],
  ["year", "int"],
  ["policyengine_value", "float"],
  ["obr_static_value", "float"],
  ["obr_post_behavioural_value", "float"],
];

const standaloneIds = (rows) =>
  [...new Set(rows.map((r) => r.reform_id).filter((id) => !id.endsWith("_combined")))].sort();

describe("the flat tables the page reads", () => {
  const tables = Object.fromEntries(
    CONTRACT_TABLES.map(([name, file]) => [name, () => parseTable(name, read(file))]),
  );

  it.each(CONTRACT_TABLES)("%s has the contract's columns and types", (name) => {
    const rows = tables[name]();
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each([...CONTRACT_TABLES.map(([, file]) => file), "obr_comparison.csv"])(
    "%s has no quoted cells (the page splits rows on commas)",
    (file) => {
      expect(read(file)).not.toContain('"');
    },
  );

  it("obr_comparison.csv has the columns OBRComparisonTable reads", () => {
    const [header, ...lines] = parseCsv(read("obr_comparison.csv").trimEnd());
    expect(header).toEqual(OBR_COLUMNS.map(([column]) => column));
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((cells, i) => {
      expect(cells, `row ${i + 1}`).toHaveLength(OBR_COLUMNS.length);
      expect(cells[0], `row ${i + 1} reform_id`).not.toBe("");
      expect(Number.isInteger(Number(cells[2])), `row ${i + 1} year`).toBe(true);
      // A missing OBR figure is blank; anything else must be a number.
      cells.slice(3).forEach((cell, j) => {
        if (j > 0 && cell === "") return;
        expect(Number.isFinite(Number(cell)) && cell !== "", `row ${i + 1} ${OBR_COLUMNS[j + 3][0]}`).toBe(
          true,
        );
      });
    });
  });

  it("age_impact.csv covers every age band and the combined run", () => {
    const rows = tables.age_impact();
    const bands = new Set(rows.map((r) => r.age_band));
    for (const band of [...AGE_BANDS.map((b) => b.key), "all"]) {
      expect(bands.has(band), band).toBe(true);
    }
    // The Young people tab looks the whole selection up by this id.
    expect(rows.some((r) => r.reform_id === COMBINED_REFORM_ID)).toBe(true);
    for (const r of rows) {
      const total = r.pct_better_off + r.pct_worse_off + r.pct_unchanged;
      expect(Math.abs(total - 100), `${r.reform_id} ${r.year} ${r.age_band}`).toBeLessThan(0.5);
    }
  });

  it("every table covers the same measures", () => {
    // A partial regeneration on the day would leave tabs disagreeing.
    const expected = standaloneIds(tables.budgetary_impact());
    for (const [name] of CONTRACT_TABLES) {
      expect(standaloneIds(tables[name]()), name).toEqual(expected);
    }
    // The OBR comparison covers the same measures once the OBR has costed
    // them. Until 28 October it holds last year's costings, under last
    // year's ids, so it shares none with the candidates and pairs nothing
    // (OBRComparisonTable says it is not yet available).
    const [, ...obr] = parseCsv(read("obr_comparison.csv").trimEnd());
    const obrIds = standaloneIds(obr.map(([reform_id]) => ({ reform_id })));
    const shared = obrIds.filter((id) => expected.includes(id));
    expect(shared.length === 0 || shared.length === expected.length, "obr_comparison").toBe(true);
    if (shared.length) expect(obrIds).toEqual(expected);
  });

  it("each decile table has the decile labels App.jsx matches on", () => {
    // App.jsx looks rows up by these exact strings: "1st".."10th" for the
    // decile chart, "1".."10" (and "all", skipped) for the waterfall.
    const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
    const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    for (const [name, labels, extra] of [
      ["distributional_impact", ORDINALS, []],
      ["winners_losers", NUMBERS, ["all"]],
    ]) {
      const byRun = new Map();
      for (const r of tables[name]()) {
        const key = `${r.reform_id} ${r.year}`;
        byRun.set(key, [...(byRun.get(key) ?? []), r.decile]);
      }
      expect(byRun.size, name).toBeGreaterThan(0);
      for (const [key, deciles] of byRun) {
        expect([...deciles].sort(), `${name} ${key}`).toEqual([...labels, ...extra].sort());
      }
    }
  });
});
