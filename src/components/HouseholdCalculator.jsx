import { useState, useEffect, useMemo } from "react";
import * as d3 from "d3";
import { fiscalYearTick } from "../utils/chartTheme";
import { YOUNG_PERSON_PRESETS } from "../utils/youngPersonPresets";
import SectionHeading from "./SectionHeading";
import UnavailableNotice from "./publication/UnavailableNotice";
import { SingleYearDetails, SingleYearHeadline } from "./personal/SingleYearResults";
import useHouseholdImpact from "../hooks/useHouseholdImpact";
import {
  CHILD_AGE_MESSAGE,
  OLDEST_CHILD_AGE,
  asksEducation,
  atStatePensionAge,
  isRenting,
  parseChildrenAges,
  statePensionFor,
} from "../utils/householdImpactApi";
import { DEFAULT_SALARY, DEFAULT_SPENDING, SALARY_SOURCE, regionalRent } from "../utils/householdDefaults";
import { ChoiceTiles, NumberField } from "./personal/FormControls";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import "./HouseholdCalculator.css";

// The form's answers, each at a typical value until changed. Sources:
// utils/householdDefaults.js
export const WIZARD_DEFAULTS = {
  current_age: 30,
  current_salary: DEFAULT_SALARY,
  region: "NORTH_WEST",
  tenure: "RENT_PRIVATELY",
  // null: the region's average private rent (ONS), until changed
  monthly_rent: null,
  // policyengine-uk's repayment depends on the plan and income alone: the
  // balance only caps a year's repayment, and is not asked for
  student_loan_plan: "NONE",
  has_partner: false,
  partner_age: 30,
  partner_salary: DEFAULT_SALARY,
  children_ages: "",
  // Per child, in the order of children_ages: whether a 16- to 19-year-old
  // is in full-time non-advanced education (school or college); yes until
  // answered
  children_in_education: [],
  // Entitlement: the household claims what it is due
  claims_universal_credit: true,
  council_tax_band: "D",
  salary_sacrifice_per_year: 0,
  petrol_spending_per_year: DEFAULT_SPENDING.petrol,
  diesel_spending_per_year: DEFAULT_SPENDING.diesel,
  electricity_spending_per_year: DEFAULT_SPENDING.electricity,
  dividends_per_year: 0,
  savings_interest_per_year: 0,
  property_income_per_year: 0,
  // Private and workplace pensions in payment, £ a year
  private_pension_per_year: 0,
  partner_private_pension_per_year: 0,
  monthly_childcare: 0,
  // At State Pension age; null is the full new State Pension for the year
  state_pension_per_year: null,
  partner_state_pension_per_year: null,
};

// The form: one list of questions, each a row showing its answer that opens
// in place to change it. The essentials first, then the optional details.
// `children` stands for one row per child (their age and, from 16, their
// education).
export const FORM_SECTIONS = [
  {
    title: null,
    fields: [
      "current_age",
      "current_salary",
      "region",
      "has_partner",
      "partner_age",
      "partner_salary",
      "children_count",
      "children",
      "tenure",
      "monthly_rent",
    ],
  },
  {
    title: "More details",
    fields: [
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "private_pension_per_year",
      "partner_private_pension_per_year",
      "state_pension_per_year",
      "partner_state_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
      "petrol_spending_per_year",
      "diesel_spending_per_year",
      "electricity_spending_per_year",
      "council_tax_band",
      "monthly_childcare",
      "claims_universal_credit",
    ],
  },
];

