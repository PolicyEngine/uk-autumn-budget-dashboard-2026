import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

const ids = ["two_child_limit", "fuel_duty_freeze", "rail_fares_freeze"];
const digest = "a".repeat(64);
const manifest = {
  release: "uk-autumn-budget-2026", budget: { id: "uk-autumn-budget-2026", date: "2026-10-28" },
  revision: 1, snapshotSha256: digest,
  measures: Object.fromEntries(ids.map((id) => [id, {
    name: id, status: "approved", years: [2029, 2030], unsupported_years: [], outputs_sha256: digest,
  }])),
  combined: {
    autumn_budget_2026_combined: {
      name: "Synthetic area package", status: "approved", years: [2029, 2030], unsupported_years: [],
      measures: ids, member_outputs_sha256: Object.fromEntries(ids.map((id) => [id, digest])),
    },
  },
};

// These tests exercise geography parsing and presentation; byte verification is
// covered by the release-index integration tests, and mocked at its boundary.
export const geographyCatalogue = buildMeasureCatalogue({
  manifest,
  tablesByKey: Object.fromEntries([...ids, "autumn_budget_2026_combined"].map((id) => [id, {}])),
});
export function GeographyCatalogueProvider({ children }) {
  return <MeasureCatalogueProvider catalogue={geographyCatalogue}>{children}</MeasureCatalogueProvider>;
}
