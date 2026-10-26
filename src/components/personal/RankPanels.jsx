/**
 * The rank view of "Where you sit": the percentile curve (rank against
 * income adjusted for household size) before and after the selected
 * policies, with you on each, and a close-up around you where the move in
 * rank shows.
 */
import { CHART_COLOURS, GRID_PROPS, TICK_STYLE, AXIS_TITLE_STYLE, BEFORE_DASH, REFERENCE_DASH } from "../../utils/chartTheme";
import { formatPounds, formatPoundsShort } from "../../utils/exampleHouseholds";
import { HIGHEST_PERCENTILE, LOWEST_PERCENTILE, ordinal } from "../../utils/incomePosition";

const BEFORE = CHART_COLOURS.before;
const AFTER = CHART_COLOURS.after;
const TEXT = CHART_COLOURS.text;

const path = (points, x, y) =>
  points.map((p, i) => `${i ? "L" : "M"}${x(p.income).toFixed(2)},${y(p.percentile).toFixed(2)}`).join("");

/** A curve clipped to an income window, with its ends interpolated. */
function clipCurve(curve, lo, hi) {
  const inside = curve.filter((p) => p.income > lo && p.income < hi);
  const at = (income) => {
    for (let i = 0; i < curve.length - 1; i += 1) {
      const a = curve[i];
      const b = curve[i + 1];
      if (income >= a.income && income <= b.income) {
        const t = (income - a.income) / (b.income - a.income || 1);
        return { income, percentile: a.percentile + t * (b.percentile - a.percentile) };
      }
    }
    return null;
  };
  return [at(lo), ...inside, at(hi)].filter(Boolean);
}

/** An arrow from one point to another, with a head at the end. */
function Arrow({ from, to, color }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 10) return null;
  const ux = dx / length;
  const uy = dy / length;
  // Stop short of the markers
  const start = { x: from.x + ux * 7, y: from.y + uy * 7 };
  const end = { x: to.x - ux * 8, y: to.y - uy * 8 };
  const head = 7;
  const left = { x: end.x - ux * head - uy * head * 0.6, y: end.y - uy * head + ux * head * 0.6 };
  const right = { x: end.x - ux * head + uy * head * 0.6, y: end.y - uy * head - ux * head * 0.6 };
  return (
    <g className="position-arrow">
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={2} />
      <path d={`M${left.x},${left.y}L${end.x},${end.y}L${right.x},${right.y}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </g>
  );
}

function Marker({ x, y, color, hollow = false }) {
  return <circle cx={x} cy={y} r={6} fill={hollow ? CHART_COLOURS.surface : color} stroke={hollow ? color : CHART_COLOURS.surface} strokeWidth={hollow ? 2.5 : 2} />;
}

/** A label with a white halo, so it reads over gridlines and curves. */
function Label({ x, y, children, anchor = "start", weight = 600, size = 12.5, color = TEXT }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color} stroke={CHART_COLOURS.surface} strokeWidth={4} paintOrder="stroke">
      {children}
    </text>
  );
}

const points1dp = (value) => {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "no change in percentile";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)} percentile point${Math.abs(rounded) === 1 ? "" : "s"}`;
};

/**
 * The whole distribution: percentile (y) against equivalised net income
 * (x), before and after, with you on each curve. The close-up's window is
 * outlined when it is shown.
 */
export function WholePanel({ width, height, before, after, position, windowBox }) {
  const left = 58;
  const right = 16;
  const top = 14;
  const bottom = 40;
  const plotW = Math.max(width - left - right, 60);
  const plotH = height - top - bottom;
  const topIncome = Math.max(before[before.length - 1].income, after[after.length - 1].income);
  const reader = Math.max(position.incomeBefore, position.incomeAfter);
  const xMax = niceMax(Math.max(topIncome, reader) * 1.04);
  const x = (v) => left + (Math.max(0, Math.min(v, xMax)) / xMax) * plotW;
  const y = (p) => top + plotH - (p / 100) * plotH;
  const xTicks = ticksFor(xMax, width < 420 ? 3 : 5);
  const yTicks = [0, 25, 50, 75, 100];

  const youBefore = markerPoint(before, position.before, position.incomeBefore);
  const youAfter = markerPoint(after, position.after, position.incomeAfter);
  const labelLeft = x(position.incomeAfter) > left + plotW * 0.62;

  return (
    <svg className="position-svg position-whole" width={width} height={height} aria-hidden="true">
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} stroke={GRID_PROPS.stroke} />
          <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
            {tick === 0 ? "0" : ordinal(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <text key={`x-${tick}`} x={x(tick)} y={top + plotH + 18} textAnchor="middle" {...TICK_STYLE}>
          {formatPoundsShort(tick)}
        </text>
      ))}
      <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke={CHART_COLOURS.axis} />
      <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        Income adjusted for household size (£ a year)
      </text>
      <text x={12} y={top + plotH / 2} transform={`rotate(-90 12 ${top + plotH / 2})`} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        Percentile
      </text>

      {/* Out of the published range: shaded, so no curve is invented there */}
      <rect x={left} y={y(LOWEST_PERCENTILE)} width={plotW} height={y(0) - y(LOWEST_PERCENTILE)} fill={CHART_COLOURS.mutedFill} />
      <rect x={left} y={y(100)} width={plotW} height={y(HIGHEST_PERCENTILE) - y(100)} fill={CHART_COLOURS.mutedFill} />

      <path d={path(before, x, y)} fill="none" stroke={BEFORE} strokeWidth={2.5} strokeDasharray={BEFORE_DASH} />
      <path d={path(after, x, y)} fill="none" stroke={AFTER} strokeWidth={2.5} />

      {windowBox && (
        <rect
          x={x(windowBox.lo)}
          y={y(windowBox.top)}
          width={Math.max(x(windowBox.hi) - x(windowBox.lo), 6)}
          height={Math.max(y(windowBox.bottom) - y(windowBox.top), 6)}
          fill="none"
          stroke={CHART_COLOURS.highlight}
          strokeWidth={1.25}
          strokeDasharray={REFERENCE_DASH}
        />
      )}

      <line x1={x(position.incomeAfter)} x2={x(position.incomeAfter)} y1={top} y2={top + plotH} stroke={TEXT} strokeWidth={1} strokeDasharray={REFERENCE_DASH} opacity={0.6} />
      <Marker x={x(position.incomeBefore)} y={y(youBefore)} color={BEFORE} hollow />
      <Marker x={x(position.incomeAfter)} y={y(youAfter)} color={AFTER} />
      <Label x={x(position.incomeAfter) + (labelLeft ? -12 : 12)} y={y(youAfter) + (youAfter > 85 ? 22 : -10)} anchor={labelLeft ? "end" : "start"}>
        You
      </Label>
    </svg>
  );
}

