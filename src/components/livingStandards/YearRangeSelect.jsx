import PillSelect from "../PillSelect";
import { fyDash } from "../../utils/livingStandards/outlook";

/**
 * "[2027-28 ▾] → [2031-32 ▾]": the two years a card compares, as one pill
 * holding two lists. A from year has to come before the to year, so the
 * lists offer only those.
 */
export default function YearRangeSelect({ years, from, to, onChange }) {
  const option = (fy) => ({ value: fy, label: fyDash(fy) });
  return (
    <span className="ls-range" role="group" aria-label="Years compared">
      <PillSelect
        variant="light"
        name="Compare from"
        value={from}
        onChange={(value) => onChange(value, to)}
        options={years.slice(0, -1).map((fy) => ({ ...option(fy), disabled: fy >= to, title: fy >= to ? "Choose a year before the end year" : undefined }))}
      />
      <span className="ls-range-arrow" aria-hidden="true">→</span>
      <PillSelect
        variant="light"
        name="Compare to"
        value={to}
        onChange={(value) => onChange(from, value)}
        options={years.slice(1).map((fy) => ({ ...option(fy), disabled: fy <= from, title: fy <= from ? "Choose a year after the start year" : undefined }))}
      />
    </span>
  );
}
