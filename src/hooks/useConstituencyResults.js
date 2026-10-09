import { useEffect, useMemo, useState } from "react";
import {
  VERIFIED_CONSTITUENCY_POLICY_IDS,
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
  const [data, setData] = useState({
    loading: true,
    loadFailed: false,
    rows: [],
    geoData: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadConstituencyData().then(
      ({ rows, geoData }) => {
        if (!cancelled) {
          setData({ loading: false, loadFailed: false, rows, geoData });
        }
      },
      (error) => {
        console.error("Error loading constituency data:", error);
        if (!cancelled) {
          setData({
            loading: false,
            loadFailed: true,
            rows: [],
            geoData: null,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const { loading, loadFailed, rows, geoData } = data;

  // A repeated ID in the URL must not read as a policy counted twice.
  const policyKey = (selectedPolicies ?? []).join(",");
  const policies = useMemo(
    () => [...new Set(policyKey ? policyKey.split(",") : [])],
    [policyKey],
  );

  const constituencyCodes = useMemo(
    () => (geoData?.features ?? []).map((f) => f.properties?.GSScode),
    [geoData],
  );

  const regionLookup = useMemo(() => buildRegionLookup(geoData), [geoData]);

  const availability = useMemo(
    () =>
      getConstituencyAvailability({
        rows,
        selectedPolicies: policies,
        selectedYear,
        constituencyCodes,
        verifiedPolicyIds: VERIFIED_CONSTITUENCY_POLICY_IDS,
        loadFailed,
      }),
    [rows, policies, selectedYear, constituencyCodes, loadFailed],
  );

  const aggregated = useMemo(
    () =>
      availability.available
        ? aggregateConstituencies(rows, policies, selectedYear)
        : [],
    [availability, rows, policies, selectedYear],
  );

  return {
    loading,
    geoData,
    regionLookup,
    policies,
    availability,
    aggregated,
  };
}
