import { AGE_BANDS, ALL_BAND, SINGLE_AGE_TOP, singleAgeKey } from "../ageImpact";

const AGE_TABLE = "age_impact";
/** The age table's row labels: the bands, "all", "0" to "89" and "90+". */
const AGE_LABELS = new Set([
  ...AGE_BANDS.map((band) => band.key),
  ALL_BAND,
  ...Array.from({ length: SINGLE_AGE_TOP + 1 }, (_, age) => singleAgeKey(age)),
]);

/**
 * Check decile blanks against the receipt without interpreting them as zero.
 * The age table leaves its withheld rows out rather than blanking them
 * (#340), so a withheld age row must be absent.
 */
export function withholdingProblems(tables, floor, { partial = false } = {}) {
  const problems = [];
  const withheld = new Set();
  const ages = new Set();
  const decileTables = ["distributional_impact", "winners_losers"];
  const groups = new Set(Array.from({ length: 10 }, (_, index) => String(index + 1)));
  const key = (table, year, group) => JSON.stringify([table, year, group]);
  if (floor != null && (typeof floor !== "object" || Array.isArray(floor))) return ["disclosure_floor is not a record"];
  const records = floor && Object.hasOwn(floor, "withheld_cells") ? floor.withheld_cells : [];
  if (!Array.isArray(records)) return ["disclosure_floor.withheld_cells is not a list"];
  for (const cell of records) {
    if (cell && typeof cell === "object" && !Array.isArray(cell) &&
        Object.keys(cell).sort().join() === "groups,table,year" && cell.table === AGE_TABLE) {
      if (!Number.isSafeInteger(cell.year) || !Array.isArray(cell.groups) || !cell.groups.length ||
          new Set(cell.groups).size !== cell.groups.length || cell.groups.some((group) => !AGE_LABELS.has(group))) {
        problems.push("disclosure_floor.withheld_cells has an invalid cell");
        continue;
      }
      for (const group of cell.groups) {
        const label = JSON.stringify([cell.year, group]);
        if (ages.has(label)) problems.push("disclosure_floor.withheld_cells repeats a cell");
        ages.add(label);
      }
      continue;
    }
    if (!cell || typeof cell !== "object" || Array.isArray(cell) ||
        Object.keys(cell).sort().join() !== "groups,table,year" ||
        !decileTables.includes(cell.table) || !Number.isSafeInteger(cell.year) ||
        !Array.isArray(cell.groups) || !cell.groups.length ||
        cell.groups.some((group) => !groups.has(group) && !(cell.table === "winners_losers" && group === "all"))) {
      problems.push("disclosure_floor.withheld_cells has an invalid cell");
      continue;
    }
    for (const group of cell.groups) {
      const label = key(cell.table, cell.year, group);
      if (withheld.has(label)) problems.push("disclosure_floor.withheld_cells repeats a cell");
      withheld.add(label);
    }
  }
  for (const label of withheld) {
    const [, year, group] = JSON.parse(label);
    if (group !== "all" && !withheld.has(key("winners_losers", year, "all"))) {
      problems.push(`winners_losers ${year} all must be withheld too`);
    }
  }
  const seen = new Set();
  const identifiers = new Set(["reform_id", "reform_name", "year", "decile"]);
  for (const table of decileTables) {
    for (const row of tables[table] ?? []) {
      const group = String(row.decile).replace(/(?:st|nd|rd|th)$/, "");
      const label = key(table, row.year, group);
      seen.add(label);
      const values = Object.entries(row).filter(([column]) => !identifiers.has(column)).map(([, value]) => value);
      if (withheld.has(label) && values.some((value) => value !== null && value !== "")) {
        problems.push(`${table} ${row.year} ${group} publishes a value in a withheld cell`);
      } else if (!withheld.has(label) && values.some((value) => value === null || value === "")) {
        problems.push(`${table} ${row.year} ${group} is blank without a recorded withholding`);
      }
    }
  }
  for (const label of withheld) {
    const [table, year, group] = JSON.parse(label);
    if (!seen.has(label) && (!partial || Object.hasOwn(tables, table))) {
      problems.push(`${table} ${year} ${group}: withheld row is missing`);
    }
  }
  for (const row of tables[AGE_TABLE] ?? []) {
    if (ages.has(JSON.stringify([row.year, String(row.age_band)]))) {
      problems.push(`${AGE_TABLE} ${row.year} ${row.age_band} publishes a withheld row`);
    }
  }
  return [...new Set(problems)];
}
