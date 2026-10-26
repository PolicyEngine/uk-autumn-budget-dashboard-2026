import { useEffect, useState } from "react";
import "./SeriesToggle.css";
import Tip from "./Tip";

const HINT_KEY = "pe-series-toggle-hint-seen";

/** Whether the reader has clicked a chip in this session (sessionStorage, if it can be read). */
function hintSeen() {
  try {
    return window.sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintSeen() {
  try {
    window.sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    // Private browsing or blocked storage: the hint just shows again
  }
}

/**
 * Line toggle chips for a multi-line chart: "Show lines:" then one chip per
 * line that shows or hides it. A chip that is on is tinted in its line's
 * colour, with a check and its swatch; one that is off is outlined and
 * muted, its swatch hollow. Several can be on at once; the last one on
 * stays on. Hovering or focusing a chip highlights its line (`onHover`).
 * Until the reader first clicks a chip in the session, a quiet "Click to
 * show or hide" line sits under them. The chips are the chart's key, so
 * the chart draws no separate legend naming the same lines.
 *
 * The chart keeps the state, so a view can start with some lines off:
 *
 *   const [shown, setShown] = useState(series.map((s) => s.key));
 *   <SeriesToggle series={series} shown={shown} onChange={setShown} onHover={setHovered} />
 *
 * @param {Object} props
 * @param {Array<{key: string, label: string, colour: string, dash?: string, short?: string, shape?: "line"|"block", disabled?: boolean, tip?: string}>} props.series
 *   (`shape: "block"` for a filled layer: a square swatch; `disabled` for one
 *   with nothing to draw, kept so two keys line up, with `tip` saying why)
 * @param {string[]} props.shown - The keys of the lines drawn
 * @param {(keys: string[]) => void} props.onChange - The next keys drawn, in `series` order
 * @param {(key: string|null) => void} [props.onHover]
 * @param {string} [props.label] - What the chips are, for screen readers ("Lines")
 * @param {boolean} [props.narrow] - Short labels (`short`) where given
 * @param {string} [props.lead] - The lead-in before the chips ("Show lines:"; "Show:" for layers)
 * @param {Array<{key: string, label: string, fill: string}>} [props.extras] - Key
 *   items that are not lines (the selected year's shading), after the chips,
 *   as a swatch and a label, not a button
 */
export default function SeriesToggle({ series, shown, onChange, onHover, label = "Lines", narrow = false, extras = [], lead = "Show lines:" }) {
  // Read after mount, so the server and first render agree
  const [hint, setHint] = useState(false);
  useEffect(() => {
    setHint(!hintSeen());
  }, []);
  const off = new Set(series.filter((s) => s.disabled).map((s) => s.key));
  const on = new Set(shown.filter((key) => !off.has(key)));
  const toggle = (key) => {
    if (off.has(key)) return;
    if (hint) {
      markHintSeen();
      setHint(false);
    }
    if (on.has(key)) {
      // The last line on stays on: a chart with none says nothing
      if (on.size === 1) return;
      on.delete(key);
    } else {
      on.add(key);
    }
    onChange(series.map((s) => s.key).filter((k) => on.has(k)));
  };
  return (
    <div className="series-toggle-wrap">
      <div className="series-toggle" role="group" aria-label={`${label}: show or hide`}>
        <span className="series-toggle-lead" aria-hidden="true">
          {lead}
        </span>
        {series.map((s) => {
          const active = on.has(s.key);
          const last = active && on.size === 1;
          return (
            <Tip key={s.key} content={s.disabled ? s.tip ?? null : last ? `${s.label}: at least one line stays on` : null}>
            <button
              type="button"
              className={`series-toggle-chip${active ? " is-on" : ""}${s.disabled ? " is-disabled" : ""}`}
              style={{ "--chip-colour": s.colour }}
              aria-pressed={active}
              aria-disabled={last || s.disabled || undefined}
              onClick={() => toggle(s.key)}
              onMouseEnter={() => onHover?.(active ? s.key : null)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(active ? s.key : null)}
              onBlur={() => onHover?.(null)}
            >
              <svg className="series-toggle-check" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                {active && <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
{s.shape === "block" ? (
                // A filled layer (a stacked band): a square swatch
                <svg className="series-toggle-swatch" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" rx="2" fill={s.colour} />
                </svg>
              ) : (
                            <svg className="series-toggle-swatch" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
                <line
                  x1="1"
                  y1="5"
                  x2="17"
                  y2="5"
                  stroke={s.colour}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={s.dash}
                />
              </svg>
              )}
              <span className="series-toggle-label">{narrow && s.short ? s.short : s.label}</span>
            </button>
            </Tip>
          );
        })}
        {extras.map((item) => (
          <span key={item.key} className="series-toggle-extra">
            <span className="series-toggle-band" style={{ background: item.fill }} aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </div>
      {hint && <p className="series-toggle-hint">Click to show or hide</p>}
    </div>
  );
}
