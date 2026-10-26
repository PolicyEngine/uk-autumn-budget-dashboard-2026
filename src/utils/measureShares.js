// Better and worse off when the selection has no single run: one row per
// selected measure, each measure's own published shares for one group (an
// age group, or pensioners). Shares come from separate simulations, so
// they are never added up across measures; with one run for the whole
// selection (one measure, or a published combined run that matches it) the
// cards draw that run's groups as before.

import { wholeSelectionRun } from "./ageImpact";
import { shortNameOf } from "./policyDetails";
import { formatShare } from "./shareFormat";

/**
 * The per-measure view, or null when the selection has its own published
 * run for the year.
 *
 * @param {Function} sharesFn - (rows, policies, [id], year) => {groups} | null
 * @param {string} groupKey - The group shown (e.g. "16_24", "pensioners")
 * @returns {null | {groups: Array<{key, label}>, rows: Array<{id, name, row}>, missing: string[]}}
 *   groups: the groups a measure's shares offer, for the group choice;
 *   rows: one per selected measure with a usable row for the group, in the
 *   catalogue's order; missing: names of measures without one.
 */
export function sharesByMeasure(sharesFn, rows, policies, selected, year, combinedId, groupKey) {
  if (selected.length < 2) return null;
  // The whole selection's run, when it is published for the year (a
  // withdrawn or unsupported package gives no rows, so each measure's own)
  if (wholeSelectionRun(policies, selected, combinedId) && sharesFn(rows, policies, selected, year, combinedId)) return null;
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  let groups = [];
  const out = [];
  const missing = [];
  for (const policy of chosen) {
    const shares = sharesFn(rows, policies, [policy.id], year);
    if (shares && !groups.length) groups = shares.groups.map(({ key, label }) => ({ key, label }));
    const group = shares?.groups.find((candidate) => candidate.key === groupKey);
    const name = shortNameOf(policy);
    const fullName = policy.label ?? policy.name ?? name;
    if (group && group.row && !group.suppressed) out.push({ id: policy.id, name, fullName, row: group.row });
    else missing.push(name);
  }
  return { groups, rows: out, missing };
}

// The per-measure view's filters, in an Options pill: measures with no
// effect hidden, largest effect first, and gains, losses or both
export const SHARE_FILTER_OPTIONS = {
  hide: [
    { value: "hide", label: "Hide" },
    { value: "show", label: "Show" },
  ],
  order: [
    { value: "size", label: "Largest first" },
    { value: "catalogue", label: "Catalogue" },
  ],
  direction: [
    { value: "both", label: "Both" },
    { value: "gains", label: "Gains" },
    { value: "losses", label: "Losses" },
  ],
};

const reads = (value) => formatShare(value ?? 0) !== formatShare(0);

/**
 * The per-measure rows to draw ({row} holds pct_better_off and
 * pct_worse_off): with no effect (both read as zero) left out when `hide`
 * is "hide", only gains or losses when asked, largest effect (better plus
 * worse off) first unless `order` is "catalogue". Returns { rows, hidden },
 * hidden counting the measures left out for having no effect.
 */
export function filterShareRows(rows, { hide = "hide", order = "size", direction = "both" } = {}) {
  let out = rows;
  let hidden = 0;
  if (hide === "hide") {
    out = out.filter((r) => reads(r.row.pct_better_off) || reads(r.row.pct_worse_off));
    hidden = rows.length - out.length;
  }
  if (direction === "gains") out = out.filter((r) => reads(r.row.pct_better_off));
  if (direction === "losses") out = out.filter((r) => reads(r.row.pct_worse_off));
  if (order === "size") {
    const size = (r) => (r.row.pct_better_off ?? 0) + (r.row.pct_worse_off ?? 0);
    out = [...out].sort((a, b) => size(b) - size(a));
  }
  return { rows: out, hidden };
}
