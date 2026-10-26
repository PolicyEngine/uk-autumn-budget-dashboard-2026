import { VIEW_OPTIONS } from "../../utils/livingStandards/baseline";

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
