import { useState, useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import { fiscalYearTick } from "../utils/chartTheme";
import { YOUNG_PERSON_PRESETS } from "../utils/youngPersonPresets";
import SectionHeading from "./SectionHeading";
import { SingleYearDetails, SingleYearHeadline } from "./personal/SingleYearResults";
import useHouseholdImpact from "../hooks/useHouseholdImpact";
import {
  CHILD_AGE_MESSAGE,
  OLDEST_CHILD_AGE,
  asksEducation,
  atStatePensionAge,
  isRenting,
  monthlyRent,
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

// The form: the essentials, then optional details (all prefilled), then
// the results. Each step's questions come in groups with a heading.
export const WIZARD_STEPS = [
  {
    title: "Essentials",
    intro: "Every answer starts at a typical value; change what differs for you.",
    groups: [
      { title: "You", fields: ["current_age", "current_salary", "region"] },
      { title: "Partner", fields: ["has_partner", "partner_age", "partner_salary"] },
      { title: "Children", fields: ["children_count", "children_ages"] },
      { title: "Home", fields: ["tenure", "monthly_rent"] },
    ],
  },
  {
    title: "More details",
    intro: "Optional. Each answer is already filled in; skip to the results if they fit.",
    groups: [
      {
        title: "Other income",
        fields: [
          "state_pension_per_year",
          "partner_state_pension_per_year",
          "private_pension_per_year",
          "partner_private_pension_per_year",
          "savings_interest_per_year",
          "dividends_per_year",
          "property_income_per_year",
        ],
      },
      { title: "Work", fields: ["salary_sacrifice_per_year"] },
      { title: "Student loan", fields: ["student_loan_plan"] },
      { title: "Spending", fields: ["petrol_spending_per_year", "diesel_spending_per_year"] },
      { title: "Home and family", fields: ["council_tax_band", "monthly_childcare", "claims_universal_credit"] },
    ],
  },
  { title: "Results", groups: [] },
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
    label: "Do you live with a partner?",
    options: YES_NO,
    hint: "Universal Credit and the High Income Child Benefit Charge are assessed per couple.",
  },
  children_count: {
    label: "Number of children",
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
    layout: "compact",
    options: ["A", "B", "C", "D", "E", "F", "G", "H"].map((band) => ({ value: band, label: band })),
    hint: "Council Tax is estimated from your band and your region's average Band D for 2026-27 (MHCLG, Welsh and Scottish governments), grown with the OBR's forecast. Band D if you are not sure.",
  },
  claims_universal_credit: {
    label: "Would your household claim Universal Credit if entitled?",
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
    hint: "From April 2029 the National Insurance relief is capped at £2,000 a year.",
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
const savedWizard = { inputs: null, step: 0, presetId: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, step: 0, presetId: null });
}

/**
 * The Personal impact view: a step-by-step form for one household, then
 * its net income in the year chosen in the title band before and after the
 * selected policies, from policyengine.py's household calculation
 * (POST /api/household-impact).
 */
function HouseholdCalculator({
  selectedPolicies = [],
  policies = [],
  year = DEFAULT_DISPLAY_YEAR,
}) {
  const [inputs, setInputs] = useState(() => ({ ...WIZARD_DEFAULTS, ...savedWizard.inputs }));
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  const selectionKey = selectedPolicies.join(",");
  // The form's step; kept between tab switches for the session
  const [step, setStep] = useState(() => savedWizard.step);
  const stepHeadingRef = useRef(null);
  const isResults = step === WIZARD_STEPS.length - 1;

  // Handle input change
  const handleInputChange = (id, value) => {
    setPresetId(null);
    // The controls give typed values: numbers from the number boxes,
    // strings and booleans from the choice boxes
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  const goToStep = (next) => {
    const target = Math.max(0, Math.min(WIZARD_STEPS.length - 1, next));
    setStep(target);
  };

  // Focus the step's heading when the step changes (not on first load)
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  // Remember the inputs and step for this session, across tab switches
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.step = step;
    savedWizard.presetId = presetId;
  }, [inputs, step, presetId]);

  // Fill the form from an example; every value stays editable
  const applyPreset = (preset) => {
    setInputs({ ...WIZARD_DEFAULTS, ...preset.inputs });
    setPresetId(preset.id);
  };
  const activePreset = YOUNG_PERSON_PRESETS.find((preset) => preset.id === presetId);

  const money = (value) => `£${d3.format(",.0f")(value)}`;
  const optionLabel = (id) =>
    CHOICE_CONFIGS[id].options.find((option) => option.value === inputs[id])?.label ?? inputs[id];
  const inputSummary = [
    `Age ${inputs.current_age}`,
    regionName(inputs.region),
    `salary ${money(inputs.current_salary)}`,
    isRenting(inputs.tenure)
      ? `rent ${money(monthlyRent(inputs))} a month`
      : optionLabel("tenure").toLowerCase(),
    inputs.has_partner ? `partner on ${money(inputs.partner_salary)}` : "no partner",
    childrenCount === 0
      ? "no children"
      : `${childrenCount} ${childrenCount === 1 ? "child" : "children"}`,
    inputs.student_loan_plan === "NONE" ? "no student loan" : `${optionLabel("student_loan_plan")} loan`,
  ].join(" · ");

  // The results: asked for only while they are shown
  const householdPolicies = useMemo(
    () => (selectionKey ? selectionKey.split(",") : []),
    [selectionKey],
  );
  const householdResult = useHouseholdImpact({
    inputs,
    year,
    policies: householdPolicies,
    enabled: isResults,
  });
  const noneSelected = householdPolicies.length === 0;

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

  // One question of the form
  const renderField = (id) => {
    if (!fieldApplies(id)) return null;
    if (id === "children_count") {
      return (
        <ChoiceTiles
          key={id}
          id={id}
          {...CHOICE_CONFIGS.children_count}
          value={childrenCount}
          onChange={setChildrenCount}
        />
      );
    }
    if (id === "children_ages") {
      return (
        <div className="field-row children-ages" key={id}>
          {childAges.map((age, index) => (
            <div className="child-answers" key={index}>
              <NumberField
                id={`child_age_${index}`}
                label={`Child ${index + 1}'s age`}
                value={age}
                min={0}
                max={OLDEST_CHILD_AGE}
                step={1}
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
          ))}
          <p className="field-hint field-row-hint">Ages in 2026, from 0 to 19.</p>
        </div>
      );
    }
    if (CHOICE_CONFIGS[id]) {
      return (
        <ChoiceTiles
          key={id}
          id={id}
          {...CHOICE_CONFIGS[id]}
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
      <div className="number-field-wrap" key={id}>
        <NumberField
          id={id}
          {...config}
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

  return (
    <div className="household-calculator">
      {/* A step-by-step form in one card: a few questions per step, then
          the results. Inputs keep their values between steps and tabs. */}
      <SectionHeading
        title="Your household"
        subtitle="Answer a few questions to see how the selected policies change your household's net income."
      />
      <div className={`wizard ${isResults ? "is-results" : "is-form"}`}>

        <nav className="wizard-steps" aria-label="Steps">
          <ol style={{ "--step-progress": step / (WIZARD_STEPS.length - 1) }}>
            {WIZARD_STEPS.map((wizardStep, index) => (
              <li
                key={wizardStep.title}
                className={`${index < step ? "is-done" : ""} ${
                  index === step ? "is-current-item" : ""
                }`}
                // Circles evenly spaced, the first and last at the edges
                style={{ "--step-position": index / (WIZARD_STEPS.length - 1) }}
              >
                <button
                  type="button"
                  className={`wizard-step-tab ${index === step ? "is-current" : ""} ${
                    index < step ? "is-done" : ""
                  } is-reachable`}
                  // Every answer has a default, so every step is open
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => goToStep(index)}
                >
                  <span className="wizard-step-number" aria-hidden="true">
                    {index < step ? "✓" : index + 1}
                  </span>
                  <span className="visually-hidden">Step {index + 1}: </span>
                  <span className="wizard-step-name">{wizardStep.title}</span>
                </button>
              </li>
            ))}
          </ol>
          {/* On a phone: "Step 2 of 3 · More details" and a progress bar */}
          <p className="wizard-steps-compact" aria-hidden="true">
            Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step].title}
          </p>
          <div className="wizard-progress" aria-hidden="true">
            <span style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }} />
          </div>
        </nav>

        <section className="wizard-step" aria-labelledby="wizard-step-heading">
          <div className={`wizard-step-header ${isResults ? "is-results" : ""}`}>
            <h3 id="wizard-step-heading" ref={stepHeadingRef} tabIndex={-1}>
              {WIZARD_STEPS[step].title}
            </h3>
            {isResults && (
              <div className="wizard-results-controls">
                <button
                  type="button"
                  className="light-pill-button"
                  onClick={() => goToStep(0)}
                >
                  Edit details
                </button>
              </div>
            )}
            {isResults && <p className="wizard-summary">{inputSummary}</p>}
            {!isResults && <p className="wizard-intro">{WIZARD_STEPS[step].intro}</p>}
          </div>

          {step === 0 && (
            <div className="wizard-examples wizard-box" role="group" aria-labelledby="wizard-examples-label">
              <p id="wizard-examples-label" className="wizard-examples-label">
                Start from an example
              </p>
              <div className="wizard-examples-buttons">
                {YOUNG_PERSON_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`example-tile ${presetId === preset.id ? "is-active" : ""}`}
                    aria-pressed={presetId === preset.id}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {activePreset && (
                <p className="wizard-examples-note" role="status">
                  {activePreset.note} Change any value in the steps that follow.
                </p>
              )}
            </div>
          )}

          {!isResults && (
            <div className="wizard-fields">
              {WIZARD_STEPS[step].groups
                .filter((group) => group.fields.some((id) => fieldApplies(id)))
                .map((group) => (
                  <fieldset className="wizard-group wizard-box" key={group.title}>
                    <legend className="wizard-group-title">{group.title}</legend>
                    <div className="wizard-group-fields">{group.fields.map(renderField)}</div>
                  </fieldset>
                ))}
            </div>
          )}

          {isResults && (
            <div className="wizard-results">
              <SingleYearHeadline
                result={householdResult}
                year={year}
                policies={policies}
                noPolicies={noneSelected}
                renting={isRenting(inputs.tenure)}
              />
            </div>
          )}
        </section>

        {!isResults && (
        <div className="wizard-actions">
            <>
              {step === 0 ? (
                <button type="button" className="light-pill-button" onClick={() => goToStep(1)}>
                  More details (optional)
                </button>
              ) : (
                <button type="button" className="light-pill-button" onClick={() => goToStep(step - 1)}>
                  Back
                </button>
              )}
              <button
                type="button"
                className="wizard-next"
                onClick={() => goToStep(WIZARD_STEPS.length - 1)}
              >
                See results
              </button>
            </>
        </div>
        )}
      </div>

      {/* The results' sections, below the form card */}
      {isResults && !noneSelected && (
        <div role="region" aria-label="Your household's results">
          <SingleYearDetails
            result={householdResult}
            year={year}
            policies={policies}
          />
        </div>
      )}

    </div>
  );
}

export default HouseholdCalculator;
