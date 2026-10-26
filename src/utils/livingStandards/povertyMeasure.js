import { useCallback, useEffect, useState } from "react";

// The poverty measure the OBR forecast's Poverty sub-tab shows, one choice
// for its tiles and both cards (Poverty over time, Who is in poverty): a
// change in either card's Options moves all of them. Kept in the address
// (?ls_poverty=relative_ahc) as the years compared are (yearRange.js).
const EVENT = "ls-poverty-measure";
const PARAM = "ls_poverty";
export const POVERTY_MEASURES = ["absolute_bhc", "absolute_ahc", "relative_bhc", "relative_ahc"];
export const DEFAULT_POVERTY_MEASURE = "absolute_bhc";

function readMeasure() {
  if (typeof window === "undefined") return DEFAULT_POVERTY_MEASURE;
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return POVERTY_MEASURES.includes(value) ? value : DEFAULT_POVERTY_MEASURE;
}

/** The shared measure ("absolute_bhc") and a setter that moves every user of it. */
export function usePovertyMeasure() {
  const [measure, setMeasure] = useState(readMeasure);
  useEffect(() => {
    const onChange = (event) => setMeasure(event.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const choose = useCallback((value) => {
    if (!POVERTY_MEASURES.includes(value)) return;
    const params = new URLSearchParams(window.location.search);
    if (value === DEFAULT_POVERTY_MEASURE) params.delete(PARAM);
    else params.set(PARAM, value);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  }, []);
  return [measure, choose];
}

/** "absolute_bhc" -> the measure's plain definition, for a tile's info tip. */
export function povertyDefinition(measure) {
  const line = measure.startsWith("absolute")
    ? "Absolute poverty: income below a fixed line, 60% of the 2024-25 median, held constant in real terms"
    : "Relative poverty: income below 60% of that year's median income";
  return `${line}, ${measure.endsWith("ahc") ? "after" : "before"} housing costs.`;
}
