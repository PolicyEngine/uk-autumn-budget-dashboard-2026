// Amounts in £bn as the costings cards show them (official costings
// comparison, revenue tooltip): under £1bn in £m, to the nearest £5m as the
// Treasury's policy costings round them (−£30m, not "£0.0bn", which would
// read as no effect); from £1bn in £bn with one decimal (or `decimals`).
// A real zero is "£0". A true minus sign throughout.

const MINUS = "−";
const isValue = (value) => typeof value === "number" && Number.isFinite(value);
const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * The amount as shown, in £bn: to the nearest £5m under £1bn (to the
 * nearest £1m where that would be nothing for an amount that is not
 * zero), else to `decimals` of a £bn. Null without a value.
 */
export function shownBn(value, decimals = 1) {
  if (!isValue(value)) return null;
  if (value === 0) return 0;
  const fives = Math.round(value * 200) / 200;
  if (Math.abs(fives) < 1) return fives !== 0 ? fives : Math.round(value * 1000) / 1000;
  return roundTo(value, decimals);
}

function words(rounded, decimals, sign) {
  if (rounded === 0) return "£0";
  const abs = Math.abs(rounded);
  if (abs < 1) return `${sign}£${Math.round(abs * 1000)}m`;
  return `${sign}£${abs.toFixed(decimals)}bn`;
}

/** −£30m / −£3.1bn / £0; "" without a value. An amount under £0.5m that is not zero reads "under £1m". */
export function formatBnOrM(value, decimals = 1) {
  if (!isValue(value)) return "";
  const rounded = shownBn(value, decimals);
  if (rounded === 0 && value !== 0) return `${value < 0 ? MINUS : ""}under £1m`;
  return words(rounded, decimals, rounded < 0 ? MINUS : "");
}

/** A difference of two shown amounts, always signed: +£25m / −£0.3bn / £0. "—" without a value. */
export function formatSignedBnOrM(value, decimals = 1) {
  if (!isValue(value)) return "—";
  // Already a difference of shown amounts: only float noise to clear
  const rounded = Math.abs(value) < 1 ? Math.round(value * 1000) / 1000 : roundTo(value, decimals);
  return words(rounded, decimals, rounded < 0 ? MINUS : "+");
}
