// The poverty measure as two choices, worded and ordered as on Population
// impact's Poverty sub-tab (SummaryMetricChart POVERTY_CHOICES): the
// poverty line, then housing costs. A measure is "<line>_<housing>"
// ("absolute_bhc").
const LINES = [
  { value: "absolute", label: "Absolute" },
  { value: "relative", label: "Relative" },
];
const HOUSING = [
  { value: "bhc", label: "Before housing costs", badge: "Before" },
  { value: "ahc", label: "After housing costs", badge: "After" },
];

/**
 * The same two choices as option groups for a card's Options (ControlBar):
 * the poverty line, then housing costs, with the same rules as the pills.
 */
export function povertyMeasureOptions(measure, available, onChange) {
  const [line, housing] = measure.split("_");
  const has = (l, h) => available.includes(`${l}_${h}`);
  return [
    {
      label: "Poverty line",
      value: line,
      onChange: (l) => onChange(`${l}_${has(l, housing) ? housing : HOUSING.find((h) => has(l, h.value)).value}`),
      options: LINES.map((l) => ({
        ...l,
        disabled: !HOUSING.some((h) => has(l.value, h.value)),
        title: HOUSING.some((h) => has(l.value, h.value)) ? undefined : "Not available for this breakdown",
      })),
    },
    {
      label: "Housing costs",
      value: housing,
      onChange: (h) => onChange(`${has(line, h) ? line : LINES.find((l) => has(l.value, h)).value}_${h}`),
      options: HOUSING.map((h) => ({
        ...h,
        disabled: !LINES.some((l) => has(l.value, h.value)),
        title: LINES.some((l) => has(l.value, h.value)) ? undefined : "Only after housing costs for this breakdown",
      })),
    },
  ];
}
