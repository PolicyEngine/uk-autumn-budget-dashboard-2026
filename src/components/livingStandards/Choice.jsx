import PillSelect from "../PillSelect";

/**
 * An in-card choice: the dashboard's light pill, "Measure [Absolute (BHC)] ▼".
 * options: [{ id, label, disabled?, title? }]
 */
export default function Choice({ fieldLabel, label, value, onChange, options }) {
  return (
    <PillSelect
      variant="light"
      name={label}
      prefix={fieldLabel}
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.id, label: o.label, disabled: o.disabled, title: o.title }))}
    />
  );
}
