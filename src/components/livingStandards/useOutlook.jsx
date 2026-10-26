import { useEffect, useState } from "react";
import LoadingSkeleton from "../publication/LoadingSkeleton";
import { loadOutlook } from "../../utils/livingStandards/outlook";

/**
 * The outlook data (public/data/living_standards_outlook.json) as
 * { loading, data, error }. loadOutlook fetches it once per page, so the
 * Pre-measures forecast view and the Population impact sub-tabs share one
 * request, whichever opens first.
 */
export function useOutlook() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      if (live) setState({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The loading line, or the error, while the outlook is not shown. */
export function OutlookStatus({ loading, error }) {
  return (
    <>
      {loading && (
        <LoadingSkeleton label="Loading outlook data…" />
      )}
      {error && (
        <p className="view-status" role="alert">
          Could not load outlook data: {error}
        </p>
      )}
    </>
  );
}
