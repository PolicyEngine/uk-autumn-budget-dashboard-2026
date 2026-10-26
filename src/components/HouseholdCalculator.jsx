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
import { NumberField, SelectField } from "./personal/FormControls";
import ConstituencyField from "./personal/ConstituencyField";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { prefersReducedMotion } from "../utils/chartMotion";
import "./HouseholdCalculator.css";


// The form: one card of questions in labelled sections, each a grid of
// boxes. The essentials first, then the optional details in More details,
// closed at first, in groups of their own. `children` stands for each
// child's answers (their age and, from 16, their education).
export const FORM_SECTIONS = [
  { title: "You", icon: "user", fields: ["current_age", "current_salary", "region"] },
  {
    title: "Family and home",
    icon: "house",
    fields: ["has_partner", "partner_age", "partner_salary", "children_count", "children", "tenure", "monthly_rent"],
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
// A child's age when added (as Spring Statement's calculator does)
const NEW_CHILD_AGE = 5;

// Choices shown as selects
const CHOICE_CONFIGS = {
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
    hint: "Council Tax is estimated from your band and your region's average Band D for 2026-27 (MHCLG, Welsh and Scottish governments), not your own council's, grown with the OBR's forecast. Band D if you are not sure.",
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
    hint: "Pension paid by salary sacrifice. Enter your salary above after the sacrifice, as your payslip shows it. Before April 2029 the sacrifice changes no figure here; from then, its National Insurance relief is capped at £2,000 a year.",
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
    `Prefilled with the average private rent in ${regionName(inputs.region)} (ONS, ${
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

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, presetId: null, formOpen: false, moreOpen: false, submitted: null, startFrom: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, presetId: null, formOpen: false, moreOpen: false, submitted: null, startFrom: null });
}

// The form's panel, opened by the "Your household" card
const FORM_PANEL_ID = "household-form-panel";

/**
 * The Household impact view: one list of questions about a household, each
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
    // strings and booleans from the choice boxes
    setInputs((prev) => ({ ...prev, [id]: value }));
  };

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  // Remember the inputs and whether More details is open for this session
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
      setFormOpen((open) => !open);
      return;
    }
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
      const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const { top } = target.getBoundingClientRect();
      if (top >= offset - 1 && top <= window.innerHeight / 3) return;
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      target.scrollIntoView({ behavior, block: "start" });
      const page = document.documentElement;
      let height = page.scrollHeight;
      const until = performance.now() + 1500;
      const follow = () => {
        if (!target.isConnected || performance.now() > until) return;
        if (page.scrollHeight !== height) {
          height = page.scrollHeight;
          if (Math.abs(target.getBoundingClientRect().top - offset) > 1) {
            target.scrollIntoView({ behavior, block: "start" });
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
    if (id === "children_count") {
      field = (
        <SelectField
          id={id}
          label={CHOICE_CONFIGS.children_count.label}
          options={CHOICE_CONFIGS.children_count.options}
          value={childrenCount}
          onChange={setChildrenCount}
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
      const hint = PREFILL_HINTS[id] && prefilled ? PREFILL_HINTS[id](year, inputs) : config.hint;
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
            ? `Your change leaves out ${placed.notModelled.length === 1 ? "one measure" : `${placed.notModelled.length} measures`} not modelled for one household; the dots include ${placed.notModelled.length === 1 ? "it" : "them"}.`
            : null,
      }
    : null;

  return (
    <div className="household-calculator">
      <HouseholdCards
        examples={HOUSEHOLD_EXAMPLES}
        value={presetId}
        formOpen={formOpen}
        formId={FORM_PANEL_ID}
        onYours={chooseYours}
        onChoose={(id) => applyPreset(HOUSEHOLD_EXAMPLES.find((preset) => preset.id === id))}
        presets={noneSelected ? null : presetsAnswer ? presetChanges : fill.figures}
        fill={noneSelected || presetsAnswer ? null : fill}
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
          {FORM_SECTIONS.map(renderSection)}
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
            <UnavailableNotice reason="Household impact is unavailable for this selection">
              <p>These measures cannot be calculated for one household: {unavailableNames.join(", ")}.</p>
              <p>Select measures that can all be calculated to see your household&apos;s results.</p>
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
