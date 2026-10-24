import { useMemo, useRef } from "react";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartSvg } from "../utils/exportChartAsSvg";
import { downloadFile, downloadSvg } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { buildChartCsv, fiscalYear } from "../utils/chartCsv";
import { useNarrowViewport, TICK_STYLE } from "../utils/chartTheme";
import ChartDownloadMenu from "./ChartDownloadMenu";
import NoBreakYear from "./NoBreakYear";
import useElementWidth from "../hooks/useElementWidth";
import "./OBRDumbbellChart.css";

/**
 * PolicyEngine and OBR estimates for one fiscal year as a dumbbell chart:
 * one row per selected policy, a solid teal dot for PolicyEngine, a hollow
 * grey ring (a little larger) for the OBR, and a line between them coloured
 * by the size of the gap (the same three bands as the comparison table).
 * Where the two estimates coincide the dot sits inside the ring, so both
 * stay visible, and the two value labels become one ("£0.5bn (both)").
 *
 * `policies` is the comparison table's own grouped data, in its order:
 * [[reformId, { name, years: { [year]: { policyengine, obr_static,
 * obr_behavioural } } }], ...].
 */

export const PE_COLOUR = "#319795";
export const OBR_COLOUR = "#9CA3AF";
const PE_LABEL_COLOUR = "#0F766E";
const OBR_LABEL_COLOUR = "#6B7280";
const ZERO_LINE = "#374151";
const GRID = "#E5E7EB";
const NAME_COLOUR = "#374151";
const BOTH_LABEL_COLOUR = "#374151";
// The PolicyEngine dot sits inside the OBR ring when the two coincide
export const PE_RADIUS = 5;
export const OBR_RADIUS = 8;
// A white outline so labels stay legible where they cross a gridline
const HALO = {
  stroke: "#ffffff",
  strokeWidth: 4,
  strokeLinejoin: "round",
  paintOrder: "stroke",
};

// The comparison table's difference bands and colours
export const BANDS = [
  { key: "small", below: 0.5, colour: "#10b981", label: "under £0.5bn" },
  { key: "medium", below: 2, colour: "#fbbf24", label: "£0.5–2bn" },
  { key: "large", below: Infinity, colour: "#ef4444", label: "over £2bn" },
];

const MINUS = "−";
const isValue = (value) => typeof value === "number" && Number.isFinite(value);

