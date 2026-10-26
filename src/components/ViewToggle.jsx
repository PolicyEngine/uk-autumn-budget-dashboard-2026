import { ChartLine, Table } from "lucide-react";
import "./ViewToggle.css";
import Tip from "./Tip";

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
  const move = (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = value === "chart" ? "table" : "chart";
    onChange(next);
    requestAnimationFrame(() => event.currentTarget?.querySelector(`[data-value="${next}"]`)?.focus());
  };
  return (
    <div className="view-toggle" role="radiogroup" aria-label={`Show ${name} as`} onKeyDown={move}>
      {VIEWS.map(({ value: v, label, Icon }) => {
        const checked = v === value;
        return (
          <Tip key={v} content={label}>
          <button
            type="button"
            role="radio"
            data-value={v}
            aria-checked={checked}
            aria-label={label}
            tabIndex={checked ? 0 : -1}
            className={`view-toggle-button${checked ? " is-checked" : ""}`}
            onClick={() => onChange(v)}
          >
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          </Tip>
        );
      })}
    </div>
  );
}
