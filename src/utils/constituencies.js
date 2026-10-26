/**
 * The 650 Westminster constituencies (July 2024 boundaries) and the region
 * each lies in, for the Household impact form's constituency picker.
 *
 * The household API takes a region, not a constituency: the picked seat
 * sets the region the form sends, and nothing else, so a request is the same
 * whichever seat in a region is picked. The table is constituencies.json,
 * written by scripts/build_constituency_regions.py from ONS lookups
 * (data_inputs/constituency_regions/README.md); it carries names only.
 */
import table from "./constituencies.json";

/** Every constituency, by name: { name, region }. */
export const CONSTITUENCIES = Object.entries(table.regions)
  .flatMap(([region, names]) => names.map((name) => ({ name, region })))
  .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

const BY_NAME = new Map(CONSTITUENCIES.map((seat) => [seat.name, seat]));

/** A constituency's region (the API's enum), or null for an unknown name. */
export const constituencyRegion = (name) => BY_NAME.get(name)?.region ?? null;

/** Lower case without accents, so "glyndwr" finds "Glyndŵr". */
export const foldText = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const FOLDED = CONSTITUENCIES.map((seat) => ({ seat, folded: foldText(seat.name) }));

/**
 * The constituencies whose names hold the query, those that start with it
 * (or have a word that does) first, each group in name order. An empty
 * query matches every constituency.
 */
export function searchConstituencies(query) {
  const q = foldText(query ?? "");
  if (!q) return CONSTITUENCIES;
  const starts = [];
  const words = [];
  const inside = [];
  for (const { seat, folded } of FOLDED) {
    const at = folded.indexOf(q);
    if (at === 0) starts.push(seat);
    else if (at > 0 && /[\s(-]/.test(folded[at - 1])) words.push(seat);
    else if (at > 0) inside.push(seat);
  }
  return [...starts, ...words, ...inside];
}

/** The constituency a typed name is, ignoring case and accents; null if none. */
export function exactConstituency(query) {
  const q = foldText(query ?? "");
  return FOLDED.find(({ folded }) => folded === q)?.seat ?? null;
}