/** −£3.1bn: one decimal, a true minus, and never a "−£0.0bn". */
export function formatBn(value) {
  if (!isValue(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}£${Math.abs(rounded).toFixed(1)}bn`;
}

/** Axis tick: £4bn, −£2bn, £0.5bn. */
function formatTick(value) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "£0";
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}£${Math.abs(rounded)}bn`;
}

export function bandFor(pe, obr) {
  if (!isValue(pe) || !isValue(obr)) return null;
  const gap = Math.abs(pe - obr);
  return BANDS.find((band) => gap < band.below);
}

/** The OBR figure the switch asks for, falling back to the other one. */
export function obrValue(yearData, showBehavioural) {
  const primary = showBehavioural
    ? yearData?.obr_behavioural
    : yearData?.obr_static;
  const other = showBehavioural
    ? yearData?.obr_static
    : yearData?.obr_behavioural;
  if (isValue(primary)) return primary;
  return isValue(other) ? other : null;
}

/** Ticks with a 1/2/5 step, always including zero. */
function niceScale(lo, hi, targetTicks) {
  const span = Math.max(hi - lo, 0.5);
  const raw = span / Math.max(targetTicks - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max + step / 1e6; t += step)
    ticks.push(Math.round(t * 1e6) / 1e6);
  return { min, max, ticks };
}

// Text width without a canvas: close enough for 12–13px system sans.
const approxWidth = (text, fontSize) => String(text).length * fontSize * 0.56;

function OBRDumbbellChart({ policies, year, showBehavioural }) {
  const [wrapperRef, measuredWidth] = useElementWidth();
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
  // Until the plot is measured, a typical width for the screen
  const width = measuredWidth > 0 ? measuredWidth : narrow ? 358 : 800;

  const yearLabel = fiscalYear(year);
  const obrKind = showBehavioural ? "post-behavioural" : "static";
  const chartTitle = `PolicyEngine and OBR estimates, ${yearLabel}`;
  // Only in exported images, which carry no surrounding text
  const description = `Each row shows a measure's budgetary impact in ${yearLabel}, in £ billion: PolicyEngine's static estimate and the OBR's ${obrKind} costing. Positive values raise revenue or reduce spending; negative values do the opposite.`;

  const rows = useMemo(
    () =>
      policies.map(([id, policy]) => {
        const yearData = policy.years?.[year];
        const pe = isValue(yearData?.policyengine)
          ? yearData.policyengine
          : null;
        const obr = obrValue(yearData, showBehavioural);
        // Both OBR figures set the axis, so the switch moves dots, not the axis
        const extent = [
          pe,
          yearData?.obr_static,
          yearData?.obr_behavioural,
        ].filter(isValue);
        return {
          id,
          name: policy.name,
          pe,
          obr,
          band: bandFor(pe, obr),
          extent,
        };
      }),
    [policies, year, showBehavioural],
  );

  const hasData = rows.some((row) => row.pe !== null || row.obr !== null);

  // Layout
  const fontSize = narrow ? 12 : 13;
  // Clear of the OBR ring
  const labelGap = OBR_RADIUS + 5;
  const labelRoom = narrow ? 54 : 62;
  const nameWidth = narrow
    ? 0
    : Math.min(
        Math.max(...rows.map((row) => approxWidth(row.name, fontSize)), 80) +
          16,
        width * 0.4,
      );
  const rowHeight = narrow ? 54 : 40;
  const top = 8;
  const axisHeight = 26;
  const height = top + rows.length * rowHeight + axisHeight;
  const plotLeft = nameWidth + labelRoom;
  const plotRight = Math.max(width - labelRoom, plotLeft + 40);

  const values = rows.flatMap((row) => row.extent);
  const scale = niceScale(
    Math.min(0, ...values),
    Math.max(0, ...values),
    narrow ? 4 : 6,
  );
  const x = (value) =>
    plotLeft +
    ((value - scale.min) / (scale.max - scale.min || 1)) *
      (plotRight - plotLeft);
  const dotY = (index) =>
    top + index * rowHeight + (narrow ? 38 : rowHeight / 2);

  const legendItems = [
    { color: PE_COLOUR, label: "PolicyEngine", type: "dot" },
    { color: OBR_COLOUR, label: `OBR (${obrKind})`, type: "ring" },
    ...BANDS.map((band) => ({
      color: band.colour,
      label: `Difference from OBR ${band.label}`,
      type: "line",
    })),
  ];
  const exportName = `policyengine-obr-estimates-${year}`;
  const exportOptions = {
    title: chartTitle,
    description,
    legendItems,
    logo: CHART_LOGO,
    svgSelector: "svg",
    reservedLegendHeight: 0,
  };
  const downloads = hasData
    ? {
        csv: () =>
          downloadFile(
            buildChartCsv({
              title: chartTitle,
              units: "£ billion a year; positive values raise revenue",
              source: `PolicyEngine UK microsimulation; OBR ${obrKind} costings, Economic and Fiscal Outlook November 2025`,
              columns: [
                { key: "name", label: "Policy" },
                { key: "pe", label: "PolicyEngine (£bn)", decimals: 4 },
                { key: "obr", label: `OBR ${obrKind} (£bn)`, decimals: 4 },
                {
                  key: "difference",
                  label: "Difference, PolicyEngine minus OBR (£bn)",
                  decimals: 4,
                },
                { key: "band", label: "Difference band" },
              ],
              rows: rows.map((row) => ({
                name: row.name,
                pe: row.pe ?? undefined,
                obr: row.obr ?? undefined,
                difference: row.band ? row.pe - row.obr : undefined,
                band: row.band
                  ? `Difference ${row.band.label}`
                  : "Not yet published",
              })),
            }),
            `${exportName}.csv`,
            "text/csv;charset=utf-8",
          ),
        png: async () =>
          downloadSvgAsPng(
            await buildChartSvg(chartRef, exportOptions),
            exportName,
          ),
        svg: async () => {
          const built = await buildChartSvg(chartRef, exportOptions);
          if (built) downloadSvg(built.svg, exportName);
        },
      }
    : {};

  // A white backing so a gridline or the zero line never runs through a label
  const backing = (left, cy, w) => (
    <rect x={left - 2} y={cy - 8} width={w + 4} height={16} fill="#ffffff" />
  );

  const fits = (text, side, cx) => {
    const w = approxWidth(text, 12);
    return side === "left" ? cx - labelGap - w >= 0 : cx + labelGap + w <= width;
  };

  const valueLabel = (value, side, cx, cy, colour, key, suffix = "") => {
    const text = `${formatBn(value)}${suffix}`;
    const tx = side === "left" ? cx - labelGap : cx + labelGap;
    const w = approxWidth(text, 12);
    // Only where it fits inside the chart
    if (!fits(text, side, cx)) return null;
    return (
      <g key={key}>
        {backing(side === "left" ? tx - w : tx, cy, w)}
        <text
          className="obr-dumbbell-value"
          x={tx}
          y={cy}
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
    const pePart = row.pe !== null;
    const obrPart = row.obr !== null;
    const centre = (plotLeft + plotRight) / 2;

    if (pePart && obrPart) {
      const xPe = x(row.pe);
      const xObr = x(row.obr);
      parts.push(
        <line
          key="gap"
          className="obr-dumbbell-gap"
          data-band={row.band.key}
          x1={xPe}
          x2={xObr}
          y1={cy}
          y2={cy}
          stroke={row.band.colour}
          strokeWidth={3}
          strokeLinecap="round"
        />,
      );
      const peLeft = row.pe < row.obr || (row.pe === row.obr && row.pe < 0);
      if (formatBn(row.pe) === formatBn(row.obr)) {
        // The same to one decimal: one label for both, on the outer side
        const cx = (xPe + xObr) / 2;
        const outer = row.pe < 0 ? "left" : "right";
        const inner = outer === "left" ? "right" : "left";
        const side = fits(`${formatBn(row.pe)} (both)`, outer, cx)
          ? outer
          : inner;
        parts.push(
          valueLabel(
            row.pe,
            side,
            side === "left" ? Math.min(xPe, xObr) : Math.max(xPe, xObr),
            cy,
            BOTH_LABEL_COLOUR,
            "both-label",
            " (both)",
          ),
        );
      } else parts.push(
        valueLabel(
          row.pe,
          peLeft ? "left" : "right",
          xPe,
          cy,
          PE_LABEL_COLOUR,
          "pe-label",
        ),
        valueLabel(
          row.obr,
          peLeft ? "right" : "left",
          xObr,
          cy,
          OBR_LABEL_COLOUR,
          "obr-label",
        ),
      );
    } else if (pePart || obrPart) {
      const value = pePart ? row.pe : row.obr;
      const cx = x(value);
      const labelSide = cx > centre ? "left" : "right";
      const otherSide = labelSide === "left" ? "right" : "left";
      parts.push(
        valueLabel(
          value,
          labelSide,
          cx,
          cy,
          pePart ? PE_LABEL_COLOUR : OBR_LABEL_COLOUR,
          "label",
        ),
        missingLabel(
          pePart ? "OBR not yet published" : "PolicyEngine not yet published",
          otherSide,
          cx + (otherSide === "right" ? 2 : -2),
          cy,
          "missing",
        ),
      );
    } else {
      parts.push(
        missingLabel(
          "Not yet published",
          "right",
          plotLeft - labelGap,
          cy,
          "missing",
        ),
      );
    }

    // A white disc behind the ring keeps lines out of it; the teal dot
    // goes over the disc and the ring over both, so neither hides the other
    if (obrPart) {
      parts.push(
        <circle
          key="obr-backing"
          cx={x(row.obr)}
          cy={cy}
          r={OBR_RADIUS}
          fill="#ffffff"
        />,
      );
    }
    if (pePart) {
      parts.push(
        <circle
          key="pe"
          className="obr-dumbbell-dot pe"
          cx={x(row.pe)}
          cy={cy}
          r={PE_RADIUS}
          fill={PE_COLOUR}
        />,
      );
    }
    if (obrPart) {
      parts.push(
        <circle
          key="obr"
          className="obr-dumbbell-dot obr"
          cx={x(row.obr)}
          cy={cy}
          r={OBR_RADIUS - 1}
          fill="none"
          stroke={OBR_COLOUR}
          strokeWidth={2}
        />,
      );
    }

    const summary = `${row.name}: PolicyEngine ${
      pePart ? formatBn(row.pe) : "not yet published"
    }, OBR ${obrPart ? formatBn(row.obr) : "not yet published"}`;

    return (
      <g key={row.id} className="obr-dumbbell-row" data-policy={row.id}>
        <title>{summary}</title>
        {narrow && backing(0, nameY, approxWidth(row.name, fontSize))}
        <text
          className="obr-dumbbell-name"
          x={0}
          y={nameY}
          dy="0.35em"
          {...HALO}
          {...HALO}
          fill={NAME_COLOUR}
          fontSize={fontSize}
          fontWeight={500}
        >
          {row.name}
        </text>
        {parts}
      </g>
    );
  };

  const plotBottom = top + rows.length * rowHeight;

  return (
    <div className="obr-dumbbell">
      <div className="obr-dumbbell-header">
        <div className="obr-dumbbell-heading">
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
        </div>
        <ChartDownloadMenu
          formats={downloads}
          chartTitle={chartTitle}
          disabledReason={hasData ? undefined : "Not yet published"}
        />
      </div>

      <div ref={wrapperRef} className="obr-dumbbell-plot">
        {hasData ? (
          <div ref={chartRef}>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${chartTitle}. ${rows
                .map(
                  (row) =>
                    `${row.name}: PolicyEngine ${
                      row.pe !== null ? formatBn(row.pe) : "not yet published"
                    }, OBR ${row.obr !== null ? formatBn(row.obr) : "not yet published"}`,
                )
                .join("; ")}.`}
              style={{ fontFamily: "inherit", display: "block" }}
            >
              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={x(tick)}
                    x2={x(tick)}
                    y1={top}
                    y2={plotBottom}
                    stroke={tick === 0 ? ZERO_LINE : GRID}
                    strokeWidth={1}
                  />
                  <text
                    x={x(tick)}
                    y={plotBottom + 17}
                    textAnchor="middle"
                    fill={TICK_STYLE.fill}
                    fontSize={narrow ? 11 : TICK_STYLE.fontSize}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatTick(tick)}
                  </text>
                </g>
              ))}
              {rows.map(renderRow)}
            </svg>
          </div>
        ) : (
          <p className="obr-dumbbell-empty">Not yet published</p>
        )}
      </div>

      {hasData && (
        <div className="obr-dumbbell-footer">
          <ul className="obr-dumbbell-legend" aria-label="Legend">
            <li>
              <span
                className="obr-dumbbell-key-dot"
                style={{ background: PE_COLOUR }}
              />
              PolicyEngine
            </li>
            <li>
              <span
                className="obr-dumbbell-key-ring"
                style={{ borderColor: OBR_COLOUR }}
              />
              OBR
            </li>
          </ul>
          <ul className="obr-dumbbell-legend" aria-label="Difference from OBR">
            <li className="obr-dumbbell-legend-title">Difference from OBR:</li>
            {BANDS.map((band) => (
              <li key={band.key}>
                <span
                  className="obr-dumbbell-key-dot"
                  style={{ background: band.colour }}
                />
                {band.label}
              </li>
            ))}
          </ul>
          <svg
            className="obr-dumbbell-logo"
            width={CHART_LOGO.width}
            height={CHART_LOGO.height}
            role="img"
            aria-label="PolicyEngine"
          >
            <image
              href={CHART_LOGO.href}
              width={CHART_LOGO.width}
              height={CHART_LOGO.height}
            />
          </svg>
        </div>
      )}
    </div>
  );
}

export default OBRDumbbellChart;
