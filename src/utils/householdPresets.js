/**
 * The example households' results, precomputed so choosing one shows it at
 * once. public/data/household_presets.json holds the household API's
 * answer for each example over the form's defaults, with every measure
 * selected, for each year a reader can choose;
 * scripts/precompute_household_presets.py writes it from the requests built
 * here (scripts/household-preset-requests.mjs), so the keys match the page's
 * own requests byte for byte. Any other request (an edited answer, another set
 * of measures) goes to the live API.
 */
import { takeEarlyResponse } from "./publication/early";
import { SELECTABLE_YEARS } from "./displayYears";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { WIZARD_DEFAULTS } from "./householdDefaults";
import {
  buildHouseholdRequest,
  definitionRefusals,
  engineDifferences,
  normaliseHouseholdImpact,
  requestKey,
} from "./householdImpactApi";

export const PRESETS_FILE = "household_presets.json";

/*
 * #185 on #104: the page keeps no list of measures, so the measures an
 * answer covers are the file's own (`policies`, as it was written), and an
 * answer is used only for a request with exactly those measures selected,
 * in the page's order, under a publication whose receipts record the
 * file's engine and approved each measure's definition the file records
 * (#136); any other request goes to the live API.
 */
const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

/** An example's answers, as choosing it fills the form. */
export const presetInputs = (preset) => ({ ...WIZARD_DEFAULTS, ...preset.inputs });

/** Every example's request for each choosable year, with every part, for
 * the measures `policies` (scripts/household-preset-requests.mjs passes the
 * published ones). */
export function presetRequests(policies) {
  return HOUSEHOLD_EXAMPLES.flatMap((preset) =>
    SELECTABLE_YEARS.map((year) => ({
      preset_id: preset.id,
      year,
      request: buildHouseholdRequest(presetInputs(preset), {
        year,
        policies,
        include: ["by_policy", "sweep"],
      }),
    })),
  );
}

/**
 * The file's entries that still answer today's examples, each with its
 * request key rebuilt from the example and form, not read from the file.
 */
function currentEntries(file, policies = file?.policies ?? []) {
  if (!file || !Array.isArray(file.entries) || !Array.isArray(file.policies)) return [];
  if (!sameSet(file.policies, policies)) return [];
  const byId = new Map(HOUSEHOLD_EXAMPLES.map((preset) => [preset.id, preset]));
  return file.entries.flatMap((entry) => {
    const preset = byId.get(entry.preset_id);
    if (!preset || !entry.response) return [];
    const asked = buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies: file.policies });
    if (requestKey(asked) !== requestKey(entry.request)) return [];
    // Keyed as the page asks: its own order of the same measures
    const key = requestKey(buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies }));
    return [{ key, entry }];
  });
}

/**
 * Whether the file's engine is the published one. Never when no engine is
 * known: the file's answers would then be shown unchecked (#104).
 */
const engineMatches = (file, expectedEngine) =>
  Boolean(expectedEngine) &&
  Object.keys(expectedEngine).length > 0 &&
  engineDifferences(expectedEngine, file?.engine).length === 0;

/**
 * Whether the file reports, for every one of its measures, the definition
 * that measure's receipt approved (`expectedDefinitions`, by id, as
 * publishedDefinitions gives them): the household API's check (#136), made
 * of the file's `definitions`, which scripts/precompute_household_presets.py
 * records at each receipt's commit from the code that computed the answers.
 * Never when none are expected, and never for a file that records none (one
 * written before them): its answers would then be shown unchecked.
 */
const definitionsMatch = (file, expectedDefinitions) =>
  Boolean(expectedDefinitions) &&
  Array.isArray(file?.policies) &&
  file.policies.length > 0 &&
  definitionRefusals(expectedDefinitions, file.definitions ?? null, file.policies).length === 0;

/** Whether the file's answers can stand for the live API's: both checks. */
const fileMatches = (file, { expectedEngine = null, expectedDefinitions = null } = {}) =>
  engineMatches(file, expectedEngine) && definitionsMatch(file, expectedDefinitions);

/**
 * One answer's definitions: the file's record, under any the answer itself
 * reports. The precompute records them once, at the top; each answer keeps
 * what the API reported beside it, which is nothing (`{}`) for a request
 * that names no commits, as the precompute's don't. A definition an answer
 * does report stands, and is checked as the file's are.
 */
function entryDefinitions(file, entry) {
  const own = entry.response.definitions;
  return { ...file.definitions, ...(own && typeof own === "object" && !Array.isArray(own) ? own : {}) };
}

