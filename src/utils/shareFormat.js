/**
 * A share of people, in percent, as the page writes it: never "0.0%" for
 * a share that is not zero, and never "100%" for one that is not all.
 *   exactly 0 → "0%"; above 0 and below 0.1 → "<0.1%";
 *   0.1 to below 1 → one decimal place; 1 to 99 → whole numbers;
 *   above 99 and up to 99.9 → one decimal place; above 99.9 and below 100
 *   → ">99.9%"; 100 → "100%".
 *
 * @param {number} value - Percent (0 to 100)
 */
export function formatShare(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value <= 0) return "0%";
  if (value >= 100) return "100%";
  if (value < 0.1) return "<0.1%";
  if (value > 99.9) return ">99.9%";
  if (value < 1 || value > 99) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

// The narrowest a non-zero segment is drawn, in percent of the bar, so a
// share of a few people is never invisible
export const MIN_SEGMENT = 0.8;

/**
 * Bar segments for shares that add up to 100: each non-zero share drawn at
 * least MIN_SEGMENT wide, the widening taken from the largest share, so the
 * bar still adds up to 100. The real shares stay on the row as `real`.
 *
 * @param {Object} row - { [key]: percent }
 * @param {string[]} keys
 */
export function visibleSegments(row, keys) {
  const real = Object.fromEntries(keys.map((key) => [key, row[key] ?? 0]));
  const drawn = { ...real };
  let added = 0;
  for (const key of keys) {
    if (real[key] > 0 && real[key] < MIN_SEGMENT) {
      added += MIN_SEGMENT - real[key];
      drawn[key] = MIN_SEGMENT;
    }
  }
  const largest = keys.reduce((a, b) => (real[b] > real[a] ? b : a), keys[0]);
  drawn[largest] = Math.max(0, drawn[largest] - added);
  return { ...row, ...drawn, real };
}
