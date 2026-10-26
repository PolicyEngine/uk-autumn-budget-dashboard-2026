import { useCallback, useState } from "react";

/**
 * One pill's choice kept in the address (?<param>=<value>), as the year
 * range is: read on load if it is one of `options`, otherwise `fallback`;
 * the default is left out of the address. replaceState, so choosing adds no
 * history entry.
 */
export function useUrlChoice(param, options, fallback) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return fallback;
    const chosen = new URLSearchParams(window.location.search).get(param);
    return options.includes(chosen) ? chosen : fallback;
  });
  const choose = useCallback(
    (next) => {
      setValue(next);
      const params = new URLSearchParams(window.location.search);
      if (next === fallback) params.delete(param);
      else params.set(param, next);
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    },
    [param, fallback],
  );
  return [value, choose];
}
