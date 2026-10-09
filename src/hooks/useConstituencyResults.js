import { useEffect, useMemo, useState } from "react";
import {
  aggregateConstituencies,
  buildRegionLookup,
  getConstituencyAvailability,
  loadConstituencyData,
} from "../utils/constituencyData";

/**
 * Constituency results for a selection, shared by the map and the rankings.
 * Both components call this hook, so they always agree on availability and
 * on every constituency's value. `aggregated` is empty unless `available`.
 */
export function useConstituencyResults(selectedPolicies, selectedYear) {
  const [data, setData] = useState({ loading: true, rows: [], geoData: null });

  useEffect(() => {
    let cancelled = false;
    loadConstituencyData().then(
      ({ rows, geoData }) => {
        if (!cancelled) setData({ loading: false, rows, geoData });
      },
      (error) => {
        console.error("Error loading constituency data:", error);
        if (!cancelled) setData({ loading: false, rows: [], geoData: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const { loading, rows, geoData } = data;

  const constituencyCodes = useMemo(
    () => (geoData?.features ?? []).map((f) => f.properties?.GSScode),
    [geoData],
  );

  const regionLookup = useMemo(() => buildRegionLookup(geoData), [geoData]);

  const availability = useMemo(
    () =>
      getConstituencyAvailability({
        rows,
        selectedPolicies,
        selectedYear,
        constituencyCodes,
      }),
    [rows, selectedPolicies, selectedYear, constituencyCodes],
  );

  const aggregated = useMemo(
    () =>
      availability.available
        ? aggregateConstituencies(rows, selectedPolicies, selectedYear)
        : [],
    [availability, rows, selectedPolicies, selectedYear],
  );

  return { loading, geoData, regionLookup, availability, aggregated };
}
