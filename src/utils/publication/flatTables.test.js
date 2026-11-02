/**
 * Flat CSVs as a plain `uk-budget-data generate` writes them, checked
 * against the columns and types the publication contract gives them
 * (contract.json, from uk_budget_data.publication.tables), so a renamed
 * column or a blank cell fails here. The files are the pre-Budget run of the
 * nine candidate measures, kept as test data under
 * src/test/fixtures/candidate-run/ when #339 removed them from public/data:
 * the page reads approved artifacts only, never these.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLAT_EXTRA_COLUMNS, TABLES, TableError, parseCsv, parseFlatTable, parseTable } from "./csv";
import { AGE_BANDS } from "../ageImpact";
// The candidate run's own combined run (not a manifest key)
const COMBINED_REFORM_ID = "autumn_budget_2026_combined";
import { csvField } from "../geography/exportTable";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/candidate-run");
const read = (file) => readFileSync(join(DATA, file), "utf8");

// Every flat table, by its contract name.
const CONTRACT_TABLES = [
  ["budgetary_impact", "budgetary_impact.csv"], // Population: public finances
  ["distributional_impact", "distributional_impact.csv"], // Population: deciles
  ["winners_losers", "winners_losers.csv"], // Population: deciles
  ["metrics", "metrics.csv"], // Population: headline metrics
  ["income_curve", "income_curve.csv"], // Population: example household
  ["age_impact", "age_impact.csv"], // Young people
];

const standaloneIds = (rows) =>
  [...new Set(rows.map((r) => r.reform_id).filter((id) => !id.endsWith("_combined")))].sort();

describe("the flat tables a generate run writes", () => {
  const tables = Object.fromEntries(
    CONTRACT_TABLES.map(([name, file]) => {
      let parsed;
      return [name, () => (parsed ??= parseFlatTable(name, read(file)))];
    }),
  );

  it.each(CONTRACT_TABLES)("%s has the contract's columns and types", (name) => {
    const rows = tables[name]();
    expect(rows.length).toBeGreaterThan(0);
  }, 60000);

  it("metrics.csv carries the poverty and inequality measures the charts choose between", () => {
    const [row] = tables.metrics();
    for (const [column] of FLAT_EXTRA_COLUMNS.metrics) {
      expect(Number.isFinite(row[column]), column).toBe(true);
    }
  });

  it.each(CONTRACT_TABLES.map(([, file]) => file))(
    "%s round trips quoted CSV cells through the real parser",
    (file) => {
      const rows = parseCsv(read(file)).slice(0, 20);
      const encoded = rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
      expect(parseCsv(encoded)).toEqual(rows);
    },
    60000,
  );

  it("parses names with commas, quotes and embedded newlines", () => {
    const name = 'New measure, "quoted"\ncontinued';
    const text = `reform_id,reform_name,year,value\nfresh,${csvField(name)},2026,-1.25\n`;
    expect(parseTable("budgetary_impact", text)).toEqual([
      { reform_id: "fresh", reform_name: name, year: 2026, value: -1.25 },
    ]);
  });

  it("age_impact.csv covers every age band and the combined run", () => {
    const rows = tables.age_impact();
    const bands = new Set(rows.map((r) => r.age_band));
    for (const band of [...AGE_BANDS.map((b) => b.key), "all"]) {
      expect(bands.has(band), band).toBe(true);
    }
    // The Young people sub-tab looks the whole selection up by this id.
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

describe("parseFlatTable", () => {
  const contract = TABLES.metrics.columns.map(([column]) => column);
  const extras = FLAT_EXTRA_COLUMNS.metrics.map(([column]) => column);
  const row = (n) => ["r", "R", "2027", ...Array(n - 3).fill("0.5")].join(",");

  it("reads a metrics file with or without the extra columns", () => {
    const wide = parseFlatTable("metrics", `${[...contract, ...extras].join(",")}\n${row(contract.length + extras.length)}\n`);
    expect(wide[0].p90_p10_change).toBe(0.5);
    const narrow = parseFlatTable("metrics", `${contract.join(",")}\n${row(contract.length)}\n`);
    expect(Object.keys(narrow[0])).toEqual(contract);
  });

  it("refuses columns it does not know, and parseTable refuses the extras", () => {
    const text = `${[...contract, "mystery"].join(",")}\n${row(contract.length + 1)}\n`;
    expect(() => parseFlatTable("metrics", text)).toThrow(TableError);
    const wide = `${[...contract, ...extras].join(",")}\n${row(contract.length + extras.length)}\n`;
    expect(() => parseTable("metrics", wide)).toThrow(TableError);
  });
});
