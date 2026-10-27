import { useEffect, useState } from "react";

/** The query parameter that holds the measure shown (?variable=). */
export const VARIABLE_PARAM = "variable";

const readParam = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(VARIABLE_PARAM);

function writeParam(value) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(VARIABLE_PARAM, value);
  else params.delete(VARIABLE_PARAM);
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", url);
  }
}

/**
 * Take ?variable= out of the address, for a hidden view whose file could
 * not be shown: useVariableParam is mounted only with the measures drawn.
 */
export const dropVariableParam = () => writeParam(null);

/**
 * The measure the forecast vintages view shows, kept in the address as
 * ?variable= while the view is shown, so a link opens it. The first value
 * is the default and is never written; a value the view does not have
 * opens the default. The view is a sub-tab of Pre-measures forecast, so it
 * never touches ?sub=, and once mounted it takes ?variable= out of the
 * address itself while it is hidden (App.jsx drops only ?sub=); with no
 * measures to draw, ForecastVintagesView does (dropVariableParam).
 *
 * @param {string[]} values - The measures' ids; the first is the default
 * @param {boolean} [active] - Whether the view is shown (kept mounted while hidden)
 * @returns {[string, (value: string) => void]}
 */
export function useVariableParam(values, active = true) {
  const fallback = values[0];
  const [value, setValue] = useState(() => {
    const requested = readParam();
    return values.includes(requested) ? requested : fallback;
  });
  // Shown again: a ?variable= a link brought opens that measure; with none,
  // the measure left open stays
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) {
      const requested = readParam();
      if (values.includes(requested) && requested !== value) setValue(requested);
    }
  }

  // After every render, not only when the measure or `active` changes: a
  // link followed while the view is hidden can bring ?variable= with
  // another of the holding view's sub-tabs, and it goes when this view next
  // renders (writeParam leaves an address already right alone). A sub-tab
  // is mounted only once it has been opened, so until then such a
  // ?variable= stays, and opening the sub-tab opens that measure.
  useEffect(() => {
    writeParam(active && value !== fallback ? value : null);
  });

  return [value, setValue];
}
