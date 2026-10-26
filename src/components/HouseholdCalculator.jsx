import TitleIcon from "./TitleIcon";
import { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { fiscalYearTick } from "../utils/chartTheme";
import { EXAMPLE_GROUPS, HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";
import ExamplePicker from "./personal/ExamplePicker";
import { SingleYearDetails, SingleYearHeadline } from "./personal/SingleYearResults";
import useHouseholdImpact from "../hooks/useHouseholdImpact";
import {
  CHILD_AGE_MESSAGE,
  OLDEST_CHILD_AGE,
  asksEducation,
  atStatePensionAge,
  buildHouseholdRequest,
  isRenting,
  monthlyRent,
  parseChildrenAges,
  requestKey,
  statePensionFor,
} from "../utils/householdImpactApi";
import useCollapse from "../hooks/useCollapse";
import { DEFAULT_SALARY, DEFAULT_SPENDING, SALARY_SOURCE } from "../utils/householdDefaults";
import { LOCAL_RENT_YEAR, areaLabel, areasIn, homeSize, householdArea, localRent, marketMonth } from "../utils/localRents";
import { NumberField, SelectField } from "./personal/FormControls";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { prefersReducedMotion } from "../utils/chartMotion";
import "./HouseholdCalculator.css";

// The form's answers, each at a typical value until changed. Sources:
// utils/householdDefaults.js
export const WIZARD_DEFAULTS = {
  current_age: 30,
  current_salary: DEFAULT_SALARY,
  region: "NORTH_WEST",
  tenure: "RENT_PRIVATELY",
  // null: the region's default rental area (the API's), until chosen
  brma: null,
  // null: the area's average private rent (ONS), until changed
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

// The form: one card of questions in labelled sections, each a grid of
// boxes. The essentials first, then the optional details in More details,
// closed at first, in groups of their own. `children` stands for each
// child's answers (their age and, from 16, their education).
export const FORM_SECTIONS = [
  { title: "You", icon: "user", fields: ["current_age", "current_salary", "region"] },
  {
    title: "Family and home",
    icon: "house",
    fields: [
      "has_partner",
      "partner_age",
      "partner_salary",
      "children_count",
      "children",
      "tenure",
      "brma",
      "monthly_rent",
    ],
  },
  {
    title: "More details",
    icon: "sliders",
    collapsible: true,
    groups: [
      { title: "Other income", icon: "coins", fields: ["savings_interest_per_year", "dividends_per_year", "property_income_per_year"] },
      {
        title: "Pension and student loan",
        icon: "piggy",
        fields: [
          "private_pension_per_year",
          "partner_private_pension_per_year",
          "state_pension_per_year",
          "partner_state_pension_per_year",
          "salary_sacrifice_per_year",
          "student_loan_plan",
        ],
      },
      {
        title: "Spending",
        icon: "cart",
        fields: ["petrol_spending_per_year", "diesel_spending_per_year", "electricity_spending_per_year", "monthly_childcare"],
      },
      { title: "Council tax and benefits", icon: "building", fields: ["council_tax_band", "claims_universal_credit"] },
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

// Choices shown as selects
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
    hintAs: "tooltip",
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
    label: "Private or workplace pension",
    min: 0,
    max: 200000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "Your private or workplace pension: pensions you are paid, before tax, not counting the State Pension.",
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
    label: "Salary sacrifice pension",
    min: 0,
    max: 60000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "Pension paid by salary sacrifice. From April 2029 the National Insurance relief is capped at £2,000 a year.",
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
  brma: (inputs) => isRenting(inputs.tenure) && areasIn(inputs.region).length > 0,
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
  monthly_rent: (year, inputs) => monthlyRent({ ...inputs, monthly_rent: null }),
};

// A short hint goes under its box; a long one behind an "i" by the label
// Long notes behind the "i"; short ones under the box. A field can ask for
// the "i" so its note never makes its row taller than the others.
const hintPlace = (hint, place) => place ?? (hint && hint.length > 60 ? "tooltip" : "below");


// The prefilled fields' notes: what the prefill is
const PREFILL_HINTS = {
  state_pension_per_year: (year) =>
    `Prefilled with the full new State Pension for ${fiscalYearTick(year)} (£${d3.format(",.0f")(
      statePensionFor(year).full,
    )}); change it if yours differs.`,
  partner_state_pension_per_year: (year) =>
    `Prefilled with the full new State Pension for ${fiscalYearTick(year)}; change it if your partner's differs.`,
  monthly_rent: (year, inputs) =>
    `Prefilled with the average private rent for ${homeSize(
      inputs,
      parseChildrenAges(inputs.children_ages).length,
    )} in ${areaLabel(householdArea(inputs))} (ONS, ${marketMonth(inputs)}); change it if yours differs.`,
};

// The rent's note when it is the area's Local Housing Allowance rate ("Use the local rate")
const lhaRentHint = (inputs) =>
  `The Local Housing Allowance rate for ${homeSize(
    inputs,
    parseChildrenAges(inputs.children_ages).length,
  )} in ${areaLabel(householdArea(inputs))} (DWP, ${fiscalYearTick(LOCAL_RENT_YEAR)}), set in April 2024 at the 30th percentile of local rents and frozen since.`;

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, presetId: null, moreOpen: false, submitted: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, presetId: null, moreOpen: false, submitted: null });
}

/**
 * The Household impact view: one list of questions about a household, each
 * opening in place, with its net income in the year chosen in the title
 * band before and after the selected policies shown alongside and updated
 * as the answers change, from policyengine.py's household calculation
 * (POST /api/household-impact).
 */
function HouseholdCalculator({
  selectedPolicies = [],
  policies = [],
  year = DEFAULT_DISPLAY_YEAR,
  active = true,
}) {
  const [inputs, setInputs] = useState(() => ({ ...WIZARD_DEFAULTS, ...savedWizard.inputs }));
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  // More details, closed at first; kept between tab switches for the session
  const [moreOpen, setMoreOpen] = useState(() => savedWizard.moreOpen);
  const more = useCollapse(moreOpen);
  // The answers, year and policies last sent with Calculate: nothing is
  // asked before it, and a result stays tied to what it was asked with
  const [submitted, setSubmitted] = useState(() => savedWizard.submitted);
  const selectionKey = selectedPolicies.join(",");

  const handleInputChange = (id, value) => {
    setPresetId(null);
    // The controls give typed values: numbers from the number boxes,
    // strings and booleans from the choice boxes. A new region starts at
    // its default rental area.
    setInputs((prev) => ({ ...prev, [id]: value, ...(id === "region" ? { brma: null } : {}) }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  // Remember the inputs and whether More details is open for this session
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.presetId = presetId;
    savedWizard.moreOpen = moreOpen;
    savedWizard.submitted = submitted;
  }, [inputs, presetId, moreOpen, submitted]);

  // Fill the form from an example; every value stays editable
  const applyPreset = (preset) => {
    setInputs({ ...WIZARD_DEFAULTS, ...preset.inputs });
    setPresetId(preset.id);
  };
  const activePreset = HOUSEHOLD_EXAMPLES.find((preset) => preset.id === presetId);

  const householdPolicies = useMemo(
    () => (selectionKey ? selectionKey.split(",") : []),
    [selectionKey],
  );
  const noneSelected = householdPolicies.length === 0;
  // The results for the answers sent with Calculate, never the ones being
  // edited. The request carries on whatever else changes on the page (this
  // view stays mounted while another is shown).
  const householdResult = useHouseholdImpact({
    inputs: submitted?.inputs ?? inputs,
    year: submitted?.year ?? year,
    policies: submitted?.policies ?? householdPolicies,
    enabled: submitted !== null,
  });
  // The answers, year or policies differ from those of the result shown
  const changed =
    submitted !== null &&
    requestKey(buildHouseholdRequest(inputs, { year, policies: householdPolicies })) !==
      requestKey(buildHouseholdRequest(submitted.inputs, { year: submitted.year, policies: submitted.policies }));
  // Busy while the headline is calculated, and while the slower parts are
  // for these same answers; changed answers can be sent once the headline
  // is back, without waiting for the split by policy and the sweep
  const running =
    submitted !== null &&
    (householdResult.status === "loading" || (!changed && householdResult.detailStatus === "loading"));

  // Once a household has been calculated, the title bar's year or policies
  // rerun it, with the same answers, without a second Calculate. Not while
  // the answers are being edited (the reader presses Calculate then), and
  // only while this view is shown: a change made on another view (Play
  // through years runs five) is caught up once, on coming back, rather than
  // calculated for every year passed through.
  const answersEdited =
    submitted !== null &&
    requestKey(buildHouseholdRequest(inputs, { year: 0, policies: [] })) !==
      requestKey(buildHouseholdRequest(submitted.inputs, { year: 0, policies: [] }));
  useEffect(() => {
    if (!active || submitted === null || answersEdited || householdPolicies.length === 0) return;
    const samePolicies = submitted.policies.join(",") === selectionKey;
    if (submitted.year === year && samePolicies) return;
    setSubmitted({ inputs: submitted.inputs, year, policies: householdPolicies, at: Date.now() });
    // Only the bar's year and policies (and coming back to the view) rerun it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, selectionKey, active]);

  const resultsRef = useRef(null);
  const calculate = (event) => {
    event?.preventDefault();
    // One calculation at a time; nothing to ask without a policy
    if (running || noneSelected) return;
    setSubmitted({ inputs, year, policies: householdPolicies, at: Date.now() });
    // On a phone the results start screens below the button: bring the
    // waiting message into view, so pressing Calculate visibly does something
    requestAnimationFrame(() => {
      const target = resultsRef.current;
      if (!target) return;
      const { top } = target.getBoundingClientRect();
      if (top > window.innerHeight * 0.6) {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
    });
  };

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

  // One question: its box, label above and hint below
  const renderField = (id) => {
    if (!fieldApplies(id)) return null;
    if (id === "children") return childAges.map(renderChild);
    let field;
    if (id === "brma") {
      field = (
        <SelectField
          id={id}
          label="Rental area"
          options={areasIn(inputs.region)}
          value={householdArea(inputs)}
          hint="Your Broad Rental Market Area: it sets the Local Housing Allowance your Universal Credit housing costs are capped at, and prefills the rent."
          hintAs="tooltip"
          onChange={(value) => handleInputChange(id, value)}
        />
      );
    } else if (id === "children_count") {
      field = (
        <SelectField
          id={id}
          label={CHOICE_CONFIGS.children_count.label}
          options={CHOICE_CONFIGS.children_count.options}
          value={childrenCount}
          onChange={setChildrenCount}
        />
      );
    } else if (CHOICE_CONFIGS[id]) {
      const config = CHOICE_CONFIGS[id];
      // An option's own note (a loan plan's) stands in for the field's
      const chosen = config.options.find((option) => option.value === inputs[id]);
      field = (
        <SelectField
          id={id}
          label={config.label}
          options={config.options}
          value={inputs[id]}
          hint={chosen?.hint ?? config.hint}
          hintAs={hintPlace(chosen?.hint ?? config.hint, config.hintAs)}
          onChange={(value) => handleInputChange(id, value)}
        />
      );
    } else {
      const config = NUMBER_CONFIGS[id];
      const prefilled = PREFILLED[id] && (inputs[id] === null || inputs[id] === undefined);
      const value = inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
      // The rent: the area's average to start with; its Local Housing
      // Allowance rate a button away
      const lhaRent = id === "monthly_rent" ? localRent(inputs, childrenCount) : null;
      const atLhaRent = lhaRent !== null && !prefilled && value === lhaRent;
      const hint =
        PREFILL_HINTS[id] && prefilled
          ? PREFILL_HINTS[id](year, inputs)
          : atLhaRent
            ? lhaRentHint(inputs)
            : config.hint;
      field = (
        <div className="number-field-wrap">
          <NumberField
            id={id}
            {...config}
            hint={hint}
            hintAs={hintPlace(hint)}
            value={value}
            onChange={(next) => handleInputChange(id, next)}
          />
          {PREFILLED[id] && !prefilled && (
            <button type="button" className="text-button" onClick={() => handleInputChange(id, null)}>
              {id === "monthly_rent" ? "Use the local average" : "Use the full new State Pension"}
            </button>
          )}
          {lhaRent !== null && value !== lhaRent && (
            <button type="button" className="text-button" onClick={() => handleInputChange(id, lhaRent)}>
              Use the local rate
            </button>
          )}
        </div>
      );
    }
    return (
      <div key={id} className="household-field" data-row={id}>
        {field}
      </div>
    );
  };

  // One child: their age and, from 16, whether they are in school or
  // college
  const renderChild = (age, index) => (
    <div
      key={`child_${index}`}
      className={`household-field household-child ${asksEducation(age) ? "has-education" : ""}`.trim()}
      data-row={`child_${index}`}
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
          <SelectField
            id={`child_in_education_${index}`}
            label={`Child ${index + 1} in full-time education (non-advanced)`}
            options={YES_NO.slice().reverse()}
            value={childEducation(index)}
            onChange={(value) => setChildEducation(index, value)}
            hint="School or college, not university or an apprenticeship. Only then does a 16- to 19-year-old count as a child."
            hintAs="tooltip"
          />
        )}
      </div>
    </div>
  );

  const renderGrid = (fields) => <div className="household-grid">{fields.map(renderField)}</div>;

  const renderSection = (section, index) => {
    const labelId = `household-section-${index}`;
    if (!section.collapsible) {
      return (
        <section key={section.title} className="household-group" aria-labelledby={labelId}>
          <h3 className="household-group-label" id={labelId}>
            <TitleIcon name={section.icon} bare size={14} className="household-label-icon" />
            {section.title}
          </h3>
          {renderGrid(section.fields)}
        </section>
      );
    }
    const fields = section.groups.flatMap((group) => group.fields);
    const shown = fields.filter(fieldApplies).length;
    const panelId = `${labelId}-panel`;
    return (
      <section key={section.title} className="household-group household-more">
        <h3 className="household-group-label">
          <button
            type="button"
            className="household-more-toggle"
            id={labelId}
            aria-expanded={moreOpen}
            aria-controls={panelId}
            onClick={() => setMoreOpen((value) => !value)}
          >
            <TitleIcon name={section.icon} bare size={14} className="household-label-icon" />
            {section.title}{" "}
            <span className="household-more-count">{shown} questions</span>
            <svg
              className="household-more-chevron"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </h3>
        {more.mounted && (
          <div
            id={panelId}
            role="region"
            aria-labelledby={labelId}
            className={`expander-body ${more.expanded ? "is-expanded" : ""}`}
          >
            <div className="expander-inner">
            <div className="household-more-panel">
            {section.groups.map((group) => {
              if (!group.fields.some(fieldApplies)) return null;
              const groupId = `${labelId}-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
              return (
                <div key={group.title} className="household-subgroup" role="group" aria-labelledby={groupId}>
                  <h4 className="household-subgroup-label" id={groupId}>
                    <TitleIcon name={group.icon} bare size={13} className="household-label-icon" />
                    {group.title}
                  </h4>
                  {renderGrid(group.fields)}
                </div>
              );
            })}
            </div>
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="household-calculator">
      <div className="household-layout">
        {/* The whole form in one card: a header with the examples, then
            the questions in sections */}
        <form className="card household-form" onSubmit={calculate} noValidate aria-label="Your household">
          <div className="household-form-header">
            <div className="household-form-title">
              <h2>
                <TitleIcon name="house" />
                Your household
              </h2>
              <p>Every answer starts at a typical value. Change any of them, then press Calculate.</p>
            </div>
            <div className="household-header-actions">
            <ExamplePicker
              groups={EXAMPLE_GROUPS}
              value={presetId}
              onChoose={(id) => applyPreset(HOUSEHOLD_EXAMPLES.find((preset) => preset.id === id))}
            />
            <button
              type="submit"
              className={`calculate-button ${running ? "is-busy" : ""}`}
              disabled={running || noneSelected}
              aria-busy={running || undefined}
            >
              {running ? (
                <>
                  <span className="calculate-spinner" aria-hidden="true" />
                  Calculating…
                </>
              ) : (
                <>
                  Calculate
                  <span className="calculate-arrow" aria-hidden="true">
                    →
                  </span>
                </>
              )}
            </button>
            </div>
          </div>
          {activePreset && (
            <p className="household-examples-note" role="status">
              {activePreset.note}
            </p>
          )}
          {FORM_SECTIONS.map(renderSection)}
        </form>

        <div className="household-results" role="region" aria-label="Results" ref={resultsRef}>
          <SingleYearHeadline
            result={householdResult}
            year={submitted?.year ?? year}
            policies={policies}
            noPolicies={noneSelected}
            renting={isRenting((submitted?.inputs ?? inputs).tenure)}
            submitted={submitted !== null}
            changed={changed}
            policyCount={submitted?.policies.length ?? householdPolicies.length}
            startedAt={submitted?.at ?? null}
          />
        </div>
      </div>

      {/* The results' sections, below the form and headline, once asked */}
      {submitted !== null && !noneSelected && (
        <div role="region" aria-label="Your household's results">
          <SingleYearDetails
            result={householdResult}
            year={submitted.year}
            policies={policies}
            changed={changed}
            startedAt={submitted.at}
          />
        </div>
      )}
    </div>
  );
}

export default HouseholdCalculator;
