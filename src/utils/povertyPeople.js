// People behind a change in a poverty rate: the change in percentage points
// times the population it is a share of. The populations are the outlook's
// own (public/data/living_standards_outlook.json, current law, by fiscal
// year): all people from the deep-poverty block (people_millions / rate),
// children from child_poverty_by_family.children_millions. A year the
// outlook does not cover gives no number, never an estimate.

const fyStart = (fy) => Number(String(fy).slice(0, 4));

/**
 * The outlook's populations, in millions, as population(year, group):
 * group "all" or "children", year a fiscal year's start (2027); null where
 * the outlook has none.
 */
export function outlookPopulation(outlook) {
  const all = new Map();
  for (const row of outlook?.deep_poverty?.projection?.below_40pc_median_ahc ?? []) {
    if (row.rate > 0 && row.people_millions > 0) all.set(fyStart(row.year), row.people_millions / row.rate);
  }
  const children = new Map();
  for (const row of outlook?.child_poverty_by_family?.children_millions?.all ?? []) {
    if (row.value > 0) children.set(fyStart(row.year), row.value);
  }
  if (!all.size && !children.size) return null;
  return (year, group) => (group === "children" ? children : all).get(year) ?? null;
}

const thousands = new Intl.NumberFormat("en-GB");

/**
 * A count of people as every poverty card writes it, so a label and the
 * bar it sits on agree: two significant figures under 10,000 (to the
 * nearest 100: 1,430 → "1,400"), the nearest 1,000 above (44,000).
 * Callers write "under 1,000" below 1,000.
 */
export function roundPeople(people) {
  const n = Math.abs(people);
  const step = n < 10000 ? 100 : 1000;
  return thousands.format(Math.round(n / step) * step);
}

/**
 * "about 5,300 fewer people in poverty" for a change of `pp` percentage
 * points in a population of `millions`; "under 1,000 more children in
 * poverty" for a small one; null with no population or no change.
 */
export function peopleInPovertyText(pp, millions, group = "all") {
  if (!millions || !pp) return null;
  const people = Math.abs((pp / 100) * millions * 1e6);
  const who = group === "children" ? "children" : "people";
  const way = pp < 0 ? "fewer" : "more";
  if (people < 1000) return `under 1,000 ${way} ${who} in poverty`;
  return `about ${roundPeople(people)} ${way} ${who} in poverty`;
}

/**
 * A change in percentage points, signed, as every poverty card writes it:
 * three decimals under 0.1pp (the measures' changes are thousandths of a
 * point), two above. "−0.008pp", "+0.12pp", "0.000pp".
 */
export function formatPp(value) {
  const size = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${size.toFixed(size < 0.1 ? 3 : 2)}pp`;
}

/** "≈5,000 fewer people", "<1,000 more children"; null as peopleInPovertyText. */
export function peopleShort(pp, millions, group = "all", { who = true } = {}) {
  if (!millions || !pp) return null;
  const people = Math.abs((pp / 100) * millions * 1e6);
  const noun = who ? ` ${group === "children" ? "children" : "people"}` : "";
  const way = pp < 0 ? "fewer" : "more";
  if (people < 1000) return `<1,000 ${way}${noun}`;
  return `≈${roundPeople(people)} ${way}${noun}`;
}
