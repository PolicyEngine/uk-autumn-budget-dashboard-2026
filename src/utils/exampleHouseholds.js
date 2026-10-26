/**
 * Number helpers for the household earnings charts: round axis ticks and
 * short and full pound labels.
 */

/** Tick values from 0 to `max` in a round step, at most five intervals. */
export function roundTicks(max) {
  const steps = [1000, 2000, 5000, 10000, 20000, 25000, 30000, 50000, 100000];
  const step = steps.find((candidate) => max / candidate <= 5) ?? steps[steps.length - 1];
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(value);
  return ticks;
}

/** "£40k", "£500", "-£2k" */
export function formatPoundsShort(value) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}£${Number((abs / 1000).toFixed(1))}k`;
  return `${sign}£${abs.toFixed(0)}`;
}

/** "£40,000" */
export function formatPounds(value) {
  return `${value < 0 ? "-" : ""}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}
