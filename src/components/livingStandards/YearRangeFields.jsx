import { Segmented } from "../ControlBar";
import { fyDash } from "../../utils/livingStandards/outlook";

/** "2027-28", or "27-28" on a phone (ControlBar.css swaps them). */
function YearLabel({ fy }) {
  const full = fyDash(fy);
  return (
    <>
      <span className="control-bar-year-full">{full}</span>
      <span className="control-bar-year-short">{full.slice(2)}</span>
    </>
  );
}

/**
 * The two years a card compares, inside its Options popover, as two
 * segmented rows in the popover's own style: From and To. A from year has
 * to come before the to year, so the other row's years are disabled.
 */
export default function YearRangeFields({ years, from, to, onChange }) {
  const option = (fy, disabled, title) => ({
    value: fy,
    label: <YearLabel fy={fy} />,
    ariaLabel: fyDash(fy),
    disabled,
    title: disabled ? title : undefined,
  });
  return (
    <div className="control-bar-years">
      <Segmented
        group={{
          label: "From",
          value: from,
          onChange: (value) => onChange(value, to),
          options: years.slice(0, -1).map((fy) => option(fy, fy >= to, "Choose a year before the end year")),
        }}
      />
      <Segmented
        group={{
          label: "To",
          value: to,
          onChange: (value) => onChange(from, value),
          options: years.slice(1).map((fy) => option(fy, fy <= from, "Choose a year after the start year")),
        }}
      />
    </div>
  );
}
