import { useRef } from "react";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import { signedMoney } from "../../utils/singleYear";
import useElementWidth from "../../hooks/useElementWidth";
import Disclosure from "../Disclosure";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../FloatingTooltip";
import { BAR_RADIUS, CHART_COLOURS } from "../../utils/chartTheme";
import TitleIcon from "../TitleIcon";

const ZERO_LINE = CHART_COLOURS.text;
const NAME_COLOUR = CHART_COLOURS.text;

// Text width without a canvas: close enough for 12–13px system sans
const approxWidth = (text, fontSize) => String(text).length * fontSize * 0.56;

/**
 * Change by policy: one bar per measure that changes the household (that
 * measure on its own), from zero, with the measure's name above it and its
 * change at the right, and the interaction between them as a grey bar when
 * it is £1 or more. No total row: the total is the headline tile. The rows
 * are the rounded figures from policyRows, so they add up to that tile.
 *
 * @param {Object} props
 * @param {Array<{id, name, color, rounded}>} props.rows
 * @param {string[]} props.noEffect - Names of measures that do not move the household
 * @param {Array<{id, name, color, reason}>} [props.noEffectItems] - Every
 *   measure that does not move it, an employer cost with its reason: listed
 *   under the chart in one expander, closed at first
 * @param {string[]} [props.underAPound] - Names of measures worth under £1
 * @param {Array<{id, name, kind, text}>} [props.notes] - Notes on measures'
 *   figures: an employer cost (£0 for every household) or "if received"
 * @param {string} props.yearLabel - "2029-30"
 */
export default function PolicyBars({ rows, noEffect, noEffectItems = [], underAPound = [], notes = [], yearLabel }) {
  const [wrapperRef, measured] = useElementWidth();
  const chartRef = useRef(null);
  const width = measured > 0 ? measured : 640;
  const title = `Change in net income by policy, ${yearLabel}`;
  // Cleared when the year or the figures change, so it never shows old ones
  const { tip, handlers } = useFloatingTooltip(
    wrapperRef,
    `${yearLabel}:${rows.map((row) => `${row.id}=${row.rounded}`).join(",")}`,
  );

  const fontSize = 13;
  const valueRoom = Math.max(64, ...rows.map((row) => approxWidth(signedMoney(row.rounded), fontSize) + 12));
  const rowHeight = 46;
  const barHeight = 14;
  const top = 4;
  const height = top + rows.length * rowHeight + 4;
  const plotLeft = 0;
  const plotRight = Math.max(width - valueRoom, 80);

  const values = rows.map((row) => row.rounded);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (value) => plotLeft + ((value - lo) / span) * (plotRight - plotLeft);
  const zero = x(0);

  const download = {
    chartRef,
    name: `change-by-policy-${yearLabel}`,
    exportOptions: {
      title,
      description: `Change in your household's net income in ${yearLabel} from each selected policy.`,
      legendItems: [],
      logo: CHART_LOGO,
      svgSelector: "svg",
      reservedLegendHeight: 0,
    },
    csv: () =>
      buildChartCsv({
        title,
        units: "£ a year; positive values raise the household's net income",
        source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
        columns: [
          { key: "name", label: "Policy" },
          { key: "change", label: "Change in net income (£)", decimals: 0 },
        ],
        rows: [
          ...rows.map((row) => ({ name: row.name, change: row.rounded })),
          ...[...underAPound, ...noEffect].map((name) => ({ name, change: 0 })),
        ],
      }),
  };

  return (
    <div className="card single-year-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="hbars" />
            <span className="title-text">{title}</span>
          </h3>
        </div>
        <ChartDownloadMenu download={rows.length ? download : undefined} chartTitle={title} />
      </div>
      {rows.length > 0 ? (
        <div ref={wrapperRef} className="policy-bars-plot" style={{ position: "relative" }}>
          <div ref={chartRef}>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={rows.map((row) => `${row.name}: ${signedMoney(row.rounded)}`).join("; ")}
            >
              {rows.map((row, index) => {
                const y = top + index * rowHeight;
                const barY = y + 22;
                const x0 = Math.min(zero, x(row.rounded));
                const w = Math.max(Math.abs(x(row.rounded) - zero), 1.5);
                return (
                  <g
                    key={row.id}
                    className="policy-bar has-tooltip"
                    data-policy={row.id}
                    tabIndex={0}
                    aria-label={`${row.name}: ${signedMoney(row.rounded)} a year in ${yearLabel}`}
                    {...handlers(
                      row.id,
                      <TooltipRows
                        label={`${row.name}, ${yearLabel}`}
                        rows={[
                          {
                            key: "change",
                            name: "Change in net income",
                            text: `${signedMoney(row.rounded)} a year`,
                            color: row.color,
                          },
                        ]}
                      />,
                    )}
                  >
                    {/* The whole row answers the pointer, not just its bar */}
                    <rect x={0} y={y} width={width} height={rowHeight} fill="transparent" />
                    <text x={plotLeft} y={y + 13} fontSize={fontSize} fill={NAME_COLOUR}>
                      {row.name}
                    </text>
                    <rect x={x0} y={barY} width={w} height={barHeight} rx={Math.min(BAR_RADIUS, barHeight / 2)} fill={row.color} />
                    <text
                      className="policy-bar-value"
                      x={width}
                      y={barY + barHeight / 2}
                      dy="0.35em"
                      textAnchor="end"
                      fontSize={fontSize}
                      fontWeight={600}
                      fill={NAME_COLOUR}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {signedMoney(row.rounded)}
                    </text>
                  </g>
                );
              })}
              {/* Zero, beside each bar only, so it never crosses a name */}
              {rows.map((row, index) => {
                const barY = top + index * rowHeight + 22;
                return (
                  <line
                    key={`zero-${row.id}`}
                    className="policy-bar-zero"
                    x1={zero}
                    x2={zero}
                    y1={barY - 4}
                    y2={barY + barHeight + 4}
                    stroke={ZERO_LINE}
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          </div>
          <div className="card-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CHART_LOGO.href} alt="PolicyEngine" />
          </div>
          <FloatingTooltip tip={tip} />
        </div>
      ) : (
        <p className="single-year-quiet">None of the selected policies changes your household&apos;s net income.</p>
      )}
      {underAPound.length > 0 && rows.length > 0 && (
        <p className="single-year-quiet">Less than £1 a year: {underAPound.join(", ")}.</p>
      )}
      {notes
        .filter((note) => note.kind !== "employer_cost")
        .map((note) => (
          <p key={note.id} className="single-year-quiet" data-note={note.kind}>
            <strong>{note.name}</strong>: {note.text}
          </p>
        ))}
      {noEffectItems.length > 0 && <NoEffectList items={noEffectItems} title="No effect on your household" />}
    </div>
  );
}

/**
 * The measures that leave the household where it was, in the card's "More
 * info" row (closed at first, as "Compare with OBR estimates"): each on its
 * own row with its colour and, for an employer cost, why.
 */
export function NoEffectList({ items, title }) {
  return (
    <Disclosure inCard title="More info" contentClassName="no-effect">
      <p className="no-effect-title">
        {title} ({items.length})
      </p>
      <ul className="no-effect-list">
        {items.map((item) => (
          <li key={item.id} className="no-effect-item" data-policy={item.id}>
            <span className="no-effect-dot" style={{ background: item.color }} aria-hidden="true" />
            <span className="no-effect-name">{item.name}</span>
            {item.reason && <span className="no-effect-reason">{item.reason}</span>}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
