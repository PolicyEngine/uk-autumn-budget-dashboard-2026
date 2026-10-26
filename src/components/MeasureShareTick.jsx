import { TICK_STYLE } from "../utils/chartTheme";

/** Words in lines of at most `width` characters (a long name over two or three lines). */
function wrap(text, width) {
  const lines = [];
  for (const word of String(text).split(" ")) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/**
 * A measure's name at the left of its better/worse-off bar (the cards'
 * one-row-per-measure view), wrapped to fit the axis on a phone.
 */
export default function MeasureShareTick({ x, y, payload, narrow, size = 12 }) {
  const lines = wrap(payload.value, narrow ? 16 : 30);
  const lineHeight = size + 2;
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text x={x - 6} y={top} textAnchor="end" dominantBaseline="middle" fontSize={size} fill={TICK_STYLE.fill}>
      {lines.map((line, i) => (
        <tspan key={i} x={x - 6} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
