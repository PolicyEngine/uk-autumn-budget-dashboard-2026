import { useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Each file is loaded once per page: every card, household and year reads it
const files = {};

// What a hook with no file to read returns: nothing is fetched
const NO_FILE = { status: "off", rows: null };

/**
 * A public data file (public/data/<name>), fetched once per page and
 * parsed with `parse` (keep it a stable function): { status:
 * "loading"|"ready"|"error", rows }. A null `name` fetches nothing and
 * gives { status: "off" } (a file only a hidden figure reads).
 */
export default function useDataFile(name, parse) {
  const [state, setState] = useState(() => (name ? files[name] : null) ?? { status: "loading", rows: null });
  useEffect(() => {
    if (!name || files[name]) return undefined;
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
  return name ? state : NO_FILE;
}
