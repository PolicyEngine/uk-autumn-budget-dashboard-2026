import { useId, useState } from "react";
import "./HouseholdForm.css";

/**
 * The Personal impact view's questions about a household.
 *
 * The core questions are those PolicyEngine's household builder (app-v2)
 * and the UK dashboards' calculators ask: your age and earnings, a partner,
 * children's ages, region, Universal Credit and housing. Below them, only
 * the income and spending the selected measures act through are asked
 * (MEASURE_FIELDS); a measure that acts on every household asks nothing
 * more. Submits the household in the shape the household impact app takes
 * (snake_case, amounts in £ a year except the monthly rent).
 */

export const REGIONS = [
  ["NORTH_EAST", "North East"],
  ["NORTH_WEST", "North West"],
  ["YORKSHIRE", "Yorkshire and the Humber"],
  ["EAST_MIDLANDS", "East Midlands"],
  ["WEST_MIDLANDS", "West Midlands"],
  ["EAST_OF_ENGLAND", "East of England"],
  ["LONDON", "London"],
  ["SOUTH_EAST", "South East"],
  ["SOUTH_WEST", "South West"],
  ["WALES", "Wales"],
  ["SCOTLAND", "Scotland"],
  ["NORTHERN_IRELAND", "Northern Ireland"],
];

export const TENURES = [
  ["OWNED_OUTRIGHT", "Own outright"],
  ["OWNED_WITH_MORTGAGE", "Own with a mortgage"],
  ["RENT_PRIVATELY", "Rent privately"],
  ["RENT_FROM_COUNCIL", "Rent from a council"],
  ["RENT_FROM_HA", "Rent from a housing association"],
];

const RENTING = new Set(["RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA"]);

// The income and spending a measure acts through, for measures that act
// only through them (as household_impact.MEASURE_INPUTS in the app)
export const MEASURE_FIELDS = {
  dividend_tax_increase_2pp: [["dividend_income", "Dividends (£ a year)"]],
  savings_tax_increase_2pp: [["savings_interest_income", "Savings interest (£ a year)"]],
  property_tax_increase_2pp: [["property_income", "Rental and other property income (£ a year)"]],
  fuel_duty_freeze: [
    ["petrol_spending", "Petrol (£ a year)"],
    ["diesel_spending", "Diesel (£ a year)"],
  ],
  salary_sacrifice_cap: [
    [
      "salary_sacrifice_pension_contributions",
      "Pension contributions through salary sacrifice (£ a year)",
    ],
  ],
};

const EXTRA_KEYS = Object.values(MEASURE_FIELDS).flat().map(([key]) => key);

const DEFAULTS = {
  age: "40",
  employment_income: "35000",
  has_partner: false,
  partner_age: "40",
  partner_employment_income: "0",
  children_ages: "",
  region: "LONDON",
  claims_universal_credit: false,
  tenure: "OWNED_WITH_MORTGAGE",
  monthly_rent: "0",
  ...Object.fromEntries(EXTRA_KEYS.map((key) => [key, "0"])),
};

const AGE_PROBLEM = "Enter an age from 16 to 100";
const AMOUNT_PROBLEM = "Enter an amount of £0 or more";
const CHILDREN_PROBLEM = "Enter children's ages from 0 to 19, separated by commas";

function readAge(text) {
  const age = Number(text);
  return Number.isInteger(age) && age >= 16 && age <= 100 ? age : null;
}

