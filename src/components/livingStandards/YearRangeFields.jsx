import { fyDash } from "../../utils/livingStandards/outlook";

/**
 * The two years a card compares, as two compact lists inside its Options
 * popover: "[2027-28] → [2031-32]". A from year has to come before the to
 * year, so each list offers only those.
 */
export default function YearRangeFields({ years, from, to, onChange }) {
  return (
    <div className="control-bar-years">
      <select
        className="control-bar-select"
        aria-label="Compare from"
        value={from}
        onChange={(event) => onChange(event.target.value, to)}
      >
        {years.slice(0, -1).map((fy) => (
          <option key={fy} value={fy} disabled={fy >= to}>
            {fyDash(fy)}
          </option>
        ))}
      </select>
      <span aria-hidden="true">→</span>
      <select
        className="control-bar-select"
        aria-label="Compare to"
        value={to}
        onChange={(event) => onChange(from, event.target.value)}
      >
        {years.slice(1).map((fy) => (
          <option key={fy} value={fy} disabled={fy <= from}>
            {fyDash(fy)}
          </option>
        ))}
      </select>
    </div>
  );
}