export const REGION_OPTIONS = [
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

const YES_NO = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

const MAX_CHILDREN = 6;
// A child's age when added (as Spring Statement's calculator does)
const NEW_CHILD_AGE = 5;

// Choices shown as boxes
const CHOICE_CONFIGS = {
  region: {
    label: "Region",
    layout: "grid",
    options: REGION_OPTIONS.map(([value, label]) => ({ value, label })),
    hint: "Scotland has its own income tax rates, and housing support follows local rents.",
  },
  has_partner: {
    label: "Partner",
    question: "Do you live with a partner?",
    options: YES_NO,
    hint: "Universal Credit and the High Income Child Benefit Charge are assessed per couple.",
  },
  children_count: {
    label: "Children",
    question: "Number of children",
    layout: "compact",
    options: Array.from({ length: MAX_CHILDREN + 1 }, (_, n) => ({ value: n, label: String(n) })),
  },
  tenure: {
    label: "Housing",
    options: [
      { value: "RENT_PRIVATELY", label: "Rent privately" },
      { value: "RENT_FROM_COUNCIL", label: "Rent from the council" },
      { value: "RENT_FROM_HA", label: "Rent from a housing association" },
      { value: "OWNED_WITH_MORTGAGE", label: "Own with a mortgage" },
      { value: "OWNED_OUTRIGHT", label: "Own outright" },
    ],
  },
  student_loan_plan: {
    label: "Student loan plan",
    layout: "grid",
    options: [
      { value: "NONE", label: "No loan" },
      { value: "PLAN_1", label: "Plan 1", hint: "Started before Sept 2012, or Northern Ireland" },
      { value: "PLAN_2", label: "Plan 2", hint: "England or Wales, Sept 2012 to July 2023" },
      { value: "PLAN_4", label: "Plan 4", hint: "Scotland" },
      { value: "PLAN_5", label: "Plan 5", hint: "England, from Aug 2023" },
      { value: "POSTGRADUATE", label: "Postgraduate", hint: "Master's or doctoral loan" },
    ],
  },
  council_tax_band: {
    label: "Council tax band",
    summary: (value) => `Band ${value}`,
    layout: "compact",
    options: ["A", "B", "C", "D", "E", "F", "G", "H"].map((band) => ({ value: band, label: band })),
    hint: "Council Tax is estimated from your band and your region's average Band D for 2026-27 (MHCLG, Welsh and Scottish governments), grown with the OBR's forecast. Band D if you are not sure.",
  },
  claims_universal_credit: {
    label: "Universal Credit",
    question: "Would your household claim Universal Credit if entitled?",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
    hint: "Yes counts the Universal Credit your answers entitle you to.",
  },
};

// Amounts and ages, as number boxes with − and + steppers
const NUMBER_CONFIGS = {
  current_age: { label: "Age", min: 18, max: 80, step: 1 },
  current_salary: { label: "Salary in 2026", min: 0, max: 500000, step: 1000, money: true, hint: SALARY_SOURCE },
  partner_age: { label: "Partner's age", min: 18, max: 80, step: 1 },
  partner_salary: { label: "Partner's salary in 2026", min: 0, max: 500000, step: 1000, money: true },
  monthly_rent: { label: "Rent", min: 0, max: 10000, step: 25, money: true, suffix: "a month" },
  savings_interest_per_year: { label: "Savings interest", min: 0, max: 100000, step: 100, money: true, suffix: "a year" },
  dividends_per_year: { label: "Dividends", min: 0, max: 100000, step: 100, money: true, suffix: "a year" },
  property_income_per_year: { label: "Property income", min: 0, max: 100000, step: 100, money: true, suffix: "a year" },
  private_pension_per_year: {
    label: "Your private or workplace pension",
    min: 0,
    max: 200000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "Pensions you are paid, before tax, not counting the State Pension.",
  },
  partner_private_pension_per_year: {
    label: "Partner's private or workplace pension",
    min: 0,
    max: 200000,
    step: 100,
    money: true,
    suffix: "a year",
  },
  state_pension_per_year: { label: "Your State Pension", min: 0, max: 25000, step: 10, money: true, suffix: "a year" },
  partner_state_pension_per_year: {
    label: "Partner's State Pension",
    min: 0,
    max: 25000,
    step: 10,
    money: true,
    suffix: "a year",
  },
  salary_sacrifice_per_year: {
    label: "Pension paid by salary sacrifice",
    min: 0,
    max: 60000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "Your annual pension contribution paid through salary sacrifice, before any policy changes.",
  },
  petrol_spending_per_year: {
    label: "Petrol",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Prefilled with the average household's spending (ONS Family Spending, 2024-25).",
  },
  diesel_spending_per_year: {
    label: "Diesel",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Prefilled with the average household's spending (ONS Family Spending, 2024-25).",
  },
  electricity_spending_per_year: {
    label: "Electricity",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Including VAT. Prefilled with the average household's spending, £20.00 a week (ONS Family Spending, 2024-25).",
  },
  monthly_childcare: {
    label: "Paid childcare",
    min: 0,
    max: 5000,
    step: 25,
    money: true,
    suffix: "a month",
    hint: "For all children together.",
  },
};

// Shown only when they apply
const FIELD_APPLIES = {
  monthly_rent: (inputs) => isRenting(inputs.tenure),
  partner_age: (inputs) => inputs.has_partner,
  partner_salary: (inputs) => inputs.has_partner,
  children_ages: (inputs, childrenCount) => childrenCount > 0,
  monthly_childcare: (inputs, childrenCount) => childrenCount > 0,
  partner_private_pension_per_year: (inputs) => inputs.has_partner,
  // Northern Ireland has domestic rates, not Council Tax
  council_tax_band: (inputs) => inputs.region !== "NORTHERN_IRELAND",
  state_pension_per_year: (inputs, childrenCount, year) => atStatePensionAge(inputs.current_age, year),
  partner_state_pension_per_year: (inputs, childrenCount, year) =>
    inputs.has_partner && atStatePensionAge(inputs.partner_age, year),
};

// Fields left as prefilled until changed (null), and what fills them
const PREFILLED = {
  state_pension_per_year: (year) => Math.round(statePensionFor(year).full),
  partner_state_pension_per_year: (year) => Math.round(statePensionFor(year).full),
  monthly_rent: (year, inputs) => regionalRent(inputs.region),
};

const regionName = (region) => REGION_OPTIONS.find(([value]) => value === region)?.[1] ?? region;

// The prefilled fields' notes: what the prefill is
const PREFILL_HINTS = {
  state_pension_per_year: (year) =>
    `Prefilled with the full new State Pension for ${fiscalYearTick(year)} (£${d3.format(",.0f")(
      statePensionFor(year).full,
    )}); change it if yours differs.`,
  partner_state_pension_per_year: (year) =>
    `Prefilled with the full new State Pension for ${fiscalYearTick(year)}; change it if your partner's differs.`,
  monthly_rent: (year, inputs) =>
    `Prefilled with the average private rent in ${regionName(inputs.region)} (ONS, ${
      inputs.region === "NORTHERN_IRELAND" ? "July" : "September"
    } 2026); change it if yours differs.`,
};

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, open: null, presetId: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, open: null, presetId: null });
}

