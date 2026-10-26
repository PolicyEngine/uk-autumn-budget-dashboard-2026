import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import { CHART_COLOURS, GRID_PROPS, TICK_STYLE, AXIS_TITLE_STYLE, BEFORE_DASH, REFERENCE_DASH, UNSELECTED_OPACITY, useNarrowViewport } from "../../utils/chartTheme";
import { formatPounds, formatPoundsShort } from "../../utils/exampleHouseholds";
import {
  DISTRIBUTION_FILE,
  HIGHEST_PERCENTILE,
  LOWEST_PERCENTILE,
  bandShares,
  curveOf,
  decileAverages,
  decileOf,
  decilePercents,
  describePosition,
  distributionRunFor,
  householdPosition,
  incomeAt,
  logEdges,
  MOBILITY_FILE,
  mobilityOf,
  ordinal,
  overallAverage,
  parseDistribution,
  positionSummary,
  lowerCount,
  PLACE_MEANING,
} from "../../utils/incomePosition";
import { parseCsv } from "../../utils/publication/csv";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import useElementWidth from "../../hooks/useElementWidth";
import useDataFile from "../../hooks/useDataFile";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartMoreInfo from "../ChartMoreInfo";
import { METHOD_ANCHORS } from "../methodology/anchors";
import TitleIcon from "../TitleIcon";
import ViewSwitch from "../ViewSwitch";
import { InfoTip } from "../Tip";
import "./IncomePosition.css";

const BEFORE = CHART_COLOURS.before;
const AFTER = CHART_COLOURS.after;
const TEXT = CHART_COLOURS.text;
const GAIN = CHART_COLOURS.gain;
const LOSS = CHART_COLOURS.loss;

/** The views, kept for links made before they were merged: any old one opens "Where you sit". */
export const POSITION_VIEWS = [{ value: "where", label: "Where you sit" }];
const UNIT_OPTIONS = [
  { value: "pct", label: "% of net income" },
  { value: "gbp", label: "£ a year" },
];

const useFile = useDataFile;

function parseRecords(text) {
  const [header, ...body] = parseCsv(text).filter((row) => row.length > 1);
  return body.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]])));
}

const reducedMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * A value eased out towards `target` over `ms` whenever `target` or `key`
 * changes (from `from` when `key` changes). With reduced motion it is the
 * target at once.
 */
function useEased(target, { ms = 1200, key = null, from = null } = {}) {
  const [value, setValue] = useState(() => (from !== null && !reducedMotion() ? from : target));
  const frame = useRef(null);
  const current = useRef(target);
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    if (reducedMotion()) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const origin = from !== null ? from : current.current;
    const step = (now) => {
      const x = Math.min(1, (now - start) / ms);
      const v = origin + (target - origin) * (1 - (1 - x) ** 3);
      current.current = v;
      setValue(v);
      if (x < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // `from` only matters when `key` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, key, ms]);
  return value;
}

/** A label with a white halo, so it reads over gridlines and areas. */
function Label({ x, y, children, anchor = "start", weight = 600, size = 12, color = TEXT }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color} stroke={CHART_COLOURS.surface} strokeWidth={4} paintOrder="stroke">
      {children}
    </text>
  );
}

const signedPounds = (value) => {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatPounds(Math.abs(rounded))}`;
};
const signedPct = (value, dp = 1) => {
  const rounded = Number(value.toFixed(dp));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(dp)}%`;
};

/** Three or four round ticks from `min` to `max`. */
function niceTicks(min, max) {
  const span = max - min || 1;
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((v) => v >= raw) ?? magnitude * 10;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1e6; t += step) ticks.push(Math.round(t / step) * step);
  return ticks;
}

/* ------------------------------------------------------------------ */
/* Where you sit: one distribution, on a log income axis              */
/* ------------------------------------------------------------------ */

