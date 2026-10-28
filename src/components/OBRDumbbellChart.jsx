import { useState } from "react";
import { useNarrowViewport, TICK_STYLE, CHART_COLOURS, ROW_RADIUS, approxTextWidth, fitTicks } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import useElementWidth from "../hooks/useElementWidth";
import { SvgMeasureLabel, SVG_LABEL_INDENT } from "./MeasureRowLabel";
import { formatBnOrM, formatSignedBnOrM, shownBn } from "../utils/moneyFormat";
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
 * obrStatic, obrBehavioural } with null for a missing figure.
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

/** The chart's legend entries, for the image downloads too. */
export function dumbbellLegendItems(obrKind) {
  return [
    { color: PE_COLOUR, label: "PolicyEngine (static)", type: "dot" },
    { color: OBR_COLOUR, label: `Official costing (${obrKind})`, type: "ring" },
  ];
}

function OBRDumbbellChart({ rows, yearLabel, obrKind = "static", scale = "bn", chartRef, tooltipKey }) {
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
        base.onFocus(event);
      },
      onBlur: () => {
        setActive(null);
        base.onBlur();
      },
    };
  };
  // A row's background: its band, the hover band, or the card
  const rowBackground = (row, index) =>
    active === row.id ? CHART_COLOURS.hover : index % 2 === 0 ? CHART_COLOURS.rowBand : CHART_COLOURS.surface;
  const pct = scale === "pct";

  // Where each mark sits: £bn, or % of the official costing
  const plotted = rows.map((row) => {
    // Not in force this year on either side: no marks, the row says why
    if (row.status) return { ...row, xPe: null, xObr: null, extent: [] };
    if (!pct) {
      return { ...row, xPe: row.pe, xObr: row.obr, extent: [row.pe, row.obrStatic, row.obrBehavioural].filter(isValue) };
    }
    const share = pctOfOfficial(row.pe, row.obr);
    const noBase = isValue(row.obr) && Math.abs(row.obr) < MIN_PCT_BASE;
    return {
      ...row,
      noBase,
      xPe: share,
      xObr: share === null ? null : 100,
      extent: share === null ? [] : [share, 100],
    };
  });
  const hasData = rows.some((row) => row.pe !== null || row.obr !== null);

  // Layout
  const fontSize = narrow ? 12 : 13;
  const labelGap = OBR_RADIUS + 5;
  const labelRoom = narrow ? 54 : 62;
  // The difference column at the right (on a phone, on the name line)
  const diffWidth = narrow ? 0 : 84 + BAND_PAD;
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
      const labelSide = cx > centre ? "left" : "right";
      const otherSide = labelSide === "left" ? "right" : "left";
      parts.push(
        valueLabel(formatBn(pePart ? row.pe : row.obr), labelSide, cx, cy, pePart ? PE_LABEL_COLOUR : OBR_LABEL_COLOUR, "label", background),
        missingLabel(
          pePart ? (row.notComparable ? "Not comparable" : "Not in the official costings") : "PolicyEngine not yet published",
          otherSide,
          cx + (otherSide === "right" ? 2 : -2),
          cy,
          "missing",
        ),
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
    if (pePart) {
      parts.push(<circle key="pe" className="obr-dumbbell-dot pe obr-dumbbell-dot-move" cx={x(row.xPe)} cy={cy} r={PE_RADIUS} fill={PE_COLOUR} />);
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
    const tooltip = (
      <TooltipRows
        label={`${row.name}, ${yearLabel}`}
        rows={[
          { key: "pe", name: "PolicyEngine (static)", text: isValue(row.pe) ? bn(row.pe) : "Not yet published", color: PE_COLOUR },
          { key: "obr", name: `Official costing (${obrKind})`, text: isValue(row.obr) ? bn(row.obr) : row.notComparable ? `Not comparable: ${row.notComparable}` : "Not in the official costings", color: OBR_COLOUR },
          ...(difference !== null
            ? [{ key: "difference", name: "Difference (PolicyEngine − official)", text: formatDifference(difference, decimals), color: GAP_COLOUR }]
            : []),
          ...(share !== null ? [{ key: "share", name: "PolicyEngine as % of official", text: `${Math.round(share)}%`, color: GAP_COLOUR }] : []),
        ]}
      />
    );
    const summary = row.status
      ? `${row.name}: ${row.status}`
      : `${row.name}: PolicyEngine ${isValue(row.pe) ? bn(row.pe) : "not yet published"}, official ${isValue(row.obr) ? bn(row.obr) : row.notComparable ? "not comparable" : "none"}`;

    return (
      <g
        key={row.id}
        className={`obr-dumbbell-row has-tooltip${active === row.id ? " is-active" : ""}`}
        data-policy={row.id}
        tabIndex={0}
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
        {narrow && backing(width - BAND_PAD - approxWidth(differenceText, 12) - 2, nameY, approxWidth(differenceText, 12) + 2, background)}
        <text
          className="obr-dumbbell-difference"
          x={width - BAND_PAD}
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
                  return `${row.name}: PolicyEngine ${isValue(row.pe) ? formatBn(row.pe, decimals) : "not yet published"}, official ${isValue(row.obr) ? formatBn(row.obr, decimals) : row.notComparable ? "not comparable" : "none"}`;
                })
                .join("; ")}.`}
              style={{ fontFamily: "inherit", display: "block" }}
            >
              {/* The difference column's heading */}
              <text className="obr-dumbbell-column-head" x={width - BAND_PAD} y={10} textAnchor="end" fill={TICK_STYLE.fill} fontSize={11}>
                Difference
              </text>
              {pct && (
                <text x={x(100)} y={10} textAnchor="middle" fill={TICK_STYLE.fill} fontSize={11}>
                  Official costing = 100%
                </text>
              )}
              {/* The row bands, under the gridlines, the zero line and the
                  dots: every second row, and the hovered or focused one */}
              <g className="obr-dumbbell-bands" aria-hidden="true">
                {plotted.map((row, index) => {
                  const fill = rowBackground(row, index);
                  return fill === CHART_COLOURS.surface ? null : (
                    <rect
                      key={row.id}
                      className={`obr-dumbbell-band${active === row.id ? " is-active" : ""}`}
                      x={0}
                      y={top + index * rowHeight + 1}
                      width={width}
                      height={rowHeight - 2}
                      rx={ROW_RADIUS}
                      fill={fill}
                    />
                  );
                })}
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
              PolicyEngine (static)
            </li>
            <li>
              <span className="obr-dumbbell-key-ring" style={{ borderColor: OBR_COLOUR }} />
              Official costing ({obrKind})
            </li>
          </ul>
          <svg className="obr-dumbbell-logo" width={CHART_LOGO.width} height={CHART_LOGO.height} role="img" aria-label="PolicyEngine">
            <image href={CHART_LOGO.href} width={CHART_LOGO.width} height={CHART_LOGO.height} />
          </svg>
        </div>
      )}
    </div>
  );
}

export default OBRDumbbellChart;
