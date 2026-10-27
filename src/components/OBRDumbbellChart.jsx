import { useNarrowViewport, TICK_STYLE, CHART_COLOURS } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import useElementWidth from "../hooks/useElementWidth";
import "./OBRDumbbellChart.css";

/**
 * PolicyEngine's estimates beside the official costings for one fiscal
 * year, as a dumbbell chart: one row per measure (in the order given: the
 * card sorts by the size of the official costing), a solid teal dot for
 * PolicyEngine, a hollow grey ring (a little larger) for the official
 * costing, and a neutral line between them. A column on the right gives
 * the difference, PolicyEngine minus official, in £bn. Where the two
 * round to the same figure, the dot sits inside the ring and one label
 * reads "£0.4bn, same".
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
// Under this the official costing has no meaningful % (and none at zero)
export const MIN_PCT_BASE = 0.05;
// A white outline so labels stay legible where they cross a gridline
const HALO = {
  stroke: CHART_COLOURS.surface,
  strokeWidth: 4,
  strokeLinejoin: "round",
  paintOrder: "stroke",
};

const MINUS = "−";
const isValue = (value) => typeof value === "number" && Number.isFinite(value);

/** −£3.1bn: one decimal, a true minus, and never a "−£0.0bn". */
export function formatBn(value) {
  if (!isValue(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}£${Math.abs(rounded).toFixed(1)}bn`;
}

/** +£0.3bn / −£0.3bn / £0.0bn: a difference, always signed. */
export function formatDifference(value) {
  if (!isValue(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "£0.0bn";
  return `${rounded < 0 ? MINUS : "+"}£${Math.abs(rounded).toFixed(1)}bn`;
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

// Text width without a canvas: close enough for 12–13px system sans.
const approxWidth = (text, fontSize) => String(text).length * fontSize * 0.56;

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
  const pct = scale === "pct";

  // Where each mark sits: £bn, or % of the official costing
  const plotted = rows.map((row) => {
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
  const diffWidth = narrow ? 0 : 84;
  const nameWidth = narrow
    ? 0
    : Math.min(Math.max(...rows.map((row) => approxWidth(row.name, fontSize)), 80) + 16, width * 0.34);
  const rowHeight = narrow ? 54 : 40;
  const top = 24;
  const axisHeight = 26;
  const height = top + rows.length * rowHeight + axisHeight;
  const plotLeft = nameWidth + labelRoom;
  const plotRight = Math.max(width - diffWidth - labelRoom, plotLeft + 40);

  const values = plotted.flatMap((row) => row.extent);
  // £bn: always from zero; %: around 100%, so the gaps are not squeezed
  const axis = niceScale(
    pct ? Math.min(100, ...values) : Math.min(0, ...values),
    Math.max(pct ? 100 : 0, ...values),
    narrow ? 4 : 6,
  );
  const x = (value) => plotLeft + ((value - axis.min) / (axis.max - axis.min || 1)) * (plotRight - plotLeft);
  const dotY = (index) => top + index * rowHeight + (narrow ? 38 : rowHeight / 2);

  // A white backing so a gridline or the zero line never runs through a label
  const backing = (left, cy, w) => (
    <rect x={left - 2} y={cy - 8} width={w + 4} height={16} fill={CHART_COLOURS.surface} />
  );
  const fits = (text, side, cx) => {
    const w = approxWidth(text, 12);
    return side === "left" ? cx - labelGap - w >= nameWidth : cx + labelGap + w <= width - diffWidth;
  };

  const valueLabel = (text, side, cx, cy, colour, key) => {
    const tx = side === "left" ? cx - labelGap : cx + labelGap;
    const w = approxWidth(text, 12);
    if (!fits(text, side, cx)) return null;
    // Drawn at the origin and moved by a transform, so a change of year
    // slides the label with its dot (OBRDumbbellChart.css)
    return (
      <g key={key} className="obr-dumbbell-move" style={{ transform: `translate(${tx}px, ${cy}px)` }}>
        {backing(side === "left" ? -w : 0, 0, w)}
        <text
          className="obr-dumbbell-value"
          x={0}
          y={0}
          dy="0.35em"
          {...HALO}
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
    const difference = isValue(row.pe) && isValue(row.obr) ? row.pe - row.obr : null;

    if (pePart && obrPart) {
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
      if (formatBn(row.pe) === formatBn(row.obr)) {
        // The same to one decimal: one label for both, on the outer side
        const text = `${formatBn(row.pe)}, same`;
        const cx = (xPe + xObr) / 2;
        const outer = row.xPe < 0 ? "left" : "right";
        const side = fits(text, outer, cx) ? outer : outer === "left" ? "right" : "left";
        parts.push(
          valueLabel(text, side, side === "left" ? Math.min(xPe, xObr) : Math.max(xPe, xObr), cy, SAME_LABEL_COLOUR, "same-label"),
        );
      } else {
        parts.push(
          valueLabel(formatBn(row.pe), peLeft ? "left" : "right", xPe, cy, PE_LABEL_COLOUR, "pe-label"),
          valueLabel(formatBn(row.obr), peLeft ? "right" : "left", xObr, cy, OBR_LABEL_COLOUR, "obr-label"),
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
        valueLabel(formatBn(pePart ? row.pe : row.obr), labelSide, cx, cy, pePart ? PE_LABEL_COLOUR : OBR_LABEL_COLOUR, "label"),
        missingLabel(
          pePart ? "Not in the official costings" : "PolicyEngine not yet published",
          otherSide,
          cx + (otherSide === "right" ? 2 : -2),
          cy,
          "missing",
        ),
      );
    } else {
      parts.push(missingLabel(pct && isValue(row.pe) ? "Not in the official costings" : "Not yet published", "right", plotLeft - labelGap, cy, "missing"));
    }

    // A white disc behind the ring keeps lines out of it; the teal dot
    // goes over the disc and the ring over both, so neither hides the other
    if (obrPart) {
      parts.push(<circle key="obr-backing" className="obr-dumbbell-dot-move" cx={x(row.xObr)} cy={cy} r={OBR_RADIUS} fill={CHART_COLOURS.surface} />);
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
          { key: "pe", name: "PolicyEngine (static)", text: isValue(row.pe) ? formatBn(row.pe) : "Not yet published", color: PE_COLOUR },
          { key: "obr", name: `Official costing (${obrKind})`, text: isValue(row.obr) ? formatBn(row.obr) : "Not in the official costings", color: OBR_COLOUR },
          ...(difference !== null
            ? [{ key: "difference", name: "Difference (PolicyEngine − official)", text: formatDifference(difference), color: GAP_COLOUR }]
            : []),
          ...(share !== null ? [{ key: "share", name: "PolicyEngine as % of official", text: `${Math.round(share)}%`, color: GAP_COLOUR }] : []),
        ]}
      />
    );
    const summary = `${row.name}: PolicyEngine ${isValue(row.pe) ? formatBn(row.pe) : "not yet published"}, official ${isValue(row.obr) ? formatBn(row.obr) : "none"}`;

    return (
      <g
        key={row.id}
        className="obr-dumbbell-row has-tooltip"
        data-policy={row.id}
        tabIndex={0}
        aria-label={`${summary}, ${yearLabel}`}
        {...handlers(row.id, tooltip)}
      >
        {/* The whole row answers the pointer, not just its dots */}
        <rect className="obr-dumbbell-hit" x={0} y={top + index * rowHeight} width={width} height={rowHeight} fill="transparent" />
        {narrow && backing(0, nameY, approxWidth(row.name, fontSize))}
        <text className="obr-dumbbell-name" x={0} y={nameY} dy="0.35em" {...HALO} fill={NAME_COLOUR} fontSize={fontSize} fontWeight={500}>
          {row.name}
        </text>
        {parts}
        <text
          className="obr-dumbbell-difference"
          x={width}
          y={narrow ? nameY : cy}
          dy="0.35em"
          textAnchor="end"
          fill={CHART_COLOURS.text}
          fontSize={12}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {difference === null ? "—" : formatDifference(difference)}
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
                .map((row) => `${row.name}: PolicyEngine ${isValue(row.pe) ? formatBn(row.pe) : "not yet published"}, official ${isValue(row.obr) ? formatBn(row.obr) : "none"}`)
                .join("; ")}.`}
              style={{ fontFamily: "inherit", display: "block" }}
            >
              {/* The difference column's heading */}
              <text className="obr-dumbbell-column-head" x={width} y={10} textAnchor="end" fill={TICK_STYLE.fill} fontSize={11}>
                Difference
              </text>
              {pct && (
                <text x={x(100)} y={10} textAnchor="middle" fill={TICK_STYLE.fill} fontSize={11}>
                  Official costing = 100%
                </text>
              )}
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
