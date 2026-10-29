import { fiscalYearTick } from "../../utils/chartTheme";
import { money } from "../../utils/singleYear";
import { monthlyPay, policyYearMonths } from "../../utils/surplusEarnings";
import { NumberField } from "./FormControls";
import "./MonthlyPayField.css";

// The policy year whose claims the Budget's £2,500 threshold reaches
const MEASURE_YEAR = 2027;
const MAX_MONTH = 100000;

/**
 * Pay before tax in each month of the year shown, April to March, for the
 * Universal Credit surplus earnings threshold measure: one £ box a month
 * (and one for a partner), prefilled with the yearly salary spread evenly,
 * with what the months add up to. Only that measure reads them; every
 * other figure comes from the yearly salary.
 *
 * @param {Object} props
 * @param {number} props.year - The policy year shown (April `year` to March)
 * @param {Array<number|null>|null} props.months - The months entered; null
 *   (or a null month) is the yearly salary spread evenly
 * @param {number} props.salary - The yearly salary the prefill spreads
 * @param {(months: Array<number|null>|null) => void} props.onChange
 * @param {boolean} [props.partner] - Ask the partner's months too
 * @param {Array<number|null>|null} [props.partnerMonths]
 * @param {number} [props.partnerSalary]
 * @param {(months: Array<number|null>|null) => void} [props.onPartnerChange]
 */
export default function MonthlyPayField({
  year,
  months,
  salary,
  onChange,
  partner = false,
  partnerMonths = null,
  partnerSalary = 0,
  onPartnerChange = () => {},
}) {
  const names = policyYearMonths(year);
  const pay = monthlyPay(months, salary);
  const partnerPay = monthlyPay(partnerMonths, partnerSalary);
  const total = (amounts) => amounts.reduce((sum, value) => sum + value, 0);
  // One month entered, the others as they stand
  const withMonth = (entered, index, value) => names.map((_, i) => (i === index ? value : (entered?.[i] ?? null)));
  const entered = (list) => Array.isArray(list) && list.some((value) => value !== null && value !== undefined);
  const yearLabel = fiscalYearTick(year);
  const box = (who, index, value, list, change) => (
    <NumberField
      id={`${who}_month_${index}`}
      label={`${who === "partner" ? "Your partner's" : "Your"} pay in ${names[index].label}`}
      hideLabel
      value={value}
      min={0}
      max={MAX_MONTH}
      step={100}
      money
      onChange={(next) => change(withMonth(list, index, next))}
    />
  );
  return (
    <div className="monthly-pay" role="group" aria-labelledby="monthly-pay-title" aria-describedby="monthly-pay-hint">
      <p className="field-label monthly-pay-title" id="monthly-pay-title">
        Pay before tax in each month of {yearLabel}
      </p>
      <p className="field-hint" id="monthly-pay-hint">
        As paid in each month, such as a month with a bonus. Prefilled with your yearly salary spread evenly. Only the Universal
        Credit surplus earnings threshold uses these months: every other figure comes from your yearly salary.
        {year !== MEASURE_YEAR &&
          ` The Budget keeps the £2,500 threshold only for claims from April 2027 to March 2028, so in ${yearLabel} these months change nothing.`}
      </p>
      <table className={`monthly-pay-table${partner ? " has-partner" : ""}`}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">You</th>
            {partner && <th scope="col">Partner</th>}
          </tr>
        </thead>
        <tbody>
          {names.map((name, index) => (
            <tr key={name.key}>
              <th scope="row">
                <span aria-hidden="true">{name.short}</span>
                <span className="visually-hidden">{name.label}</span>
              </th>
              <td>{box("you", index, pay[index], months, onChange)}</td>
              {partner && <td>{box("partner", index, partnerPay[index], partnerMonths, onPartnerChange)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint monthly-pay-total" role="status">
        These months add up to {money(total(pay))} a year
        {partner ? `; your partner's to ${money(total(partnerPay))}` : ""}.
      </p>
      {(entered(months) || (partner && entered(partnerMonths))) && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onChange(null);
            if (partner) onPartnerChange(null);
          }}
        >
          Spread your yearly salary evenly
        </button>
      )}
    </div>
  );
}
