import { VIEW_OPTIONS } from "../../utils/livingStandards/baseline";
import { fyDash } from "../../utils/livingStandards/outlook";
import YearRangeFields from "./YearRangeFields";

// The summary words for the Period choice on a card's Options button
// (ControlBar): "Both" alone would not say both of what
const PERIOD_SUMMARY = { outturn: "Official figures", both: "Official and PolicyEngine", forecast: "PolicyEngine" };

/**
 * The lines shown (official figures, both, PolicyEngine) as an Options
 * group. `noOutturnReason`, when set, disables Official figures and says why.
 */
export function periodOption(value, onChange, noOutturnReason = null) {
  return {
    label: "Lines",
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

// "OBR March 2026", "March 2026 forecast" -> "March 2026"
const forecastMonth = (name) => String(name || "").replace(/^OBR,?\s+/, "").replace(/\s+forecast$/, "");

/**
 * The forecasts a card draws (the earlier, the later or both) as an
 * Options group: `shown` is the card's list of drawn forecasts ("pre",
 * "post"), `onChange` takes the new list. The summary reads "March and
 * October 2026" for both (one year said once when they share it), else
 * "October 2026 forecast". The names may carry "OBR" or "forecast";
 * neither is repeated.
 */
export function forecastsOption(shown, onChange, preName, postName) {
  const pre = forecastMonth(preName);
  const post = forecastMonth(postName);
  const [preMonth, preYear] = [pre.replace(/\s+\d{4}$/, ""), pre.match(/\d{4}$/)?.[0]];
  const bothWords = preYear && post.endsWith(preYear) ? `${preMonth} and ${post}` : `${pre} and ${post}`;
  const value = shown.includes("pre") && shown.includes("post") ? "both" : shown.includes("post") ? "post" : "pre";
  return {
    label: "Forecasts",
    value,
    onChange: (next) => onChange(next === "both" ? ["pre", "post"] : [next]),
    options: [
      { value: "both", label: "Both", summary: bothWords },
      { value: "pre", label: pre, summary: `${pre} forecast` },
      { value: "post", label: post, summary: `${post} forecast` },
    ],
  };
}
