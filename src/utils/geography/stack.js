/**
 * The constituency map's stacked figures: for several selected policies
 * with no published combined run, each seat's figure is the sum of the
 * policies' own published rows (Vahid, 28 October). No new simulation.
 *
 * - value, lo and hi are each summed. Summing interval bounds gives a
 *   wider interval than the combined run's would be: conservative.
 * - A policy whose cell is withheld (disclosure control, too few survey
 *   households), or that has no row for the seat, counts as zero, and the
 *   seat's stacked figure is approximate. So is it when any policy's own
 *   figure is approximate.
 * - A seat where every policy is withheld or has no row has no figure.
 * - Interactions between policies are not included (nationally under £1m
 *   a year).
 *
 * The stacked rows have the parsed rows' shape (rows.js, parse.js), with
 * their own `cells` for the CSV export, so the map, the table, the cards
 * and the downloads read them as any other reform's.
 */

import { parseDecimal } from "./decimal";
import { indexRows } from "./rows";

/** The stacked figure's reform id for a set of policies, in their order. */
export const stackReform = (members) => `stack:${members.join("+")}`;

/** Whether a reform id is a stacked one. */
export const isStackReform = (reform) => typeof reform === "string" && reform.startsWith("stack:");

/** The table's note on approximate stacked figures. */
export const STACK_APPROXIMATE_NOTE =
  "Approximate: a policy has no published figure here (it counts as zero) or its figure rests on fewer than 30 survey households.";

/** The card's note for a stacked figure that is approximate. */
export const stackApproximateNote = (withheld) =>
  withheld.length > 0
    ? `Approximate: ${withheld.join(", ")} not published here, counted as zero`
    : "Approximate: a policy's figure here rests on fewer than 30 survey households";

/** The exact sum of published decimal strings, as a plain decimal. */
export function addDecimals(texts) {
  const parsed = texts.map(parseDecimal);
  if (parsed.length === 0) return "0";
  const exponent = Math.min(...parsed.map((part) => part.exponent));
  let total = 0n;
  for (const { negative, digits, exponent: own } of parsed) {
    const magnitude = BigInt(digits) * 10n ** BigInt(own - exponent);
    total += negative ? -magnitude : magnitude;
  }
  const negative = total < 0n;
  let digits = (negative ? -total : total).toString();
  if (exponent >= 0) return `${negative && digits !== "0" ? "-" : ""}${digits}${"0".repeat(exponent)}`;
  digits = digits.padStart(-exponent + 1, "0");
  const point = digits.length + exponent;
  const fraction = digits.slice(point).replace(/0+$/, "");
  const text = fraction ? `${digits.slice(0, point)}.${fraction}` : digits.slice(0, point);
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

const isZero = (text) => parseDecimal(text).digits === "0";
const sign = (text) => (isZero(text) ? 0 : parseDecimal(text).negative ? -1 : 1);

/**
 * A stacked figure's direction, from its summed interval: a gain when the
 * whole interval is above zero, a loss when below, no change when value
 * and bounds are all zero, else too close to call. Stricter than a
 * published row's check (parse.js lets a gain's interval touch zero).
 */
export function stackDirection({ value, lo, hi }) {
  if (sign(lo) > 0) return "gain";
  if (sign(hi) < 0) return "loss";
  if (isZero(value) && isZero(lo) && isZero(hi)) return "no_change";
  return "too_close_to_call";
}

/**
 * One seat's stacked row from its members' rows (null for a member with
 * no row), or null when no member has a row.
 *
 * @param {Array<{name: string, row: Object|null}>} parts
 */
export function stackRow(parts, { reform, areaCode, year, outcome }) {
  const present = parts.filter((part) => part.row);
  if (present.length === 0) return null;
  const areaName = present[0].row.areaName;
  const published = present.filter((part) => part.row.tier !== "withheld");
  // Not published (or no row): counted as zero, and named in the note
  const withheld = parts.filter((part) => !part.row || part.row.tier === "withheld").map((part) => part.name);
  const base = { level: "constituency", areaCode, areaName, reform, year, outcome };
  if (published.length === 0) {
    const cells = {
      level: "constituency", area_code: areaCode, area_name: areaName, reform, year: String(year), outcome,
      value: "", lo: "", hi: "", direction: "", tier: "withheld", reason: "disclosure_control",
      support_band: "", noise: "False", estimator: "sum_of_policies",
    };
    return Object.freeze({
      ...base, cells: Object.freeze(cells), value: "", lo: "", hi: "", direction: "",
      tier: "withheld", reason: "disclosure_control", supportBand: "", noise: false,
      estimator: "sum_of_policies", stacked: true, withheldPolicies: withheld,
    });
  }
  const sum = (field) => addDecimals(published.map((part) => part.row[field]));
  const figures = { value: sum("value"), lo: sum("lo"), hi: sum("hi") };
  const direction = stackDirection(figures);
  const approximate = withheld.length > 0 || published.some((part) => part.row.tier === "approximate");
  const tier = approximate ? "approximate" : "reported";
  const reason = approximate ? "thin_support" : "";
  const cells = {
    level: "constituency", area_code: areaCode, area_name: areaName, reform, year: String(year), outcome,
    ...figures, direction, tier, reason, support_band: "", noise: "False", estimator: "sum_of_policies",
  };
  return Object.freeze({
    ...base,
    cells: Object.freeze(cells),
    ...figures,
    direction,
    tier,
    reason,
    supportBand: "",
    noise: false,
    estimator: "sum_of_policies",
    stacked: true,
    withheldPolicies: withheld,
    note: approximate ? stackApproximateNote(withheld) : null,
  });
}

/**
 * The constituency table with the stacked rows of `members` added under
 * `stackReform(members)`, for every seat, year and outcome any member
 * publishes. Members with no rows at all count as zero everywhere.
 *
 * @param {Object} table - The parsed constituency table.
 * @param {Array<{id: string, name: string}>} members - The selected
 *   policies, in the page's order.
 */
export function withStack(table, members) {
  if (!table || members.length < 2) return table;
  const reform = stackReform(members.map((member) => member.id));
  const keys = new Map();
  const byMember = new Map(members.map((member) => [member.id, new Map()]));
  for (const member of members) {
    for (const row of table.byReform.get(member.id) ?? []) {
      const key = JSON.stringify([row.areaCode, row.year, row.outcome]);
      keys.set(key, { areaCode: row.areaCode, year: row.year, outcome: row.outcome });
      byMember.get(member.id).set(key, row);
    }
  }
  const stacked = [];
  for (const [key, where] of keys) {
    const parts = members.map((member) => ({ name: member.name, row: byMember.get(member.id).get(key) ?? null }));
    const row = stackRow(parts, { reform, ...where });
    if (row) stacked.push(row);
  }
  if (stacked.length === 0) return table;
  return indexRows(table.level, [...table.rows, ...stacked]);
}