function WhereView({ width, narrow, curves, position, side, decile }) {
  const left = narrow ? 34 : 44;
  const right = 14;
  const plotW = Math.max(width - left - right, 80);
  const top = 26;
  const plotH = narrow ? 190 : 230;
  const height = top + plotH + 58;

  // Log bands across the range both curves publish
  const bandsN = narrow ? 16 : 26;
  const edges = useMemo(() => {
    const lo = Math.max(curves.before[0].income, curves.after[0].income);
    const hi = Math.min(curves.before[curves.before.length - 1].income, curves.after[curves.after.length - 1].income);
    return logEdges(lo, hi, bandsN);
  }, [curves, bandsN]);
  const shares = {
    before: useMemo(() => bandShares(curves.before, edges), [curves.before, edges]),
    after: useMemo(() => bandShares(curves.after, edges), [curves.after, edges]),
  };
  // 0 = before, 1 = after: the curve and you glide between them
  const t = useEased(side === "after" ? 1 : 0, { ms: 700 });
  // Lightly smoothed (1-2-1 over neighbouring bands), the same for both sides
  const smooth = (v) => v.map((s, i) => (2 * s + (v[i - 1] ?? s) + (v[i + 1] ?? s)) / 4);
  const smoothBefore = useMemo(() => smooth(shares.before), [shares.before]);
  const smoothAfter = useMemo(() => smooth(shares.after), [shares.after]);
  const mix = smoothBefore.map((b, i) => b + (smoothAfter[i] - b) * t);

  const median = incomeAt(curves.before, 50) + (incomeAt(curves.after, 50) - incomeAt(curves.before, 50)) * t;
  const youIncome = position.incomeBefore + (position.incomeAfter - position.incomeBefore) * t;
  const lo = Math.min(edges[0], youIncome, median / 2) * 0.92;
  const hi = Math.max(edges[edges.length - 1], youIncome, median * 2) * 1.08;
  const x = (v) => left + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * plotW;
  const yMax = Math.max(...smoothBefore, ...smoothAfter) * 1.18;
  const y = (s) => top + plotH - (s / yMax) * plotH;
  const outline = mix
    .map((s, i) => {
      const xm = (x(edges[i]) + x(edges[i + 1])) / 2;
      return `${i ? "L" : "M"}${xm.toFixed(1)},${y(s).toFixed(1)}`;
    })
    .join("");
  const first = (x(edges[0]) + x(edges[1])) / 2;
  const last = (x(edges[edges.length - 2]) + x(edges[edges.length - 1])) / 2;
  const area = `${outline}L${last.toFixed(1)},${y(0)}L${first.toFixed(1)},${y(0)}Z`;

  const anchors = [
    // Short names where the card is narrow (a half-width card too)
    { value: median / 2, label: narrow || width < 640 ? "Half middle" : "Half the middle income" },
    { value: median, label: narrow || width < 640 ? "Middle" : "Middle income" },
    { value: median * 2, label: narrow || width < 640 ? "Twice middle" : "Twice the middle income" },
  ];
  const bounds = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) =>
    p === 0 ? lo : p === 100 ? hi : incomeAt(side === "after" ? curves.after : curves.before, p),
  );
  const youX = x(youIncome);
  const inside = youIncome >= edges[0] && youIncome <= edges[edges.length - 1];
  const youShare = inside ? mix[Math.max(0, Math.min(mix.length - 1, edges.findIndex((e) => e > youIncome) - 1))] ?? 0 : 0;
  const onRight = youX > left + plotW * 0.6;
  const colour = side === "after" ? AFTER : BEFORE;

  return (
    <svg className="position-where" width={width} height={height} aria-hidden="true">
      {decile && (
        <rect
          x={x(bounds[decile - 1])}
          y={top}
          width={Math.max(0, x(bounds[decile]) - x(bounds[decile - 1]))}
          height={plotH}
          fill={CHART_COLOURS.highlightBand}
        />
      )}
      {decile && x(bounds[decile]) - x(bounds[decile - 1]) > (narrow ? 50 : 96) && (
        <text x={x(bounds[decile - 1]) + 4} y={top + 12} textAnchor="start" fontSize={10.5} fill={CHART_COLOURS.highlight}>
          {tenthName(decile)}
        </text>
      )}
      <text x={left} y={12} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight} fill={AXIS_TITLE_STYLE.fill}>
        {narrow ? "Share of people" : "Share of people, by income adjusted for household size"}
      </text>
      {anchors.map((a) => (
        <g key={a.label}>
          <line x1={x(a.value)} x2={x(a.value)} y1={top} y2={top + plotH} stroke={CHART_COLOURS.reference} strokeWidth={1} strokeDasharray={REFERENCE_DASH} opacity={0.7} />
          <text x={x(a.value)} y={top + plotH + 16} textAnchor="middle" {...TICK_STYLE}>
            {formatPoundsShort(Math.round(a.value / 1000) * 1000)}
          </text>
          <text x={x(a.value)} y={top + plotH + 32} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
            {a.label}
          </text>
        </g>
      ))}
      <path d={area} fill={colour} fillOpacity={0.22} stroke="none" />
      <path d={outline} fill="none" stroke={colour} strokeWidth={2.25} strokeDasharray={side === "after" ? undefined : BEFORE_DASH} />
      <line x1={left} x2={left + plotW} y1={y(0)} y2={y(0)} stroke={CHART_COLOURS.axis} />
      <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        {narrow
          ? `Income adjusted for household size, ${side === "after" ? "after" : "before"}`
          : `Income adjusted for household size, ${side === "after" ? "after" : "before"} the selected policies (log scale)`}
      </text>

      <line x1={youX} x2={youX} y1={top + 8} y2={y(0)} stroke={TEXT} strokeWidth={1.75} />
      <circle cx={youX} cy={y(youShare)} r={6} fill={side === "after" ? AFTER : CHART_COLOURS.surface} stroke={side === "after" ? CHART_COLOURS.surface : BEFORE} strokeWidth={2.5} />
      <Label x={youX + (onRight ? -8 : 8)} y={top + 34} anchor={onRight ? "end" : "start"} size={13}>
        {`You, ${formatPounds(youIncome)}`}
      </Label>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Who gains: the average change in each tenth                         */
