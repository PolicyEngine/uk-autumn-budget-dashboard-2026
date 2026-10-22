/**
 * The public format of results by area, as the disclosure layer writes it.
 *
 * public/data/regional.csv (level `region`), public/data/constituency.csv
 * (level `constituency`) and public/data/demographics.csv (one level per
 * way of grouping people, with a group's code where an area's would be)
 * share it: one row per level, area or group, reform, year and outcome.
 * Every value has passed disclosure control before it is written; a
 * withheld row carries no figure at all.
 */

import { DEMOGRAPHIC_LEVELS } from "../demographics/groups";

/** The columns, in the order the layer writes them. */
export const COLUMNS = Object.freeze([
  "level",
  "area_code",
  "area_name",
  "reform",
  "year",
  "outcome",
  "value",
  "lo",
  "hi",
  "direction",
  "tier",
  "reason",
  "support_band",
  "noise",
  "estimator",
]);

/** The levels whose rows are areas, with ONS codes. */
export const AREA_LEVELS = Object.freeze(["region", "constituency"]);

/** The published files, and the levels each one carries. */
export const FILES = Object.freeze({
  regional: Object.freeze({
    file: "regional.csv",
    levels: Object.freeze(["region"]),
  }),
  constituency: Object.freeze({
    file: "constituency.csv",
    levels: Object.freeze(["constituency"]),
  }),
  demographics: Object.freeze({
    file: "demographics.csv",
    levels: DEMOGRAPHIC_LEVELS,
  }),
});

/**
 * `average_change` is £ per household per year; `relative_change` is a
 * ratio of baseline household net income (0.0123 is 1.23%).
 */
export const OUTCOMES = Object.freeze(["average_change", "relative_change"]);

/**
 * - `reported`: the value and its interval.
 * - `approximate`: the value and its interval, from few survey households;
 *   the interval understates the uncertainty.
 * - `withheld`: nothing published. Withheld rows are alike by design.
 */
export const TIERS = Object.freeze(["reported", "approximate", "withheld"]);

/** The reason each tier other than `reported` must carry. */
export const TIER_REASONS = Object.freeze({
  approximate: "thin_support",
  withheld: "disclosure_control",
});

/**
 * - `too_close_to_call`: the interval crosses zero.
 * - `no_change`: no surveyed household in the area changed (all zeros).
 */
export const DIRECTIONS = Object.freeze([
  "gain",
  "loss",
  "too_close_to_call",
  "no_change",
]);

/** Survey households behind a figure, in bands (with an en dash). */
export const SUPPORT_BANDS = Object.freeze(["<10", "10–29", "30+"]);

export const ESTIMATORS = Object.freeze(["direct"]);

export const NOISE_VALUES = Object.freeze({ True: true, False: false });

/** The cells a withheld row leaves blank, and every other row fills. */
export const FIGURE_COLUMNS = Object.freeze([
  "value",
  "lo",
  "hi",
  "direction",
  "support_band",
]);

/** The columns the page's CSV and TXT exports carry, in this order. */
export const EXPORT_COLUMNS = Object.freeze([
  "area_code",
  "area_name",
  "reform",
  "year",
  "outcome",
  "value",
  "lo",
  "hi",
  "direction",
  "tier",
  "reason",
  "support_band",
]);