/** Whether one answer, as well as the file, reports each measure's approved definition. */
const entryMatches = (file, entry, expectedDefinitions) =>
  definitionRefusals(expectedDefinitions, entryDefinitions(file, entry), file.policies).length === 0;

/**
 * Each example's change in net income by year, with every measure, and
 * each measure's own part (that measure alone, as the breakdown shows it;
 * with interactions the parts need not add up to the change), from the file, for the cards' figures:
 * { [presetId]: { [year]: { change, byPolicy: { [measureId]: change } } } }.
 * An entry that no longer matches its example is left out, as above, or
 * that reports a definition of its own other than the approved one, and
 * the whole file unless its engine is `expectedEngine` and it reports each
 * measure's `expectedDefinitions`.
 */
export function presetChanges(file, { policies, expectedEngine = null, expectedDefinitions = null } = {}) {
  const changes = {};
  if (!fileMatches(file, { expectedEngine, expectedDefinitions })) return changes;
  for (const { entry } of currentEntries(file, policies)) {
    if (!entryMatches(file, entry, expectedDefinitions)) continue;
    const change = Number(entry.response.net_income?.change);
    if (!Number.isFinite(change)) continue;
    const byPolicy = Object.fromEntries(
      (entry.response.by_policy?.measures ?? [])
        .filter((measure) => Number.isFinite(Number(measure.change)))
        .map((measure) => [measure.id, Number(measure.change)]),
    );
    // Net income before and after too, for where the household sits
    const before = Number(entry.response.net_income?.baseline);
    const after = Number(entry.response.net_income?.reform);
    (changes[entry.preset_id] ??= {})[entry.year] = {
      change,
      byPolicy,
      before: Number.isFinite(before) ? before : null,
      after: Number.isFinite(after) ? after : null,
    };
  }
  return changes;
}

/**
 * The file's answers as [requestKey, page-shaped result] pairs. Each key is
 * rebuilt from today's example and form, not read from the file: if either
 * has changed since the file was written, its entry no longer matches any
 * request and the live API answers instead. None unless the file's engine
 * is `expectedEngine` (the receipts' for every published measure) and it
 * reports each measure's `expectedDefinitions`.
 */
export function presetCacheEntries(
  file,
  { policies, expectedEngine = null, expectedDefinitions = null, publicationKey = "" } = {},
) {
  if (!fileMatches(file, { expectedEngine, expectedDefinitions })) return [];
  return currentEntries(file, policies).flatMap(({ key, entry }) => {
    if (!entryMatches(file, entry, expectedDefinitions)) return [];
    // The file keeps the engine and the definitions once, at its top; each
    // answer gets them back, so the breakdown's "Versions" line shows as for
    // a live answer, and useHouseholdImpact checks its definitions as it
    // checks a live answer's
    const data = normaliseHouseholdImpact({
      ...entry.response,
      engine: entry.response.engine ?? file.engine,
      definitions: entryDefinitions(file, entry),
    });
    if (data.byPolicy === null || data.sweep === null) return [];
    // useHouseholdImpact's key: the publication snapshot, then the request
    return [[`${publicationKey}:${key}`, data]];
  });
}

// One load per session, shared by every mount of the view
let loading = null;

/** The file, fetched once; null when it is missing or unreadable. */
function loadPresetFile(fetchImpl) {
  if (!loading) {
    const url = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/${PRESETS_FILE}`;
    // The head script may have requested it already (publication/early.js)
    const early = fetchImpl === globalThis.fetch ? takeEarlyResponse(url) : null;
    loading = Promise.resolve()
      .then(() => (early ? early.catch(() => fetchImpl(url)) : fetchImpl(url)))
      .then((response) => (response?.ok ? response.json() : null))
      .catch(() => null);
  }
  return loading;
}

/**
 * The precomputed answers, fetched once: [key, result] pairs
 * (presetCacheEntries, with `options`), or none when the file is missing,
 * unreadable, for other measures or another engine, or without the
 * approved definitions (the live API answers then).
 */
export function loadPresetResults(options = {}, fetchImpl = globalThis.fetch) {
  return loadPresetFile(fetchImpl)
    .then((file) => presetCacheEntries(file, options))
    .catch(() => []);
}

/** The examples' changes in net income (presetChanges), from the same load. */
export function loadPresetChanges(options = {}, fetchImpl = globalThis.fetch) {
  return loadPresetFile(fetchImpl)
    .then((file) => presetChanges(file, options))
    .catch(() => ({}));
}

/** Forget the loaded file (for tests). */
export function resetPresetResults() {
  loading = null;
}
