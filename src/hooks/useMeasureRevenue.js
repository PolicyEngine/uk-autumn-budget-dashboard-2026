import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";

/**
 * A measure's change in government revenue in a year, £bn (negative is a
 * cost), from its receipt-verified budgetary_impact table in the catalogue
 * (#104: the page reads no flat file for national figures); null when the
 * measure has no verified row for that year.
 */
export default function useMeasureRevenue(id, year) {
  const catalogue = useMeasureCatalogue();
  if (!isCatalogueRowDisplayable(catalogue, id, year)) return null;
  const row = (catalogue.tablesByKey?.[id]?.budgetary_impact ?? []).find(
    (entry) => entry.reform_id === id && Number(entry.year) === Number(year),
  );
  const value = row ? Number(row.value) : NaN;
  return Number.isFinite(value) ? value : null;
}
