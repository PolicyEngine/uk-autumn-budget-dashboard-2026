import { measureRamp } from "../../utils/chartTheme";
import silhouette from "./silhouette.json";

// The drawing's own units: the page column's width
const W = 1120;
const H = 680;
const PLOT = { left: 120, right: W - 60, top: 300, bottom: H - 40 };

const colourOf = (() => {
  const ramps = {};
  return ({ direction, rank, of }) => (ramps[`${direction}:${of}`] ??= measureRamp(direction, of))[rank];
})();

/**
 * The landing page's background: a silhouette of Population impact's Public
 * finances view (its sub-tabs, heading and Revenue impact chart), drawn
 * from silhouette.json (scripts/landing-silhouette.mjs), so it paints with
 * the page and needs no data. LandingPage.css fades and blurs it; it is
 * decoration only, hidden from assistive tech.
 */
export default function LandingBackdrop() {
  const { years, bars } = silhouette;
  const stacks = years.map((_, i) => {
    let up = 0;
    let down = 0;
    return bars.map((bar) => {
      const value = bar.values[i];
      const from = value >= 0 ? up : down;
      if (value >= 0) up += value;
      else down += value;
      return { bar, from, to: from + value };
    });
  });
  const top = Math.max(1, ...stacks.flat().map((s) => Math.max(s.from, s.to)));
  const bottom = Math.min(-1, ...stacks.flat().map((s) => Math.min(s.from, s.to)));
  const y = (v) => PLOT.top + ((top - v) / (top - bottom)) * (PLOT.bottom - PLOT.top);
  const step = (PLOT.right - PLOT.left) / years.length;
  const barW = step * 0.8;
  return (
    <div className="landing-backdrop" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMin slice" focusable="false">
        {/* The sub-tabs */}
        <rect className="lb-band" x="0" y="0" width={W} height="52" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} className={i === 0 ? "lb-pill is-chosen" : "lb-pill"} x={8 + i * 168} y="10" width={i === 0 ? 150 : 132} height="32" rx="16" />
        ))}
        {/* The section heading */}
        <circle className="lb-icon" cx="20" cy="104" r="20" />
        <rect className="lb-text is-strong" x="56" y="92" width="190" height="20" rx="6" />
        <rect className="lb-text" x="56" y="124" width="520" height="12" rx="6" />
        {/* The Revenue impact card */}
        <rect className="lb-card" x="0.5" y="168.5" width={W - 1} height={H} rx="12" />
        <rect className="lb-text is-strong" x="28" y="196" width="160" height="18" rx="6" />
        <rect className="lb-text" x="28" y="232" width="560" height="12" rx="6" />
        {[top, top / 2, 0, bottom / 2, bottom].map((v) => (
          <line key={v} className={v === 0 ? "lb-zero" : "lb-grid"} x1={PLOT.left - 30} x2={PLOT.right} y1={y(v)} y2={y(v)} />
        ))}
        {stacks.map((stack, i) =>
          stack
            .filter((s) => s.to !== s.from)
            .map((s, k) => (
              <rect
                key={`${i}-${k}`}
                x={PLOT.left + i * step + (step - barW) / 2}
                y={y(Math.max(s.from, s.to))}
                width={barW}
                height={Math.abs(y(s.to) - y(s.from))}
                fill={colourOf(s.bar)}
              />
            )),
        )}
      </svg>
    </div>
  );
}
