/**
 * Exact arithmetic on published decimal strings.
 *
 * The disclosure layer rounds every figure to the precision the data
 * supports, and the page shows those digits and no others. Reading the
 * strings into floating point and printing them again can add digits
 * (0.0123 * 100 is 1.2300000000000002), so the page never does: it moves
 * decimal points, compares and groups digits on the strings themselves.
 */

// Python writes very small or large floats in e-notation ("1.2e-05"), so
// that is read too; a two-digit exponent covers every published figure.
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,2}))?$/;

/** Whether `text` is a finite decimal number, optionally in e-notation. */
export function isDecimal(text) {
  if (typeof text !== "string") return false;
  const match = DECIMAL.exec(text);
  return Boolean(match) && /\d/.test(`${match[2]}${match[3] ?? ""}`);
}

/**
 * A decimal string as `{negative, digits, exponent}`: the value is
 * digits × 10^exponent, with the sign. `digits` has no leading or trailing
 * zeros, so equal values have equal parts; zero is `{false, "0", 0}`.
 *
 * @throws {Error} when `text` is not a decimal number.
 */
export function parseDecimal(text) {
  if (!isDecimal(text)) throw new Error("not a decimal number");
  const [, sign, whole, fraction = "", exponent = "0"] = DECIMAL.exec(text);
  let digits = `${whole}${fraction}`.replace(/^0+/, "");
  let power = Number(exponent) - fraction.length;
  if (digits === "") return { negative: false, digits: "0", exponent: 0 };
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  digits = digits.slice(0, digits.length - trailing);
  power += trailing;
  return { negative: sign === "-", digits, exponent: power };
}

function plain({ negative, digits, exponent }) {
  let text;
  if (exponent >= 0) {
    text = digits + "0".repeat(exponent);
  } else {
    const point = digits.length + exponent;
    text =
      point > 0
        ? `${digits.slice(0, point)}.${digits.slice(point)}`
        : `0.${"0".repeat(-point)}${digits}`;
  }
  return negative && digits !== "0" ? `-${text}` : text;
}

/**
 * The shortest plain decimal for `text`, with the point moved `places` to
 * the right: "120.0" → "120", "0.0123" with 2 places → "1.23".
 */
export function shiftDecimal(text, places = 0) {
  const parsed = parseDecimal(text);
  if (parsed.digits === "0") return "0";
  return plain({ ...parsed, exponent: parsed.exponent + places });
}

/** The shortest plain decimal for `text` ("-0.50" → "-0.5", "1e-3" → "0.001"). */
export const canonicalDecimal = (text) => shiftDecimal(text, 0);

/** -1, 0 or 1. */
export function signOf(text) {
  const { negative, digits } = parseDecimal(text);
  if (digits === "0") return 0;
  return negative ? -1 : 1;
}

/** The magnitude of `text`, as a plain decimal. */
export function absDecimal(text) {
  const parsed = parseDecimal(text);
  return plain({ ...parsed, negative: false });
}

function scaled({ negative, digits }, extra) {
  const magnitude = BigInt(digits) * 10n ** BigInt(extra);
  return negative ? -magnitude : magnitude;
}

/** Compare two decimal strings exactly: -1, 0 or 1. */
export function compareDecimal(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const exponent = Math.min(a.exponent, b.exponent);
  const x = scaled(a, a.exponent - exponent);
  const y = scaled(b, b.exponent - exponent);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** A plain, unsigned decimal with en-GB thousands separators. */
export function groupThousands(magnitude) {
  const [whole, fraction] = magnitude.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
