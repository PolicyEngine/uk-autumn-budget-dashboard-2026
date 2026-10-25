import "./ViewSwitch.css";

/**
 * An icon switch between a card's views, styled as the OBR comparison's
 * Chart / Table switch: one button per view, each with an icon and a
 * label, the current one pressed (aria-pressed). Buttons, so Tab reaches
 * each and Enter or Space chooses it.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string, icon?: JSX.Element, title?: string}>} props.options
 *   - `title`, the full name where `label` is short
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.label - The group's accessible name
 * @param {boolean} [props.compact] - The in-card size, as tall as the
 *   in-card pills beside it
 */
function ViewSwitch({ options, value, onChange, label, compact = false }) {
  return (
    <div
      className={`obr-view-switch${compact ? " is-compact" : ""}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="obr-view-option"
          aria-pressed={value === option.value}
          title={option.title ?? option.label}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export const MapIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path
      d="M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5zM5.5 2v10.5M10.5 3.5V14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export const ListIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path
      d="M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5M2 4h.5M2 8h.5M2 12h.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export default ViewSwitch;
