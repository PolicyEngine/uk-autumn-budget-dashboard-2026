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
} from "../../utils/incomePosition";
import { parseCsv } from "../../utils/publication/csv";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import useElementWidth from "../../hooks/useElementWidth";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartMoreInfo from "../ChartMoreInfo";
import PillSelect from "../PillSelect";
import TitleIcon from "../TitleIcon";
import ViewSwitch from "../ViewSwitch";
import GroupedLegend from "../GroupedLegend";
import HouseholdScatter from "../HouseholdScatter";
import { WholePanel, CloseUpPanel, closeUpWindow } from "./RankPanels";
import "./IncomePosition.css";

const BEFORE = CHART_COLOURS.before;
const AFTER = CHART_COLOURS.after;
const TEXT = CHART_COLOURS.text;
const GAIN = CHART_COLOURS.gain;
const LOSS = CHART_COLOURS.loss;
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const POSITION_VIEWS = [
  { value: "where", label: "Where you sit" },
  { value: "gains", label: "Who gains" },
  { value: "compare", label: "You vs others" },
  { value: "moves", label: "Who moves" },
  { value: "ranks", label: "Ranks" },
  { value: "among", label: "Among all households" },
];
const MOVE_UNITS = [
  { value: "percentile", label: "A percentile" },
  { value: "decile", label: "A tenth" },
];
const UNIT_OPTIONS = [
  { value: "pct", label: "% of net income" },
  { value: "gbp", label: "£ a year" },
];

