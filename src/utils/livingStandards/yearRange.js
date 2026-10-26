import { useCallback, useEffect, useState } from "react";
import { useScopedParam } from "./urlScope";

// The years two-year comparisons on Living standards run between, kept in
// the address (?ls_from=2027&ls_to=2031) and shared by every card that
// compares two years, so choosing a range in one changes it in all. Within
// one place only: Population impact's copies of the cards keep their own
// range (?pop_ls_from, urlScope.js)
const EVENT = "ls-year-range";
const startOf = (fy) => Number(String(fy).slice(0, 4));

function readRange(years, fallback, fromParam, toParam) {
  const known = new Set(years.map(startOf));
  let from = fallback[0];
  let to = fallback[1];
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const f = Number(params.get(fromParam));
    const t = Number(params.get(toParam));
    if (known.has(f)) from = years.find((fy) => startOf(fy) === f);
    if (known.has(t)) to = years.find((fy) => startOf(fy) === t);
  }
  return startOf(from) < startOf(to) ? [from, to] : fallback;
}

/**
 * The chosen [from, to] fiscal years ("2027-28") among `years`, the
 * default `fallback` until the reader chooses; and a setter that keeps
 * from before to.
 */
export function useYearRange(years, fallback) {
  const fromParam = useScopedParam("ls_from");
  const toParam = useScopedParam("ls_to");
  const event = `${EVENT}:${fromParam}`;
  const [range, setRange] = useState(() => readRange(years, fallback, fromParam, toParam));
  useEffect(() => {
    const onChange = (e) => setRange(e.detail);
    window.addEventListener(event, onChange);
    return () => window.removeEventListener(event, onChange);
  }, [event]);
  const choose = useCallback(
    (from, to) => {
      if (!(startOf(from) < startOf(to))) return;
      const params = new URLSearchParams(window.location.search);
      const isDefault = from === fallback[0] && to === fallback[1];
      if (isDefault) {
        params.delete(fromParam);
        params.delete(toParam);
      } else {
        params.set(fromParam, String(startOf(from)));
        params.set(toParam, String(startOf(to)));
      }
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      window.dispatchEvent(new CustomEvent(event, { detail: [from, to] }));
    },
    [fallback, fromParam, toParam, event],
  );
  return [range, choose];
}

/**
 * The projection years a reader can compare (meta.headline_start_year to
 * meta.headline_end_year, "2027-28" … "2031-32"), for cards whose own rows
 * also hold outturn years.
 */
export function rangeYears(data) {
  const first = startOf(data?.meta?.headline_start_year);
  const last = startOf(data?.meta?.headline_end_year);
  if (!first || !last || last <= first) return [];
  const out = [];
  for (let y = first; y <= last; y += 1) out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  return out;
}
