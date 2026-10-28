/**
 * MOCK DATA, for tests only. Synthetic national tables in the shape of the
 * flat CSVs the pipeline writes (`metrics.csv`, `distributional_impact.csv`,
 * `winners_losers.csv`, `age_impact.csv`). Every figure is invented by the
 * rules below: none comes from a model run, survey data or a published file.
 *
 * The flat files these stand for were removed from public/data (#285
 * review): they were written before their writer was held to the floor of
 * survey households, and the page never read them. The tests that read them
 * to exercise the cards and the CSV parser read these instead.
 *
 * The measures, and their names, are those of public/data/budgetary_impact.csv,
 * which the tests build their catalogue from. What the tests rely on:
 *
 * - In 2027 three measures change no household's income (all deciles 0):
 *   the employer NI relief (never), the Warm Home Discount top-up (2026
 *   only) and the threshold freeze (2031 only). Every other one changes
 *   some.
 * - In 2027 two measures move people out of absolute poverty before housing
 *   costs: the Plan 2 threshold most (MOCK -0.005pp), State Pension
 *   protection next (MOCK -0.0025pp, and no child poverty change); the
 *   combined run is their sum (MOCK -0.0075pp). Fuel duty and the other
 *   price and capital gains measures move no one.
 * - The combined run's figures are its members' summed, every year.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLAT_EXTRA_COLUMNS, parseCsv, TABLES } from "../utils/publication/csv";
import { AGE_BANDS } from "../utils/ageImpact";
import { csvField } from "../utils/geography/exportTable";

export const MOCK_YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
export const MOCK_COMBINED = "autumn_budget_2026_combined";

// The measures and names budgetary_impact.csv carries (public, reviewed)
const [, ...budgetLines] = parseCsv(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data", "budgetary_impact.csv"), "utf8").trimEnd(),
);
const NAMES = new Map(budgetLines.map(([id, name]) => [id, name]));
const MEMBERS = [...NAMES.keys()].filter((id) => id !== MOCK_COMBINED);

// MOCK: the years each measure changes household incomes
const ACTIVE = {
  employer_ni_relief_under_25s: [],
  warm_home_discount_top_up: [2026],
  threshold_freeze_2031_32: [2031],
  road_fuel_vat_cut: [2026, 2027],
};
const active = (id, year) => (ACTIVE[id] ?? MOCK_YEARS).includes(year);

// MOCK: each measure's change for a middling household, £ a year, when active
const BASE_GBP = {
  badr_lifetime_limit_cut: -15,
  domestic_electricity_zero_vat: 50,
  employer_ni_relief_under_25s: 0,
  fuel_duty_rise_deferral: 30,
  plan_2_threshold_unfreeze: 60,
  road_fuel_vat_cut: 20,
  state_pension_income_tax_protection: 40,
  threshold_freeze_2031_32: -120,
  warm_home_discount_top_up: 25,
};

// MOCK: each measure's change in the headline poverty rate, pp, by year
// (0 in any year not listed)
const POVERTY_PP = {
  plan_2_threshold_unfreeze: { 2026: -0.004, 2027: -0.005, 2028: -0.006, 2029: -0.006, 2030: -0.007, 2031: -0.007 },
  state_pension_income_tax_protection: { 2026: -0.002, 2027: -0.0025, 2028: -0.003, 2029: -0.003, 2030: -0.0035, 2031: -0.0035 },
  warm_home_discount_top_up: { 2026: -0.003 },
  threshold_freeze_2031_32: { 2031: 0.01 },
};
// MOCK: measures that change no child's poverty
const NO_CHILD_EFFECT = new Set(["state_pension_income_tax_protection"]);
// MOCK: each poverty line's change relative to the headline's
const LINE_FACTOR = { abs_bhc: 1, abs_ahc: 1.1, rel_bhc: 0.9, rel_ahc: 1.2 };

const decileChange = (id, year, decile) => (active(id, year) ? BASE_GBP[id] * (0.5 + decile / 10) : 0);
const memberIds = (id) => (id === MOCK_COMBINED ? MEMBERS : [id]);
const sum = (id, value) => memberIds(id).reduce((total, member) => total + value(member), 0);
const ORDINAL = (n) => `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n] ?? "th"}`;
const DECILES = Array.from({ length: 10 }, (_, i) => i + 1);

function metricsRow(id, year) {
  const pp = (member) => POVERTY_PP[member]?.[year] ?? 0;
  const row = {
    people_affected: sum(id, (member) => (active(member, year) && BASE_GBP[member] !== 0 ? 4 : 0)),
    gini_change: sum(id, (member) => -0.00001 * decileChange(member, year, 1)),
    poverty_change_pp: sum(id, pp),
    poverty_change_pct: sum(id, (member) => pp(member) * 5),
  };
  for (const [line, factor] of Object.entries(LINE_FACTOR)) {
    const child = (member) => (NO_CHILD_EFFECT.has(member) ? 0 : pp(member) * factor * 1.5);
    row[`poverty_${line}_change_pp`] = sum(id, (member) => pp(member) * factor);
    row[`poverty_${line}_change_pct`] = sum(id, (member) => pp(member) * factor * 5);
    row[`child_poverty_${line}_change_pp`] = sum(id, child);
    row[`child_poverty_${line}_change_pct`] = sum(id, (member) => child(member) * 4);
  }
  row.top_10_share_change_pp = sum(id, (member) => -0.0001 * decileChange(member, year, 1));
  row.top_1_share_change_pp = sum(id, (member) => -0.00002 * decileChange(member, year, 1));
  row.p90_p10_change = sum(id, (member) => -0.0005 * decileChange(member, year, 1));
  return row;
}

function ageRow(id, year, index) {
  const change = sum(id, (member) => decileChange(member, year, 5)) * (0.7 + index / 10);
  const moved = sum(id, (member) => (active(member, year) && BASE_GBP[member] !== 0 ? 1 : 0));
  const better = change > 0 ? Math.min(90, 5 * moved) : 0;
  const worse = change < 0 ? Math.min(90, 5 * moved) : 0;
  return {
    people: 8_000_000 + index * 500_000,
    sample_size: 4_000 + index * 250,
    mean_change: change,
    mean_equivalised_change: change * 0.6,
    pct_better_off: better,
    pct_worse_off: worse,
    pct_unchanged: 100 - better - worse,
    people_directly_affected: moved * 100_000,
  };
}

const IDS = [...MEMBERS, MOCK_COMBINED];
const each = (make) => IDS.flatMap((id) => MOCK_YEARS.flatMap((year) => make(id, year)));
const identify = (id, year) => ({ reform_id: id, reform_name: NAMES.get(id), year });

/** MOCK rows by flat file name: synthetic, never a published figure. */
export const MOCK_NATIONAL_ROWS = {
  "metrics.csv": each((id, year) => [{ ...identify(id, year), ...metricsRow(id, year) }]),
  "distributional_impact.csv": each((id, year) =>
    DECILES.map((d) => ({ ...identify(id, year), decile: ORDINAL(d), value: sum(id, (m) => decileChange(m, year, d)) / (100 * d) })),
  ),
  "winners_losers.csv": each((id, year) => [
    ...DECILES.map((d) => ({ ...identify(id, year), decile: String(d), avg_change: sum(id, (m) => decileChange(m, year, d)) })),
    { ...identify(id, year), decile: "all", avg_change: sum(id, (m) => DECILES.reduce((t, d) => t + decileChange(m, year, d), 0) / 10) },
  ]),
  "age_impact.csv": each((id, year) =>
    [...AGE_BANDS.map((band) => band.key), "all"].map((band, index) => ({ ...identify(id, year), age_band: band, ...ageRow(id, year, index) })),
  ),
};

const COLUMNS = {
  "metrics.csv": [...TABLES.metrics.columns, ...FLAT_EXTRA_COLUMNS.metrics].map(([column]) => column),
  "distributional_impact.csv": TABLES.distributional_impact.columns.map(([column]) => column),
  "winners_losers.csv": TABLES.winners_losers.columns.map(([column]) => column),
  "age_impact.csv": TABLES.age_impact.columns.map(([column]) => column),
};

const cell = (value) => (typeof value === "number" && !Number.isInteger(value) ? String(Number(value.toFixed(8))) : String(value));

/**
 * MOCK: one synthetic flat file's text, as the pipeline would write it.
 *
 * @param {string} file - "metrics.csv", "distributional_impact.csv",
 *   "winners_losers.csv" or "age_impact.csv"
 * @returns {string}
 */
export function mockNationalCsv(file) {
  const columns = COLUMNS[file];
  if (!columns) throw new Error(`${file} has no mock national table`);
  const lines = [columns.join(","), ...MOCK_NATIONAL_ROWS[file].map((row) => columns.map((column) => csvField(cell(row[column]))).join(","))];
  return `${lines.join("\n")}\n`;
}