function readAmount(text) {
  const amount = Number(text);
  return text.trim() !== "" && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function readChildren(text) {
  if (text.trim() === "") return [];
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length > 10 || !parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  const ages = parts.map(Number);
  return ages.every((age) => age <= 19) ? ages : null;
}

/** The household in the app's shape, or the first problem with it. */
function readHousehold(answers, askedKeys) {
  const age = readAge(answers.age);
  if (age === null) return { problem: AGE_PROBLEM };
  const amounts = {};
  const amountKeys = ["employment_income", ...askedKeys];
  if (answers.has_partner) amountKeys.push("partner_employment_income");
  if (RENTING.has(answers.tenure)) amountKeys.push("monthly_rent");
  for (const key of amountKeys) {
    const amount = readAmount(answers[key]);
    if (amount === null) return { problem: AMOUNT_PROBLEM };
    amounts[key] = amount;
  }
  let partnerAge = Number(DEFAULTS.partner_age);
  if (answers.has_partner) {
    partnerAge = readAge(answers.partner_age);
    if (partnerAge === null) return { problem: AGE_PROBLEM };
  }
  const childrenAges = readChildren(answers.children_ages);
  if (childrenAges === null) return { problem: CHILDREN_PROBLEM };
  return {
    household: {
      age,
      employment_income: amounts.employment_income,
      has_partner: answers.has_partner,
      partner_age: partnerAge,
      partner_employment_income: amounts.partner_employment_income ?? 0,
      children_ages: childrenAges,
      region: answers.region,
      claims_universal_credit: answers.claims_universal_credit,
      tenure: answers.tenure,
      monthly_rent: amounts.monthly_rent ?? 0,
      ...Object.fromEntries(EXTRA_KEYS.map((key) => [key, amounts[key] ?? 0])),
    },
  };
}

function HouseholdForm({ selectedPolicies, onSubmit, disabled = false }) {
  const [answers, setAnswers] = useState(DEFAULTS);
  const [problem, setProblem] = useState(null);
  const formId = useId();
  const fieldId = (key) => `${formId}-${key}`;

  // The extra questions the selected measures need, each asked once
  const extraFields = [];
  for (const policy of selectedPolicies) {
    for (const field of MEASURE_FIELDS[policy] ?? []) {
      if (!extraFields.some(([key]) => key === field[0])) extraFields.push(field);
    }
  }

  const set = (key) => (event) => {
    const { type, checked, value } = event.target;
    setAnswers((current) => ({ ...current, [key]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const { household, problem: found } = readHousehold(
      answers,
      extraFields.map(([key]) => key),
    );
    setProblem(found ?? null);
    if (household) onSubmit(household);
  };

  const numberField = (key, label, extra = {}) => (
    <div className="household-field" key={key}>
      <label htmlFor={fieldId(key)}>{label}</label>
      <input
        id={fieldId(key)}
        type="number"
        inputMode="decimal"
        min="0"
        value={answers[key]}
        onChange={set(key)}
        {...extra}
      />
    </div>
  );

  return (
    <form className="household-form" onSubmit={handleSubmit} noValidate>
      <div className="household-form-grid">
        {numberField("age", "Your age", { min: "16", max: "100", inputMode: "numeric" })}
        {numberField("employment_income", "Your employment income (£ a year)")}

        <div className="household-field household-check">
          <input
            id={fieldId("has_partner")}
            type="checkbox"
            checked={answers.has_partner}
            onChange={set("has_partner")}
          />
          <label htmlFor={fieldId("has_partner")}>I live with a partner</label>
        </div>
        {answers.has_partner && (
          <>
            {numberField("partner_age", "Partner's age", {
              min: "16",
              max: "100",
              inputMode: "numeric",
            })}
            {numberField("partner_employment_income", "Partner's employment income (£ a year)")}
          </>
        )}

        <div className="household-field">
          <label htmlFor={fieldId("children_ages")}>Children&apos;s ages</label>
          <input
            id={fieldId("children_ages")}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 3, 7"
            aria-describedby={`${fieldId("children_ages")}-hint`}
            value={answers.children_ages}
            onChange={set("children_ages")}
          />
          <p id={`${fieldId("children_ages")}-hint`} className="household-hint">
            Separated by commas. Leave blank if none.
          </p>
        </div>

        <div className="household-field">
          <label htmlFor={fieldId("region")}>Region</label>
          <select id={fieldId("region")} value={answers.region} onChange={set("region")}>
            {REGIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="household-field">
          <label htmlFor={fieldId("tenure")}>Housing</label>
          <select id={fieldId("tenure")} value={answers.tenure} onChange={set("tenure")}>
            {TENURES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {RENTING.has(answers.tenure) && numberField("monthly_rent", "Monthly rent (£)")}

        <div className="household-field household-check">
          <input
            id={fieldId("claims_universal_credit")}
            type="checkbox"
            checked={answers.claims_universal_credit}
            onChange={set("claims_universal_credit")}
          />
          <label htmlFor={fieldId("claims_universal_credit")}>
            My household claims Universal Credit
          </label>
        </div>
      </div>

      {extraFields.length > 0 && (
        <fieldset className="household-extra">
          <legend>More about your income and spending</legend>
          <p className="household-hint">
            The selected policies act through these. Leave a field at £0 if it
            doesn&apos;t apply.
          </p>
          <div className="household-form-grid">
            {extraFields.map(([key, label]) => numberField(key, label))}
          </div>
        </fieldset>
      )}

      {problem && (
        <p className="household-problem" role="alert">
          {problem}
        </p>
      )}

      <button type="submit" className="household-submit" disabled={disabled}>
        Calculate
      </button>
    </form>
  );
}

export default HouseholdForm;
