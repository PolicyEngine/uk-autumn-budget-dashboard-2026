import { VIEW_OPTIONS } from "../../utils/livingStandards/baseline";
import { fyDash } from "../../utils/livingStandards/outlook";
import YearRangeFields from "./YearRangeFields";

// The summary words for the Period choice on a card's Options button
// (ControlBar): "Both" alone would not say both of what
const PERIOD_SUMMARY = { outturn: "Outturn", both: "Outturn and projection", forecast: "Projection" };

/**
 * The Period choice (outturn, both, projection) as an Options group.
 * `noOutturnReason`, when set, disables Outturn and says why.
 */
export function periodOption(value, onChange, noOutturnReason = null) {
  return {
    label: "Period",
    value,
    onChange,
    options: VIEW_OPTIONS.map((option) => ({
      ...option,
      summary: PERIOD_SUMMARY[option.value],
      ...(option.value === "outturn" && noOutturnReason ? { disabled: true, title: noOutturnReason } : {}),
    })),
  };
}

/** Housing costs as an Options group, worded as everywhere on the page. */
export function housingOption(value, onChange, ids = ["bhc", "ahc"]) {
  return {
    label: "Housing costs",
    value,
    onChange,
    options: ids.map((id) => ({ value: id, label: id === "bhc" ? "Before housing costs" : "After housing costs" })),
  };
}

/**
 * The two years a card compares as the first Options group ("2027-28 →
 * 2031-32"): two compact lists in the popover. Every card comparing two
 * years reads and writes the same ?ls_from / ?ls_to (useYearRange), so
 * they stay in step. Null when there is nothing to choose.
 */
export function yearsOption(years, range, onChange) {
  if (!range || !onChange || years.length <= 2) return null;
  return {
    label: "Years compared",
    summary: `${fyDash(range[0])} → ${fyDash(range[1])}`,
    control: <YearRangeFields years={years} from={range[0]} to={range[1]} onChange={onChange} />,
  };
}
