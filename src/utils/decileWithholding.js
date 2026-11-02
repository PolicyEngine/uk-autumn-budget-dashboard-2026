/** Whether a retained decile row has a withheld value. */
export const isWithheldDecileValue = (value) => value == null || (typeof value === "string" && value.trim() === "");

/** The dash of a net line's segment across withheld deciles. */
export const NET_GAP_DASH = "4 3";

/**
 * The net line's bridges across withheld deciles (Vahid, 29 Oct): for each
 * run of points whose net is withheld (`withheld`, `key` null) with a
 * published net on both sides, a series that holds only those two published
 * values, drawn as a dashed segment between the two dots. No bridge runs off
 * either end, and a gap that is not withheld (unpublished) is not bridged.
 * Returns the points with each bridge's values under its own key, and the
 * keys in order.
 *
 * @param {Array<Object>} points - The chart's rows, in decile order
 * @param {string} [key] - The net's key
 * @returns {{ data: Array<Object>, keys: Array<string> }}
 */
export function netGapBridges(points, key = "netChange") {
  const has = (point) => point?.[key] !== null && point?.[key] !== undefined && Number.isFinite(point[key]);
  const data = points.map((point) => ({ ...point }));
  const keys = [];
  let i = 0;
  while (i < points.length) {
    if (has(points[i]) || i === 0) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < points.length && !has(points[end])) end += 1;
    const run = points.slice(i, end);
    if (has(points[i - 1]) && end < points.length && run.every((point) => point.withheld)) {
      const bridge = `${key}Gap${keys.length}`;
      keys.push(bridge);
      data[i - 1][bridge] = points[i - 1][key];
      data[end][bridge] = points[end][key];
    }
    i = end;
  }
  return { data, keys };
}
