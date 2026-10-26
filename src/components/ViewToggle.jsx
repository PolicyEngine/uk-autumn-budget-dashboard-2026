import { ChartLine, Table } from "lucide-react";
import "./ViewToggle.css";
import useSegmentThumb from "../hooks/useSegmentThumb";

const VIEWS = [
  { value: "chart", label: "Show as chart", Icon: ChartLine },
  { value: "table", label: "Show as table", Icon: Table },
];

/**
 * Chart or table, as two icon buttons in a card's header, just left of its
 * Download button and as tall: a radio group, so the arrow keys move
 * between them. Every card with a chart/table choice uses it; the choice is
 * never in an Options pill.
 *
 * @param {Object} props
 * @param {"chart"|"table"} props.value
 * @param {(value: "chart"|"table") => void} props.onChange
 * @param {string} [props.name] - What is shown, for the group's name
 */
export default function ViewToggle({ value, onChange, name = "this card" }) {
  const { containerRef: thumbContainer, itemRef: thumbItem, ready: thumbReady, thumbStyle } = useSegmentThumb(value);
  const move = (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = value === "chart" ? "table" : "chart";
    onChange(next);
    requestAnimationFrame(() => event.currentTarget?.querySelector(`[data-value="${next}"]`)?.focus());
  };
  return (
    <div
      ref={thumbContainer}
      className={`view-toggle${thumbReady ? " has-thumb" : ""}`}
      role="radiogroup"
      aria-label={`Show ${name} as`}
      onKeyDown={move}
    >
      <span className={`segment-thumb${thumbReady ? " is-ready" : ""}`} style={thumbStyle} aria-hidden="true" />
      {VIEWS.map(({ value: v, label, Icon }) => {
        const checked = v === value;
        return (
          <button
            key={v}
            ref={thumbItem(v)}
            type="button"
            role="radio"
            data-value={v}
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            className={`view-toggle-button${checked ? " is-checked" : ""}`}
            onClick={() => onChange(v)}
          >
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
