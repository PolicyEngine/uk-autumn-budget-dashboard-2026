import { useCallback, useEffect, useState } from "react";

// The years two-year comparisons on Living standards run between, kept in
// the address (?ls_from=2027&ls_to=2031) and shared by every card that
// compares two years, so choosing a range in one changes it in all
const EVENT = "ls-year-range";
const startOf = (fy) => Number(String(fy).slice(0, 4));

function readRange(years, fallback) {
  const known = new Set(years.map(startOf));
  let from = fallback[0];
  let to = fallback[1];
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const f = Number(params.get("ls_from"));
    const t = Number(params.get("ls_to"));
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
  const [range, setRange] = useState(() => readRange(years, fallback));
  useEffect(() => {
    const onChange = (event) => setRange(event.detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const choose = useCallback(
    (from, to) => {
      if (!(startOf(from) < startOf(to))) return;
      const params = new URLSearchParams(window.location.search);
      const isDefault = from === fallback[0] && to === fallback[1];
      if (isDefault) {
        params.delete("ls_from");
        params.delete("ls_to");
      } else {
        params.set("ls_from", String(startOf(from)));
        params.set("ls_to", String(startOf(to)));
      }
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: [from, to] }));
    },
    [fallback],
  );
  return [range, choose];
}
