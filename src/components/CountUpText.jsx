import useCountUp from "../hooks/useCountUp";

// The first number in a formatted figure ("£43.1k", "−0.2pp", "≈4,000
// fewer"): its sign, digits with thousands commas, and decimals
const NUMBER = /([−-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/;

function parse(text) {
  if (typeof text !== "string") return null;
  const match = text.match(NUMBER);
  if (!match) return null;
  const [whole, sign, digits, decimals = ""] = match;
  const value = Number(`${sign ? "-" : ""}${digits.replace(/,/g, "")}${decimals}`);
  return {
    value,
    before: text.slice(0, match.index),
    after: text.slice(match.index + whole.length),
    places: decimals ? decimals.length - 1 : 0,
    commas: digits.includes(","),
    minus: sign || "−",
    // A rounded figure ("44,000") counts in its own steps (thousands)
    step: decimals ? 1 : 10 ** ((digits.replace(/,/g, "").match(/0+$/)?.[0].length ?? 0)),
  };
}

function format(value, { places, commas, minus, step }) {
  const abs = step > 1 ? Math.round(Math.abs(value) / step) * step : Math.abs(value);
  const body = commas
    ? abs.toLocaleString("en-GB", { minimumFractionDigits: places, maximumFractionDigits: places })
    : abs.toFixed(places);
  // No "-0" while a figure counts through zero
  return `${value < 0 && Number(body.replace(/,/g, "")) !== 0 ? minus : ""}${body}`;
}

/**
 * A headline figure, as formatted text, whose number counts to its new
 * value when it changes (useCountUp: 400ms, eased out): the text around the
 * number ("£", "k", "pp", "fewer") stays. It is shown as it is on first
 * render, when its shape changes (a different unit), and with
 * prefers-reduced-motion. Assistive technology reads the final figure.
 *
 * @param {Object} props
 * @param {string} props.text - The formatted figure
 */
export default function CountUpText({ text }) {
  const parsed = parse(text);
  if (!parsed) return text;
  // A change of unit or format starts afresh (no count): counting £ into %
  // would mislead
  const shape = `${parsed.before}#${parsed.after}|${parsed.places}|${parsed.commas}`;
  return <Counter key={shape} text={text} parsed={parsed} />;
}

function Counter({ text, parsed }) {
  const counted = useCountUp(parsed.value);
  if (counted === null || counted === parsed.value) return text;
  return (
    <span className="count-up">
      <span aria-hidden="true">{`${parsed.before}${format(counted, parsed)}${parsed.after}`}</span>
      <span className="visually-hidden">{text}</span>
    </span>
  );
}
