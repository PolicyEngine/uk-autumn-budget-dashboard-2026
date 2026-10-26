/**
 * The household charts' three views, one at a time: before the selected
 * policies, after them, and the change. Each view draws one thing, and the
 * tooltip gives only what that view draws.
 */
export const CHART_VIEWS = [
  { value: "before", label: "Before", title: "Before the selected policies" },
  { value: "after", label: "After", title: "After the selected policies" },
  { value: "change", label: "Change", title: "The change the selected policies make" },
];

/**
 * The net income card's two views: net income before and after the
 * selected policies, drawn together, or the change they make.
 */
export const EARNINGS_VIEWS = [
  { value: "net", label: "Net income", title: "Net income before and after the selected policies" },
  { value: "change", label: "Change", title: "The change the selected policies make" },
];
