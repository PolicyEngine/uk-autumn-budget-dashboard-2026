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
    color: CHART_COLOURS.marketIncome,
    net: ["market_income"],
    rate: null,
    absent: { rate: "Not part of the rate: it is the salary the rate is taken from" },
  },
  {
    key: "state_pension",
    label: "State Pension",
    color: CHART_COLOURS.netStatePension,
    net: ["state_pension"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "universal_credit",
    label: "Universal Credit",
    color: CHART_COLOURS.mtrUniversalCredit,
    net: ["universal_credit"],
    rate: ["universal_credit"],
  },
  {
    key: "child_benefit",
    label: "Child Benefit and its charge",
    color: CHART_COLOURS.mtrChildBenefit,
    net: ["child_benefit", "child_benefit_charge"],
    rate: ["child_benefit_charge"],
  },
  {
    key: "warm_home_discount",
    label: "Warm Home Discount",
    color: CHART_COLOURS.netWarmHomeDiscount,
    net: ["warm_home_discount"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "other_benefits",
    label: "Other benefits",
    color: CHART_COLOURS.mtrOtherBenefits,
    net: ["other_benefits"],
    rate: ["other_benefits"],
  },
  {
    key: "income_tax",
    label: "Income tax",
    color: CHART_COLOURS.mtrIncomeTax,
    net: ["income_tax"],
    rate: ["income_tax"],
  },
  {
    key: "pa_taper",
    label: "Personal allowance taper",
    color: CHART_COLOURS.mtrAllowanceTaper,
    net: null,
    rate: ["personal_allowance_taper"],
    absent: { net: "Included in income tax on this card" },
  },
  {
    key: "national_insurance",
    label: "National Insurance",
    color: CHART_COLOURS.mtrNationalInsurance,
    net: ["national_insurance"],
    rate: ["national_insurance"],
  },
  {
    key: "student_loan",
    label: "Student loan",
    color: CHART_COLOURS.mtrStudentLoan,
    net: ["student_loan"],
    rate: ["student_loan"],
  },
  {
    key: "council_tax",
    label: "Council Tax",
    color: CHART_COLOURS.netCouncilTax,
    net: ["council_tax"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "fuel_duty",
    label: "Fuel duty",
    color: CHART_COLOURS.netFuelDuty,
    net: ["fuel_duty"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "vat_change",
    label: "VAT change",
    color: CHART_COLOURS.netVat,
    net: ["vat_change"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "pension_contributions",
    label: "Pension contributions",
    color: CHART_COLOURS.pensionContributions,
    net: ["pension_contributions"],
    rate: null,
    absent: { rate: "Does not change with salary" },
  },
  {
    key: "other",
    label: "Other",
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
