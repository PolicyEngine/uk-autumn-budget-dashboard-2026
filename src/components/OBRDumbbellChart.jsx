import { useState } from "react";
import { useNarrowViewport, TICK_STYLE, CHART_COLOURS, ROW_RADIUS, approxTextWidth, fitTicks } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import useElementWidth from "../hooks/useElementWidth";
import { SvgMeasureLabel, SVG_LABEL_INDENT } from "./MeasureRowLabel";
import { formatBnOrM, formatSignedBnOrM, shownBn } from "../utils/moneyFormat";
import { BASIS_LABEL, basisLabel, basisWords } from "../utils/officialBasis";
import "./OBRDumbbellChart.css";

/**
 * PolicyEngine's estimates beside the official costings for one fiscal
 * year, as a dumbbell chart: one row per measure (in the order given: the
 * card sorts by the size of the official costing), a solid teal dot for
 * PolicyEngine, a hollow grey ring (a little larger) for the official
 * costing, and a neutral line between them. A column on the right gives
 * the difference, PolicyEngine minus official, in £bn. Where the two
 * round to the same figure, the dot sits inside the ring and one label
 * reads "£0.4bn, same"; where they round equal to £0.1bn but not to
 * £0.01bn, the row takes two decimals (−£0.53bn vs −£0.55bn, a difference
 * of −£0.02bn), so visibly apart dots never read "same".
 *
 * Every second row sits on a faint band (--c-row-band), and the hovered or
 * focused row's band is stronger (--c-hover) with its name and difference
 * in bold, so a row's dots and difference read with its name. The bands
 * are drawn under the gridlines, the zero line and the dots.
 *
 * Scale "bn" plots £bn; scale "pct" plots each estimate as a % of its
 * official costing (the ring at 100%), so small measures are not squashed
 * beside large ones. An official costing under £0.05bn has no % and its
 * row says so.
 *
 * `rows`: comparisonRows() of OBRComparisonTable.jsx, { id, name, pe, obr,
 * obrStatic, obrBehavioural, peOfficial } with null for a missing figure.
 *
 * A third mark, a small teal ring, is our estimate on the official
 * costing's basis (`peOfficial`, #297): the change in just the taxes and
 * benefits the official costing covers, where it covers fewer than our net
 * figure. It sits inside the official ring when the two agree. Only rows
 * whose measure has an official basis carry it; the others keep two marks.
 * Its label names what it counts ("Ours, income tax only":
 * utils/officialBasis.js), since an official figure can hold more than
 * taxes and benefits, such as a block grant.
 */

export const PE_COLOUR = CHART_COLOURS.gain;
export const OBR_COLOUR = CHART_COLOURS.obr;
// The line between the two marks: neutral, it carries no judgement
export const GAP_COLOUR = CHART_COLOURS.axis;
const PE_LABEL_COLOUR = CHART_COLOURS.gainText;
const OBR_LABEL_COLOUR = CHART_COLOURS.obrText;
const ZERO_LINE = CHART_COLOURS.zeroLine;
const GRID = CHART_COLOURS.grid;
const NAME_COLOUR = CHART_COLOURS.zeroLine;
const SAME_LABEL_COLOUR = CHART_COLOURS.zeroLine;
// The PolicyEngine dot sits inside the official ring when the two coincide
export const PE_RADIUS = 5;
export const OBR_RADIUS = 8;
// The ring on the official costing's basis: small enough to sit inside the
// official ring when the two agree
export const BASIS_RADIUS = 4;
// The row band's inset: the name and the difference sit this far in from its ends
const BAND_PAD = 8;
// Under this the official costing has no meaningful % (and none at zero)
export const MIN_PCT_BASE = 0.05;
// An outline in the row's background so labels stay legible where they
// cross a gridline
const halo = (background) => ({
  stroke: background,
  strokeWidth: 4,
  strokeLinejoin: "round",
  paintOrder: "stroke",
});

const MINUS = "−";
const isValue = (value) => typeof value === "number" && Number.isFinite(value);


/** −£3.1bn, or −£30m under £1bn (to the nearest £5m), £0 for a real zero (moneyFormat.js). */
export function formatBn(value, decimals = 1) {
  return formatBnOrM(value, decimals);
}

