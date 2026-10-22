/**
 * The demographic groups results are published for, from the list the
 * pipeline writes them with (src/uk_budget_data/demographic_groups.json):
 * each level's groups in display order, with their published names.
 */

import groups from "../../uk_budget_data/demographic_groups.json";

export const AGE_GROUP = "age_group";
export const AGE_BAND = "age_band";
export const YOUNG_PEOPLE = "young_people";
export const EMPLOYMENT = "employment";

/** The levels, in the order the page offers them. */
export const DEMOGRAPHIC_LEVELS = Object.freeze(Object.keys(groups));

/** Each level's groups: `[{code, name}]`, in display order. */
export const GROUPS = Object.freeze(
  Object.fromEntries(
    Object.entries(groups).map(([level, entries]) => [
      level,
      Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
    ]),
  ),
);

/** What the page calls each way of grouping people. */
export const LEVEL_LABELS = Object.freeze({
  [AGE_GROUP]: "Age groups",
  [AGE_BAND]: "Age bands",
  [YOUNG_PEOPLE]: "18 to 24-year-olds",
  [EMPLOYMENT]: "Employment status",
});

export const isDemographicLevel = (level) =>
  Object.hasOwn(GROUPS, level);

/** A group's published name, or null when `code` is not one of the level's groups. */
export function groupName(level, code) {
  if (!isDemographicLevel(level)) return null;
  return GROUPS[level].find((group) => group.code === code)?.name ?? null;
}
