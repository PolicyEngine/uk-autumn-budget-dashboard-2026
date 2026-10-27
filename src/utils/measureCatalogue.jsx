import { createContext, useContext } from "react";
import { isDisplayable, measureAvailability } from "./publication/manifest";
import { combinedEntryFor, isSupported } from "./publication/select";
import { MEASURE_RAMPS, measureRamp } from "./chartTheme";

// The ramps live with the other colour tokens (chartTheme.js, docs/COLOURS.md)
export const NEUTRAL_COLOR = MEASURE_RAMPS.neutral;

const finite = (value) => value !== "" && value != null && Number.isFinite(Number(value));
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Largest first: total absolute budgetary effect over the published years,
 * ties by id, so the rank depends only on the publication, never on the
 * order its rows arrive in or on which measures a reader selects.
 */
const bySize = (a, b) => b.size - a.size || compareIds(a.id, b.id);

/**
 * Each measure's colour: within its direction, the measures ranked by size
 * take measureRamp's steps in order, largest darkest. The catalogue is built
 * once from the publication's manifest snapshot, so a measure keeps its
 * colour on every chart, tab and selection of that publication; a new
 * measure in a later revision can re-shade the others in its direction.
 */
export function assignMeasureColors(measures) {
  for (const direction of ["revenue", "cost", "neutral"]) {
    const group = measures.filter((measure) => measure.direction === direction).sort(bySize);
    const colors = measureRamp(direction, group.length);
    group.forEach((measure, rank) => { measure.color = colors[rank]; measure.sizeRank = rank; });
  }
  return measures;
}

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
 * One table's rows from every artifact the catalogue verified when the page
 * loaded (`tablesByKey`, the receipt route), gated as every other table
 * is: [] without a published, verified catalogue.
 */
export function verifiedTableRows(catalogue, table) {
  if (!catalogue?.manifest || !catalogue.tablesByKey) return [];
  return Object.values(catalogue.tablesByKey)
    .flatMap((tables) => tables?.[table] ?? [])
    .filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year));
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
    const size = budgetRows.reduce((sum, row) => sum + Math.abs(Number(row.value)), 0);
    const direction = impact === null || impact === 0 ? "neutral" : impact < 0 ? "cost" : "revenue";
    const name = entry?.name || receipt?.name || ownRows.find((row) => row.reform_name)?.reform_name || id;
    const description = entry?.description || receipt?.description || ownRows.find((row) => row.reform_description)?.reform_description || "A public description has not yet been published.";
    const availability = measureAvailability(manifest, id);
    const verified = tablesByKey != null && Object.hasOwn(tablesByKey, id) && !failures[id];
    if (!verified && isDisplayable(entry)) {
      availability.available = false;
      availability.reason = `Results unavailable: ${failures[id] || "no verified artifact"}`;
    }
    return { id, seriesKey: `measure:${id}`, name, label: name, description, explanation: description, direction, order, size, color: NEUTRAL_COLOR, displayable: isDisplayable(entry) && verified, availability, years: [...(entry?.years ?? [])], unsupported_years: [...(entry?.unsupported_years ?? [])], personal: entry?.personal ?? receipt?.personal };
  });
  const labelCounts = new Map();
  for (const measure of measures) labelCounts.set(measure.name, (labelCounts.get(measure.name) ?? 0) + 1);
  for (const measure of measures) {
    if (labelCounts.get(measure.name) > 1) measure.name = measure.label = `${measure.name} (${measure.id})`;
  }
  assignMeasureColors(measures);
  // Revenue first, then cost, then measures without a published costing;
  // each group largest first, the order of its colours (cards, keys,
  // legends, tooltips and the revenue chart's stack all take this order).
  const rank = { revenue: 0, cost: 1, neutral: 2 };
  measures.sort((a, b) => rank[a.direction] - rank[b.direction] || bySize(a, b));
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
