/**
 * The UK's 361 local authorities (ONS LAD 2024: England's 296 lower-tier
 * and unitary authorities, Wales 22, Scotland 32, Northern Ireland 11) and
 * the region each lies in, for the Household calculator form's local
 * authority picker.
 *
 * The picked council sets the region the form sends, and the household
 * request carries its policyengine-uk key as `local_authority`, from which
 * the API estimates Council Tax with that council's own Band D. Nothing is
 * sent until a council is picked, so the examples' requests (and their
 * precomputed answers) are as they were. The table is localAuthorities.json,
 * from ONS lookups (its
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

/** A local authority's policyengine-uk LocalAuthority key ("GLASGOW_CITY"), or null for an unknown name. */
export const localAuthorityKey = (name) => BY_NAME.get(name)?.key ?? null;

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
