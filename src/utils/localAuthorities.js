/**
 * The UK's 361 local authorities (ONS LAD 2024: England's 296 lower-tier
 * and unitary authorities, Wales 22, Scotland 32, Northern Ireland 11) and
 * the region each lies in, for the Household calculator form's local
 * authority picker.
 *
 * The household API takes a region: the picked council sets the region the
 * form sends, and nothing else, so a request is the same whichever council
 * in a region is picked. Council Tax stays estimated from the region's
 * average Band D. The table is localAuthorities.json, from ONS lookups (its
 * "source"); each entry is a name and policyengine-uk's LocalAuthority key.
 * It carries no ONS codes, so it stays clear of the area-code guard in
 * scripts/check_public_data.py.
 */
import table from "./localAuthorities.json";

/** Every local authority, by name: { name, key, region }. */
export const LOCAL_AUTHORITIES = Object.entries(table.regions)
  .flatMap(([region, entries]) => entries.map(([name, key]) => ({ name, key, region })))
  .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

const BY_NAME = new Map(LOCAL_AUTHORITIES.map((council) => [council.name, council]));

/** A local authority's region (the API's enum), or null for an unknown name. */
export const localAuthorityRegion = (name) => BY_NAME.get(name)?.region ?? null;

/** Lower case without accents or punctuation, so "rhondda cynon taf" finds "Rhondda Cynon Taf". */
export const foldText = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[,.']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const FOLDED = LOCAL_AUTHORITIES.map((council) => ({ council, folded: foldText(council.name) }));

/**
 * The local authorities whose names hold the query, those that start with
 * it (or have a word that does) first, each group in name order. An empty
 * query matches every one.
 */
export function searchLocalAuthorities(query) {
  const q = foldText(query ?? "");
  if (!q) return LOCAL_AUTHORITIES;
  const starts = [];
  const words = [];
  const inside = [];
  for (const { council, folded } of FOLDED) {
    const at = folded.indexOf(q);
    if (at === 0) starts.push(council);
    else if (at > 0 && /[\s(-]/.test(folded[at - 1])) words.push(council);
    else if (at > 0) inside.push(council);
  }
  return [...starts, ...words, ...inside];
}

/** The local authority a typed name is, ignoring case and accents; null if none. */
export function exactLocalAuthority(query) {
  const q = foldText(query ?? "");
  return FOLDED.find(({ folded }) => folded === q)?.council ?? null;
}
