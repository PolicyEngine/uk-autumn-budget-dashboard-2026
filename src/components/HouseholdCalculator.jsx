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
import ConstituencyField from "./personal/ConstituencyField";
import PolicyBadges from "./personal/PolicyBadge";
import { policyQuestions } from "../utils/householdPolicyFields";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { prefersReducedMotion } from "../utils/chartMotion";
import "./HouseholdCalculator.css";
import { STICKY_GAP, scrollBelowBars, stickyBottom } from "../utils/pageScroll";


// The form: one card. The essentials first, as one grid of boxes and
// segmented choices; then More details, four groups that each open on
// their own and, closed, say what they hold. `children` stands for each
// child's answers (their age and, from 16, their education); `rent_from`
// is the landlord, the renting half of the tenure.
export const FORM_SECTIONS = [
  {
    title: "About your household",
    fields: [
      "current_age",
      "current_salary",
      "region",
      "has_partner",
      "children_count",
      "tenure",
      "partner_age",
      "partner_salary",
      "rent_from",
      "monthly_rent",
      "children",
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

// The "region" question asks for a constituency (2024 boundaries), which
// sets the region the calculation reads; the constituency itself is not sent
const CONSTITUENCY_HINT =
  "Your constituency sets your region, which the calculation uses: Scotland has its own income tax rates, and the rent and Council Tax estimates and housing support follow the region.";

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
    hint: "Estimated from your band and your region's average Band D for 2026-27, not your own council's, grown with the OBR's forecast (Source: MHCLG, Welsh and Scottish governments). Choose Band D if you are not sure.",
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
};

// Ages, as number boxes with − and + steppers; amounts, as £ boxes
const NUMBER_CONFIGS = {
  current_age: { label: "Age", min: 18, max: 80, step: 1 },
  current_salary: { label: "Salary in 2026", min: 0, max: 500000, step: 1000, money: true, suffix: "a year", hint: SALARY_SOURCE },
  partner_age: { label: "Partner's age", min: 18, max: 80, step: 1 },
  partner_salary: { label: "Partner's salary in 2026", min: 0, max: 500000, step: 1000, money: true, suffix: "a year" },
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
 * The selected policies' questions in runs: those next to each other read
 * by the same policies share one row of badges.
 */
export function policyClusters(questions) {
  const clusters = [];
  for (const question of questions) {
    const last = clusters.at(-1);
    if (last && last.policies.join(",") === question.policies.join(",")) last.fields.push(question.id);
    else clusters.push({ policies: question.policies, fields: [question.id] });
  }
  return clusters;
}

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
const sentence = (parts) => {
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * What a More details group holds, in one line, for its closed row:
 * "Petrol £620 · diesel £340 · electricity £1,040 a year (UK average)".
 * `applies(id)`: whether the group asks that field (not when it does not
 * apply, nor when the selected policies' questions ask it up front).
 */
export function groupSummary(title, { answer, applies, inputs, presetId }) {
  const amounts = (ids) =>
    ids.filter((id) => applies(id) && answer(id) > 0).map((id) => `${NUMBER_CONFIGS[id].label.toLowerCase()} ${pounds(answer(id))}`);
  if (title === "Other income") {
    return sentence(amounts(["savings_interest_per_year", "dividends_per_year", "property_income_per_year"])) || "None";
  }
  if (title === "Pension and student loan") {
    const parts = amounts([
      "private_pension_per_year",
      "partner_private_pension_per_year",
      "state_pension_per_year",
      "partner_state_pension_per_year",
      "salary_sacrifice_per_year",
    ]).map((part) => part.replace(/^your state pension/, "State Pension").replace(/state pension/, "State Pension"));
    const pensions = ["private_pension_per_year", "state_pension_per_year"];
    if (parts.length === 0 && pensions.some((id) => applies(id))) parts.push("no pension income");
    if (applies("student_loan_plan")) {
      const plan = CHOICE_CONFIGS.student_loan_plan.options.find((option) => option.value === inputs.student_loan_plan);
      parts.push(!plan || plan.value === "NONE" ? "no student loan" : `${plan.label} student loan`);
    }
    return sentence(parts) || "None";
  }
  if (title === "Spending") {
    const fuel = ["petrol_spending_per_year", "diesel_spending_per_year", "electricity_spending_per_year"]
      .filter(applies)
      .map((id) => `${NUMBER_CONFIGS[id].label.toLowerCase()} ${pounds(answer(id))}`);
    const parts = [];
    if (fuel.length > 0) {
      let text = `${sentence(fuel)} a year`;
      if (spendingAssumed(inputs, presetId) === "average") text += " (UK average)";
      parts.push(text);
    }
    if (applies("monthly_childcare") && answer("monthly_childcare") > 0) parts.push(`childcare ${pounds(answer("monthly_childcare"))} a month`);
    return sentence(parts) || "None";
  }
  const parts = [];
  if (applies("council_tax_band")) parts.push(`Council Tax band ${inputs.council_tax_band}`);
  if (applies("claims_universal_credit")) {
    parts.push(inputs.claims_universal_credit ? "claims Universal Credit if entitled" : "does not claim Universal Credit");
  }
  return sentence(parts);
}

/**
 * One More details group: a row that opens it, saying what it holds and
 * how many answers differ from the typical ones while closed, with "Reset
 * to typical" beside it once any do.
 */
function DetailsGroup({ id, title, icon, open, onToggle, summary, changed, onReset, children }) {
  const collapse = useCollapse(open);
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  return (
    <div className={`household-detail ${open ? "is-open" : ""}`.trim()}>
      <div className="household-detail-head">
        <h4 className="household-detail-heading">
          <button
            type="button"
            className="household-detail-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <TitleIcon name={icon} bare size={14} className="household-label-icon" />
            <span className="household-detail-title" id={titleId}>
              {title}
            </span>
            {!open && <span className="household-detail-summary">{summary}</span>}
            {changed > 0 && (
              <span className="household-detail-changed">{changed === 1 ? "1 changed" : `${changed} changed`}</span>
            )}
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
        </h4>
        {changed > 0 && (
          <button type="button" className="text-button household-detail-reset" aria-label={`Reset ${title} to typical`} onClick={onReset}>
            Reset to typical
          </button>
        )}
      </div>
      {collapse.mounted && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={titleId}
          className={`expander-body ${collapse.expanded ? "is-expanded" : ""}`}
        >
          <div className="expander-inner">
            <div className="household-detail-panel">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, presetId: null, formOpen: false, moreOpen: {}, submitted: null, startFrom: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, presetId: null, formOpen: false, moreOpen: {}, submitted: null, startFrom: null });
}

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
  // More details' groups open, by title: closed at first; kept between tab
  // switches for the session
  const [moreOpen, setMoreOpen] = useState(() => savedWizard.moreOpen);
  // The answers, year and policies last sent with Calculate: nothing is
  // asked before it, and a result stays tied to what it was asked with
  const [submitted, setSubmitted] = useState(() => savedWizard.submitted);
  const selectionKey = selectedPolicies.join(",");

  const handleInputChange = (id, value) => {
    setPresetId(null);
    // The controls give typed values: numbers from the number boxes,
    // strings and booleans from the choice boxes
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  // Remember the inputs and which More details groups are open for this session
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.presetId = presetId;
    savedWizard.startFrom = startFrom;
    savedWizard.formOpen = formOpen;
    savedWizard.moreOpen = moreOpen;
    savedWizard.submitted = submitted;
  }, [inputs, presetId, startFrom, formOpen, moreOpen, submitted]);

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
      setSubmitted({ inputs: next, year, policies: householdPolicies, at: Date.now(), household: preset.id });
    }
  };
  // The results for the answers sent with Calculate, never the ones being
  // edited. The request carries on whatever else changes on the page (this
  // view stays mounted while another is shown).
  const householdResult = useHouseholdImpact({
    inputs: submitted?.inputs ?? inputs,
    year: submitted?.year ?? year,
    policies: submitted?.policies ?? householdPolicies,
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
    // The same household again: its last result stays, greyed, until the
    // new one arrives (unlike a switch to another card)
    setSubmitted({ ...submitted, year, policies: householdPolicies, at: Date.now() });
    // Only the bar's year and policies (and coming back to the view) rerun it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, selectionKey, active]);

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
  // top third of the screen, and move focus to it. The region mounts
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

  const calculate = (event) => {
    event?.preventDefault();
    // One calculation at a time; nothing to ask without a policy
    if (running || noneSelected) return;
    setSubmitted({ inputs, year, policies: householdPolicies, at: Date.now(), household: presetId ?? "yours" });
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
  // asked up front, each with its policies; More details keeps the rest
  const policyAsks = noneSelected ? [] : policyQuestions(householdPolicies, { inputs, year, applies: fieldApplies });
  const askedUpFront = new Set(policyAsks.map((question) => question.id));
  const inDetails = (id) => !askedUpFront.has(id);
  const appliesInDetails = (id) => inDetails(id) && fieldApplies(id);

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

  // One question: its box, label above and hint below; asked for the
  // selected policies, described by their badges (`badgesId`)
  const renderField = (id, badgesId = undefined) => {
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
        <ConstituencyField
          id="constituency"
          label="Constituency"
          value={inputs.constituency ?? null}
          regionLabel={regionName(inputs.region)}
          hint={CONSTITUENCY_HINT}
          onChange={(seat) => {
            setPresetId(null);
            setInputs((prev) => ({ ...prev, constituency: seat.name, region: seat.region }));
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
          hint={chosen?.hint ?? config.hint}
          hintAs={hintPlace(chosen?.hint ?? config.hint, config.hintAs)}
          describedBy={badgesId}
          {...(config.layout === "segmented" ? { layout: "segmented" } : {})}
          onChange={(value) => handleInputChange(id, value)}
        />
      );
    } else {
      const config = NUMBER_CONFIGS[id];
      const prefilled = PREFILLED[id] && (inputs[id] === null || inputs[id] === undefined);
      const value = inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
      const hint = PREFILL_HINTS[id] && prefilled ? PREFILL_HINTS[id](year, inputs) : config.hint;
      field = (
        <div className="number-field-wrap">
          <NumberField
            id={id}
            {...config}
            hint={hint}
            hintAs={hintPlace(hint)}
            describedBy={badgesId}
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

  const renderGrid = (fields, className = "") => (
    <div className={`household-grid ${className}`.trim()}>{fields.map((id) => renderField(id))}</div>
  );

  // An answer as the calculation reads it (a prefilled field's prefill)
  const answer = (id) => inputs[id] ?? PREFILLED[id]?.(year, inputs) ?? 0;
  // Whether an answer differs from where it started (WIZARD_DEFAULTS)
  const changedFromTypical = (id) => (PREFILLED[id] ? inputs[id] !== null && inputs[id] !== undefined : inputs[id] !== WIZARD_DEFAULTS[id]);
  // A group's answers back to where they started (those it asks)
  const resetGroup = (group) => {
    setPresetId(null);
    const fields = group.fields.filter(inDetails);
    setInputs((prev) => ({ ...prev, ...Object.fromEntries(fields.map((id) => [id, WIZARD_DEFAULTS[id]])) }));
  };

  // The selected policies' own questions, after the essentials; none when
  // no selected policy reads an answer the essentials leave out
  const POLICY_QUESTIONS_ID = "household-policy-questions";
  const renderPolicyQuestions = () =>
    policyAsks.length === 0 ? null : (
      <section key="policy-questions" className="household-group household-policy-questions" aria-labelledby={POLICY_QUESTIONS_ID}>
        <div className="household-more-head">
          <TitleIcon name="list" size={14} className="title-icon household-more-icon" />
          <div className="household-more-text">
            <h3 className="household-more-heading" id={POLICY_QUESTIONS_ID}>
              Questions that matter for the selected policies
            </h3>
            <p className="household-more-note">Asked here because the policies selected use them.</p>
          </div>
        </div>
        {/* Questions next to each other that the same policies read share
            one row of badges: "Fuel duty" over Petrol and Diesel */}
        <div className="household-grid household-grid-details household-grid-policies">
          {policyClusters(policyAsks).map((cluster) => {
            const badgesId = `policies-for-${cluster.fields[0]}`;
            return (
              <div
                key={cluster.fields[0]}
                className="household-policy-cluster"
                data-span={Math.min(cluster.fields.length, 3)}
              >
                <PolicyBadges
                  id={badgesId}
                  label="Used by"
                  measures={cluster.policies.map((policyId) => policies.find((policy) => policy.id === policyId) ?? { id: policyId, name: policyId })}
                />
                <div className="household-policy-cluster-fields">{cluster.fields.map((id) => renderField(id, badgesId))}</div>
              </div>
            );
          })}
        </div>
      </section>
    );

  const renderSection = (section, index) => {
    if (!section.collapsible) {
      return (
        <section key={section.title} className="household-group household-essentials" aria-label={section.title}>
          {renderGrid(section.fields, "household-grid-essentials")}
        </section>
      );
    }
    const labelId = `household-section-${index}`;
    return (
      <section key={section.title} className="household-group household-more" aria-labelledby={labelId}>
        {/* The form's own header in small: a tinted icon, the title with an
            "Optional" tag, and one muted line under it */}
        <div className="household-more-head">
          <TitleIcon name={section.icon} size={14} className="title-icon household-more-icon" />
          <div className="household-more-text">
            <div className="household-more-title">
              <h3 className="household-more-heading" id={labelId}>
                {section.title}
              </h3>
              <span className="household-more-tag">Optional</span>
            </div>
            <p className="household-more-note">Each starts at a typical value for a household like yours.</p>
          </div>
        </div>
        <div className="household-details">
          {section.groups.map((group) => {
            const shown = group.fields.filter(appliesInDetails);
            if (shown.length === 0) return null;
            const slug = group.title.toLowerCase().replace(/[^a-z]+/g, "-");
            return (
              <DetailsGroup
                key={group.title}
                id={`${labelId}-${slug}`}
                title={group.title}
                icon={group.icon}
                open={Boolean(moreOpen[group.title])}
                onToggle={() => setMoreOpen((prev) => ({ ...prev, [group.title]: !prev[group.title] }))}
                summary={groupSummary(group.title, { answer, applies: appliesInDetails, inputs, presetId })}
                changed={shown.filter(changedFromTypical).length}
                onReset={() => resetGroup(group)}
              >
                {renderGrid(group.fields.filter(inDetails), "household-grid-details")}
              </DetailsGroup>
            );
          })}
        </div>
      </section>
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
    policies: submitted?.policies ?? [],
    presetPolicies,
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
            : null,
      }
    : null;

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
                calculates them again */}
            <div className="household-header-actions">
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
          {FORM_SECTIONS.map((section, index) => [renderSection(section, index), index === 0 && renderPolicyQuestions()])}
        </form>
        </div>
        </div>
        )}

        {/* Only once there is something to show: a result, its progress
            or the note to select a policy; before that the cards say
            what to do */}
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
              policyCount={submitted?.policies.length ?? householdPolicies.length}
              startedAt={submitted?.at ?? null}
              salarySource={activePreset?.salarySource ?? null}
              spendingSource={activePreset?.spendingSource ?? null}
              requestHousehold={submitted ? buildHouseholdRequest(submitted.inputs, { year: submitted.year, policies: submitted.policies }).household : null}
              selected={submitted?.policies ?? householdPolicies}
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
            selected={submitted.policies}
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
