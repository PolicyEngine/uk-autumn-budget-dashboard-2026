/**
 * CSV and TXT exports of results by area.
 *
 * Both carry the published strings exactly as the files hold them, in the
 * columns EXPORT_COLUMNS lists, under metadata lines saying when the export
 * was made and what it shows. A withheld row stays blank where it was
 * blank: an export never fills in a figure.
 */

import { EXPORT_COLUMNS, OUTCOMES } from "./columns";
import { REGIONS } from "./regions";
import { lookupRow } from "./rows";

/** What the columns mean, for metadata lines and notes. */
export const EXPORT_UNITS =
  "average_change is in £ per household per year; relative_change is a ratio of baseline household net income (0.0123 is 1.23%)";

export const EXPORT_NOTES = Object.freeze([
  "Figures are as published after disclosure control, rounded to the precision the data supports.",
  "lo and hi bound a 90% interval from resampling survey households with their weights held fixed; it understates the uncertainty.",
  "approximate: the figure rests on few survey households, and its interval understates the uncertainty more.",
  "withheld: not published, to protect survey respondents' confidentiality.",
  "support_band: how many survey households the figure rests on.",
]);

/** "15 October 2026 at 11:20" */
export const formatGenerated = (date) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);

/**
 * The published rows for one reform and year, region by region in the
 * canonical order, each outcome in turn. Regions with no row are left out.
 */
export function regionExportRows(table, { reform, year }) {
  return REGIONS.flatMap((region) =>
    OUTCOMES.map((outcome) =>
      lookupRow(table, { areaCode: region.code, reform, year, outcome }),
    ),
  ).filter(Boolean);
}

/** One CSV field (RFC 4180): quoted when it holds a comma, quote or break. */
export const csvField = (text) =>
  /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * CSV text: a UTF-8 byte-order mark (so spreadsheets read £ and en dashes),
 * "# label: value" metadata lines, the header and the rows.
 *
 * @param {Array<Object>} rows - Parsed rows (their `cells` are exported).
 * @param {Array<[string, string]>} metadata - Label and value pairs.
 */
export function buildCsv(rows, metadata) {
  const lines = [
    ...metadata.map(([label, value]) => csvField(`# ${label}: ${value}`)),
    EXPORT_COLUMNS.join(","),
    ...rows.map((row) =>
      EXPORT_COLUMNS.map((column) => csvField(row.cells[column])).join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Plain text: a title, the metadata, the rows in aligned columns and notes.
 */
export function buildTxt(rows, { title, metadata, notes = EXPORT_NOTES }) {
  const table = [
    [...EXPORT_COLUMNS],
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => row.cells[column])),
  ];
  const widths = EXPORT_COLUMNS.map((_, index) =>
    Math.max(...table.map((cells) => cells[index].length)),
  );
  const lines = table.map((cells) =>
    cells
      .map((text, index) => text.padEnd(widths[index]))
      .join("  ")
      .trimEnd(),
  );
  return [
    title,
    ...metadata.map(([label, value]) => `${label}: ${value}`),
    "",
    ...lines,
    "",
    "Notes",
    ...notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}
