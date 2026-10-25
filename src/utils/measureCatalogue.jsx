import { createContext, useContext } from "react";
import { FULL_COMMIT } from "./publication/definitions";
import { isDisplayable, measureAvailability } from "./publication/manifest";
import { combinedEntryFor, isSupported } from "./publication/select";

export const COST_COLORS = ["#115E59", "#2DD4BF", "#0F766E", "#5EEAD4", "#0D9488", "#99F6E4", "#14B8A6"];
export const REVENUE_COLORS = ["#78350F", "#B45309", "#F59E0B"];
export const NEUTRAL_COLOR = "#9CA3AF";

// A colour depends only on the published id and budgetary direction. Adding
// or reordering measures cannot change an existing measure's colour.
export function measureColor(id, direction) {
  const palette = direction === "cost" ? COST_COLORS : direction === "revenue" ? REVENUE_COLORS : null;
  if (!palette) return NEUTRAL_COLOR;
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return palette[hash % palette.length];
}

const finite = (value) => value !== "" && value != null && Number.isFinite(Number(value));
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Apply the same publication and year gate to every independently loaded table. */
export function isCatalogueRowDisplayable(catalogue, id, year) {
  // Only a key whose artifact verified against this manifest snapshot can
  // supply a figure: a catalogue built without verified tables authorises none.
  if (!catalogue.manifest || !catalogue.tablesByKey || !Object.hasOwn(catalogue.tablesByKey, id)) return false;
  if (id !== catalogue.combinedId && !catalogue.byId.get(id)?.displayable) return false;
  const entry = catalogue.manifest.measures[id] ?? catalogue.manifest.combined[id];
  if (!isDisplayable(entry) || !isSupported(entry, Number(year))) return false;
  if (id === catalogue.combinedId) return entry.measures.every((member) => isSupported(catalogue.manifest.measures[member], Number(year)));
  return true;
}

/**
 * The one set of package versions the selected measures' verified receipts
 * record, or null when one has none recorded, is not verified, or they
 * disagree. Personal impact asks the household API live, and compares its
 * versions with these.
 */
export function publishedEngine(catalogue, ids) {
  let engine = null;
  for (const id of ids) {
    const recorded = catalogue?.tablesByKey && Object.hasOwn(catalogue.tablesByKey, id) ? catalogue.tablesByKey[id]?.engine : null;
    if (!recorded || !Object.keys(recorded).length) return null;
    const key = JSON.stringify(Object.entries(recorded).sort(([a], [b]) => (a < b ? -1 : 1)));
    if (engine !== null && engine.key !== key) return null;
    engine = { key, value: recorded };
  }
  return engine?.value ?? null;
}

/**
 * The definition each selected measure's verified receipt approved (its
 * commit and reform identities), for the household API to recompute and
 * report. A measure with none, or whose receipt names no full commit (the
 * only kind the API takes), is in `missing` with the reason: Household
 * impact is then unavailable for it, never answered unchecked.
 *
 * @returns {{definitions: Object<string, Object>, missing: Array<{id: string, reason: string}>}}
 */
export function publishedDefinitions(catalogue, ids) {
  // Collected as entries: an id such as `__proto__` stays an own key
  const found = [];
  const missing = [];
  for (const id of ids) {
    const tables = catalogue?.tablesByKey && Object.hasOwn(catalogue.tablesByKey, id) ? catalogue.tablesByKey[id] : null;
    const definition = tables?.definition;
    if (!definition) missing.push({ id, reason: "its published figures record no definition to check the calculator against" });
    else if (typeof definition.git_sha !== "string" || !FULL_COMMIT.test(definition.git_sha)) missing.push({ id, reason: "its published receipt names no full commit to check the calculator at" });
    else found.push([id, definition]);
  }
  return { definitions: Object.fromEntries(found), missing };
}

/** Only an explicit publication manifest supplies catalogue membership. */
export function buildMeasureCatalogue({ manifest = null, receipts = {}, budgetary = [], distributional = [], winnersLosers = [], metrics = [], tablesByKey = null, failures = {} } = {}) {
  const rows = [...budgetary, ...distributional, ...winnersLosers, ...metrics];
  const ids = manifest ? Object.keys(manifest.measures) : [];
  const measures = ids.sort(compareIds).map((id, order) => {
    const entry = manifest?.measures[id];
    const receipt = receipts[id]?.dashboard ?? receipts[id];
    const ownRows = rows.filter((row) => row.reform_id === id);
    const budgetRows = budgetary.filter((row) => row.reform_id === id && finite(row.value) && (!entry || (isDisplayable(entry) && isSupported(entry, Number(row.year))))).sort((a, b) => Number(a.year) - Number(b.year) || Number(a.value) - Number(b.value));
    const impact = budgetRows.length ? budgetRows.reduce((sum, row) => sum + Number(row.value), 0) : null;
    const direction = impact === null || impact === 0 ? "neutral" : impact < 0 ? "cost" : "revenue";
    const name = entry?.name || receipt?.name || ownRows.find((row) => row.reform_name)?.reform_name || id;
    const description = entry?.description || receipt?.description || ownRows.find((row) => row.reform_description)?.reform_description || "A public description has not yet been published.";
    const availability = measureAvailability(manifest, id);
    const verified = tablesByKey != null && Object.hasOwn(tablesByKey, id) && !failures[id];
    if (!verified && isDisplayable(entry)) {
      availability.available = false;
      availability.reason = `Results unavailable: ${failures[id] || "no verified artifact"}`;
    }
    return { id, seriesKey: `measure:${id}`, name, label: name, description, explanation: description, direction, order, color: measureColor(id, direction), displayable: isDisplayable(entry) && verified, availability, years: [...(entry?.years ?? [])], unsupported_years: [...(entry?.unsupported_years ?? [])], personal: entry?.personal ?? receipt?.personal };
  });
  const labelCounts = new Map();
  for (const measure of measures) labelCounts.set(measure.name, (labelCounts.get(measure.name) ?? 0) + 1);
  for (const measure of measures) {
    if (labelCounts.get(measure.name) > 1) measure.name = measure.label = `${measure.name} (${measure.id})`;
  }
  // Revenue first, then cost, then measures without a published costing.
  const rank = { revenue: 0, cost: 1, neutral: 2 };
  measures.sort((a, b) => rank[a.direction] - rank[b.direction] || compareIds(a.id, b.id));
  measures.forEach((measure, index) => { measure.order = index; });
  const displayable = measures.filter((measure) => measure.displayable);
  // The package combined run is the one of exactly the displayable measures
  const combined = manifest ? combinedEntryFor(manifest, displayable.map((measure) => measure.id)) : null;
  const combinedIds = combined && !combined.single ? [combined.key] : [];
  return {
    measures, displayable, manifest, tablesByKey, failures,
    byId: new Map(measures.map((measure) => [measure.id, measure])),
    bySeriesKey: new Map(measures.map((measure) => [measure.seriesKey, measure])),
    policyColors: Object.fromEntries(displayable.map((measure) => [measure.seriesKey, measure.color])),
    allPolicyNames: displayable.map((measure) => measure.seriesKey),
    revenueRaisingNames: new Set(displayable.filter((measure) => measure.direction === "revenue").map((measure) => measure.seriesKey)),
    combinedId: combinedIds.length === 1 ? combinedIds[0] : null,
  };
}

const CatalogueContext = createContext(buildMeasureCatalogue());
export function MeasureCatalogueProvider({ catalogue, value, children }) {
  return <CatalogueContext.Provider value={catalogue ?? value}>{children}</CatalogueContext.Provider>;
}
export const useMeasureCatalogue = () => useContext(CatalogueContext);
