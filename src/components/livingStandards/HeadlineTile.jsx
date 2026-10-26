// The headline tile shared by Before the Budget's sub-tabs (Forecast
// changes: CPI, RPI, earnings; Poverty: children, working-age adults,
// pensioners): an icon and name (with an info tip when given), a big
// figure and what it is, a small trend, and one line on what it means.
//
// The trend (TileTrend) is one series: a line over a light area, named
// above ("OBR forecast", "PolicyEngine projection"), with its first and
// last values labelled and the year the big figure comes from ringed. Its
// y range is fitted to the tile's own values but at least `minSpan` wide,
// so a tenth of a point stays near-flat. Hover, or focus it and use the
// arrow keys, for each year's value ("2028: 2.0%").

import { useState } from "react";
import useElementWidth from "../../hooks/useElementWidth";
import Tip, { InfoTip } from "../Tip";

const H = 68;
const PAD_X = 8;
const PAD_TOP = 18;
const PAD_BOTTOM = 6;

/** The y range: the values' range, at least `minSpan` wide, padded a tenth. */
export function trendRange(values, minSpan = 1) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2, minSpan / 2) * 1.1;
  return [Math.max(0, mid - half), mid + half];
}

/**
 * rows: [{ label: "2028", value }], oldest first. highlight: the label of
 * the year the tile's figure is ("2027-28"). dashed: a projection.
 */
export function TileTrend({ rows, name, format, seriesLabel, highlight, dashed = false, minSpan = 1 }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const points = rows.filter((r) => r.value != null);
  if (points.length < 2) return null;
  const [lo, hi] = trendRange(points.map((p) => p.value), minSpan);
  const w = Math.max(width || 0, 120);
  const x = (i) => PAD_X + (i / (points.length - 1)) * (w - 2 * PAD_X);
  const y = (v) => PAD_TOP + ((hi - v) / (hi - lo)) * (H - PAD_TOP - PAD_BOTTOM);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const last = points.length - 1;
  const hero = points.findIndex((p) => p.label === highlight);

  const pick = (clientX) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.round(((clientX - box.left - PAD_X) / (w - 2 * PAD_X)) * last);
    setActive(Math.min(last, Math.max(0, i)));
  };
  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.min(last, Math.max(0, (i ?? (hero >= 0 ? hero : last)) + step)));
  };
  const row = active == null ? null : points[active];

  return (
    <div className="tile-trend">
      <p className="tile-trend-series">{seriesLabel}</p>
      <div
        ref={ref}
        className="tile-trend-plot"
        tabIndex={0}
        role="group"
        aria-label={`${name}, ${seriesLabel}, ${points[0].label} to ${points[last].label}: ${format(points[0].value)} to ${format(points[last].value)}. Use the arrow keys for each year.`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive((i) => i ?? (hero >= 0 ? hero : last))}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <svg width={w} height={H} aria-hidden="true">
          <path className="tile-trend-area" d={area} />
          <path className={`tile-trend-line${dashed ? " is-dashed" : ""}`} d={line} />
          {points.map((p, i) => (
            <circle key={p.label} className="tile-trend-dot" cx={x(i)} cy={y(p.value)} r={1.8} />
          ))}
          {hero >= 0 && <circle className="tile-trend-hero" cx={x(hero)} cy={y(points[hero].value)} r={4.5} />}
          {/* The first and last values, beside their points */}
          <text className="tile-trend-value" x={x(0)} y={y(points[0].value) - 7} textAnchor="start">
            {hero === 0 ? "" : format(points[0].value)}
          </text>
          <text className="tile-trend-value" x={x(last)} y={y(points[last].value) - 7} textAnchor="end">
            {format(points[last].value)}
          </text>
          {row && (
            <g>
              <line className="tile-trend-guide" x1={x(active)} x2={x(active)} y1={PAD_TOP - 4} y2={H} />
              <circle className="tile-trend-hover" cx={x(active)} cy={y(row.value)} r={4} />
            </g>
          )}
        </svg>
        {row && (
          <div className="tile-trend-tip" role="status" style={{ left: `${Math.min(Math.max(x(active), 50), w - 50)}px` }}>
            {row.label}: {format(row.value)}
          </div>
        )}
      </div>
      <div className="tile-trend-years">
        <span>{points[0].label}</span>
        <span>{points[last].label}</span>
      </div>
    </div>
  );
}

/**
 * icon: a lucide icon; name: the tile's name (a link when href is given,
 * with hrefTip); info: a definition in an info tip; value and caption: the
 * figure and what it is; trend: TileTrend's props; meaning: one line.
 */
export default function HeadlineTile({ icon: Icon, name, href, hrefTip, info, value, caption, trend, meaning }) {
  return (
    <div className="forecast-tile">
      <div className="forecast-tile-head">
        <span className="forecast-tile-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="forecast-tile-name">
          {href ? (
            <Tip content={hrefTip}>
              <a href={href} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
            </Tip>
          ) : (
            name
          )}
        </span>
        {info && (
          <span className="forecast-tile-info">
            <InfoTip content={info} label={`About ${name}`} />
          </span>
        )}
      </div>
      <div>
        <p className="forecast-tile-value">{value}</p>
        <p className="forecast-tile-sub">{caption}</p>
      </div>
      <TileTrend name={name} {...trend} />
      {meaning && <p className="forecast-tile-meaning">{meaning}</p>}
    </div>
  );
}
