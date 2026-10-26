/**
 * The age groups the By age sub-tab can focus on (?sub=age&age=<key>): the
 * published age bands, pensioners (everyone at or over State Pension age,
 * aggregated from single years of age) and all ages. "65 and over" and
 * "Pensioners" are different groups: 65 and over is a band; pensioners are
 * 66 and over in 2026-27 and 67 and over from 2027-28.
 */
import { AGE_BANDS, ALL_BAND, SINGLE_AGE_TOP, YOUNG_BAND } from "./ageImpact";
import { pensionerAge, pensionerMeasureSeries } from "../components/pensioners/pensionersData";
import { groupMeasureSeries } from "../components/youngPeople/youngPeopleData";

export const PENSIONERS = "pensioners";
export const DEFAULT_AGE_GROUP = YOUNG_BAND;

/** Every group a reader can choose, in order. */
export const AGE_GROUP_OPTIONS = [
  ...AGE_BANDS.map((band) => ({ key: band.key, label: band.label, short: band.short })),
  { key: PENSIONERS, label: "Pensioners (State Pension age)", short: "Pensioners" },
  { key: ALL_BAND, label: "All ages", short: "All" },
];

const KEYS = new Set(AGE_GROUP_OPTIONS.map((group) => group.key));

/** The group named in an address's ?age=, or the default. */
export function ageGroupFrom(value) {
  return KEYS.has(value) ? value : DEFAULT_AGE_GROUP;
}

/** The group's name on a chart or chip: "16 to 24", "Pensioners", "All ages". */
export function groupLabel(key) {
  if (key === PENSIONERS) return "Pensioners";
  return AGE_GROUP_OPTIONS.find((group) => group.key === key)?.label ?? key;
}

/** Who the group is, as a sentence's subject: "16 to 24-year-olds", "Pensioners". */
export function groupSubject(key) {
  switch (key) {
    case "0-15":
      return "Under-16s";
    case "65+":
      return "People aged 65 and over";
    case PENSIONERS:
      return "Pensioners";
    case ALL_BAND:
      return "People of all ages";
    default:
      return `${groupLabel(key)}-year-olds`;
  }
}

/** The group's single years of age in fiscal year `year`: [first, last] (the last is 90 and over). */
export function groupAges(key, year) {
  if (key === PENSIONERS) return [pensionerAge(year), SINGLE_AGE_TOP];
  if (key === ALL_BAND) return [0, SINGLE_AGE_TOP];
  if (key === "65+") return [65, SINGLE_AGE_TOP];
  const [first, last] = key.split("-").map(Number);
  return [first, last];
}

/**
 * The single-year-of-age chart's window for a group: its ages and ten
 * years either side (55 to 90 and over for pensioners and 65 and over; every
 * age for all ages), within 0 to 90 and over.
 */
export function ageWindow(key, year) {
  if (key === ALL_BAND) return [0, SINGLE_AGE_TOP];
  if (key === PENSIONERS || key === "65+") return [55, SINGLE_AGE_TOP];
  const [first, last] = groupAges(key, year);
  return [Math.max(0, first - 10), Math.min(SINGLE_AGE_TOP, last + 10)];
}

/** The group's change in every year with each measure's part (groupMeasureSeries' shape). */
export function groupSeries(rows, policies, selected, years, key) {
  return key === PENSIONERS
    ? pensionerMeasureSeries(rows, policies, selected, years)
    : groupMeasureSeries(rows, policies, selected, years, key);
}
