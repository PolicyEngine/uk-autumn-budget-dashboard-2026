/** en-GB formats for published figures. */

function fixed(value, digits) {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** £X.XXbn */
export const formatBillions = (value) => {
  const sign = value < 0 ? "-" : "";
  return `${sign}£${fixed(Math.abs(value), 2)}bn`;
};

/** XX.XX% */
export const formatPercent = (value) => `${fixed(value, 2)}%`;

/** X.XXpp */
export const formatPoints = (value) => `${fixed(value, 2)}pp`;

/** A relative change given as a fraction, shown as XX.XX%. */
export const formatRelative = (fraction) => formatPercent(fraction * 100);

/** The UK fiscal year starting in April of `year`: 2027 → "2027-28". */
export const fiscalYearLabel = (year) =>
  `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