/** +£0.3bn / −£25m / £0: a difference, always signed. */
export function formatDifference(value, decimals = 1) {
  return formatSignedBnOrM(value, decimals);
}

/**
 * A row's precision: one decimal, or two where the two figures round equal
 * to £0.1bn but not to £0.01bn (−£0.53bn vs −£0.55bn, never "−£0.5bn,
 * same" beside dots that are visibly apart).
 */
export function rowDecimals(pe, obr) {
  if (!isValue(pe) || !isValue(obr)) return 1;
  return formatBn(pe) === formatBn(obr) && formatBn(pe, 2) !== formatBn(obr, 2) ? 2 : 1;
}

/**
 * The difference a reader can check against the labels: PolicyEngine minus
 * official, each rounded to the shown precision first (−£6.2bn vs −£6.5bn
 * is +£0.3bn, never +£0.4bn). Null without both figures. Downloads keep the
 * raw one.
 */
export function shownDifference(pe, obr, decimals = 1) {
  if (!isValue(pe) || !isValue(obr)) return null;
  // Each as its label shows it (£5m steps under £1bn), to the nearest £1m
  return Math.round((shownBn(pe, decimals) - shownBn(obr, decimals)) * 1000) / 1000;
}

/** PolicyEngine's estimate as a % of the official costing, or null. */
export function pctOfOfficial(pe, obr) {
  if (!isValue(pe) || !isValue(obr) || Math.abs(obr) < MIN_PCT_BASE) return null;
  return (pe / obr) * 100;
}

// A row's figure on the official costing's basis, for its spoken summary,
// named by what it counts: beside our own figure only
const basisText = (row, decimals) =>
  isValue(row.pe) && isValue(row.peOfficial) ? ` (${basisWords(row.id)} only: ${formatBn(row.peOfficial, decimals)})` : "";

/**
 * Whether the chart draws a ring on the official costing's basis on any
 * row, on `scale`: beside our own dot, in a year the measure is in force,
 * and on the % scale only where the official costing has a %.
 */
export function drawsBasis(rows, scale = "bn") {
  return rows.some(
    (row) =>
      !row.status &&
      // Never without our dot, as the row's own ring (basisPart)
      isValue(row.pe) &&
      isValue(row.peOfficial) &&
      (scale !== "pct" || (pctOfOfficial(row.pe, row.obr) !== null && pctOfOfficial(row.peOfficial, row.obr) !== null)),
  );
}