/** Where to draw a marker: on its curve, or at the edge of the published range. */
function markerPoint(curve, pos, income) {
  if (pos.below) return LOWEST_PERCENTILE / 2;
  if (pos.above) return (100 + HIGHEST_PERCENTILE) / 2;
  return pos.percentile ?? curve[0].percentile;
}

function niceMax(value) {
  // Up to the next round tenth of its order of magnitude: 106k -> 110k
  const step = 10 ** Math.floor(Math.log10(value)) / 10;
  return Math.ceil(value / step) * step;
}

function ticksFor(max, count) {
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks = [];
  for (let t = 0; t <= max + step / 1e6; t += step) ticks.push(Math.round(t));
  return ticks;
}

/** The close-up's income window: wide enough to show the move, centred on it. */
export function closeUpWindow(position) {
  const mid = (position.incomeBefore + position.incomeAfter) / 2;
  const half = Math.max(Math.abs(position.change) * 2.5, mid * 0.015, 150);
  return { lo: mid - half, hi: mid + half };
}

/**
 * The close-up around you: both curves over a narrow band of incomes, so
 * the move from before to after shows, with an arrow and its size.
 */
export function CloseUpPanel({ width, height, before, after, position, window: box }) {
  const left = 58;
  const right = 16;
  const top = 14;
  const bottom = 40;
  const plotW = Math.max(width - left - right, 60);
  const plotH = height - top - bottom;
  const b = clipCurve(before, box.lo, box.hi);
  const a = clipCurve(after, box.lo, box.hi);
  const pctLo = Math.min(...b.map((p) => p.percentile), ...a.map((p) => p.percentile), position.before.percentile, position.after.percentile);
  const pctHi = Math.max(...b.map((p) => p.percentile), ...a.map((p) => p.percentile), position.before.percentile, position.after.percentile);
  const pad = Math.max((pctHi - pctLo) * 0.12, 0.2);
  const yLo = pctLo - pad;
  const yHi = pctHi + pad;
  const x = (v) => left + ((v - box.lo) / (box.hi - box.lo)) * plotW;
  const y = (p) => top + plotH - ((p - yLo) / (yHi - yLo)) * plotH;
  const xTicks = [box.lo, (box.lo + box.hi) / 2, box.hi];
  const yTicks = [yLo + pad, (yLo + yHi) / 2, yHi - pad];
  const from = { x: x(position.incomeBefore), y: y(position.before.percentile) };
  const to = { x: x(position.incomeAfter), y: y(position.after.percentile) };
  const rising = position.change >= 0;
  const labelX = Math.max(left + 4, Math.min((from.x + to.x) / 2, left + plotW - 4));
  const anchor = labelX > left + plotW * 0.6 ? "end" : labelX < left + plotW * 0.4 ? "start" : "middle";

  return (
    <svg className="position-svg position-close" width={width} height={height} aria-hidden="true">
      {yTicks.map((tick, i) => (
        <g key={`y-${i}`}>
          <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} stroke={GRID_PROPS.stroke} />
          <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
            {tick.toFixed(1)}
          </text>
        </g>
      ))}
      {xTicks.map((tick, i) => (
        <text key={`x-${i}`} x={x(tick)} y={top + plotH + 18} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} {...TICK_STYLE}>
          {formatPounds(tick)}
        </text>
      ))}
      <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke={CHART_COLOURS.axis} />
      <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        Close-up around you (£ a year)
      </text>
      <text x={12} y={top + plotH / 2} transform={`rotate(-90 12 ${top + plotH / 2})`} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        Percentile
      </text>
      <path d={path(b, x, y)} fill="none" stroke={BEFORE} strokeWidth={2.5} strokeDasharray={BEFORE_DASH} />
      <path d={path(a, x, y)} fill="none" stroke={AFTER} strokeWidth={2.5} />
      <Arrow from={from} to={to} color={TEXT} />
      <Marker x={from.x} y={from.y} color={BEFORE} hollow />
      <Marker x={to.x} y={to.y} color={AFTER} />
      <Label x={from.x + (rising ? -10 : 10)} y={from.y + 20} anchor={rising ? "end" : "start"} weight={500} size={12}>
        Before
      </Label>
      <Label x={to.x + (rising ? 10 : -10)} y={to.y - 10} anchor={rising ? "start" : "end"} weight={600} size={12}>
        After
      </Label>
      <Label x={labelX} y={top + 14} anchor={anchor} weight={600} size={12.5}>
        {points1dp(position.exactChange)}
      </Label>
    </svg>
  );
}

