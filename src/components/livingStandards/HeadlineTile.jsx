// The headline tile shared by the OBR forecast's sub-tabs (Forecast
// changes: CPI, RPI, earnings; Poverty: children, working-age adults,
// pensioners): an icon and name (with an info tip when given), a big
// figure and what it is, a small trend, and one line on what it means.
//
// The trend (TileTrend) draws official years solid grey and the projection
// or forecast dashed teal, on a y range fitted to the tile's own values
// with its bottom and top labelled at the left and faint gridlines, so a
// small change shows but its size is plain. Hover, or focus it and use the
// arrow keys, for each year's value ("2028: 2.0%").

import { useState } from "react";
import { Info } from "lucide-react";
import useElementWidth from "../../hooks/useElementWidth";

const H = 56;
const GUTTER = 40;
const PAD_Y = 6;
const SERIES = ["official", "projection"];

/** A tile's row text: "2028: 2.0%", or both values in the year two lines meet. */
export function trendPointText(row, format) {
  if (row.official != null && row.projection != null) {
    return `${row.label}: ${format(row.official)} official, ${format(row.projection)} projected`;
  }
  return `${row.label}: ${format(row.official ?? row.projection)}`;
}

/**
 * The y range: the values' range, at least `minSpan` wide, padded a tenth,
 * then rounded out to `round` (never below 0).
 */
export function trendRange(values, { minSpan = 1, round = 0.5 } = {}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2, minSpan / 2) * 1.1;
  const lo = Math.max(0, Math.floor((mid - half) / round) * round);
  const hi = Math.ceil((mid + half) / round) * round;
  return [lo, hi];
}

/**
 * rows: [{ label: "2028", official: number|null, projection: number|null }],
 * oldest first. format: a value as shown ("2.0%").
 */
export function TileTrend({ rows, name, format }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const vals = rows.flatMap((r) => [r.official, r.projection]).filter((v) => v != null);
  if (rows.length < 2 || !vals.length) return null;
  const [lo, hi] = trendRange(vals);
  const mid = (lo + hi) / 2;
  const w = Math.max(width || 0, GUTTER + 80);
  const plotW = w - GUTTER - 10;
  const x = (i) => GUTTER + 4 + (i / (rows.length - 1)) * plotW;
  const y = (v) => PAD_Y + ((hi - v) / (hi - lo)) * (H - 2 * PAD_Y);
  const path = (key) => {
    let d = "";
    rows.forEach((r, i) => {
      if (r[key] == null) return;
      d += `${d && rows[i - 1]?.[key] != null ? "L" : "M"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`;
    });
    return d;
  };
  // The first and last values, marked larger
  const firstKey = rows[0].official != null ? "official" : "projection";
  const lastRow = rows[rows.length - 1];
  const lastKey = lastRow.projection != null ? "projection" : "official";

  const pick = (clientX) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.round(((clientX - box.left - GUTTER - 4) / plotW) * (rows.length - 1));
    setActive(Math.min(rows.length - 1, Math.max(0, i)));
  };
  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.min(rows.length - 1, Math.max(0, (i ?? rows.length - 1) + step)));
  };
  const row = active == null ? null : rows[active];

  return (
    <div className="tile-trend">
      <div
        ref={ref}
        className="tile-trend-plot"
        tabIndex={0}
        role="group"
        aria-label={`${name}, ${rows[0].label} to ${lastRow.label}. Use the arrow keys for each year.`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive((i) => i ?? rows.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <svg width={w} height={H} aria-hidden="true">
          {[lo, mid, hi].map((v) => (
            <line key={v} className="tile-trend-grid" x1={GUTTER} x2={w} y1={y(v)} y2={y(v)} />
          ))}
          <text className="tile-trend-axis" x={GUTTER - 6} y={y(hi)} dy="0.35em" textAnchor="end">
            {format(hi)}
          </text>
          <text className="tile-trend-axis" x={GUTTER - 6} y={y(lo)} dy="0.35em" textAnchor="end">
            {format(lo)}
          </text>
          {SERIES.map((key) => (
            <path key={key} className={`tile-trend-line is-${key}`} d={path(key)} />
          ))}
          {rows.map((r, i) =>
            SERIES.map((key) =>
              r[key] == null ? null : <circle key={`${i}-${key}`} className={`tile-trend-dot is-${key}`} cx={x(i)} cy={y(r[key])} r={1.8} />,
            ),
          )}
          <circle className={`tile-trend-end is-${firstKey}`} cx={x(0)} cy={y(rows[0][firstKey])} r={3.5} />
          <circle className={`tile-trend-end is-${lastKey}`} cx={x(rows.length - 1)} cy={y(lastRow[lastKey])} r={3.5} />
          {row && (
            <g>
              <line className="tile-trend-guide" x1={x(active)} x2={x(active)} y1={0} y2={H} />
              {SERIES.map((key) =>
                row[key] == null ? null : <circle key={key} className={`tile-trend-hover is-${key}`} cx={x(active)} cy={y(row[key])} r={4} />,
              )}
            </g>
          )}
        </svg>
        {row && (
          <div className="tile-trend-tip" role="status" style={{ left: `${Math.min(Math.max(x(active), 70), w - 70)}px` }}>
            {trendPointText(row, format)}
          </div>
        )}
      </div>
      <div className="tile-trend-years" style={{ paddingLeft: GUTTER }}>
        <span>{rows[0].label}</span>
        <span>{lastRow.label}</span>
      </div>
    </div>
  );
}

/**
 * icon: a lucide icon; name: the tile's name (a link when href is given);
 * info: a definition shown in an info tip; value and caption: the figure
 * and what it is; rows and format: the trend; meaning: one line.
 */
export default function HeadlineTile({ icon: Icon, name, href, info, value, caption, rows, format, meaning }) {
  return (
    <div className="forecast-tile">
      <div className="forecast-tile-head">
        <span className="forecast-tile-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="forecast-tile-name">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" title="ONS series">
              {name}
            </a>
          ) : (
            name
          )}
        </span>
        {info && (
          <span className="forecast-tile-info" tabIndex={0} role="img" aria-label={info} title={info}>
            <Info size={13} strokeWidth={1.8} aria-hidden="true" />
          </span>
        )}
      </div>
      <div>
        <p className="forecast-tile-value">{value}</p>
        <p className="forecast-tile-sub">{caption}</p>
      </div>
      <TileTrend rows={rows} name={name} format={format} />
      {meaning && <p className="forecast-tile-meaning">{meaning}</p>}
    </div>
  );
}