function formatTick(value, scale) {
  const rounded = Math.round(value * 100) / 100;
  if (scale === "pct") return `${rounded < 0 ? MINUS : ""}${Math.abs(rounded)}%`;
  if (rounded === 0) return "£0";
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}£${Math.abs(rounded)}bn`;
}

/** The official figure the basis asks for, falling back to the other one. */
export function obrValue(yearData, showBehavioural) {
  const primary = showBehavioural ? yearData?.obr_behavioural : yearData?.obr_static;
  const other = showBehavioural ? yearData?.obr_static : yearData?.obr_behavioural;
  if (isValue(primary)) return primary;
  return isValue(other) ? other : null;
}

/** Ticks with a 1/2/5 step, always including zero. */
function niceScale(lo, hi, targetTicks) {
  const span = Math.max(hi - lo, 0.5);
  const raw = span / Math.max(targetTicks - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { min, max, ticks };
}

const approxWidth = approxTextWidth;

/**
 * The chart's legend entries, for the image downloads too: the ring on the
 * official costing's basis only where a row shows one (`withBasis`), under
 * the label that serves every row.
 */
export function dumbbellLegendItems(obrKind, withBasis = false) {
  return [
    { color: PE_COLOUR, label: "Ours (static)", type: "dot" },
    ...(withBasis ? [{ color: PE_COLOUR, label: `${BASIS_LABEL} (static)`, type: "ring" }] : []),
    { color: OBR_COLOUR, label: `Official costing (${obrKind})`, type: "ring" },
  ];
}

function OBRDumbbellChart({ rows, yearLabel, obrKind = "static", scale = "bn", chartRef, tooltipKey, selectedId = null, onSelect, showLogo = true }) {
  const [wrapperRef, measuredWidth] = useElementWidth();
  const narrow = useNarrowViewport();
  // Until the plot is measured, a typical width for the screen
  const width = measuredWidth > 0 ? measuredWidth : narrow ? 358 : 800;
  // Cleared when the year, basis or scale changes
  const { tip, handlers } = useFloatingTooltip(wrapperRef, `${tooltipKey}-${scale}`);
  // The hovered or focused row, whose band is stronger
  const [active, setActive] = useState(null);
  const rowHandlers = (id, content) => {
    const base = handlers(id, content);
    return {
      ...base,
      onMouseEnter: (event) => {
        setActive(id);
        base.onMouseEnter(event);
      },
      onMouseLeave: () => {
        setActive(null);
        base.onMouseLeave();
      },
      onFocus: (event) => {
        setActive(id);
        onSelect?.(id);
        base.onFocus(event);
      },
      // A row is a button: a click or Enter selects it for the panel, and
      // the up and down arrows move between rows
      onClick: () => onSelect?.(id),
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(id);
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const all = [...(event.currentTarget.ownerSVGElement?.querySelectorAll(".obr-dumbbell-row") ?? [])];
        const next = all[all.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
        next?.focus();
      },
      onBlur: () => {
        setActive(null);
        base.onBlur();
      },
    };
  };
  // A row's background: its band, the hover band, or the card
  // The selected row (whose policy the panel explains) a stronger tint than
  // a hovered one, with an accent bar at its left edge
  const rowBackground = (row, index) =>
    selectedId === row.id ? CHART_COLOURS.highlightBand : active === row.id ? CHART_COLOURS.hover : index % 2 === 0 ? CHART_COLOURS.rowBand : CHART_COLOURS.surface;
  const pct = scale === "pct";

  // Where each mark sits: £bn, or % of the official costing
  const plotted = rows.map((row) => {
    // Not in force this year on either side: no marks, the row says why
    if (row.status) return { ...row, xPe: null, xObr: null, xBasis: null, extent: [] };
    if (!pct) {
      return {
        ...row,
        xPe: row.pe,
        xObr: row.obr,
        xBasis: isValue(row.peOfficial) ? row.peOfficial : null,
        // The ring only widens the axis where it is drawn, beside our dot
        extent: [row.pe, row.obrStatic, row.obrBehavioural, isValue(row.pe) ? row.peOfficial : null].filter(isValue),
      };
    }
    const share = pctOfOfficial(row.pe, row.obr);
    const basisShare = share === null ? null : pctOfOfficial(row.peOfficial, row.obr);
    const noBase = isValue(row.obr) && Math.abs(row.obr) < MIN_PCT_BASE;
    return {
      ...row,
      noBase,
      xPe: share,
      xObr: share === null ? null : 100,
      xBasis: basisShare,
      extent: share === null ? [] : [share, 100, basisShare].filter(isValue),
    };
  });
  const hasData = rows.some((row) => row.pe !== null || row.obr !== null);
  const withBasis = drawsBasis(rows, scale);

  // Layout
  const fontSize = narrow ? 12 : 13;
  const labelGap = OBR_RADIUS + 5;
  const labelRoom = narrow ? 54 : 62;
  // The difference column at the right (on a phone, on the name line)
  // A chevron at the right of each row when rows select a policy
  // (not on a phone, where the panel is below and the difference shares
  // the name's line: the room goes to the labels)
  const chevron = onSelect && !narrow ? 14 : 0;
  const diffWidth = narrow ? 0 : 84 + BAND_PAD + chevron;
  const nameWidth = narrow
    ? 0
    : Math.min(Math.max(...rows.map((row) => approxWidth(row.name, fontSize)), 80) + 16 + BAND_PAD + SVG_LABEL_INDENT.full, width * 0.38);
  const rowHeight = narrow ? 50 : 36;
  const top = 24;
  const axisHeight = 26;
  const height = top + rows.length * rowHeight + axisHeight;
  const plotLeft = nameWidth + labelRoom;
  const plotRight = Math.max(width - diffWidth - labelRoom, plotLeft + 40);

  const values = plotted.flatMap((row) => row.extent);
  // £bn: always from zero; %: around 100%, so the gaps are not squeezed
  const roundAxis = niceScale(
    pct ? Math.min(100, ...values) : Math.min(0, ...values),
    Math.max(pct ? 100 : 0, ...values),
    narrow ? 4 : 6,
  );
  // Only the ticks whose labels fit the plot (always £0, or 100%)
  const axis = {
    ...roundAxis,
    ticks: fitTicks(roundAxis.ticks, [roundAxis.min, roundAxis.max], plotRight - plotLeft, (tick) => formatTick(tick, scale), {
      fontSize: narrow ? 11 : TICK_STYLE.fontSize,
      keep: pct ? 100 : 0,
    }),
  };
  const x = (value) => plotLeft + ((value - axis.min) / (axis.max - axis.min || 1)) * (plotRight - plotLeft);
  const dotY = (index) => top + index * rowHeight + (narrow ? 35 : rowHeight / 2);

  // A backing in the row's background so a gridline or the zero line never
  // runs through a label
  const backing = (left, cy, w, background) => (
    <rect x={left - 2} y={cy - 8} width={w + 4} height={16} fill={background} />
  );
  const fits = (text, side, cx) => {
    const w = approxWidth(text, 12);
    return side === "left" ? cx - labelGap - w >= nameWidth : cx + labelGap + w <= width - diffWidth;
  };

  const valueLabel = (text, side, cx, cy, colour, key, background) => {
    const tx = side === "left" ? cx - labelGap : cx + labelGap;
    const w = approxWidth(text, 12);
    if (!fits(text, side, cx)) return null;
    // Drawn at the origin and moved by a transform, so a change of year
    // slides the label with its dot (OBRDumbbellChart.css)
    return (
      <g key={key} className="obr-dumbbell-move" style={{ transform: `translate(${tx}px, ${cy}px)` }}>
        {backing(side === "left" ? -w : 0, 0, w, background)}
        <text
          className="obr-dumbbell-value"
          x={0}
          y={0}
          dy="0.35em"
          {...halo(background)}
          textAnchor={side === "left" ? "end" : "start"}
          fill={colour}
          fontSize={12}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {text}
        </text>
      </g>
    );
  };

  const missingLabel = (text, side, cx, cy, key) => (
    <text
      key={key}
      className="obr-dumbbell-missing"
      x={side === "left" ? cx - labelGap : cx + labelGap}
      y={cy}
      dy="0.35em"
      textAnchor={side === "left" ? "end" : "start"}
      fill={OBR_LABEL_COLOUR}
      fontSize={12}
      fontStyle="italic"
    >
      {text}
    </text>
  );

  const renderRow = (row, index) => {
    const cy = dotY(index);
    const nameY = narrow ? top + index * rowHeight + 14 : cy;
    const parts = [];
    const pePart = row.xPe !== null && row.xPe !== undefined;
    const obrPart = row.xObr !== null && row.xObr !== undefined;
    // On the official costing's basis: drawn only beside our own dot
    const basisPart = pePart && isValue(row.xBasis);
    const centre = (plotLeft + plotRight) / 2;
    const decimals = rowDecimals(row.pe, row.obr);
    const difference = shownDifference(row.pe, row.obr, decimals);
    const background = rowBackground(row, index);
    const bn = (value) => formatBn(value, decimals);
    const differenceText = row.status ? "" : difference === null ? "—" : formatDifference(difference, decimals);

    if (row.status) {
      parts.push(missingLabel(row.status, "right", plotLeft - labelGap, cy, "status"));
    } else if (pePart && obrPart) {
      const xPe = x(row.xPe);
      const xObr = x(row.xObr);
      // A unit line moved and stretched by a transform, so it slides with
      // the dots; the stroke keeps its width (non-scaling-stroke)
      parts.push(
        <line
          key="gap"
          className="obr-dumbbell-gap obr-dumbbell-move"
          x1={0}
          x2={1}
          y1={0}
          y2={0}
          style={{ transform: `translate(${Math.min(xPe, xObr)}px, ${cy}px) scaleX(${Math.max(Math.abs(xObr - xPe), 0.001)})` }}
          vectorEffect="non-scaling-stroke"
          stroke={GAP_COLOUR}
          strokeWidth={3}
          strokeLinecap="round"
        />,
      );
      const peLeft = row.xPe < row.xObr || (row.xPe === row.xObr && row.xPe < 0);
      if (bn(row.pe) === bn(row.obr)) {
        // The same at the row's precision: one label for both, on the outer side
        const text = `${formatBn(row.pe)}, same`;
        const cx = (xPe + xObr) / 2;
        const outer = row.xPe < 0 ? "left" : "right";
        const side = fits(text, outer, cx) ? outer : outer === "left" ? "right" : "left";
        parts.push(
          valueLabel(text, side, side === "left" ? Math.min(xPe, xObr) : Math.max(xPe, xObr), cy, SAME_LABEL_COLOUR, "same-label", background),
        );
      } else {
        parts.push(
          valueLabel(bn(row.pe), peLeft ? "left" : "right", xPe, cy, PE_LABEL_COLOUR, "pe-label", background),
          valueLabel(bn(row.obr), peLeft ? "right" : "left", xObr, cy, OBR_LABEL_COLOUR, "obr-label", background),
        );
      }
    } else if (pct && row.noBase) {
      parts.push(missingLabel(`Official costing ${formatBn(row.obr)}: no % to show`, "right", plotLeft - labelGap, cy, "missing"));
    } else if (pePart || obrPart) {
      const value = pePart ? row.xPe : row.xObr;
      const cx = x(value);
      const valueText = formatBn(pePart ? row.pe : row.obr);
      const missingText = pePart ? (row.notComparable ? "Not comparable" : "Not in the official costings") : "Ours not yet published";
      // The figure on the side with more room, the words on the other;
      // where the words would run past the chart's edge (a phone), the two
      // swap sides, so "Not comparable" is never cut off
      const room = (side, text) =>
        side === "right" ? cx + labelGap + approxWidth(text, 12) <= width - BAND_PAD - diffWidth : cx - labelGap - approxWidth(text, 12) >= 0;
      let labelSide = cx > centre ? "left" : "right";
      let otherSide = labelSide === "left" ? "right" : "left";
      if (!room(otherSide, missingText) && room(labelSide, missingText) && room(otherSide, valueText)) {
        [labelSide, otherSide] = [otherSide, labelSide];
      }
      parts.push(
        valueLabel(valueText, labelSide, cx, cy, pePart ? PE_LABEL_COLOUR : OBR_LABEL_COLOUR, "label", background),
        missingLabel(missingText, otherSide, cx + (otherSide === "right" ? 2 : -2), cy, "missing"),
      );
    } else {
      parts.push(missingLabel(pct && isValue(row.pe) ? (row.notComparable ? "Not comparable" : "Not in the official costings") : "Not yet published", "right", plotLeft - labelGap, cy, "missing"));
    }

    // A disc in the row's background behind the ring keeps lines out of it;
    // the teal dot goes over the disc and the ring over both, so neither
    // hides the other
    if (obrPart) {
      parts.push(<circle key="obr-backing" className="obr-dumbbell-dot-move" cx={x(row.xObr)} cy={cy} r={OBR_RADIUS} fill={background} />);
    }
    // The basis ring's own disc keeps the gap line out of it; our dot goes
    // over the disc, so where the two coincide the dot shows whole
    if (basisPart) {
      parts.push(<circle key="basis-backing" className="obr-dumbbell-dot-move" cx={x(row.xBasis)} cy={cy} r={BASIS_RADIUS + 1} fill={background} />);
    }
    if (pePart) {
      parts.push(<circle key="pe" className="obr-dumbbell-dot pe obr-dumbbell-dot-move" cx={x(row.xPe)} cy={cy} r={PE_RADIUS} fill={PE_COLOUR} />);
    }
    if (basisPart) {
      parts.push(
        <circle
          key="basis"
          className="obr-dumbbell-dot basis obr-dumbbell-dot-move"
          cx={x(row.xBasis)}
          cy={cy}
          r={BASIS_RADIUS}
          fill="none"
          stroke={PE_COLOUR}
          strokeWidth={2}
        />,
      );
    }
    if (obrPart) {
      parts.push(
        <circle
          key="obr"
          className="obr-dumbbell-dot obr obr-dumbbell-dot-move"
          cx={x(row.xObr)}
          cy={cy}
          r={OBR_RADIUS - 1}
          fill="none"
          stroke={OBR_COLOUR}
          strokeWidth={2}
        />,
      );
    }

    const share = pctOfOfficial(row.pe, row.obr);
    // The figures only: what each side counts and why they differ are in
    // the panel beside the chart, so the tip stays the width of its card
    const tooltip = (
      <TooltipRows
        label={`${row.name}, ${yearLabel}`}
        note={onSelect ? "Click for why they differ" : undefined}
        rows={[
          { key: "pe", name: "Ours (static)", text: isValue(row.pe) ? bn(row.pe) : "Not yet published", color: PE_COLOUR },
          ...(isValue(row.pe) && isValue(row.peOfficial) ? [{ key: "basis", name: `${basisLabel(row.id)} (static)`, text: bn(row.peOfficial), color: PE_COLOUR }] : []),
          { key: "obr", name: `Official costing (${obrKind})`, text: isValue(row.obr) ? bn(row.obr) : row.notComparable ? "Not comparable" : "Not in the official costings", color: OBR_COLOUR },
          ...(difference !== null
            ? [{ key: "difference", name: "Difference (ours − official)", text: formatDifference(difference, decimals), color: GAP_COLOUR }]
            : []),
          ...(share !== null ? [{ key: "share", name: "Ours as % of official", text: `${Math.round(share)}%`, color: GAP_COLOUR }] : []),
        ]}
      />
    );
    const summary = row.status
      ? `${row.name}: ${row.status}`
      : `${row.name}: ours ${isValue(row.pe) ? bn(row.pe) : "not yet published"}${basisText(row, decimals)}, official ${isValue(row.obr) ? bn(row.obr) : row.notComparable ? "not comparable" : "none"}`;

    return (
      <g
        key={row.id}
        className={`obr-dumbbell-row has-tooltip${active === row.id ? " is-active" : ""}${selectedId === row.id ? " is-selected" : ""}`}
        data-policy={row.id}
        tabIndex={0}
        role="button"
        aria-pressed={selectedId === row.id}
        aria-label={`${summary}, ${yearLabel}`}
        {...rowHandlers(row.id, tooltip)}
      >
        {/* The whole row answers the pointer, not just its dots */}
        <rect className="obr-dumbbell-hit" x={1} y={top + index * rowHeight + 1} width={width - 2} height={rowHeight - 2} rx={ROW_RADIUS} fill="transparent" />
        {narrow && backing(BAND_PAD, nameY, approxWidth(row.name, fontSize) + SVG_LABEL_INDENT.full, background)}
        {/* The shared measure label (MeasureRowLabel), drawn in the SVG so
            the downloaded image keeps it */}
        <g className="obr-dumbbell-name">
          <SvgMeasureLabel
            measure={row.measure ?? { id: row.id, name: row.name }}
            name={row.name}
            x={BAND_PAD}
            y={nameY}
            fontSize={fontSize}
            textProps={halo(background)}
            nameColour={NAME_COLOUR}
            captionColour={TICK_STYLE.fill}
          />
        </g>
        {parts}
        {/* On a phone the difference shares the name's line, where the zero
            line can run: a backing in the row's background keeps it clear */}
        {narrow && backing(width - BAND_PAD - chevron - approxWidth(differenceText, 12) - 2, nameY, approxWidth(differenceText, 12) + 2, background)}
        {/* The chevron: in the accent once the row is selected, pointing
            at the panel */}
        {chevron > 0 && !row.status && (
          <text
            className={`obr-dumbbell-chevron${selectedId === row.id ? " is-selected" : ""}`}
            x={width - BAND_PAD - 3}
            y={narrow ? nameY : cy}
            dy="0.35em"
            textAnchor="middle"
            fill={selectedId === row.id ? PE_COLOUR : TICK_STYLE.fill}
            fontSize={16}
            fontWeight={selectedId === row.id ? 700 : 400}
            aria-hidden="true"
            data-export="skip"
          >
            ›
          </text>
        )}
        <text
          className="obr-dumbbell-difference"
          x={width - BAND_PAD - chevron}
          y={narrow ? nameY : cy}
          dy="0.35em"
          textAnchor="end"
          fill={CHART_COLOURS.text}
          fontSize={12}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {differenceText}
        </text>
      </g>
    );
  };

  const plotBottom = top + rows.length * rowHeight;

  return (
    <div className="obr-dumbbell">
      <div ref={wrapperRef} className="obr-dumbbell-plot" style={{ position: "relative" }}>
        {hasData ? (
          <div ref={chartRef}>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${rows
                .map((row) => {
                  if (row.status) return `${row.name}: ${row.status}`;
                  const decimals = rowDecimals(row.pe, row.obr);
                  return `${row.name}: ours ${isValue(row.pe) ? formatBn(row.pe, decimals) : "not yet published"}${basisText(row, decimals)}, official ${isValue(row.obr) ? formatBn(row.obr, decimals) : row.notComparable ? "not comparable" : "none"}`;
                })
                .join("; ")}.`}
              style={{ fontFamily: "inherit", display: "block" }}
            >
              {/* The difference column's heading */}
              <text className="obr-dumbbell-column-head" x={width - BAND_PAD - chevron} y={10} textAnchor="end" fill={TICK_STYLE.fill} fontSize={11}>
                Difference
              </text>
              {onSelect && (
                <text className="obr-dumbbell-hint" data-export="skip" x={BAND_PAD} y={10} fill={TICK_STYLE.fill} fontSize={11}>
                  Select a policy to see why it differs
                </text>
              )}
              {pct && (
                <text x={x(100)} y={10} textAnchor="middle" fill={TICK_STYLE.fill} fontSize={11}>
                  Official costing = 100%
                </text>
              )}
              {/* The row bands, under the gridlines, the zero line and the
                  dots: every second row, and the hovered or focused one */}
              <g className="obr-dumbbell-bands" aria-hidden="true">
                {/* Every row's band drawn (white where unbanded), so a
                    change of selection fades the tints rather than
                    swapping shapes in and out */}
                {plotted.map((row, index) => {
                  const fill = rowBackground(row, index);
                  const selected = selectedId === row.id;
                  return (
                    <rect
                      key={row.id}
                      className={`obr-dumbbell-band${active === row.id || selected ? " is-active" : ""}${selected ? " is-selected" : ""}`}
                      x={0}
                      y={top + index * rowHeight + 1}
                      width={width}
                      height={rowHeight - 2}
                      rx={ROW_RADIUS}
                      fill={fill}
                    />
                  );
                })}
                {/* One accent bar, slid to the selected row */}
                {(() => {
                  const index = plotted.findIndex((row) => row.id === selectedId);
                  return index < 0 ? null : (
                    <rect
                      className="obr-dumbbell-accent"
                      data-export="skip"
                      x={0}
                      y={0}
                      width={3}
                      height={rowHeight - 2}
                      fill={PE_COLOUR}
                      style={{ transform: `translateY(${top + index * rowHeight + 1}px)` }}
                    />
                  );
                })()}
              </g>
              {axis.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={x(tick)}
                    x2={x(tick)}
                    y1={top}
                    y2={plotBottom}
                    stroke={tick === 0 || (pct && tick === 100) ? ZERO_LINE : GRID}
                    strokeWidth={1}
                    strokeDasharray={pct && tick === 100 ? "3 3" : undefined}
                  />
                  <text
                    x={x(tick)}
                    y={plotBottom + 17}
                    textAnchor="middle"
                    fill={TICK_STYLE.fill}
                    fontSize={narrow ? 11 : TICK_STYLE.fontSize}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatTick(tick, scale)}
                  </text>
                </g>
              ))}
              {plotted.map(renderRow)}
            </svg>
          </div>
        ) : (
          <p className="obr-dumbbell-empty">Not yet published</p>
        )}
        {hasData && <FloatingTooltip tip={tip} />}
      </div>

      {hasData && (
        <div className="obr-dumbbell-footer">
          <ul className="obr-dumbbell-legend" aria-label="Legend">
            <li>
              <span className="obr-dumbbell-key-dot" style={{ background: PE_COLOUR }} />
              Ours (static)
            </li>
            {withBasis && (
              <li>
                <span className="obr-dumbbell-key-ring is-basis" style={{ borderColor: PE_COLOUR }} />
                {BASIS_LABEL} (static)
              </li>
            )}
            <li>
              <span className="obr-dumbbell-key-ring" style={{ borderColor: OBR_COLOUR }} />
              Official costing ({obrKind})
            </li>
          </ul>
          {showLogo && <svg className="obr-dumbbell-logo" width={CHART_LOGO.width} height={CHART_LOGO.height} role="img" aria-label="PolicyEngine">
            <image href={CHART_LOGO.href} width={CHART_LOGO.width} height={CHART_LOGO.height} />
          </svg>}
        </div>
      )}
    </div>
  );
}

export default OBRDumbbellChart;
