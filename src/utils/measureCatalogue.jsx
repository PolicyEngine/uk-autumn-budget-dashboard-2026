import { createContext, useContext } from "react";
import { isDisplayable, measureAvailability } from "./publication/manifest";
import { combinedEntryFor, isSupported } from "./publication/select";

export const COST_COLORS = ["#0D9488", "#14B8A6", "#2DD4BF", "#5EEAD4", "#047857", "#059669"];
export const REVENUE_COLORS = ["#78350F", "#92400E", "#B45309", "#D97706", "#F59E0B", "#FBBF24"];
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

export const isCombinedId = (id) => typeof id === "string" && id.endsWith("_combined");
const finite = (value) => value !== "" && value != null && Number.isFinite(Number(value));
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Apply the same publication and year gate to every independently loaded table. */
export function isCatalogueRowDisplayable(catalogue, id, year) {
  if (!catalogue.manifest) return false;
  if (catalogue.tablesByKey !== null && !Object.hasOwn(catalogue.tablesByKey, id)) return false;
  if (id !== catalogue.combinedId && !catalogue.byId.get(id)?.displayable) return false;
  const entry = catalogue.manifest.measures[id] ?? catalogue.manifest.combined[id];
  if (!isDisplayable(entry) || !isSupported(entry, Number(year))) return false;
  if (id === catalogue.combinedId) return entry.measures.every((member) => isSupported(catalogue.manifest.measures[member], Number(year)));
  return true;
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
    if (failures[id]) { availability.available = false; availability.reason = `Results unavailable: ${failures[id]}`; }
    return { id, seriesKey: `measure:${id}`, name, label: name, description, explanation: description, direction, order, color: measureColor(id, direction), displayable: isDisplayable(entry), availability, years: [...(entry?.years ?? [])], unsupported_years: [...(entry?.unsupported_years ?? [])], personal: entry?.personal ?? receipt?.personal };
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
  const combined = manifest ? combinedEntryFor(manifest, measures.map((measure) => measure.id)) : null;
  const combinedIds = combined && !combined.single ? [combined.key] : [];
  return {
    measures, displayable, manifest, tablesByKey, failures,
    byId: new Map(measures.map((measure) => [measure.id, measure])),
    byName: new Map(measures.map((measure) => [measure.name, measure])),
    bySeriesKey: new Map(measures.map((measure) => [measure.seriesKey, measure])),
    policyColors: Object.fromEntries(displayable.map((measure) => [measure.seriesKey, measure.color])),
    policyColorsByKey: Object.fromEntries(displayable.map((measure) => [measure.id, measure.color])),
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
