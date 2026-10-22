/**
 * CSV downloads of what a chart plots, for the current selection and year.
 *
 * Every file has the same shape: a UTF-8 byte-order mark (so spreadsheets
 * read £ signs), a "# title" line, one "# Units: ... | Source: ..." line,
 * the header row and the data rows. The values are the chart's own data,
 * rounded only to remove floating-point noise.
 */
import { csvField } from "./geography/exportTable";

export const CSV_SOURCE =
  "PolicyEngine UK microsimulation, UK Autumn Budget 2026 dashboard";

/** A number as CSV text: rounded to `decimals`, no trailing noise. */
export function formatCsvNumber(value, decimals = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const factor = 10 ** decimals;
  const rounded = Math.round(Number(value) * factor) / factor;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Build CSV text.
 *
 * @param {Object} spec
 * @param {string} spec.title - What the file holds, e.g. "Revenue impact"
 * @param {string} spec.units - The units of the value columns
 * @param {string} [spec.source] - Where the figures come from
 * @param {Array<{key: string, label: string, decimals?: number}>} spec.columns
 *   - Columns in order; a column with `decimals` is numeric
 * @param {Array<Object>} spec.rows - One object per row, keyed by column key
 * @returns {string}
 */
export function buildChartCsv({
  title,
  units,
  source = CSV_SOURCE,
  columns,
  rows,
  notes = [],
}) {
  const cell = (column, row) => {
    const value = row[column.key];
    if (column.decimals !== undefined) return formatCsvNumber(value, column.decimals);
    return csvField(value === null || value === undefined ? "" : String(value));
  };
  const lines = [
    csvField(`# ${title}`),
    csvField(`# Units: ${units} | Source: ${source}`),
    columns.map((column) => csvField(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => cell(column, row)).join(",")),
    ...notes.map((note) => csvField(`# ${note}`)),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "2026" -> "2026-27" */
export const fiscalYear = (year) => {
  const y = Number(year);
  return `${y}-${String(y + 1).slice(-2)}`;
};

/**
 * Revenue impact: one row per fiscal year, a column per selected measure,
 * and the net impact. `data` is the chart's data (year, measure names,
 * netImpact).
 */
export function revenueCsv(data, policyNames) {
  return buildChartCsv({
    title: "Revenue impact of the selected policies",
    units:
      "£ billion per fiscal year; positive values are revenue for the Government, negative values are costs",
    columns: [
      { key: "fiscal_year", label: "Fiscal year" },
      ...policyNames.map((name) => ({ key: name, label: name, decimals: 4 })),
      { key: "netImpact", label: "Net impact", decimals: 4 },
    ],
    // A year not yet published is a note, never a row of zeros
    rows: data
      .filter((point) => !point.unpublished)
      .map((point) => ({ ...point, fiscal_year: fiscalYear(point.year) })),
    notes: data
      .filter((point) => point.unpublished)
      .map((point) => `${fiscalYear(point.year)}: Not yet published`),
  });
}

/**
 * Impact by income decile: one row per decile, a column per selected
 * measure, and the net change.
 *
 * @param {"absolute"|"relative"} kind - Which decile chart
 */
export function decileCsv(data, policyNames, { kind, year }) {
  const absolute = kind === "absolute";
  return buildChartCsv({
    title: `${absolute ? "Absolute" : "Relative"} impact by income decile, ${fiscalYear(year)}`,
    units: absolute
      ? "£ per household per year (average change in household net income)"
      : "% change in household net income",
    columns: [
      { key: "decile", label: "Income decile" },
      ...policyNames.map((name) => ({
        key: name,
        label: name,
        decimals: absolute ? 2 : 4,
      })),
      { key: "netChange", label: "Net change", decimals: absolute ? 2 : 4 },
    ],
    rows: data.map((point) => ({
      ...point,
      decile: String(point.decile).replace(/st|nd|rd|th/g, ""),
    })),
  });
}

/** The example household's net income before and after, by earnings. */
export function householdIncomeCsv(data, { year }) {
  return buildChartCsv({
    title: `Household net income analysis, ${fiscalYear(year)}`,
    units:
      "£ per year; a household with 2 adults (both age 40) and 3 children (ages 7, 5 and 3)",
    columns: [
      { key: "employment", label: "Household head employment income", decimals: 0 },
      { key: "baseline", label: "Pre-Autumn Budget net income", decimals: 2 },
      { key: "reform", label: "Post-Autumn Budget net income", decimals: 2 },
    ],
    rows: data,
  });
}

/** The example household's change in net income, by earnings. */
export function householdChangeCsv(data, { year }) {
  return buildChartCsv({
    title: `Net income change, ${fiscalYear(year)}`,
    units:
      "£ per year; a household with 2 adults (both age 40) and 3 children (ages 7, 5 and 3)",
    columns: [
      { key: "employment", label: "Household head employment income", decimals: 0 },
      { key: "difference", label: "Change in net income", decimals: 2 },
    ],
    rows: data,
  });
}

const LIFECYCLE_COLUMNS = [
  "age",
  "year",
  "gross_income",
  "income_tax",
  "national_insurance",
  "student_loan_payment",
  "student_loan_debt_remaining",
  "baseline_net_income",
  "impact_rail_fare_freeze",
  "impact_fuel_duty_freeze",
  "impact_threshold_freeze",
  "impact_unearned_income_tax",
  "impact_salary_sacrifice_cap",
  "impact_sl_threshold_freeze",
  "impact_two_child_limit",
  "net_policy_impact",
];

/**
 * The lifetime calculator's year-by-year results: the columns the
 * calculator's CSV has always had, with the net impact summed over
 * `reformKeys`.
 */
export function lifecycleCsv(data, reformKeys, { real }) {
  return buildChartCsv({
    title: "Lifetime policy impact, year by year",
    units: real
      ? "£ per year in 2025 prices (age and year are plain numbers)"
      : "£ per year in cash terms (age and year are plain numbers)",
    columns: LIFECYCLE_COLUMNS.map((key) => ({
      key,
      label: key,
      decimals: key === "age" || key === "year" ? 0 : 2,
    })),
    rows: data.map((row) => ({
      ...row,
      net_policy_impact: reformKeys.reduce((sum, key) => sum + (row[key] || 0), 0),
    })),
  });
}

/**
 * A year-specific chart's CSV for a year not yet published: the title,
 * units and header, then a "# Not yet published" line, and no rows.
 */
export function unpublishedCsv(csvText) {
  const lines = csvText.replace(/\r\n$/, "").split("\r\n");
  const header = lines.slice(0, 3);
  return `${[...header, "# Not yet published"].join("\r\n")}\r\n`;
}
