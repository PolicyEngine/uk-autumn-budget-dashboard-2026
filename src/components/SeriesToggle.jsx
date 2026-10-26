import "./SeriesToggle.css";
import Tip from "./Tip";

/**
 * Line toggle chips for a multi-line chart: one chip per line, in the
 * line's colour (and dash), that shows or hides it. Several can be on at
 * once; the last one on stays on. Hovering or focusing a chip highlights
 * its line (`onHover`). The chips are the chart's key, so the chart draws
 * no separate legend naming the same lines.
 *
 * The chart keeps the state, so a view can start with some lines off:
 *
 *   const [shown, setShown] = useState(series.map((s) => s.key));
 *   <SeriesToggle series={series} shown={shown} onChange={setShown} onHover={setHovered} />
 *
 * @param {Object} props
 * @param {Array<{key: string, label: string, colour: string, dash?: string, short?: string}>} props.series
 * @param {string[]} props.shown - The keys of the lines drawn
 * @param {(keys: string[]) => void} props.onChange - The next keys drawn, in `series` order
 * @param {(key: string|null) => void} [props.onHover]
 * @param {string} [props.label] - What the chips are, for screen readers ("Lines")
 * @param {boolean} [props.narrow] - Short labels (`short`) where given
 */
export default function SeriesToggle({ series, shown, onChange, onHover, label = "Lines", narrow = false }) {
  const on = new Set(shown);
  const toggle = (key) => {
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
    <div className="series-toggle" role="group" aria-label={`${label}: show or hide`}>
      {series.map((s) => {
        const active = on.has(s.key);
        const last = active && on.size === 1;
        return (
          <Tip key={s.key} content={last ? `${s.label}: at least one line stays on` : null}>
          <button
            type="button"
            className={`series-toggle-chip${active ? " is-on" : ""}`}
            aria-pressed={active}
            aria-disabled={last || undefined}
            onClick={() => toggle(s.key)}
            onMouseEnter={() => onHover?.(active ? s.key : null)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(active ? s.key : null)}
            onBlur={() => onHover?.(null)}
          >
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
            <span>{narrow && s.short ? s.short : s.label}</span>
          </button>
          </Tip>
        );
      })}
    </div>
  );
}