// Each file is loaded once per page: every household and year reads it
const files = {};
function useFile(name, parse) {
  const [state, setState] = useState(() => files[name] ?? { status: "loading", rows: null });
  useEffect(() => {
    if (files[name]) return undefined;
    let cancelled = false;
    fetch(`${BASE}/data/${name}`)
      .then((response) => {
        if (!response.ok) throw new Error(`${name}: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        files[name] = { status: "ready", rows: parse(text) };
        if (!cancelled) setState(files[name]);
      })
      .catch((error) => {
        console.error(`Error loading ${name}:`, error);
        if (!cancelled) setState({ status: "error", rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, [name, parse]);
  return state;
}

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
    { value: median / 2, label: narrow ? "Half" : "Half the middle income" },
    { value: median, label: narrow ? "Middle" : "Middle income" },
    { value: median * 2, label: narrow ? "Twice" : "Twice the middle income" },
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
          {narrow ? `${ordinal(decile)} tenth` : `Your tenth (${ordinal(decile)})`}
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
              <strong>{missing ? "Not published" : unit === "pct" ? signedPct(v, 2) : signedPounds(v)}</strong>
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
/* Who moves: people changing place, and the shift in cut points       */
/* ------------------------------------------------------------------ */

function MovesView({ width, narrow, mobility, moveUnit, decile, cuts, grow }) {
  const left = narrow ? 44 : 56;
  const right = 12;
  const plotW = Math.max(width - left - right, 80);
  const top = 26;
  const plotH = narrow ? 170 : 200;
  const height = top + plotH + 52;
  const rows = Array.from({ length: 10 }, (_, i) => mobility?.[i + 1] ?? { up: null, down: null });
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.up ?? 0, r.down ?? 0]));
  const ticks = niceTicks(0, max).filter((t) => t > 0);
  const scale = ticks[ticks.length - 1] >= max ? ticks[ticks.length - 1] : max;
  const zeroY = top + plotH / 2;
  const y = (v) => (v / scale) * (plotH / 2) * 0.92;
  const slot = plotW / 10;
  const barW = Math.min(slot * 0.6, 48);
  const what = moveUnit === "percentile" ? "a percentile" : "a tenth";
  return (
    <div className="position-moves">
      {mobility ? (
        <svg className="position-moves-chart" width={width} height={height} aria-hidden="true">
          <text x={left} y={12} fontSize={AXIS_TITLE_STYLE.fontSize} fontWeight={AXIS_TITLE_STYLE.fontWeight} fill={AXIS_TITLE_STYLE.fill}>
            {narrow ? "% of each tenth" : `People who move up or down ${what}, % of each tenth`}
          </text>
          {ticks.flatMap((t) => [t, -t]).map((t) => (
            <g key={`t-${t}`}>
              <line x1={left} x2={left + plotW} y1={zeroY - y(t)} y2={zeroY - y(t)} stroke={GRID_PROPS.stroke} />
              <text x={left - 6} y={zeroY - y(t)} dy="0.35em" textAnchor="end" {...TICK_STYLE}>
                {`${Number(Math.abs(t).toFixed(2))}%`}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = left + slot * (i + 0.5);
            const mine = i + 1 === decile;
            return (
              <g key={i}>
                {mine && <rect x={left + slot * i + 1} y={top} width={slot - 2} height={plotH} fill={CHART_COLOURS.highlightBand} />}
                {r.up !== null && (
                  <rect x={cx - barW / 2} y={zeroY - y(r.up * grow)} width={barW} height={Math.max(y(r.up * grow), 0.5)} fill={GAIN} fillOpacity={mine ? 1 : UNSELECTED_OPACITY} />
                )}
                {r.down !== null && (
                  <rect x={cx - barW / 2} y={zeroY} width={barW} height={Math.max(y(r.down * grow), 0.5)} fill={LOSS} fillOpacity={mine ? 1 : UNSELECTED_OPACITY} />
                )}
                {r.up === null && (
                  <text x={cx} y={zeroY - 6} textAnchor="middle" fontSize={9.5} fill={CHART_COLOURS.tick}>
                    n/a
                  </text>
                )}
                <text x={cx} y={top + plotH + 16} textAnchor="middle" fontSize={11} fontWeight={mine ? 700 : 400} fill={mine ? CHART_COLOURS.highlight : CHART_COLOURS.tick}>
                  {i + 1}
                </text>
              </g>
            );
          })}
          <line x1={left} x2={left + plotW} y1={zeroY} y2={zeroY} stroke={CHART_COLOURS.zeroLine} />
          <Label x={left + 4} y={top + 12} size={11} weight={600} color={CHART_COLOURS.gainText}>
            Up
          </Label>
          <Label x={left + 4} y={top + plotH - 4} size={11} weight={600} color={CHART_COLOURS.lossText}>
            Down
          </Label>
          <text x={left} y={top + plotH + 34} fontSize={11} fill={CHART_COLOURS.tick}>
            Bottom 10%
          </text>
          <text x={left + plotW / 2} y={top + plotH + 34} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
            {narrow ? "Tenth before" : "Tenth of people by income, before the selected policies"}
          </text>
          <text x={left + plotW} y={top + plotH + 34} textAnchor="end" fontSize={11} fill={CHART_COLOURS.tick}>
            Top 10%
          </text>
        </svg>
      ) : (
        <p className="single-year-quiet">Who moves is not available for this selection and year.</p>
      )}
      <table className="position-cuts">
        <caption>Income at three points of the distribution, adjusted for household size</caption>
        <thead>
          <tr>
            <th scope="col">Point</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {cuts.map((cut) => (
            <tr key={cut.p}>
              <th scope="row">{cut.label}</th>
              <td>{formatPounds(cut.before)}</td>
              <td>{formatPounds(cut.after)}</td>
              <td>{`${signedPounds(cut.after - cut.before)} (${signedPct(((cut.after - cut.before) / cut.before) * 100, 2)})`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/**
 * Where you sit in the UK income distribution, before and after the
 * selected policies. A headline (how many in every 100 people have a lower
 * income than yours) and your result, then four views: where you sit on
 * the distribution (log income axis, before or after), who gains in each
 * tenth (% or £), you against your tenth, the UK average and the median,
 * and ranks (the percentile curve, with a close-up of your move). The
 * method is under "More info"; the CSV follows the view.
 *
 * @param {Object} props
 * @param {{ before: number, after: number }} props.net - The household's net income
 * @param {Object} props.household - The request's household (has_partner, children)
 * @param {number} props.year - The figures' year
 * @param {string[]} props.policies - The selected measures' ids
 * @param {string} props.yearLabel - "2027-28"
 * @param {Object|null} [props.you] - The household on the Population
 *   impact scatter (HouseholdScatter's `you`), for "Among all households"
 */
export default function IncomePositionChart({ net, household, year, policies, yearLabel, you = null }) {
  const narrow = useNarrowViewport();
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const [view, setView] = useState("where");
  const [side, setSide] = useState("after");
  const [unit, setUnit] = useState("pct");
  const [moveUnit, setMoveUnit] = useState("percentile");
  // "Among all households" is the scatter's own chart: its download comes
  // up from it, so the card's menu follows the view
  const [amongDownload, setAmongDownload] = useState(null);
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
  const grow = useEased(1, { key: view, from: 0 });
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
    () => (moves.status === "ready" ? mobilityOf(moves.rows, { reformId: run.reformId, year, unit: moveUnit }) : null),
    [moves, run.reformId, year, moveUnit],
  );
  const percents = useMemo(() => (relative.status === "ready" ? decilePercents(relative.rows, policies, year) : null), [relative, policies, year]);

  const width = measured > 0 ? measured : narrow ? 326 : 1060;

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
  const text = positionSummary(position, ownChange, netBefore);
  const textLine = `${text.headline} ${text.chips.map((c) => `${c.label}: ${c.value}.`).join(" ")}`;
  const decile = decileOf(position.before);
  const medianBefore = incomeAt(curves.before, 50);
  const medianChange = incomeAt(curves.after, 50) - medianBefore;
  const compareRows = [
    { key: "you", label: "Your household", gbp: ownChange, pct: ownPct, you: true },
    { key: "tenth", label: `Average in your tenth (${ordinal(decile)})`, gbp: averages?.[decile] ?? null, pct: percents?.[decile] ?? null },
    { key: "uk", label: "Average UK household", gbp: ukAverage, pct: null },
    { key: "median", label: "UK middle income, adjusted for household size", gbp: medianChange, pct: (medianChange / medianBefore) * 100 },
  ];

  const cuts = [
    { p: 10, label: narrow ? "10th" : "10th percentile" },
    { p: 50, label: narrow ? "Median" : "Median (50th)" },
    { p: 90, label: narrow ? "90th" : "90th percentile" },
  ].map((cut) => ({ ...cut, before: incomeAt(curves.before, cut.p), after: incomeAt(curves.after, cut.p) }));
  const everyone = mobility?.all ?? null;
  const viewOptions = POSITION_VIEWS;
  const chooser = narrow ? (
    <PillSelect variant="light" name="Show" prefix="Show" value={view} onChange={setView} options={viewOptions} />
  ) : (
    <ViewSwitch options={viewOptions} value={view} onChange={setView} label="Where you sit: view" compact />
  );

  const alt = {
    where: `The UK income distribution ${side} the selected policies, on a log scale, with you at ${describePosition(side === "after" ? position.after : position.before)} and in the ${ordinal(decile)} tenth. Middle income ${formatPounds(medianBefore)} before the policies.`,
    gains: `Average change by tenth of people by income, ${unit === "pct" ? "% of net income" : "£ a year"}: ${Array.from({ length: 10 }, (_, i) => `${i + 1}: ${unit === "pct" ? (percents ? signedPct(percents[i + 1], 2) : "n/a") : averages ? signedPounds(averages[i + 1]) : "n/a"}`).join(", ")}. You, in the ${ordinal(decile)} tenth: ${unit === "pct" ? signedPct(ownPct, 2) : signedPounds(ownChange)}.`,
    compare: compareRows.map((r) => `${r.label}: ${r.gbp !== null ? signedPounds(r.gbp) : "not published"}${r.pct !== null ? ` (${signedPct(r.pct, 2)})` : ""}`).join("; "),
    ranks: `Your rank: ${describePosition(position.before)} before the selected policies, ${describePosition(position.after)} after.`,
    among: "UK households by baseline household net income in 2027-28 and the change in it from the selected policies, with your household marked.",
    moves: `${everyone ? `${everyone.up !== null ? `${everyone.up.toFixed(1)}%` : "Not published"} of people move up ${moveUnit === "percentile" ? "a percentile" : "a tenth"} and ${everyone.down !== null ? `${everyone.down.toFixed(1)}%` : "not published"} move down. ` : ""}${cuts.map((c) => `${c.label}: ${formatPounds(c.before)} before, ${formatPounds(c.after)} after`).join("; ")}.`,
  }[view];

  const csvFor = {
    where: () => {
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
    },
    gains: () =>
      buildChartCsv({
        title: `Average change by tenth of people by income, ${yearLabel}`,
        units: "% of net income and £ a year per household",
        columns: [
          { key: "tenth", label: "Tenth (1 = bottom 10%)", decimals: 0 },
          { key: "pct", label: "Average change (% of net income)", decimals: 3 },
          { key: "gbp", label: "Average change (£ a year)", decimals: 2 },
        ],
        rows: Array.from({ length: 10 }, (_, i) => ({ tenth: i + 1, pct: percents?.[i + 1], gbp: averages?.[i + 1] })),
        notes: [`Your household: tenth ${decile}, ${signedPct(ownPct, 2)}, ${signedPounds(ownChange)} a year`],
      }),
    compare: () =>
      buildChartCsv({
        title: `You and others, ${yearLabel}`,
        units: "£ a year and % of net income",
        columns: [
          { key: "label", label: "Who" },
          { key: "gbp", label: "Change (£ a year)", decimals: 2 },
          { key: "pct", label: "Change (% of net income)", decimals: 3 },
        ],
        rows: compareRows,
      }),
    moves: () =>
      buildChartCsv({
        title: `People who move up or down ${moveUnit === "percentile" ? "a percentile" : "a tenth"}, by tenth before the selected policies, ${yearLabel}`,
        units: "% of people in each tenth; blank where too few survey households move to publish",
        columns: [
          { key: "tenth", label: "Tenth before (1 = bottom 10%)" },
          { key: "up", label: "Move up (%)", decimals: 3 },
          { key: "down", label: "Move down (%)", decimals: 3 },
        ],
        rows: [...Array.from({ length: 10 }, (_, i) => String(i + 1)), "all"].map((k) => ({ tenth: k, up: mobility?.[k]?.up ?? null, down: mobility?.[k]?.down ?? null })),
        notes: cuts.map((c) => `${c.label}: ${Math.round(c.before)} before, ${Math.round(c.after)} after (£ a year, adjusted for household size)`),
      }),
    ranks: () =>
      buildChartCsv({
        title: `UK income distribution by percentile before and after the selected policies, ${yearLabel}`,
        units: "£ a year, income adjusted for household size (HBAI modified OECD scale)",
        columns: [
          { key: "percentile", label: "Percentile", decimals: 0 },
          { key: "before", label: "Before the selected policies (£)", decimals: 0 },
          { key: "after", label: "After the selected policies (£)", decimals: 0 },
        ],
        rows: curves.before.map((point) => ({ percentile: point.percentile, before: point.income, after: incomeAt(curves.after, point.percentile) })),
      }),
  };
  const download = view === "among" ? amongDownload : {
    chartRef,
    name: `income-position-${view}-${yearLabel}`,
    exportOptions: {
      title: `${title}: ${POSITION_VIEWS.find((v) => v.value === view).label.toLowerCase()}`,
      description: textLine,
      legendItems: [],
      logo: CHART_LOGO,
      svgSelector: `svg.position-${view === "ranks" ? "whole" : view === "moves" ? "moves-chart" : view}`,
      reservedLegendHeight: 0,
    },
    csv: csvFor[view],
    image: view !== "compare",
  };

  const inRange = position.exactChange !== null;
  const stacked = width < 640;
  const wholeW = inRange && !stacked ? Math.round((width - 20) * 0.6) : width;
  const closeW = inRange ? (stacked ? width : width - 20 - wholeW) : 0;

  return (
    <div className="card single-year-card position-card" data-view={view}>
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="users" />
            <span className="title-text">{title}</span>
          </h3>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={title}
          disabledReason={download ? undefined : "Available when results are published"}
        />
      </div>
      <p className="position-headline">{text.headline}</p>
      <dl className="position-chips">
        {text.chips.map((chip) => (
          <div key={chip.key} className={`position-chip is-${chip.key}`}>
            <dt>{chip.label}</dt>
            <dd>{chip.value}</dd>
          </div>
        ))}
      </dl>
      <div className="chart-view-switch chart-controls position-controls">
        {chooser}
        {view === "where" && (
          <ViewSwitch
            compact
            label="Before or after the selected policies"
            value={side}
            onChange={setSide}
            options={[
              { value: "before", label: "Before" },
              { value: "after", label: "After" },
            ]}
          />
        )}
        {view === "moves" && <ViewSwitch compact label="Moving by" value={moveUnit} onChange={setMoveUnit} options={MOVE_UNITS} />}
        {(view === "gains" || view === "compare") && (
          <ViewSwitch compact label="Units" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
        )}
      </div>
      {view === "among" && (
        <div className="position-among">
          <HouseholdScatter
            selectedPolicies={policies}
            policies={POLICIES}
            selectedYear={year}
            you={you}
            title="Your household among all UK households"
            embedded
            onDownload={setAmongDownload}
          />
        </div>
      )}
      <div ref={wrapperRef} className="chart-plot position-plot" hidden={view === "among" || undefined}>
        <div ref={chartRef} role="img" aria-label={alt}>
          {view === "where" && <WhereView width={width} narrow={narrow} curves={curves} position={position} side={side} decile={decile} />}
          {view === "gains" &&
            (percents || averages ? (
              <GainsView width={width} narrow={narrow} unit={unit} percents={percents} averages={averages} decile={decile} ownPct={ownPct} ownChange={ownChange} grow={grow} />
            ) : (
              <p className="single-year-quiet">The changes by tenth are not available for this selection and year.</p>
            ))}
          {view === "compare" && <CompareView rows={compareRows} unit={unit} grow={grow} />}
          {view === "moves" && (
            <>
              {everyone && (
                <p className="position-moves-lead">
                  {`${everyone.up !== null ? `${everyone.up.toFixed(1)}%` : "Too few to publish"} of people move up ${moveUnit === "percentile" ? "at least a percentile" : "at least a tenth"}; ${everyone.down !== null ? `${everyone.down.toFixed(1)}%` : "too few to publish"} move down.`}
                </p>
              )}
              <MovesView width={width} narrow={narrow} mobility={mobility} moveUnit={moveUnit} decile={decile} cuts={cuts} grow={grow} />
            </>
          )}
          {view === "ranks" && (
            <>
              <div className={`position-panels ${stacked ? "is-stacked" : ""}`}>
                <WholePanel width={wholeW} height={narrow ? 240 : 280} before={curves.before} after={curves.after} position={position} windowBox={null} />
                {inRange && (
                  <CloseUpPanel width={closeW} height={narrow ? 240 : 280} before={curves.before} after={curves.after} position={position} window={closeUpWindow(position)} />
                )}
              </div>
              <div className="position-legend">
                <GroupedLegend
                  items={[
                    { label: "Before the selected policies", color: BEFORE, type: "line", dash: BEFORE_DASH },
                    { label: "After the selected policies", color: AFTER, type: "line" },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {view === "where" && (
        <p className="position-note">The curves before and after overlap almost exactly: the changes are small next to incomes. Switch Before and After to compare, or see Who gains.</p>
      )}
      <div className="chart-footer">
        <ChartMoreInfo year={year}>
          <p>
            {`Income is household net income as this calculator counts it (after taxes, including fuel duty and VAT, with benefits), divided by ${position.factor.toFixed(2)} for your household's size on the HBAI scale. Public spending in kind (the NHS, schools, transport subsidies) is left out for everyone. Unlike the HBAI income behind the decile charts and the OBR forecast tab's median, it takes off fuel duty and VAT, so the two medians differ slightly.`}
          </p>
          <p>
            {"Everyone's income changes too, so your place before is ranked among everyone's income before the selected policies, and your place after among everyone's income after them."}
          </p>
          <p>
            {`The UK distribution is published from the ${ordinal(LOWEST_PERCENTILE)} to the ${ordinal(HIGHEST_PERCENTILE)} percentile, as averages over bands one percentile wide; the lowest and highest 1% are not drawn.`}
          </p>
          <p>
            {"The tenths' average changes are the decile charts' own: they rank households by HBAI income, which leaves out fuel duty and VAT, so a household near a boundary may sit in the next tenth there. The average UK household's change has no published % of net income."}
          </p>
          <p>
            {"Who moves ranks everyone before and after the selected policies: a person moves up when the whole percentile (or tenth) of their rank is higher after than before. A share drawn from fewer than 10 survey households is not published."}
          </p>
          <p>
            {"Among all households is the Population impact scatter: there each household sits by its household net income before the selected policies in 2027-28, not adjusted for household size, in every year, and you by yours. Each dot is a group of households, never one survey household."}
          </p>
          {!run.exact && (
            <p>
              {"The UK distribution after is the whole package's run, with measures beyond those selected (or, after one is withdrawn, no longer published); your own income after uses only the measures you selected."}
            </p>
          )}
        </ChartMoreInfo>
      </div>
    </div>
  );
}
