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
import { POLICIES } from "./policies";
import { SELECTABLE_YEARS } from "./displayYears";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { WIZARD_DEFAULTS } from "./householdDefaults";
import { buildHouseholdRequest, normaliseHouseholdImpact, requestKey } from "./householdImpactApi";

export const PRESETS_FILE = "household_presets.json";

/** The measures the file covers: the page's default selection, all of them. */
export const PRESET_POLICIES = POLICIES.map((policy) => policy.id);

/** An example's answers, as choosing it fills the form. */
export const presetInputs = (preset) => ({ ...WIZARD_DEFAULTS, ...preset.inputs });

/** Every example's request for each choosable year, with every part. */
export function presetRequests() {
  return HOUSEHOLD_EXAMPLES.flatMap((preset) =>
    SELECTABLE_YEARS.map((year) => ({
      preset_id: preset.id,
      year,
      request: buildHouseholdRequest(presetInputs(preset), {
        year,
        policies: PRESET_POLICIES,
        include: ["by_policy", "sweep"],
      }),
    })),
  );
}

/**
 * The file's answers as [requestKey, page-shaped result] pairs. Each key is
 * rebuilt from today's example and form, not read from the file: if either
 * has changed since the file was written, its entry no longer matches any
 * request and the live API answers instead.
 */
export function presetCacheEntries(file) {
  if (!file || !Array.isArray(file.entries)) return [];
  const byId = new Map(HOUSEHOLD_EXAMPLES.map((preset) => [preset.id, preset]));
  return file.entries.flatMap((entry) => {
    const preset = byId.get(entry.preset_id);
    if (!preset || !entry.response) return [];
    const key = requestKey(
      buildHouseholdRequest(presetInputs(preset), { year: entry.year, policies: PRESET_POLICIES }),
    );
    if (key !== requestKey(entry.request)) return [];
    // The file keeps the engine once, at its top; each answer gets it back,
    // so the breakdown's "Versions" line shows as for a live answer
    const data = normaliseHouseholdImpact({ ...entry.response, engine: entry.response.engine ?? file.engine });
    if (data.byPolicy === null || data.sweep === null) return [];
    return [[key, data]];
  });
}

// One load per session, shared by every mount of the view
let loading = null;

/**
 * The precomputed answers, fetched once: [requestKey, result] pairs, or
 * none when the file is missing or unreadable (the live API answers then).
 */
export function loadPresetResults(fetchImpl = globalThis.fetch) {
  if (!loading) {
    const url = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/${PRESETS_FILE}`;
    loading = Promise.resolve()
      .then(() => fetchImpl(url))
      .then((response) => (response?.ok ? response.json() : null))
      .then(presetCacheEntries)
      .catch(() => []);
  }
  return loading;
}

/** Forget the loaded file (for tests). */
export function resetPresetResults() {
  loading = null;
}
