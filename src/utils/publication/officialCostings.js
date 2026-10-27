import { assertCurrentRelease } from "./release";

// Written by `python -m uk_budget_data.publication.official_costings` from
// the Treasury figures the reconciliation gate compares (data_inputs/treasury)
export const OFFICIAL_COSTINGS_FILE = "official_costings.json";
export const OFFICIAL_COSTINGS_SCHEMA = "uk-budget-official-costings/v1";
const BASES = ["static_costing", "post_behavioural"];

/** The costings file is not published yet: the comparison follows the Budget. */
export class OfficialCostingsPendingError extends Error {
  constructor() {
    super("The official costings are not published yet");
    this.name = "OfficialCostingsPendingError";
  }
}

const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Check an official costings document against the manifest the page loaded
 * and return its rows: { reform_id, year, obr_static, obr_behavioural }.
 *
 * The document must name the manifest's release and Budget, which must be
 * this Budget, and only the manifest's measures; every figure is a finite
 * number or null. Anything else throws, so a file from another Budget (the
 * reason obr_comparison.csv is never read) cannot pair with these results.
 * It carries no PolicyEngine figure: those come from the verified artifacts.
 */
export function officialCostingRows(document, manifest) {
  assertCurrentRelease(manifest);
  if (!isMap(document) || document.schema !== OFFICIAL_COSTINGS_SCHEMA) {
    throw new Error("The official costings file has the wrong schema");
  }
  if (document.release !== manifest.release || document.budget?.id !== manifest.budget.id || document.budget?.date !== manifest.budget.date) {
    throw new Error("The official costings are not for this Budget");
  }
  if (document.sign_convention !== "exchequer_positive" || !isMap(document.measures)) {
    throw new Error("The official costings file is malformed");
  }
  const rows = [];
  for (const [key, measure] of Object.entries(document.measures)) {
    if (!Object.hasOwn(manifest.measures ?? {}, key)) {
      throw new Error(`The official costings name ${key}, which is not a published measure`);
    }
    if (!isMap(measure?.years)) throw new Error(`The official costings for ${key} are malformed`);
    for (const [year, figures] of Object.entries(measure.years)) {
      if (!/^[1-9][0-9]{3}$/.test(year) || !isMap(figures)) {
        throw new Error(`The official costings for ${key} in ${year} are malformed`);
      }
      const [staticValue, behavioural] = BASES.map((basis) => {
        const value = figures[basis];
        if (value === null || value === undefined) return null;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`The official ${basis} costing for ${key} in ${year} is not a number`);
        }
        return value;
      });
      rows.push({ reform_id: key, year: Number(year), obr_static: staticValue, obr_behavioural: behavioural });
    }
  }
  return rows;
}

/**
 * Fetch and check the official costings for the loaded manifest. Throws
 * OfficialCostingsPendingError while the file is not published (404).
 */
export async function loadOfficialCostings(catalogue, { basePath = process.env.NEXT_PUBLIC_BASE_PATH || "", fetchImpl = fetch, signal } = {}) {
  const manifest = catalogue?.manifest;
  if (!manifest) throw new Error("No Budget results are published yet");
  const response = await fetchImpl(`${basePath}/data/${OFFICIAL_COSTINGS_FILE}`, { signal, cache: "no-cache" });
  if (response.status === 404) throw new OfficialCostingsPendingError();
  if (!response.ok) throw new Error("The official costings are unavailable");
  return officialCostingRows(await response.json(), manifest);
}
