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
 * "about 5,000 fewer people in poverty" for a change of `pp` percentage
 * points in a population of `millions`; "under 1,000 more children in
 * poverty" for a small one; null with no population or no change.
 */
export function peopleInPovertyText(pp, millions, group = "all") {
  if (!millions || !pp) return null;
  const people = Math.abs((pp / 100) * millions * 1e6);
  const who = group === "children" ? "children" : "people";
  const way = pp < 0 ? "fewer" : "more";
  if (people < 1000) return `under 1,000 ${way} ${who} in poverty`;
  return `about ${thousands.format(Math.round(people / 1000) * 1000)} ${way} ${who} in poverty`;
}
