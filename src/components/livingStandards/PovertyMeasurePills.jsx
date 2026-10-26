import PillSelect from "../PillSelect";

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
 * "Poverty line: [Absolute ▾]  Housing costs: [Before ▾]" for a measure
 * among `available`; a pair the data lacks is listed but disabled, and
 * choosing a line keeps the housing basis where it can.
 */
export default function PovertyMeasurePills({ measure, available, onChange }) {
  const [line, housing] = measure.split("_");
  const has = (l, h) => available.includes(`${l}_${h}`);
  const chooseLine = (l) => onChange(`${l}_${has(l, housing) ? housing : HOUSING.find((h) => has(l, h.value)).value}`);
  const chooseHousing = (h) => onChange(`${has(line, h) ? line : LINES.find((l) => has(l.value, h)).value}_${h}`);
  return (
    <>
      <PillSelect
        variant="light"
        prefix="Poverty line"
        name="Poverty line"
        value={line}
        onChange={chooseLine}
        options={LINES.map((l) => ({
          ...l,
          disabled: !HOUSING.some((h) => has(l.value, h.value)),
          title: HOUSING.some((h) => has(l.value, h.value)) ? undefined : "Not available for this breakdown",
        }))}
      />
      <PillSelect
        variant="light"
        prefix="Housing costs"
        name="Housing costs"
        value={housing}
        onChange={chooseHousing}
        options={HOUSING.map((h) => ({
          ...h,
          disabled: !LINES.some((l) => has(l.value, h.value)),
          title: LINES.some((l) => has(l.value, h.value)) ? undefined : "Only after housing costs for this breakdown",
        }))}
      />
    </>
  );
}
