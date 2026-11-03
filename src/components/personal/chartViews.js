/**
 * The household charts' four views: before the selected policies, after
 * them, both together (two total lines, no parts; Vahid, 28 October), and
 * the change. The tooltip gives only what the view draws.
 */
export const CHART_VIEWS = [
  { value: "before", label: "Current law", title: "Under current law" },
  { value: "after", label: "With the policies", title: "With the selected policies" },
  { value: "both", label: "Both", title: "Under current law and with the selected policies" },
  { value: "change", label: "Change", title: "The change the selected policies make" },
];
