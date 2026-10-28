/**
 * The household charts' three views, one at a time: before the selected
 * policies, after them, and the change. Each view draws one thing, and the
 * tooltip gives only what that view draws.
 */
export const CHART_VIEWS = [
  { value: "before", label: "Current law", title: "Under current law" },
  { value: "after", label: "With the policies", title: "With the selected policies" },
  { value: "change", label: "Change", title: "The change the selected policies make" },
];