const money = (value) => `£${d3.format(",.0f")(value)}`;

/** A row's answer, as the closed row shows it. */
function summaryOf(id, inputs, year) {
  if (CHOICE_CONFIGS[id]) {
    const config = CHOICE_CONFIGS[id];
    if (config.summary) return config.summary(inputs[id]);
    return config.options.find((option) => option.value === inputs[id])?.label ?? String(inputs[id]);
  }
  const config = NUMBER_CONFIGS[id];
  const value = inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
  if (!config.money) return String(value);
  return config.suffix ? `${money(value)} ${config.suffix}` : money(value);
}

/**
 * One question: a row showing its label and answer that opens in place to
 * change it.
 */
function FormRow({ rowId, label, summary, open, onToggle, children }) {
  const panelId = `household-row-${rowId}`;
  const buttonId = `${panelId}-button`;
  return (
    <li className={`household-row ${open ? "is-open" : ""}`} data-row={rowId}>
      <button
        type="button"
        id={buttonId}
        className="household-row-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="household-row-label">{label}</span>
        <span className="household-row-value">{summary}</span>
        <span className="household-row-chevron" aria-hidden="true" />
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} className="household-row-panel" hidden={!open}>
        {open && children}
      </div>
    </li>
  );
}

/**
 * The Personal impact view: one list of questions about a household, each
 * opening in place, with its net income in the year chosen in the title
 * band before and after the selected policies shown alongside and updated
 * as the answers change, from policyengine.py's household calculation
 * (POST /api/household-impact).
 */