/* ------------------------------------------------------------------ */

function GainsView({ width, narrow, unit, percents, averages, decile, ownPct, ownChange, grow }) {
  const left = narrow ? 44 : 56;
  const right = 12;
  const plotW = Math.max(width - left - right, 80);
  const top = 26;
  const plotH = narrow ? 200 : 240;
  const height = top + plotH + 52;
  const values = Array.from({ length: 10 }, (_, i) => (unit === "pct" ? percents?.[i + 1] : averages?.[i + 1]) ?? 0);
  const own = unit === "pct" ? ownPct : ownChange;
  const all = [...values, own];
  const max = Math.max(...all.map((v) => Math.max(v, 0)), 0);
  const min = Math.min(...all.map((v) => Math.min(v, 0)), 0);
  const span = max - min || 1;
  const pad = span * 0.18;
  const y = (v) => top + plotH - ((v - (min - (min < 0 ? pad : 0))) / (span + pad * (min < 0 ? 2 : 1))) * plotH;
  const zeroY = y(0);
  const slot = plotW / 10;
  const barW = Math.min(slot * 0.66, 56);
  const fmt = (v) => (unit === "pct" ? signedPct(v, 2) : signedPounds(v));
  const gridTicks = niceTicks(min, max).filter((tick) => tick !== 0);

  return (
    <svg className="position-gains" width={width} height={height} aria-hidden="true">
      <text x={left} y={12} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight} fill={AXIS_TITLE_STYLE.fill}>
        {unit === "pct" ? "Average change, % of net income" : "Average change per household, £ a year"}
      </text>
      {gridTicks.map((tick) => (
        <g key={`g-${tick}`}>
          <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} stroke={GRID_PROPS.stroke} />
          <text x={left - 6} y={y(tick)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
            {unit === "pct" ? `${Number(tick.toFixed(2))}%` : formatPoundsShort(tick)}
          </text>
        </g>
      ))}
      <line x1={left} x2={left + plotW} y1={zeroY} y2={zeroY} stroke={CHART_COLOURS.zeroLine} />
      <text x={left - 6} y={zeroY} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
        {unit === "pct" ? "0%" : "£0"}
      </text>
      {values.map((v, i) => {
        const cx = left + slot * (i + 0.5);
        const shown = v * grow;
        const y0 = Math.min(y(shown), zeroY);
        const h = Math.max(Math.abs(y(shown) - zeroY), 0.5);
        const mine = i + 1 === decile;
        const pounds = averages?.[i + 1];
        return (
          <g key={i}>
            {mine && <rect x={left + slot * i + 1} y={top} width={slot - 2} height={plotH} fill={CHART_COLOURS.highlightBand} />}
            <rect x={cx - barW / 2} y={y0} width={barW} height={h} rx={2} fill={v >= 0 ? GAIN : LOSS} fillOpacity={mine ? 1 : UNSELECTED_OPACITY} />
            {grow > 0.98 && (!narrow || mine) && (
              <text x={cx} y={v >= 0 ? y0 - 6 : y0 + h + 13} textAnchor="middle" fontSize={narrow ? 9.5 : 11} fontWeight={mine ? 700 : 500} fill={TEXT}>
                {fmt(v)}
              </text>
            )}
            {grow > 0.98 && unit === "pct" && !narrow && pounds !== undefined && (
              <text x={cx} y={v >= 0 ? y0 - 20 : y0 + h + 27} textAnchor="middle" fontSize={10.5} fill={CHART_COLOURS.tick}>
                {signedPounds(pounds)}
              </text>
            )}
            <text x={cx} y={top + plotH + 16} textAnchor="middle" fontSize={11} fontWeight={mine ? 700 : 400} fill={mine ? CHART_COLOURS.highlight : CHART_COLOURS.tick}>
              {i + 1}
            </text>
          </g>
        );
      })}
      <text x={left} y={top + plotH + 34} fontSize={11} fill={CHART_COLOURS.tick}>
        Bottom 10%
      </text>
      <text x={left + plotW / 2} y={top + plotH + 34} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
        Tenths of people by income
      </text>
      <text x={left + plotW} y={top + plotH + 34} textAnchor="end" fontSize={11} fill={CHART_COLOURS.tick}>
        Top 10%
      </text>
      {decile && (
        <g>
          <line
            x1={left + slot * (decile - 1) + 4}
            x2={left + slot * decile - 4}
            y1={y(own * grow)}
            y2={y(own * grow)}
            stroke={TEXT}
            strokeWidth={2.5}
          />
          <Label
            x={decile > 6 ? left + slot * (decile - 1) - 4 : left + slot * decile + 4}
            y={y(own * grow) + 4}
            anchor={decile > 6 ? "end" : "start"}
            size={12}
          >
            {`You: ${fmt(own)}`}
          </Label>
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* You vs others                                                       */
/* ------------------------------------------------------------------ */

function CompareView({ rows, unit, grow }) {
  const values = rows.map((row) => (unit === "pct" ? row.pct : row.gbp)).filter((v) => v !== null && v !== undefined);
  const max = Math.max(...values.map(Math.abs), 1e-9);
  return (
    <div className="position-compare" role="list">
      {rows.map((row) => {
        const v = unit === "pct" ? row.pct : row.gbp;
        const missing = v === null || v === undefined;
        // No % published for it (the UK average): its £ instead, unbarred
        const poundsOnly = missing && unit === "pct" && row.gbp !== null && row.gbp !== undefined;
        const share = missing ? 0 : (Math.abs(v) / max) * 100 * grow;
        return (
          <div key={row.key} className={`position-compare-row ${row.you ? "is-you" : ""}`} role="listitem">
            <span className="position-compare-label">{row.label}</span>
            <span className="position-compare-track" aria-hidden="true">
              {!missing && (
                <span
                  className={`position-compare-bar ${v < 0 ? "is-loss" : "is-gain"}`}
                  style={{ width: `${share}%` }}
                />
              )}
            </span>
            <span className="position-compare-value">
              <strong>{poundsOnly ? signedPounds(row.gbp) : missing ? "Not published" : unit === "pct" ? signedPct(v, 2) : signedPounds(v)}</strong>
              {poundsOnly && <span className="position-compare-other">no % published</span>}
              {!missing && (
                <span className="position-compare-other">
                  {unit === "pct" ? (row.gbp !== null ? signedPounds(row.gbp) : "") : row.pct !== null ? signedPct(row.pct, 2) : ""}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rank: the same distribution as a cumulative curve                   */
/* ------------------------------------------------------------------ */

/**
 * The share of people with less income than each income, before or after,
 * on the same log income axis (and the same "You") as the spread: read up
 * from you to see how many have less.
 */
function RankView({ width, narrow, curves, position, side }) {
  const left = narrow ? 40 : 48;
  const right = 14;
  const plotW = Math.max(width - left - right, 80);
  const top = 26;
  const plotH = narrow ? 190 : 230;
  const height = top + plotH + 58;
  const t = useEased(side === "after" ? 1 : 0, { ms: 700 });
  // The same range as the spread: what both curves publish, and you
  const loEdge = Math.max(curves.before[0].income, curves.after[0].income);
  const hiEdge = Math.min(curves.before[curves.before.length - 1].income, curves.after[curves.after.length - 1].income);
  const median = incomeAt(curves.before, 50) + (incomeAt(curves.after, 50) - incomeAt(curves.before, 50)) * t;
  const youIncome = position.incomeBefore + (position.incomeAfter - position.incomeBefore) * t;
  const lo = Math.min(loEdge, youIncome, median / 2) * 0.92;
  const hi = Math.max(hiEdge, youIncome, median * 2) * 1.08;
  const x = (v) => left + ((Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * plotW;
  const y = (p) => top + plotH - (p / 100) * plotH;
  const points = curves.before.map((point) => {
    const after = incomeAt(curves.after, point.percentile);
    return { p: point.percentile, income: point.income + (after - point.income) * t };
  });
  const path = points.map((point, i) => `${i ? "L" : "M"}${x(point.income).toFixed(1)},${y(point.p).toFixed(1)}`).join("");
  const pos = side === "after" ? position.after : position.before;
  const youP = pos.percentile ?? (pos.below ? pos.edge ?? LOWEST_PERCENTILE : pos.edge ?? HIGHEST_PERCENTILE);
  const youX = x(youIncome);
  const onRight = youX > left + plotW * 0.6;
  const colour = side === "after" ? AFTER : BEFORE;
  const anchors = [
    // Short names where the card is narrow (a half-width card too)
    { value: median / 2, label: narrow || width < 640 ? "Half middle" : "Half the middle income" },
    { value: median, label: narrow || width < 640 ? "Middle" : "Middle income" },
    { value: median * 2, label: narrow || width < 640 ? "Twice middle" : "Twice the middle income" },
  ];
  return (
    <svg className="position-rank" width={width} height={height} aria-hidden="true">
      <text x={left} y={12} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight} fill={AXIS_TITLE_STYLE.fill}>
        {narrow ? "People with less income" : "Share of people with less income, by income adjusted for household size"}
      </text>
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={left} x2={left + plotW} y1={y(p)} y2={y(p)} stroke={GRID_PROPS.stroke} />
          <text x={left - 6} y={y(p)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>{`${p}%`}</text>
        </g>
      ))}
      {anchors.map((a) => (
        <g key={a.label}>
          <line x1={x(a.value)} x2={x(a.value)} y1={top} y2={top + plotH} stroke={CHART_COLOURS.reference} strokeWidth={1} strokeDasharray={REFERENCE_DASH} opacity={0.7} />
          <text x={x(a.value)} y={top + plotH + 16} textAnchor="middle" {...TICK_STYLE}>
            {formatPoundsShort(Math.round(a.value / 1000) * 1000)}
          </text>
          <text x={x(a.value)} y={top + plotH + 32} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
            {a.label}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke={colour} strokeWidth={2.25} strokeDasharray={side === "after" ? undefined : BEFORE_DASH} />
      <text x={left + plotW / 2} y={height - 4} textAnchor="middle" fill={AXIS_TITLE_STYLE.fill} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight}>
        {narrow
          ? `Income adjusted for household size, ${side}`
          : `Income adjusted for household size, ${side} the selected policies (log scale)`}
      </text>
      {/* You: across to the axis, up to the curve */}
      <line x1={youX} x2={youX} y1={y(0)} y2={y(youP)} stroke={TEXT} strokeWidth={1.75} />
      <line x1={left} x2={youX} y1={y(youP)} y2={y(youP)} stroke={TEXT} strokeWidth={1} strokeDasharray={REFERENCE_DASH} />
      <circle cx={youX} cy={y(youP)} r={6} fill={side === "after" ? AFTER : CHART_COLOURS.surface} stroke={side === "after" ? CHART_COLOURS.surface : BEFORE} strokeWidth={2.5} />
      {/* Two short lines, so it fits a half-width card */}
      <Label x={youX + (onRight ? -8 : 8)} y={y(youP) - 26} anchor={onRight ? "end" : "start"} size={13}>
        {`You: ${Math.round(youP)} in 100`}
      </Label>
      <Label x={youX + (onRight ? -8 : 8)} y={y(youP) - 10} anchor={onRight ? "end" : "start"} size={11.5} weight={500}>
        live in households with less
      </Label>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* The cards                                                           */
/* ------------------------------------------------------------------ */

const SIDES = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
];
const SHOW_AS = [
  { value: "spread", label: "Spread" },
  { value: "rank", label: "Rank" },
];
const COMPARE_BY = [
  { value: "tenths", label: "By income tenth" },
  { value: "like", label: "Households like you" },
];
const TENTH_WORDS = ["", "Lowest", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Highest"];

/** A tenth in plain words: "Lowest tenth", "Third tenth", "Highest tenth". */
export const tenthName = (decile) => `${TENTH_WORDS[decile] ?? ordinal(decile)} tenth`;

/** A card's plot, at the width its column gives it. */
function Measured({ narrow, children }) {
  const [ref, measured] = useElementWidth();
  const width = measured > 0 ? measured : narrow ? 326 : 520;
  return (
    <div ref={ref} className="chart-plot position-plot">
      {children(width)}
    </div>
  );
}

/**
 * Where you sit in the UK income distribution, before and after the
 * selected policies. Above: a headline (how many in every 100 people have
 * a lower income than yours) and three tiles (your change, its share of
 * your income, your place before → after, with how you and everyone move in
 * its tip), and one Before | After choice for both cards below:
 *
 * - "Where you sit": the distribution with you on it, as a spread (how many
 *   people at each income) or a rank (how many have less than each income),
 *   on the same log income axis;
 * - "How your change compares": the average change in each tenth with yours
 *   marked, or you beside households like you.
 *
 * Every household's own change is on All households, linked below.
 *
 * @param {Object} props
 * @param {{ before: number, after: number }} props.net - The household's net income
 * @param {Object} props.household - The request's household (has_partner, children)
 * @param {number} props.year - The figures' year
 * @param {string[]} props.policies - The selected measures' ids
 * @param {string} props.yearLabel - "2027-28"
 */
export default function IncomePositionChart({ net, household, year, policies, yearLabel }) {
  const narrow = useNarrowViewport();
  const whereRef = useRef(null);
  const compareRef = useRef(null);
  const [side, setSide] = useState("after");
  const [showAs, setShowAs] = useState("spread");
  const [compareBy, setCompareBy] = useState("tenths");
  const [unit, setUnit] = useState("pct");
  const distribution = useFile(DISTRIBUTION_FILE, parseDistribution);
  const winners = useFile("winners_losers.csv", parseRecords);
  const relative = useFile("distributional_impact.csv", parseRecords);
  const moves = useFile(MOBILITY_FILE, parseRecords);
  // Every measure the catalogue publishes: the package's run is exact only
  // when all of them are selected, and it was run with exactly those
  const catalogue = useMeasureCatalogue();
  const run = distributionRunFor(
    policies,
    catalogue.displayable.map((measure) => measure.id),
    catalogue.combinedId ? (catalogue.manifest?.combined?.[catalogue.combinedId]?.measures ?? null) : null,
  );
  // Bars grow from zero each time their view opens
  const grow = useEased(1, { key: compareBy, from: 0 });
  const title = `Where you sit in the UK income distribution, ${yearLabel}`;

  const curves = useMemo(() => {
    if (distribution.status !== "ready") return null;
    const before = curveOf(distribution.rows, { reformId: run.reformId, year, side: "baseline" });
    const after = curveOf(distribution.rows, { reformId: run.reformId, year, side: "reform" });
    return before.length > 1 && after.length > 1 ? { before, after } : null;
  }, [distribution, run.reformId, year]);
  const position = useMemo(
    () => (curves ? householdPosition({ net, household, before: curves.before, after: curves.after }) : null),
    [curves, net, household],
  );
  const averages = useMemo(() => (winners.status === "ready" ? decileAverages(winners.rows, policies, year) : null), [winners, policies, year]);
  const ukAverage = useMemo(() => (winners.status === "ready" ? overallAverage(winners.rows, policies, year) : null), [winners, policies, year]);
  const mobility = useMemo(
    () => (moves.status === "ready" ? mobilityOf(moves.rows, { reformId: run.reformId, year, unit: "percentile" }) : null),
    [moves, run.reformId, year],
  );
  const percents = useMemo(() => (relative.status === "ready" ? decilePercents(relative.rows, policies, year) : null), [relative, policies, year]);

  if (distribution.status === "loading") return <div className="card single-year-card position-card is-loading" aria-busy="true" />;
  if (!curves || !position) {
    return (
      <div className="card single-year-card position-card">
        <h3>
          <TitleIcon name="users" />
          <span className="title-text">{title}</span>
        </h3>
        <p className="single-year-quiet">The UK income distribution is not available for this year.</p>
      </div>
    );
  }

  const netBefore = Number(net?.before);
  const ownChange = Number(net?.after) - netBefore;
  const ownPct = netBefore > 0 ? (ownChange / netBefore) * 100 : 0;
  const text = positionSummary(position, ownChange, netBefore, side);
  const textLine = `${text.headline} ${text.chips.map((c) => `${c.label}: ${c.value}.`).join(" ")}`;
  // Your tenth on the side shown
  const decile = decileOf(side === "after" ? position.after : position.before) ?? decileOf(position.before);
  const medianBefore = incomeAt(curves.before, 50);
  const medianChange = incomeAt(curves.after, 50) - medianBefore;
  const compareRows = [
    { key: "you", label: "Your household", gbp: ownChange, pct: ownPct, you: true },
    { key: "tenth", label: `Average in your tenth (${tenthName(decile).toLowerCase()})`, gbp: averages?.[decile] ?? null, pct: percents?.[decile] ?? null },
    { key: "uk", label: "Average UK household", gbp: ukAverage, pct: null },
    { key: "median", label: "UK middle income, adjusted for household size", gbp: medianChange, pct: (medianChange / medianBefore) * 100 },
  ];

  // How you and everyone move, for the Your place tile's tip ("Who moves")
  const everyone = mobility?.all ?? null;
  const moveWords =
    position.pointChange === null
      ? null
      : position.pointChange === 0
        ? "You stay in the same percentile."
        : `You move ${position.pointChange > 0 ? "up" : "down"} ${Math.abs(position.pointChange)} ${Math.abs(position.pointChange) === 1 ? "percentile" : "percentiles"}.`;
  const placeTip = [
    `Your place is how many in every 100 people in the UK ${PLACE_MEANING}: ${lowerCount(position.before)} before the selected policies and ${lowerCount(position.after)} after.`,
    moveWords,
    everyone && everyone.up !== null && everyone.down !== null
      ? `Across the UK, ${everyone.up.toFixed(1)}% of people move up at least a percentile and ${everyone.down.toFixed(1)}% move down.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const whereCsv = () => {
    if (showAs === "rank") {
      return buildChartCsv({
        title: `UK income distribution by percentile before and after the selected policies, ${yearLabel}`,
        units: "£ a year, income adjusted for household size (HBAI modified OECD scale)",
        columns: [
          { key: "percentile", label: "Percentile", decimals: 0 },
          { key: "before", label: "Before the selected policies (£)", decimals: 0 },
          { key: "after", label: "After the selected policies (£)", decimals: 0 },
        ],
        rows: curves.before.map((point) => ({ percentile: point.percentile, before: point.income, after: incomeAt(curves.after, point.percentile) })),
      });
    }
    const edges = logEdges(
      Math.max(curves.before[0].income, curves.after[0].income),
      Math.min(curves.before[curves.before.length - 1].income, curves.after[curves.after.length - 1].income),
      36,
    );
    const b = bandShares(curves.before, edges);
    const a = bandShares(curves.after, edges);
    return buildChartCsv({
      title: `UK income distribution before and after the selected policies, ${yearLabel}`,
      units: "% of people in each income band; income in £ a year adjusted for household size (HBAI modified OECD scale)",
      columns: [
        { key: "from", label: "Income from (£)", decimals: 0 },
        { key: "to", label: "Income to (£)", decimals: 0 },
        { key: "before", label: "Share of people before (%)", decimals: 2 },
        { key: "after", label: "Share of people after (%)", decimals: 2 },
      ],
      rows: b.map((s, i) => ({ from: edges[i], to: edges[i + 1], before: s * 100, after: a[i] * 100 })),
      notes: [
        `Your household: ${formatPounds(position.incomeBefore)} before (${describePosition(position.before)}), ${formatPounds(position.incomeAfter)} after (${describePosition(position.after)}), adjusted for household size`,
        `The lowest ${LOWEST_PERCENTILE}% and highest ${100 - HIGHEST_PERCENTILE}% are not published`,
      ],
    });
  };
  const compareCsv = () =>
    compareBy === "tenths"
      ? buildChartCsv({
          title: `Average change by tenth of people by income, ${yearLabel}`,
          units: "% of net income and £ a year per household",
          columns: [
            { key: "tenth", label: "Tenth (1 = bottom 10%)", decimals: 0 },
            { key: "pct", label: "Average change (% of net income)", decimals: 3 },
            { key: "gbp", label: "Average change (£ a year)", decimals: 2 },
          ],
          rows: Array.from({ length: 10 }, (_, i) => ({ tenth: i + 1, pct: percents?.[i + 1], gbp: averages?.[i + 1] })),
          notes: [`Your household: tenth ${decile}, ${signedPct(ownPct, 2)}, ${signedPounds(ownChange)} a year`],
        })
      : buildChartCsv({
          title: `You and households like you, ${yearLabel}`,
          units: "£ a year and % of net income",
          columns: [
            { key: "label", label: "Who" },
            { key: "gbp", label: "Change (£ a year)", decimals: 2 },
            { key: "pct", label: "Change (% of net income)", decimals: 3 },
          ],
          rows: compareRows,
        });

  const whereTitle = `Your place in the distribution, ${yearLabel}`;
  const compareTitle = `How your change compares, ${yearLabel}`;
  const youPlace = side === "after" ? position.after : position.before;
  const whereAlt =
    showAs === "rank"
      ? `The share of people with less income than each income ${side} the selected policies, on a log scale: ${describePosition(youPlace)} for you.`
      : `The UK income distribution ${side} the selected policies, on a log scale, with you at ${describePosition(youPlace)} and in the ${tenthName(decile).toLowerCase()}.`;
  const compareAlt =
    compareBy === "tenths"
      ? `Average change by tenth of people by income, ${unit === "pct" ? "% of net income" : "£ a year"}: ${Array.from({ length: 10 }, (_, i) => `${i + 1}: ${unit === "pct" ? (percents ? signedPct(percents[i + 1], 2) : "n/a") : averages ? signedPounds(averages[i + 1]) : "n/a"}`).join(", ")}. You, in the ${tenthName(decile).toLowerCase()}: ${unit === "pct" ? signedPct(ownPct, 2) : signedPounds(ownChange)}.`
      : compareRows.map((r) => `${r.label}: ${r.gbp !== null ? signedPounds(r.gbp) : "not published"}${r.pct !== null ? ` (${signedPct(r.pct, 2)})` : ""}`).join("; ");

  const exportOptions = (cardTitle, svgSelector) => ({
    title: cardTitle,
    description: textLine,
    legendItems: [],
    logo: CHART_LOGO,
    svgSelector,
    reservedLegendHeight: 0,
  });

  return (
    <div className="position-block">
      {/* The headline and tiles, and the one Before | After for both cards */}
      <div className="card single-year-card position-card position-summary">
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="users" />
              <span className="title-text">{title}</span>
            </h3>
          </div>
        </div>
        <p className="position-headline">{text.headline}</p>
        <dl className="position-chips">
          {text.chips.map((chip) => (
            <div key={chip.key} className={`position-chip is-${chip.key}`}>
              <dt>
                {chip.label}
                {chip.key === "place" && <InfoTip content={placeTip} label={`About your place: ${placeTip}`} />}
              </dt>
              <dd>{chip.value}</dd>
            </div>
          ))}
        </dl>
        <div className="position-controls">
          <ViewSwitch options={SIDES} value={side} onChange={setSide} label="Before or after the selected policies" compact />
          <span className="position-controls-note">The selected policies, for both charts below</span>
        </div>
      </div>

      <div className="charts-grid position-pair">
        <div className="card single-year-card position-card" data-view={showAs}>
          <div className="chart-header">
            <div>
              <h3>
                <TitleIcon name="users" />
                <span className="title-text">{whereTitle}</span>
              </h3>
              <p className="chart-description">
                {showAs === "rank"
                  ? "Read up from you: how many in every 100 people live in households with a lower income than yours."
                  : "How many people live at each household income, with yours on it."}
              </p>
            </div>
            <ChartDownloadMenu
              download={{
                chartRef: whereRef,
                name: `income-position-${showAs}-${yearLabel}`,
                exportOptions: exportOptions(whereTitle, `svg.position-${showAs === "rank" ? "rank" : "where"}`),
                csv: whereCsv,
              }}
              chartTitle={whereTitle}
            />
          </div>
          <div className="chart-controls position-segment">
            <span className="position-segment-lead">Show as</span>
            <ViewSwitch options={SHOW_AS} value={showAs} onChange={setShowAs} label="Show the distribution as" compact />
          </div>
          <Measured narrow={narrow}>
            {(width) => (
              <div ref={whereRef} role="img" aria-label={whereAlt}>
                {showAs === "rank" ? (
                  <RankView width={width} narrow={narrow} curves={curves} position={position} side={side} />
                ) : (
                  <WhereView width={width} narrow={narrow} curves={curves} position={position} side={side} decile={decile} />
                )}
              </div>
            )}
          </Measured>
          <div className="chart-footer">
            <ChartMoreInfo
              year={year}
              info={{
                how: [
                  `Your place is how many in every 100 people in the UK ${PLACE_MEANING}, in ${yearLabel}, before or after the selected policies as chosen above.`,
                  `Household income is net income after all taxes; yours is divided by ${position.factor.toFixed(2)} for your household's size, and everyone's is adjusted the same way (the modified OECD scale, before housing costs).`,
                  "Spread shows how many people live at each household income; Rank shows how many live in households with a lower income than each. Both are the same distribution, on the same axis.",
                  "Your place before ranks among everyone's income before the policies; after, among everyone's after.",
                ],
                caveats: [
                  "The curves before and after overlap almost exactly: the changes are small next to incomes.",
                  !run.exact && "The UK distribution after is the whole package's run; your own income after uses only your selection.",
                ],
                method: { anchor: METHOD_ANCHORS.incomePosition, label: "How your place in the UK is worked out" },
              }}
            />
          </div>
        </div>

        <div className="card single-year-card position-card" data-view={compareBy}>
          <div className="chart-header">
            <div>
              <h3>
                <TitleIcon name="bars" />
                <span className="title-text">{compareTitle}</span>
              </h3>
              <p className="chart-description">
                {compareBy === "tenths"
                  ? `The average change in each tenth of people by income, with yours marked: you are in the ${tenthName(decile).toLowerCase()}.`
                  : "Your change beside your tenth's average, the average UK household and the middle income."}
              </p>
            </div>
            <ChartDownloadMenu
              download={{
                chartRef: compareRef,
                name: `income-position-${compareBy}-${yearLabel}`,
                exportOptions: exportOptions(compareTitle, "svg.position-gains"),
                csv: compareCsv,
                image: compareBy === "tenths",
              }}
              chartTitle={compareTitle}
            />
          </div>
          <div className="chart-controls position-segment">
            <ViewSwitch options={COMPARE_BY} value={compareBy} onChange={setCompareBy} label="Compare by" compact />
            <ViewSwitch options={UNIT_OPTIONS.map((o) => ({ ...o, label: o.value === "pct" ? "%" : "£" }))} value={unit} onChange={setUnit} label="Units" compact />
          </div>
          <Measured narrow={narrow}>
            {(width) => (
              <div ref={compareRef} role="img" aria-label={compareAlt}>
                {compareBy === "tenths" ? (
                  percents || averages ? (
                    <GainsView width={width} narrow={narrow} unit={unit} percents={percents} averages={averages} decile={decile} ownPct={ownPct} ownChange={ownChange} grow={grow} />
                  ) : (
                    <p className="single-year-quiet">The changes by tenth are not available for this selection and year.</p>
                  )
                ) : (
                  <CompareView rows={compareRows} unit={unit} grow={grow} />
                )}
              </div>
            )}
          </Measured>
          <div className="chart-footer">
            <ChartMoreInfo
              year={year}
              info={{
                how: [
                  "Tenths rank everyone by household income adjusted for household size; each bar is the average change in that tenth.",
                  "Households like you: your change beside your tenth's average, the average UK household and the middle income.",
                ],
                caveats: ["The decile charts rank by HBAI income, without VAT and fuel duty, so the two medians differ slightly."],
                method: { anchor: METHOD_ANCHORS.incomePosition, label: "How your place in the UK is worked out" },
              }}
            />
          </div>
        </div>
      </div>
      <p className="position-link">
        <a href="?tab=dashboard&sub=all#scatter">See every household&apos;s change on All households →</a>
      </p>
    </div>
  );
}
