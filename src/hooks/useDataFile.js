import { useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Each file is loaded once per page: every card, household and year reads it
const files = {};

/**
 * A public data file (public/data/<name>), fetched once per page and
 * parsed with `parse` (keep it a stable function): { status:
 * "loading"|"ready"|"error", rows }.
 */
export default function useDataFile(name, parse) {
  const [state, setState] = useState(() => files[name] ?? { status: "loading", rows: null });
  useEffect(() => {
    if (files[name]) return undefined;
    let cancelled = false;
    fetch(`${BASE}/data/${name}`)
      .then((response) => {
        if (!response.ok) throw new Error(`${name}: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        files[name] = { status: "ready", rows: parse(text) };
        if (!cancelled) setState(files[name]);
      })
      .catch((error) => {
        console.error(`Error loading ${name}:`, error);
        if (!cancelled) setState({ status: "error", rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, [name, parse]);
  return state;
}
