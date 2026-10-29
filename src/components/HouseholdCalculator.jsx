import TitleIcon from "./TitleIcon";
import { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { fiscalYearTick } from "../utils/chartTheme";
import { HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";
import HouseholdCards from "./personal/HouseholdCards";
import UnavailableNotice from "./publication/UnavailableNotice";
import { SingleYearDetails, SingleYearHeadline } from "./personal/SingleYearResults";
import useHouseholdImpact, { seedHouseholdImpactCache } from "../hooks/useHouseholdImpact";
import useBasisIncome from "../hooks/useBasisIncome";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { loadPresetChanges, loadPresetResults, presetInputs } from "../utils/householdPresets";
import useExampleFigures from "../hooks/useExampleFigures";
import { SELECTABLE_YEARS } from "../utils/displayYears";
import {
  CHILD_AGE_MESSAGE,
  OLDEST_CHILD_AGE,
  asksEducation,
  atStatePensionAge,
  buildHouseholdRequest,
  isRenting,
  parseChildrenAges,
  requestKey,
  statePensionFor,
} from "../utils/householdImpactApi";
import useCollapse from "../hooks/useCollapse";
import { DEFAULT_SPENDING, SALARY_SOURCE, WIZARD_DEFAULTS, regionalRent } from "../utils/householdDefaults";

// The form's answers at their defaults (utils/householdDefaults.js)
export { WIZARD_DEFAULTS };
import { ChoiceTiles, NumberField, SelectField } from "./personal/FormControls";
import LocalAuthorityField from "./personal/LocalAuthorityField";
import { policyQuestions } from "../utils/householdPolicyFields";
import { resultPolicies, withCalculatorOnly, withoutCalculatorOnly } from "../utils/calculatorOnlyMeasures";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { prefersReducedMotion } from "../utils/chartMotion";
import "./HouseholdCalculator.css";
import { STICKY_GAP, scrollBelowBars, stickyBottom } from "../utils/pageScroll";
import { trackEvent } from "../utils/analytics";


// The form's seven numbered steps, read top to bottom, and nothing after
// them (Vahid, Budget day: the separate More details block is gone). You
// and Household open at first; the others start closed, each saying in one
// line only the answers that differ from the typical ones. In a step, the
// answers a selected policy reads (utils/householdPolicyFields.js) come
// first, in the table's order; the step's other answers wait, collapsed,
// under "Other questions". A step no selected policy reads shows all its
// answers when opened. `quiet` fields leave their own note to the step's
// line. `children` stands for each child's answers (their age and, from
// 16, their education); `rent_from` is the landlord, the renting half of
// the tenure.
export const FORM_GROUPS = [
  {
    key: "you",
    title: "You",
    hint: "Your age, your pay before tax, and where you live.",
    always: true,
    fields: ["current_age", "current_salary", "region"],
  },
  {
    key: "household",
    title: "Household",
    hint: "Who lives with you, and your home.",
    always: true,
    fields: ["has_partner", "children_count", "tenure", "partner_age", "partner_salary", "rent_from", "monthly_rent", "children"],
  },
  {
    key: "spending",
    title: "Spending",
    hint: "Prefilled with the average household's spending (Source: ONS Family Spending, 2024-25).",
    fields: ["petrol_spending_per_year", "diesel_spending_per_year", "electricity_spending_per_year", "monthly_childcare"],
    quiet: ["petrol_spending_per_year", "diesel_spending_per_year"],
  },
  {
    key: "savings",
    title: "Savings and other income",
    hint: "Your own income from savings, investments, property and self-employment, before tax.",
    fields: [
      "savings_interest_per_year",
      "cash_isa_payments_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "self_employment_receipts_per_year",
      "self_employment_expenses_per_year",
    ],
  },
  {
    key: "home",
    title: "Council Tax",
    hint: "Your home's band, as on your Council Tax bill.",
    fields: ["council_tax_band"],
  },
  {
    key: "benefits",
    title: "Benefits and loans",
    hint: "Yes to Universal Credit counts what your answers entitle you to.",
    fields: ["claims_universal_credit", "is_carer", "care_hours_per_week"],
    quiet: ["claims_universal_credit"],
  },
  {
    key: "pensions",
    title: "Pensions and student loan",
    hint: "Pensions paid to you before tax, pension paid by salary sacrifice, and any student loan.",
    fields: [
      "state_pension_per_year",
      "private_pension_per_year",
      "partner_state_pension_per_year",
      "partner_private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
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

// The "region" question asks for a local authority (council), which sets
// the region the calculation reads and is sent for its own Council Tax
const LOCAL_AUTHORITY_HINT =
  "Your council sets your region: Scotland has its own income tax rates, and the rent estimate and housing support follow the region, not your council. Council Tax is estimated from your band and your council's Band D.";

const YES_NO = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

const MAX_CHILDREN = 6;
// The tenure choice's "Rent": whichever landlord, asked beside the rent
const RENTING = "RENTING";
// A child's age when added (as Spring Statement's calculator does)
const NEW_CHILD_AGE = 5;

// Choices shown as selects
const CHOICE_CONFIGS = {
  has_partner: {
    label: "Partner",
    question: "Do you live with a partner?",
    layout: "segmented",
    options: YES_NO,
    hint: "Universal Credit and the High Income Child Benefit Charge are assessed per couple.",
  },
  children_count: {
    label: "Children",
    question: "Number of children",
    layout: "segmented",
    options: Array.from({ length: MAX_CHILDREN + 1 }, (_, n) => ({ value: n, label: String(n) })),
  },
  // Rent, mortgage or own outright; a renter's landlord is asked beside
  // the rent (rent_from), so the tenure sent is one of the five as before
  tenure: {
    label: "Housing",
    layout: "segmented",
    options: [
      { value: RENTING, label: "Rent" },
      { value: "OWNED_WITH_MORTGAGE", label: "Mortgage" },
      { value: "OWNED_OUTRIGHT", label: "Own outright" },
    ],
  },
  rent_from: {
    label: "Rent from",
    options: [
      { value: "RENT_PRIVATELY", label: "Private landlord" },
      { value: "RENT_FROM_COUNCIL", label: "Council" },
      { value: "RENT_FROM_HA", label: "Housing association" },
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
    layout: "segmented",
    options: ["A", "B", "C", "D", "E", "F", "G", "H"].map((band) => ({ value: band, label: band })),
    hint: "Estimated from your band and your council's Band D for 2026-27 (your region's average until you pick your council), grown with the OBR's forecast (Source: MHCLG, Welsh and Scottish governments, via policyengine-uk). Choose Band D if you are not sure.",
  },
  claims_universal_credit: {
    label: "Universal Credit",
    question: "Would your household claim Universal Credit if entitled?",
    layout: "segmented",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
    hint: "Yes counts the Universal Credit your answers entitle you to.",
    hintAs: "tooltip",
  },
  is_carer: {
    label: "Carer",
    question: "Do you look after someone, unpaid?",
    layout: "segmented",
    options: YES_NO,
    hint: "Unpaid care for someone who is ill, disabled or older. With 35 hours a week or more, the calculation counts Carer's Allowance (while your earnings are under its limit) and the carer element of Universal Credit.",
    hintAs: "tooltip",
  },
};

// Ages, as number boxes with − and + steppers; amounts, as £ boxes
const NUMBER_CONFIGS = {
  current_age: { label: "Age", min: 18, max: 80, step: 1 },
  current_salary: { label: "Salary in 2026", min: 0, max: 500000, step: 1000, money: true, suffix: "a year", hint: SALARY_SOURCE },
  partner_age: { label: "Partner's age", min: 18, max: 80, step: 1 },
  partner_salary: { label: "Partner's salary in 2026", min: 0, max: 500000, step: 1000, money: true, suffix: "a year" },
  monthly_rent: { label: "Rent", min: 0, max: 10000, step: 25, money: true, suffix: "a month" },
  savings_interest_per_year: { label: "Savings interest", min: 0, max: 100000, step: 100, money: true, suffix: "a year" },
  cash_isa_payments_per_year: {
    label: "Paid into cash ISAs",
    min: 0,
    max: 20000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "New money you pay into cash ISAs each year, up to the £20,000 ISA limit. If you are under 65, the planned £12,000 cash limit would have left the rest outside an ISA, where its interest is taxed.",
  },
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
    hint: "Enter your salary above after the sacrifice, as your payslip shows it. From April 2029 its National Insurance relief is capped at £2,000 a year; before then it changes no figure here.",
  },
  petrol_spending_per_year: {
    label: "Petrol",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Prefilled with the average household's spending (Source: ONS Family Spending, 2024-25).",
  },
  diesel_spending_per_year: {
    label: "Diesel",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Prefilled with the average household's spending (Source: ONS Family Spending, 2024-25).",
  },
  electricity_spending_per_year: {
    label: "Electricity",
    min: 0,
    max: 20000,
    step: 10,
    money: true,
    suffix: "a year",
    hint: "Including VAT. Prefilled with the average household's spending, £20.00 a week (Source: ONS Family Spending, 2024-25).",
  },
  self_employment_receipts_per_year: {
    label: "Self-employment or side income",
    min: 0,
    max: 500000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "Receipts (turnover) before expenses, from self-employment or side work such as selling or renting out things.",
    hintAs: "tooltip",
  },
  self_employment_expenses_per_year: {
    label: "Its allowable expenses",
    min: 0,
    max: 500000,
    step: 100,
    money: true,
    suffix: "a year",
    hint: "The calculation deducts these, or the trading allowance instead when that is larger.",
    hintAs: "tooltip",
  },
  care_hours_per_week: {
    label: "Hours of care",
    min: 0,
    max: 168,
    step: 1,
    suffix: "a week",
    hint: "Carer's Allowance and the carer element need 35 hours a week or more.",
    hintAs: "tooltip",
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
  rent_from: (inputs) => isRenting(inputs.tenure),
  partner_age: (inputs) => inputs.has_partner,
  partner_salary: (inputs) => inputs.has_partner,
  children_ages: (inputs, childrenCount) => childrenCount > 0,
  monthly_childcare: (inputs, childrenCount) => childrenCount > 0,
  care_hours_per_week: (inputs) => Boolean(inputs.is_carer),
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

// A short hint goes under its box; a long one behind an "i" by the label
// Long notes behind the "i"; short ones under the box. A field can ask for
// the "i" so its note never makes its row taller than the others.
const hintPlace = (hint, place) => place ?? (hint && hint.length > 60 ? "tooltip" : "below");

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
    `Prefilled with the average private rent in ${regionName(inputs.region)} (Source: ONS, ${
      inputs.region === "NORTHERN_IRELAND" ? "July" : "September"
    } 2026); change it if yours differs.`,
};

/**
 * Whether the spending the fuel and electricity measures act on is assumed:
 * "average" while it is the prefilled average household's (ONS), "example"
 * for an example's own figure, null once the reader has entered their own.
 */
export function spendingAssumed(answers, presetId) {
  const average =
    answers.petrol_spending_per_year === DEFAULT_SPENDING.petrol &&
    answers.diesel_spending_per_year === DEFAULT_SPENDING.diesel &&
    answers.electricity_spending_per_year === DEFAULT_SPENDING.electricity;
  if (average) return "average";
  return presetId !== null ? "example" : null;
}

const pounds = (value) => `£${d3.format(",.0f")(value)}`;
const careSummary = (hours) => `${d3.format(",.0f")(hours)} ${hours === 1 ? "hour" : "hours"} a week`;

/**
 * A numbered step's line while it is closed: only the answers that differ
 * from where they started (WIZARD_DEFAULTS, or a prefill), shortest
 * first-hand wording: "Petrol £500 a year · Band C · Carer, 35 hours a
 * week". Empty when every answer is typical (the step's hint shows then).
 * `answer(id)` is an answer as the calculation reads it, `changed(id)`
 * whether it differs, `childrenCount` the number of children.
 */
export function stepSummary(fields, { answer, applies, changed, inputs, childrenCount = 0 }) {
  const parts = [];
  for (const id of fields.filter(applies)) {
    if (id === "children") continue;
    if (id === "children_count") {
      if (childrenCount > 0) parts.push(childrenCount === 1 ? "1 child" : `${childrenCount} children`);
      continue;
    }
    if (id === "region") {
      if (inputs.council) parts.push(inputs.council);
      continue;
    }
    if (id === "care_hours_per_week") continue;
    if (id === "is_carer") {
      if (inputs.is_carer) parts.push(`Carer, ${careSummary(answer("care_hours_per_week"))}`);
      continue;
    }
    if (!changed(id)) continue;
    if (id === "claims_universal_credit") {
      parts.push(inputs[id] ? "Claims Universal Credit" : "Does not claim Universal Credit");
    } else if (id === "student_loan_plan") {
      const chosen = CHOICE_CONFIGS[id].options.find((option) => option.value === inputs[id]);
      parts.push(!chosen || chosen.value === "NONE" ? "No student loan" : `${chosen.label} student loan`);
    } else if (id === "council_tax_band") {
      parts.push(`Band ${inputs[id]}`);
    } else if (id === "tenure" || id === "rent_from") {
      const chosen = CHOICE_CONFIGS[id].options.find((option) => option.value === (id === "tenure" && isRenting(inputs.tenure) ? RENTING : inputs.tenure));
      if (chosen) parts.push(chosen.label);
    } else if (NUMBER_CONFIGS[id]) {
      const config = NUMBER_CONFIGS[id];
      const value = config.money ? pounds(answer(id)) : d3.format(",.0f")(answer(id));
      parts.push(`${config.label} ${value}${config.suffix ? ` ${config.suffix}` : ""}`);
    } else if (CHOICE_CONFIGS[id]) {
      const config = CHOICE_CONFIGS[id];
      const chosen = config.options.find((option) => option.value === inputs[id]);
      if (chosen) parts.push(`${config.label}: ${chosen.label}`);
    }
  }
  return { text: parts.join(" · "), changed: parts.length > 0 };
}

/**
 * One numbered group: its heading (the number, title and one muted line)
 * is a button that opens and closes its boxes, with a chevron at the
 * right. Closed, the muted line gives way to the answers that differ from
 * the typical ones (stepSummary); a tap anywhere on it opens the group.
 * `optional`: the step's answers no selected policy reads, when some
 * other answer in it is read, collapsed under "Other questions" until
 * opened (`optionalOpen`).
 */
function StepGroup({ group, number, last, open, onToggle, summary, children, optional = null, optionalOpen = false, onOptionalToggle }) {
  const collapse = useCollapse(open);
  const headId = `household-step-${group.key}`;
  const hintId = `${headId}-hint`;
  const summaryId = `${headId}-summary`;
  const panelId = `${headId}-panel`;
  const showSummary = !open && Boolean(summary?.text);
  return (
    <section
      className={`household-group household-step ${open ? "is-open" : ""}`.trim()}
      role="group"
      aria-labelledby={headId}
      data-step={group.key}
      data-last={last || undefined}
    >
      <h3 className="household-step-heading">
        <button
          type="button"
          className="household-step-head household-step-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={headId}
          aria-describedby={showSummary ? summaryId : hintId}
          onClick={onToggle}
        >
          <span className="household-step-number" aria-hidden="true">
            {number}
          </span>
          <span className="household-step-text">
            <span className="household-step-title" id={headId}>
              <span className="visually-hidden">{`Step ${number}:`}</span> {group.title}
            </span>
            {showSummary ? (
              <span className="household-step-summary" id={summaryId} data-changed={summary.changed || undefined}>
                {summary.text}
              </span>
            ) : (
              <span className="household-step-hint" id={hintId}>
                {group.hint}
              </span>
            )}
          </span>
          <svg
            className="household-more-chevron household-step-chevron"
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
      {collapse.mounted && (
        <div id={panelId} className={`expander-body household-step-body ${collapse.expanded ? "is-expanded" : ""}`}>
          <div className="expander-inner">
            <div className="household-grid household-grid-step">{children}</div>
            {optional && (
              <div className="household-step-optional">
                <button
                  type="button"
                  className="text-button household-step-optional-toggle"
                  aria-expanded={optionalOpen}
                  aria-controls={`${panelId}-optional`}
                  onClick={onOptionalToggle}
                >
                  {optionalOpen ? "Fewer questions" : "Other questions"}
                </button>
                {optionalOpen && (
                  <div id={`${panelId}-optional`} className="household-grid household-grid-step" role="group" aria-label={`${group.title}: other questions`}>
                    {optional}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// A phone's width, as HouseholdCalculator.css's phone layout
const PHONE_QUERY = "(max-width: 640px)";

/** Phrases as a list in words: "a", "a and b", "a, b and c". */
const joinedPhrases = (phrases) =>
  phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}` : (phrases[0] ?? "");

/** Whether the window matches a media query, following it as it changes. */
function useNarrow(query) {
  const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, [query]);
  return narrow;
}

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, presetId: null, formOpen: false, optionalOpen: {}, stepOpen: {}, submitted: null, startFrom: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, presetId: null, formOpen: false, optionalOpen: {}, stepOpen: {}, submitted: null, startFrom: null });
}

// Answers always shown first in their step, whatever is selected
const ALWAYS_FIRST = ["savings_interest_per_year"];

// The form's panel, opened by the "Your household" card
const FORM_PANEL_ID = "household-form-panel";

/**
 * The Household calculator view: one list of questions about a household, each
 * opening in place, with its net income in the year chosen in the title
 * band before and after the selected policies shown alongside and updated
 * as the answers change, from policyengine.py's household calculation
 * (POST /api/household-impact).
 */
// Each example's id and full answers, for the cards' background figures
const EXAMPLE_REQUESTS = HOUSEHOLD_EXAMPLES.map((example) => ({ id: example.id, inputs: presetInputs(example) }));

function HouseholdCalculator({
  selectedPolicies = [],
  policies = [],
  year = DEFAULT_DISPLAY_YEAR,
  publicationKey = "",
  expectedEngine = null,
  presetEngine = null,
  confirmPublication = null,
  active = true,
}) {
  const [inputs, setInputs] = useState(() => ({ ...WIZARD_DEFAULTS, ...savedWizard.inputs }));
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  // The form, below the cards: closed at first, opened by "Your household"
  const [formOpen, setFormOpen] = useState(() => savedWizard.formOpen);
  // The example Your household started from, named at the top of the form
  const [startFrom, setStartFrom] = useState(() => savedWizard.startFrom);
  const form = useCollapse(formOpen);
  // Each step's "Other questions" open, by step key: closed at first;
  // kept between tab switches for the session
  const [optionalOpen, setOptionalOpen] = useState(() => savedWizard.optionalOpen);
  // The numbered groups opened or closed by hand, by key; a group not in
  // it is open or closed as stepStartsOpen says. Kept for the session
  const [stepOpen, setStepOpen] = useState(() => savedWizard.stepOpen);
  // The answers, year and policies last sent with Calculate: nothing is
  // asked before it, and a result stays tied to what it was asked with
  const [submitted, setSubmitted] = useState(() => savedWizard.submitted);
  const selectionKey = selectedPolicies.join(",");
  const narrow = useNarrow(PHONE_QUERY);

  const handleInputChange = (id, value) => {
    setPresetId(null);
    // The controls give typed values: numbers from the number boxes,
    // strings and booleans from the choice boxes
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  // Remember the inputs and which steps and Other questions are open for this session
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.presetId = presetId;
    savedWizard.startFrom = startFrom;
    savedWizard.formOpen = formOpen;
    savedWizard.optionalOpen = optionalOpen;
    savedWizard.stepOpen = stepOpen;
    savedWizard.submitted = submitted;
  }, [inputs, presetId, startFrom, formOpen, optionalOpen, stepOpen, submitted]);

  // The examples' precomputed answers, loaded once and added to the
  // session cache; `seeded` tells a request already waiting to look again
  const [seeded, setSeeded] = useState(0);
  // and each example's change in net income, for its card
  const [presetChanges, setPresetChanges] = useState({});
  // Whether the file has been read (until then the cards wait for it rather
  // than ask the API)
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  // The measures the cards' figures are for: every published one, in the
  // page's order (#104: the page keeps no list of its own). The file's
  // answers count only for exactly these, under the engine their receipts
  // record (`presetEngine`, not the selection's: with nothing selected that
  // is null, and none are loaded then).
  const presetPolicies = useMemo(
    () => policies.filter((policy) => policy.displayable !== false).map((policy) => policy.id),
    [policies],
  );
  const presetKey = presetPolicies.join(",");
  useEffect(() => {
    let live = true;
    const options = { policies: presetPolicies, expectedEngine: presetEngine, publicationKey };
    loadPresetResults(options).then((entries) => {
      if (!live || entries.length === 0) return;
      seedHouseholdImpactCache(entries);
      setSeeded((n) => n + 1);
    });
    loadPresetChanges(options).then((changes) => {
      if (!live) return;
      setPresetChanges(changes);
      setPresetsLoaded(true);
    });
    return () => {
      live = false;
    };
    // presetKey stands for presetPolicies; presetEngine for its own JSON
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey, publicationKey, JSON.stringify(presetEngine)]);

  // The example shown, if any: its salary's source goes in "Based on"
  const activePreset = HOUSEHOLD_EXAMPLES.find((preset) => preset.id === presetId);

  const householdPolicies = useMemo(
    () => (selectionKey ? selectionKey.split(",") : []),
    [selectionKey],
  );
  const noneSelected = householdPolicies.length === 0;
  // What the household's own request asks for: the selected measures, then
  // any calculator-only one turned on. With none on it is the selection
  // itself, so the examples' precomputed answers (keyed to exactly the
  // published measures) still answer at once
  const requestPolicies = useMemo(() => withCalculatorOnly(householdPolicies), [householdPolicies]);
  const requestKeyPolicies = requestPolicies.join(",");
  // The cards' figures are for every measure: shown only while every
  // measure is selected
  const allSelected =
    presetPolicies.length > 0 &&
    householdPolicies.length === presetPolicies.length &&
    presetPolicies.every((id) => householdPolicies.includes(id));
  // The file answers every card in every year: the cards show it at once
  const presetsAnswer =
    allSelected &&
    HOUSEHOLD_EXAMPLES.every((example) => SELECTABLE_YEARS.every((y) => presetChanges[example.id]?.[y]));
  // Otherwise the cards' figures are asked for in the background, for the
  // selected measures (useExampleFigures.js)
  const fill = useExampleFigures({
    examples: EXAMPLE_REQUESTS,
    policies: householdPolicies,
    year,
    enabled: active && presetsLoaded && !presetsAnswer,
    publicationKey,
    expectedEngine,
    confirmPublication,
  });
  // Fill the form from an example and show its result at once (no
  // Calculate); every value stays editable
  const applyPreset = (preset) => {
    if (!preset) return;
    const next = { ...WIZARD_DEFAULTS, ...preset.inputs };
    setInputs(next);
    setStartFrom(null);
    setPresetId(preset.id);
    // The form closes; the result (or, for an answer not precomputed, its
    // progress) is scrolled to once shown
    setFormOpen(false);
    scrollToResult.current = true;
    if (householdPolicies.length > 0) {
      // Another household: its own result or a clean loading state, never
      // the previous card's (useHouseholdImpact's `household`)
      setSubmitted({ inputs: next, year, policies: requestPolicies, at: Date.now(), household: preset.id });
    }
  };
  // The results for the answers sent with Calculate, never the ones being
  // edited. The request carries on whatever else changes on the page (this
  // view stays mounted while another is shown).
  const householdResult = useHouseholdImpact({
    inputs: submitted?.inputs ?? inputs,
    year: submitted?.year ?? year,
    policies: submitted?.policies ?? requestPolicies,
    enabled: submitted !== null,
    publicationKey,
    expectedEngine,
    confirmPublication,
    seeded,
    household: submitted?.household ?? null,
  });
  const unmodelled = householdResult.data?.notModelled ?? [];
  const selectionUnavailable = !noneSelected && unmodelled.length > 0;
  const unavailableNames = unmodelled.map((measure) =>
    policies.find((policy) => policy.id === measure.id)?.name ?? measure.name ?? measure.id,
  );
  // The answers, year or policies differ from those of the result shown
  const changed =
    submitted !== null &&
    requestKey(buildHouseholdRequest(inputs, { year, policies: requestPolicies })) !==
      requestKey(buildHouseholdRequest(submitted.inputs, { year: submitted.year, policies: submitted.policies }));
  // Busy while the result for these same answers is calculated (headline,
  // then the split by policy and the sweep). Changed answers can always be
  // sent: a press while the old request runs starts the new one rather than
  // being swallowed (Pavel's review, HH11)
  const running =
    submitted !== null &&
    !changed &&
    (householdResult.status === "loading" || householdResult.detailStatus === "loading");

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
    const samePolicies = submitted.policies.join(",") === requestKeyPolicies;
    if (submitted.year === year && samePolicies) return;
    // The same household again: its last result stays, greyed, until the
    // new one arrives (unlike a switch to another card)
    setSubmitted({ ...submitted, year, policies: requestPolicies, at: Date.now() });
    // Only the bar's year and policies (and coming back to the view) rerun it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, requestKeyPolicies, active]);

  // "Your household" is chosen as the examples are, and opens the form.
  // From an example it starts from that example's answers (named at the
  // top of the form): the example's result goes at once, and Calculate
  // gives Your household's own. Otherwise it is your last answers, or the
  // typical ones. Chosen already, it opens or closes the form.
  const chooseYours = () => {
    if (presetId === null) {
      // Opening it brings it into view (below)
      if (!formOpen) scrollToForm.current = true;
      setFormOpen((open) => !open);
      return;
    }
    scrollToForm.current = true;
    setStartFrom(activePreset?.short ?? activePreset?.label ?? null);
    setPresetId(null);
    setSubmitted(null);
    setFormOpen(true);
  };
  // Your household is the one chosen: its form open, or its result shown
  const yoursSelected = presetId === null && (formOpen || submitted !== null);
  // Your own household's change, on its card, once calculated and unedited
  const yoursChange =
    presetId === null && submitted !== null && !changed && householdResult.status === "ready"
      ? (householdResult.data?.net?.change ?? null)
      : null;

  // After "Your household" opens the form: bring it into view below the
  // sticky bars (smoothly, or at once with reduced motion) and put the
  // focus in its first box, without the focus itself jumping the page
  const scrollToForm = useRef(false);
  useEffect(() => {
    if (!scrollToForm.current || !formOpen) return undefined;
    scrollToForm.current = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const panel = document.getElementById(FORM_PANEL_ID);
        const target = panel?.querySelector("form") ?? panel;
        if (!target) return;
        target.querySelector("input, select, textarea")?.focus({ preventScroll: true });
        scrollBelowBars(target, { behavior: prefersReducedMotion() ? "auto" : "smooth" });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [formOpen]);

  const resultsRef = useRef(null);
  // After an example card: bring its result (or its progress) into view
  // below the sticky bars, every time, unless its top is already in the
  // top third of the screen, and move focus to it. The region opens with
  // the "Your result" heading, so a phone lands on that heading (the
  // example's own description is gone: Vahid, 28 October). The region mounts
  // before what is under it has any height (the detail sections render a
  // frame or two later), so a single scroll is cut short at the page's
  // end as it was then: while the page grows, the scroll is asked again.
  const scrollToResult = useRef(false);
  useEffect(() => {
    if (!scrollToResult.current || submitted === null) return undefined;
    scrollToResult.current = false;
    let frame = requestAnimationFrame(() => {
      const target = resultsRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      const offset = stickyBottom() + STICKY_GAP;
      const { top } = target.getBoundingClientRect();
      if (top >= offset - 1 && top <= window.innerHeight / 3) return;
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      scrollBelowBars(target, { behavior });
      const page = document.documentElement;
      let height = page.scrollHeight;
      const until = performance.now() + 1500;
      const follow = () => {
        if (!target.isConnected || performance.now() > until) return;
        if (page.scrollHeight !== height) {
          height = page.scrollHeight;
          if (Math.abs(target.getBoundingClientRect().top - (stickyBottom() + STICKY_GAP)) > 1) {
            scrollBelowBars(target, { behavior });
          }
        }
        frame = requestAnimationFrame(follow);
      };
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [submitted]);

  // Back to the typical answers, with no example and no result (HH12)
  const resetAnswers = () => {
    setInputs({ ...WIZARD_DEFAULTS });
    setPresetId(null);
    setStartFrom(null);
    setSubmitted(null);
    savedWizard.inputs = {};
    savedWizard.presetId = null;
    savedWizard.startFrom = null;
    savedWizard.submitted = null;
  };

  const calculate = (event) => {
    event?.preventDefault();
    // One calculation at a time; nothing to ask without a policy
    if (running || noneSelected) return;
    setSubmitted({ inputs, year, policies: requestPolicies, at: Date.now(), household: presetId ?? "yours" });
    trackEvent("household_calculated", { household: presetId ?? "yours", year, policy_count: requestPolicies.length });
    // On a phone the results start screens below the button: bring the
    // waiting message into view, so pressing Calculate visibly does something
    requestAnimationFrame(() => {
      const target = resultsRef.current;
      if (!target) return;
      // Calculate is disabled while it runs, which drops keyboard focus
      // to the page's start: focus goes to the results instead (WCAG 2.4.3)
      const lost = document.activeElement;
      if (!lost || lost === document.body || lost.disabled) target.focus({ preventScroll: true });
      const { top } = target.getBoundingClientRect();
      if (top > window.innerHeight * 0.6) {
        scrollBelowBars(target, { behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    });
  };

  // Whether a field applies to the answers so far (rent only when renting)
  const fieldApplies = (id) => !FIELD_APPLIES[id] || FIELD_APPLIES[id](inputs, childrenCount, year);
  // The answers the selected policies read (utils/householdPolicyFields.js),
  // first in their step, in the table's order; the step's other answers
  // wait under "Other questions"
  const policyAsks = noneSelected ? [] : policyQuestions(requestPolicies, { inputs, year, applies: fieldApplies });

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

  // One question: its box, label above and hint below (none when `quiet`:
  // its group's line says it)
  const renderField = (id, { quiet = false } = {}) => {
    if (!fieldApplies(id)) return null;
    if (id === "children") return childAges.map(renderChild);
    let field;
    if (id === "children_count") {
      field = (
        <ChoiceTiles
          id={id}
          label={CHOICE_CONFIGS.children_count.label}
          layout="segmented"
          options={CHOICE_CONFIGS.children_count.options}
          value={childrenCount}
          onChange={setChildrenCount}
        />
      );
    } else if (id === "tenure") {
      const config = CHOICE_CONFIGS.tenure;
      field = (
        <ChoiceTiles
          id={id}
          label={config.label}
          layout="segmented"
          options={config.options}
          value={isRenting(inputs.tenure) ? RENTING : inputs.tenure}
          // "Rent" keeps the landlord already chosen; private at first
          onChange={(value) =>
            handleInputChange(id, value !== RENTING ? value : isRenting(inputs.tenure) ? inputs.tenure : "RENT_PRIVATELY")
          }
        />
      );
    } else if (id === "rent_from") {
      const config = CHOICE_CONFIGS.rent_from;
      field = (
        <SelectField
          id={id}
          label={config.label}
          options={config.options}
          value={inputs.tenure}
          onChange={(value) => handleInputChange("tenure", value)}
        />
      );
    } else if (id === "region") {
      field = (
        <LocalAuthorityField
          id="council"
          label="Local authority"
          value={inputs.council ?? null}
          regionLabel={regionName(inputs.region)}
          hint={LOCAL_AUTHORITY_HINT}
          onChange={(council) => {
            setPresetId(null);
            setInputs((prev) => ({ ...prev, council: council.name, region: council.region }));
          }}
        />
      );
    } else if (CHOICE_CONFIGS[id]) {
      const config = CHOICE_CONFIGS[id];
      // An option's own note (a loan plan's) stands in for the field's
      const chosen = config.options.find((option) => option.value === inputs[id]);
      const Control = config.layout === "segmented" ? ChoiceTiles : SelectField;
      field = (
        <Control
          id={id}
          label={config.label}
          options={config.options}
          value={inputs[id]}
          hint={quiet ? undefined : (chosen?.hint ?? config.hint)}
          hintAs={hintPlace(chosen?.hint ?? config.hint, config.hintAs)}
          {...(config.layout === "segmented" ? { layout: "segmented" } : {})}
          onChange={(value) => handleInputChange(id, value)}
        />
      );
    } else {
      const config = NUMBER_CONFIGS[id];
      const prefilled = PREFILLED[id] && (inputs[id] === null || inputs[id] === undefined);
      const value = inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
      const hint = PREFILL_HINTS[id] && prefilled ? PREFILL_HINTS[id](year, inputs) : quiet ? undefined : config.hint;
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
              {id === "monthly_rent" ? "Use the regional average" : "Use the full new State Pension"}
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
          // Ages are taken in the chosen year (the calculation does not age
          // anyone from 2026, unlike the salary, which it grows)
          hint={`Age in ${fiscalYearTick(year)}, from 0 to 19.`}
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

  // An answer as the calculation reads it (a prefilled field's prefill)
  const answer = (id) => inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
  // Whether an answer differs from where it started (WIZARD_DEFAULTS)
  const changedFromTypical = (id) => (PREFILLED[id] ? inputs[id] !== null && inputs[id] !== undefined : inputs[id] !== WIZARD_DEFAULTS[id]);

  // The seven steps, each with the answers a selected policy reads first
  // (in policyQuestions' order) and, when there are any, its other answers
  // under "Other questions"; a step no selected policy reads shows them all
  const policyOrder = policyAsks.map((question) => question.id);
  const shownGroups = FORM_GROUPS.map((group) => {
    if (group.always) return { ...group, primary: group.fields, optional: [] };
    // Savings interest is always asked first in its step, so the savings
    // switch (and the saver example) always has its answer in view
    const read = policyOrder.filter((id) => group.fields.includes(id));
    if (read.length === 0) return { ...group, primary: group.fields, optional: [] };
    const asked = [...new Set([...group.fields.filter((id) => ALWAYS_FIRST.includes(id)), ...read])];
    return { ...group, primary: asked, optional: group.fields.filter((id) => !asked.includes(id)) };
  });
  // Whether a numbered group starts open: You and Household only. The
  // others start closed, each saying which answers differ from the typical
  // ones (an example's too: it does not open them), so the form reads
  // calmly at first sight (Vahid, Budget day). Opened or closed by hand, it
  // stays so for the session. Closing one only hides its boxes: the
  // answers stay as they are, and the calculation reads them all
  const stepStartsOpen = (group) => Boolean(group.always);
  const isStepOpen = (group) => stepOpen[group.key] ?? stepStartsOpen(group);
  const renderGroup = (group, index) => {
    const optional = group.optional.filter(fieldApplies);
    return (
      <StepGroup
        key={group.key}
        group={group}
        number={index + 1}
        last={index === shownGroups.length - 1}
        open={isStepOpen(group)}
        onToggle={() => setStepOpen((prev) => ({ ...prev, [group.key]: !isStepOpen(group) }))}
        summary={stepSummary(group.fields, { answer, applies: fieldApplies, changed: changedFromTypical, inputs, childrenCount })}
        optional={optional.length > 0 ? optional.map((id) => renderField(id, { quiet: group.quiet?.includes(id) })) : null}
        optionalOpen={Boolean(optionalOpen[group.key])}
        onOptionalToggle={() => setOptionalOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
      >
        {group.primary.map((id) => renderField(id, { quiet: group.quiet?.includes(id) }))}
      </StepGroup>
    );
  };

  // The result among all UK households (the position card's "Among all
  // households" view): the Population impact scatter with this household
  // on it, for the year and policies the result was
  // asked with, once it is back and while the answers stand. The scatter's
  // y axis is baseline household net income in its basis year (2027-28),
  // so the household is placed by its own baseline income in that year.
  const scatterData = useHouseholdScatterData();
  const basisYear = scatterData.status === "ready" ? (scatterData.rows[0]?.income_basis_year ?? null) : null;
  const placed =
    submitted !== null &&
    !noneSelected &&
    !changed &&
    householdResult.status === "ready" &&
    !householdResult.stale &&
    householdResult.data
      ? householdResult.data
      : null;
  const basisIncome = useBasisIncome({
    inputs: submitted?.inputs ?? null,
    // Baseline income, the same whatever the measures: asked with the
    // result's own, and looked up under the examples' (the published ones
    // with the calculator-only ones), so their precomputed answers serve it
    policies: submitted?.policies ?? [],
    presetPolicies: withCalculatorOnly(presetPolicies),
    publicationKey,
    expectedEngine,
    basisYear,
    enabled: placed !== null,
  });
  const you = placed
    ? {
        change: placed.net.change,
        // Until the basis year's income is known no ring is drawn; if it
        // cannot be had, the ring goes by this year's income and says so
        income:
          basisIncome.status === "ready"
            ? basisIncome.income
            : basisIncome.status === "error"
              ? placed.net.before
              : null,
        incomeYear: basisIncome.status === "error" ? submitted.year : (basisYear ?? submitted.year),
        label: "You",
        note:
          placed.notModelled.length > 0
            ? `Your change leaves out ${placed.notModelled.length === 1 ? "one policy" : `${placed.notModelled.length} policies`} not modelled for one household; the dots include ${placed.notModelled.length === 1 ? "it" : "them"}.`
            : submitted.policies.length !== withoutCalculatorOnly(submitted.policies).length
              ? `Your change includes ${joinedPhrases(resultPolicies(submitted.policies).named)}, which the dots leave out.`
              : null,
      }
    : null;

  // Calculate: in the form's header, or on a phone at its foot
  const calculateButton = (
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
  );

  // Reset answers: a text button beside Calculate, no confirmation (HH12)
  const resetButton = (
    <button type="button" className="reset-answers-button" onClick={resetAnswers}>
      Reset answers
    </button>
  );

  return (
    <div className="household-calculator">
      <HouseholdCards
        examples={HOUSEHOLD_EXAMPLES}
        value={presetId}
        formOpen={formOpen}
        // aria-controls names the panel only while it is in the page
        formId={form.mounted ? FORM_PANEL_ID : undefined}
        onYours={chooseYours}
        onChoose={(id) => applyPreset(HOUSEHOLD_EXAMPLES.find((preset) => preset.id === id))}
        presets={noneSelected ? null : presetsAnswer ? presetChanges : fill.figures}
        fill={noneSelected || presetsAnswer ? null : fill}
        figurePolicies={householdPolicies}
        yoursChange={yoursChange}
        year={year}
        chosen={presetId !== null || formOpen || submitted !== null}
        yoursSelected={yoursSelected}
      />
      {/* A way into the chosen example's answers, one short line under the
          chips (Pavel's review, HH10; its description dropped, Vahid,
          28 October) */}
      {activePreset && !formOpen && (
        <p className="household-example-summary" data-example={activePreset.id}>
          <button type="button" className="link-button" onClick={chooseYours}>
            Edit these answers
          </button>
        </p>
      )}
      <div className="household-layout">
        {/* The whole form in one card, opened from "Your household": a
            header, then the questions in sections */}
        {form.mounted && (
        <div id={FORM_PANEL_ID} className={`expander-body household-form-panel ${form.expanded ? "is-expanded" : ""}`} data-open={formOpen}>
        <div className="expander-inner">
        <form className="card household-form" onSubmit={calculate} noValidate aria-label="Your household">
          <div className="household-form-header">
            <div className="household-form-title">
              <h2>
                <TitleIcon name="house" />
                Your household
              </h2>
              <p>Every answer starts at a typical value. Change any of them, then press Calculate.</p>
              {startFrom && (
                <p className="household-start-from">
                  Starting from: <strong>{startFrom}</strong>. Change anything, then Calculate.
                </p>
              )}
            </div>
            {/* Always there: with an example's answers unedited it
                calculates them again; on a phone, at the form's foot */}
            {!narrow && (
              <div className="household-header-actions">
                {resetButton}
                {calculateButton}
              </div>
            )}
          </div>
          {shownGroups.map(renderGroup)}
          {/* On a phone, Calculate waits at the screen's foot while the
              form is in view, after the questions in the tab order */}
          {narrow && (
            <div className="household-form-footer">
              {resetButton}
              {calculateButton}
            </div>
          )}
        </form>
        </div>
        </div>
        )}

        {/* Only once there is something to show: a result, its progress
            or the note to select a policy; before that the cards say
            what to do */}
        {/* Answers edited since the result: say so where the result was,
            so a reader never sees the page go blank (HH11) */}
        {!noneSelected && submitted !== null && changed && (
          <p className="household-results-stale" role="status">
            Your answers have changed. Press Calculate to see the new result.
          </p>
        )}
        {(noneSelected || (submitted !== null && !changed)) && (
        <div className="household-results" role="region" aria-label="Results" ref={resultsRef} tabIndex={-1}>
          {selectionUnavailable ? (
            <UnavailableNotice reason="Household calculator is unavailable for this selection">
              <p>These measures cannot be calculated for one household: {unavailableNames.join(", ")}.</p>
              <p>Select policies that can all be calculated to see your household&apos;s results.</p>
            </UnavailableNotice>
          ) : (
            <SingleYearHeadline
              result={householdResult}
              year={submitted?.year ?? year}
              policies={policies}
              noPolicies={noneSelected}
              renting={isRenting((submitted?.inputs ?? inputs).tenure)}
              spending={{
                petrol: (submitted?.inputs ?? inputs).petrol_spending_per_year,
                diesel: (submitted?.inputs ?? inputs).diesel_spending_per_year,
                electricity: (submitted?.inputs ?? inputs).electricity_spending_per_year,
                assumed: spendingAssumed(submitted?.inputs ?? inputs, presetId),
              }}
              submitted={submitted !== null}
              changed={changed}
              // The measures the result covers: the selection, counted, and
              // the calculator-only ones, named (resultPolicies)
              requestPolicies={submitted?.policies ?? requestPolicies}
              startedAt={submitted?.at ?? null}
              salarySource={activePreset?.salarySource ?? null}
              spendingSource={activePreset?.spendingSource ?? null}
              requestHousehold={submitted ? buildHouseholdRequest(submitted.inputs, { year: submitted.year, policies: submitted.policies }).household : null}
              // Your place among households is on the national results,
              // which leave the calculator-only measures out
              selected={withoutCalculatorOnly(submitted?.policies ?? householdPolicies)}
            />
          )}
        </div>
        )}
      </div>

      {/* The results' sections, below the form and headline, once asked */}
      {submitted !== null && !noneSelected && !selectionUnavailable && (
        <div role="region" aria-label="Your household's results">
          <SingleYearDetails
            result={householdResult}
            year={submitted.year}
            policies={policies}
            household={buildHouseholdRequest(submitted.inputs, { year: submitted.year, policies: submitted.policies }).household}
            // The position chart's dots are the national results, which
            // leave the calculator-only measures out
            selected={withoutCalculatorOnly(submitted.policies)}
            you={you}
            changed={changed}
            startedAt={submitted.at}
          />
        </div>
      )}
    </div>
  );
}

export default HouseholdCalculator;
