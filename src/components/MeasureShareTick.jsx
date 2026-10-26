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

/**
 * A row of a measure's group of rows: the group's name, with the measure's
 * name above its first row (labels: rowKey -> {name, group, first}).
 */
export function MeasureGroupTick({ x, y, payload, labels, narrow, size = 12 }) {
  const label = labels[payload.value];
  if (!label) return null;
  return (
    <g>
      {label.first && (
        <text x={x - 6} y={y - size - 2} textAnchor="end" dominantBaseline="middle" fontSize={size} fontWeight={600} fill={TICK_STYLE.fill}>
          {narrow && label.name.length > 18 ? `${label.name.slice(0, 17)}…` : label.name}
        </text>
      )}
      <text x={x - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={size} fill={TICK_STYLE.fill}>
        {label.group}
      </text>
    </g>
  );
}
