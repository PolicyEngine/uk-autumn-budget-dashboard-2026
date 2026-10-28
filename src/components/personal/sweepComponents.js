import { CHART_COLOURS } from "../../utils/chartTheme";

/**
 * One list of components for both "Across earnings" cards, so their "Show:"
 * keys name the same things in the same order and colours, and a chip
 * toggled on one is toggled on the other. Each says which of the API's
 * parts it stands for on each card: `net` (net_income_parts, £) and `rate`
 * (marginal_rate_parts, share of an extra pound). A card without the
 * component (`null`) shows its chip disabled, with why (`absent`).
 */
export const SWEEP_COMPONENTS = [
  {
    key: "earnings",
    label: "Earnings and other income",
    about: "Your salary and any other income, before tax.",
    color: CHART_COLOURS.marketIncome,
    net: ["market_income"],
    rate: null,
    absent: { rate: "Not part of the rate: it is the salary the rate is taken from" },
  },
  {
    key: "state_pension",
    label: "State Pension",
    about: "The State Pension, paid from State Pension age.",
    color: CHART_COLOURS.netStatePension,
    net: ["state_pension"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "universal_credit",
    label: "Universal Credit",
    about: "The means-tested benefit for working-age households, withdrawn as earnings rise.",
    color: CHART_COLOURS.mtrUniversalCredit,
    net: ["universal_credit"],
    rate: ["universal_credit"],
  },
  {
    key: "child_benefit",
    label: "Child Benefit and its charge",
    about: "Child Benefit, less the High Income Child Benefit Charge that takes it back between £60,000 and £80,000 of income.",
    color: CHART_COLOURS.mtrChildBenefit,
    net: ["child_benefit", "child_benefit_charge"],
    rate: ["child_benefit_charge"],
  },
  {
    key: "warm_home_discount",
    label: "Warm Home Discount",
    about: "The rebate on winter electricity bills for households on some benefits.",
    color: CHART_COLOURS.netWarmHomeDiscount,
    net: ["warm_home_discount"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "other_benefits",
    label: "Other benefits",
    about: "Benefits not named here, such as Pension Credit and disability benefits.",
    color: CHART_COLOURS.mtrOtherBenefits,
    net: ["other_benefits"],
    rate: ["other_benefits"],
  },
  {
    key: "income_tax",
    label: "Income tax",
    about: "Tax on income above the personal allowance.",
    color: CHART_COLOURS.mtrIncomeTax,
    net: ["income_tax"],
    rate: ["income_tax"],
  },
  {
    key: "pa_taper",
    label: "Personal allowance taper",
    about: "The personal allowance falls by £1 for every £2 of income above £100,000, so each extra pound also makes 50p more taxable.",
    color: CHART_COLOURS.mtrAllowanceTaper,
    net: null,
    rate: ["personal_allowance_taper"],
    absent: { net: "Included in income tax on this card" },
  },
  {
    key: "national_insurance",
    label: "National Insurance",
    about: "Employee National Insurance on earnings.",
    color: CHART_COLOURS.mtrNationalInsurance,
    net: ["national_insurance"],
    rate: ["national_insurance"],
  },
  {
    key: "student_loan",
    label: "Student loan",
    about: "Student loan repayments taken from earnings above your plan's threshold.",
    color: CHART_COLOURS.mtrStudentLoan,
    net: ["student_loan"],
    rate: ["student_loan"],
  },
  {
    key: "council_tax",
    label: "Council Tax",
    about: "The local tax on your home, set by your council.",
    color: CHART_COLOURS.netCouncilTax,
    net: ["council_tax"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "fuel_duty",
    label: "Fuel duty",
    about: "The duty in what you spend on petrol and diesel.",
    color: CHART_COLOURS.netFuelDuty,
    net: ["fuel_duty"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "vat_change",
    label: "VAT change",
    about: "The change the policies make to the VAT on your electricity, petrol and diesel spending.",
    color: CHART_COLOURS.netVat,
    net: ["vat_change"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "pension_contributions",
    label: "Pension contributions",
    about: "Your own contributions to a workplace or personal pension.",
    color: CHART_COLOURS.pensionContributions,
    net: ["pension_contributions"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "other",
    label: "Other",
    about: "Taxes and deductions not named here.",
    color: CHART_COLOURS.mtrOther,
    net: ["other_taxes"],
    rate: ["other"],
  },
];

export const NO_EFFECT_TIP = "No effect for this household";

/** The component a card's part belongs to. */
export function componentOf(card, part) {
  return SWEEP_COMPONENTS.find((component) => (component[card] ?? []).includes(part)) ?? null;
}

/** Why a component shown in both keys has nothing on this card. */
const NOTHING_HERE = {
  net: "No effect on your net income",
  rate: "Doesn't change your marginal rate",
};

/** The components that apply to this household on either card (net and rate parts in use). */
export function componentsInUse(netInUse, rateInUse) {
  return new Set(
    SWEEP_COMPONENTS.filter(
      (component) => (component.net ?? []).some((part) => netInUse.has(part)) || (component.rate ?? []).some((part) => rateInUse.has(part)),
    ).map((component) => component.key),
  );
}

/**
 * The "Show:" chips for one card: every component, in order. Those that
 * apply on either card (`union`) are in both keys alike, so the two rows
 * match chip for chip: on a card where one has nothing, its chip is
 * disabled with why. The rest are folded (`folded`) into the "+N with no
 * effect for you" chip, the same N on both. Then the total. Without
 * `union`, those this card draws are shown and the rest folded.
 *
 * @param {"net"|"rate"} card
 * @param {Set<string>} inUse - The card's parts in use for this household
 * @param {{label: string, colour: string}} total - The total line's chip
 * @param {Set<string>|null} [union] - Component keys that apply on either card
 */
export function sweepChips(card, inUse, total, union = null) {
  return [
    ...SWEEP_COMPONENTS.map((component) => {
      const parts = component[card];
      const used = Boolean(parts) && parts.some((part) => inUse.has(part));
      const shown = union ? union.has(component.key) : used;
      return {
        key: component.key,
        label: component.label,
        colour: component.color,
        shape: "block",
        disabled: !used,
        folded: !shown,
        tip: used ? null : !parts ? component.absent?.[card] ?? NOTHING_HERE[card] : shown ? NOTHING_HERE[card] : NO_EFFECT_TIP,
      };
    }),
    { key: "total", label: total.label, colour: total.colour },
  ];
}

/** The card's parts hidden, from the components switched off. */
export function hiddenParts(card, hidden) {
  return SWEEP_COMPONENTS.filter((component) => hidden.includes(component.key)).flatMap((component) => component[card] ?? []);
}

/** The two charts the shared key drives, by card. */
export const CHART_NAMES = { net: "Household net income", rate: "Marginal tax rate across earnings" };

/** What "no effect" means on each chart, mid-sentence. */
const NO_EFFECT_ON = { net: "your net income", rate: "your marginal tax rate" };

/**
 * Whether a component has an effect on each chart for this household:
 * some part of it in use (at or above the chart's own threshold: £1 of net
 * income, 0.5pp of the marginal rate, so the tip and the drawing agree).
 *
 * @param {Object} component - A SWEEP_COMPONENTS entry
 * @param {Set<string>} netInUse - Net income layers in use (NET_LAYERS keys)
 * @param {Set<string>} rateInUse - Marginal rate parts in use (RATE_PARTS names)
 * @returns {{net: boolean, rate: boolean}}
 */
export function componentEffect(component, netInUse, rateInUse) {
  return {
    net: (component.net ?? []).some((part) => netInUse.has(part)),
    rate: (component.rate ?? []).some((part) => rateInUse.has(part)),
  };
}

/** Why a component is never on one chart, where "no effect" would mislead. */
const STRUCTURAL = {
  earnings: "the marginal tax rate is taken from earnings, not made of them",
  pa_taper: "on net income it is counted in income tax",
};

/**
 * The note on a shared chip whose component is missing from one chart or
 * both: "Council Tax: no effect on your marginal tax rate — shown on
 * Household net income only." A component never on a chart (the
 * personal allowance taper is inside income tax on net income) says why;
 * one on neither, "no effect on either chart for you". Null when it is on both.
 */
export function noEffectNote(component, effect) {
  if (effect.net && effect.rate) return null;
  if (!effect.net && !effect.rate) return `${component.label}: no effect on either chart for you.`;
  const missing = effect.net ? "rate" : "net";
  const shownOn = CHART_NAMES[effect.net ? "net" : "rate"];
  // Never on that chart for anyone, for a reason other than "does not change with salary"
  const structural = component[missing] === null ? STRUCTURAL[component.key] : null;
  if (structural) return `${component.label}: shown on ${shownOn} only — ${structural}.`;
  return `${component.label}: no effect on ${NO_EFFECT_ON[missing]} — shown on ${shownOn} only.`;
}

/** A shared chip's tip: the note on where it has no effect (if any), then what it is. */
export function sharedChipTip(component, effect) {
  const note = noEffectNote(component, effect);
  return note ? `${note} ${component.about}` : component.about;
}

export const TOTAL_TIP = "Total: net income on Household net income, and the whole marginal tax rate on Marginal tax rate across earnings.";

/**
 * The one "Show:" control above both "Across earnings" cards: a chip for
 * each component that applies on either card (in the cards' order and
 * colours), the rest folded into "N more with no effect for you", then the
 * total (each card's own total line). Every chip's tip says what it is,
 * and, where it has no effect on one chart or both, so.
 *
 * @param {Set<string>} netInUse - Net income layers in use (NET_LAYERS keys)
 * @param {Set<string>} rateInUse - Marginal rate parts in use (RATE_PARTS names)
 */
export function sharedSweepChips(netInUse, rateInUse) {
  return [
    ...SWEEP_COMPONENTS.map((component) => {
      const effect = componentEffect(component, netInUse, rateInUse);
      const shown = effect.net || effect.rate;
      return {
        key: component.key,
        label: component.label,
        colour: component.color,
        shape: "block",
        disabled: !shown,
        folded: !shown,
        tip: sharedChipTip(component, effect),
      };
    }),
    { key: "total", label: "Total", colour: CHART_COLOURS.text, tip: TOTAL_TIP },
  ];
}
