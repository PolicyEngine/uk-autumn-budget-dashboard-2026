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
