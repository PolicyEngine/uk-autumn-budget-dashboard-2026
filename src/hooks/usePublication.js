import { useEffect, useState } from "react";
import { loadPublication } from "../utils/publication/load";
import { uniqueIds } from "../utils/publication/select";

const EMPTY = {
  status: "loading",
  manifest: null,
  tablesByKey: {},
  failures: {},
  selection: [],
};

/**
 * Load the published figures for a selection of measures.
 *
 * Returns `{status, manifest, tablesByKey, failures, selection}`:
 *
 * - `ready`: the manifest and the verified tables for `selection`.
 * - `loading`: a new selection is being fetched. `manifest`, `tablesByKey`
 *   and `selection` still describe the previous one, as a consistent set, so
 *   a caller may keep showing it.
 * - `no-manifest`: nothing has been published through the manifest yet.
 * - `error`: the manifest could not be fetched or is invalid (`error` holds
 *   the message). Nothing may be shown.
 *
 * A response for a selection that is no longer current is dropped.
 *
 * @param {string} basePath - The site's base path ("" at the root).
 * @param {Array<string>} selectedIds - Selected measure ids.
 * @param {{refreshKey?: any}} [options] - Change `refreshKey` to refetch.
 */
export function usePublication(basePath, selectedIds, { refreshKey } = {}) {
  const selectionKey = JSON.stringify(uniqueIds(selectedIds));
  const requestKey = JSON.stringify([basePath, selectionKey, refreshKey]);
  const [state, setState] = useState({ ...EMPTY, requestKey: null });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    loadPublication(basePath, JSON.parse(selectionKey), {
      signal: controller.signal,
    })
      .then((result) => {
        if (current) setState({ ...result, requestKey });
      })
      .catch((error) => {
        if (!current || error?.name === "AbortError") return;
        setState({
          ...EMPTY,
          status: "error",
          error: error.message,
          requestKey,
        });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [basePath, selectionKey, requestKey]);

  const { requestKey: loadedKey, ...loaded } = state;
  if (loadedKey === requestKey) return loaded;
  // Not yet loaded for this request. Keep the last good set, if any.
  if (loaded.status === "ready") return { ...loaded, status: "loading" };
  return EMPTY;
}

export default usePublication;
