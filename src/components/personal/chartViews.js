/**
 * The household charts' four views: before the selected policies, after
 * them, both together (two total lines, no parts; Vahid, 28 October), and
 * the change. The tooltip gives only what the view draws.
 */
export const CHART_VIEWS = [
  { value: "before", label: "Pre-Budget", title: "Under pre-Budget policy" },
  { value: "after", label: "With Budget policies", title: "With the selected Budget policies" },
  { value: "both", label: "Both", title: "Under pre-Budget policy and with the selected Budget policies" },
  { value: "change", label: "Change", title: "The change the selected policies make" },
];