function HouseholdCalculator({
  selectedPolicies = [],
  policies = [],
  year = DEFAULT_DISPLAY_YEAR,
  publicationKey = "",
  expectedEngine = null,
  confirmPublication = null,
}) {
  const [inputs, setInputs] = useState(() => ({ ...WIZARD_DEFAULTS, ...savedWizard.inputs }));
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  // The row open (one at a time); kept between tab switches for the session
  const [openRow, setOpenRow] = useState(() => savedWizard.open);
  const selectionKey = selectedPolicies.join(",");

  const handleInputChange = (id, value) => {
    setPresetId(null);
    // The controls give typed values: numbers from the number boxes,
    // strings and booleans from the choice boxes
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  // Remember the inputs and the open row for this session
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.open = openRow;
    savedWizard.presetId = presetId;
  }, [inputs, openRow, presetId]);

  // Fill the form from an example; every value stays editable
  const applyPreset = (preset) => {
    setInputs({ ...WIZARD_DEFAULTS, ...preset.inputs });
    setPresetId(preset.id);
  };
  const activePreset = YOUNG_PERSON_PRESETS.find((preset) => preset.id === presetId);

  // The results, updated as the answers change
  const householdPolicies = useMemo(
    () => (selectionKey ? selectionKey.split(",") : []),
    [selectionKey],
  );
  const householdResult = useHouseholdImpact({
    inputs,
    year,
    policies: householdPolicies,
    enabled: true,
    publicationKey,
    expectedEngine,
    confirmPublication,
  });
  const noneSelected = householdPolicies.length === 0;
  const unmodelled = householdResult.data?.notModelled ?? [];
  const selectionUnavailable = !noneSelected && unmodelled.length > 0;
  const unavailableNames = unmodelled.map((measure) =>
    policies.find((policy) => policy.id === measure.id)?.name ?? measure.name ?? measure.id,
  );

  // Whether a field applies to the answers so far (rent only when renting)
  const fieldApplies = (id) => !FIELD_APPLIES[id] || FIELD_APPLIES[id](inputs, childrenCount, year);

  // The children's ages, kept as the text the household request reads
  // ("5, 3")
  const childAges = parseChildrenAges(inputs.children_ages);
  const setChildAges = (ages) => handleInputChange("children_ages", ages.join(", "));
  const childEducation = (index) => inputs.children_in_education?.[index] !== false;
  const setChildEducation = (index, value) => {
    const next = childAges.map((_, i) => (i === index ? value : childEducation(i)));
    handleInputChange("children_in_education", next);
  };
  const setChildrenCount = (count) => {
    const ages = childAges.slice(0, count);
    while (ages.length < count) ages.push(NEW_CHILD_AGE);
    setPresetId(null);
    setInputs((prev) => ({
      ...prev,
      children_ages: ages.join(", "),
      children_in_education: ages.map((_, i) => prev.children_in_education?.[i] !== false),
    }));
  };

  const toggle = (rowId) => setOpenRow((current) => (current === rowId ? null : rowId));

  // A question's input, inside its open row
  const renderInput = (id) => {
    if (id === "children_count") {
      return (
        <ChoiceTiles
          id={id}
          {...CHOICE_CONFIGS.children_count}
          label={CHOICE_CONFIGS.children_count.question}
          hideLabel
          value={childrenCount}
          onChange={setChildrenCount}
        />
      );
    }
    if (CHOICE_CONFIGS[id]) {
      const config = CHOICE_CONFIGS[id];
      return (
        <ChoiceTiles
          id={id}
          {...config}
          label={config.question ?? config.label}
          hideLabel={!config.question}
          value={inputs[id]}
          onChange={(value) => handleInputChange(id, value)}
        />
      );
    }
    const config = NUMBER_CONFIGS[id];
    const prefilled = PREFILLED[id] && (inputs[id] === null || inputs[id] === undefined);
    const value = inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
    const hint = PREFILL_HINTS[id] && prefilled ? PREFILL_HINTS[id](year, inputs) : config.hint;
    return (
      <div className="number-field-wrap">
        <NumberField
          id={id}
          {...config}
          hideLabel
          hint={hint}
          value={value}
          onChange={(next) => handleInputChange(id, next)}
        />
        {PREFILLED[id] && !prefilled && (
          <button type="button" className="text-button" onClick={() => handleInputChange(id, null)}>
            {id === "monthly_rent" ? "Use the regional average" : "Use the full new State Pension"}
          </button>
        )}
      </div>
    );
  };

  // One child's row: their age and, from 16, whether they are in school or
  // college
  const renderChild = (age, index) => {
    const rowId = `child_${index}`;
    const education = asksEducation(age) ? (childEducation(index) ? " · in education" : " · not in education") : "";
    return (
      <FormRow
        key={rowId}
        rowId={rowId}
        label={`Child ${index + 1}`}
        summary={`Age ${age}${education}`}
        open={openRow === rowId}
        onToggle={() => toggle(rowId)}
      >
        <div className="child-answers">
          <NumberField
            id={`child_age_${index}`}
            label={`Child ${index + 1}'s age`}
            value={age}
            min={0}
            max={OLDEST_CHILD_AGE}
            step={1}
            hint="Age in 2026, from 0 to 19."
            outOfRangeMessage={CHILD_AGE_MESSAGE}
            onChange={(value) => setChildAges(childAges.map((a, i) => (i === index ? value : a)))}
          />
          {asksEducation(age) && (
            <ChoiceTiles
              id={`child_in_education_${index}`}
              label={`Child ${index + 1} in full-time education (non-advanced)`}
              layout="compact"
              options={YES_NO.slice().reverse()}
              value={childEducation(index)}
              onChange={(value) => setChildEducation(index, value)}
              hint="School or college, not university or an apprenticeship. Only then does a 16- to 19-year-old count as a child."
            />
          )}
        </div>
      </FormRow>
    );
  };

  const renderRow = (id) => {
    if (!fieldApplies(id)) return null;
    if (id === "children") return childAges.map(renderChild);
    const config = CHOICE_CONFIGS[id] ?? NUMBER_CONFIGS[id];
    const summary = id === "children_count" ? String(childrenCount) : summaryOf(id, inputs, year);
    return (
      <FormRow
        key={id}
        rowId={id}
        label={config.label}
        summary={summary}
        open={openRow === id}
        onToggle={() => toggle(id)}
      >
        {renderInput(id)}
      </FormRow>
    );
  };

  return (
    <div className="household-calculator">
      <SectionHeading
        title="Your household"
        subtitle="Every answer starts at a typical value. Open a row to change it; the results update as you go."
      />
      <div className="household-layout">
        <div className="household-form">
          <div className="household-examples" role="group" aria-labelledby="household-examples-label">
            <span id="household-examples-label" className="household-examples-label">
              Start from an example
            </span>
            {YOUNG_PERSON_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`example-chip ${presetId === preset.id ? "is-active" : ""}`}
                aria-pressed={presetId === preset.id}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {activePreset && (
            <p className="household-examples-note" role="status">
              {activePreset.note}
            </p>
          )}
          {FORM_SECTIONS.map((section, index) => (
            <section
              className="household-section"
              key={section.title ?? "essentials"}
              aria-labelledby={section.title ? `household-section-${index}` : undefined}
              aria-label={section.title ? undefined : "Essentials"}
            >
              {section.title && (
                <h3 className="household-section-title" id={`household-section-${index}`}>
                  {section.title}
                </h3>
              )}
              <ul className="household-list">{section.fields.map(renderRow)}</ul>
            </section>
          ))}
        </div>

        <div className="household-results" role="region" aria-label="Results">
          {selectionUnavailable ? (
            <UnavailableNotice reason="Personal impact is unavailable for this selection">
              <p>These measures cannot be calculated for one household: {unavailableNames.join(", ")}.</p>
              <p>Select measures that can all be calculated to see your household&apos;s results.</p>
            </UnavailableNotice>
          ) : (
            <SingleYearHeadline
              result={householdResult}
              year={year}
              policies={policies}
              noPolicies={noneSelected}
              renting={isRenting(inputs.tenure)}
            />
          )}
        </div>
      </div>

      {/* The results' sections, below the form and headline */}
      {!noneSelected && !selectionUnavailable && (
        <div role="region" aria-label="Your household's results">
          <SingleYearDetails result={householdResult} year={year} policies={policies} />
        </div>
      )}
    </div>
  );
}

export default HouseholdCalculator;
