/**
 * Per-measure presentation that the published catalogue does not carry.
 *
 * The measures themselves, their names, order and colours, come from the
 * approved catalogue (src/utils/measureCatalogue.js), never a fixed list
 * here. Only a measure's icon is chosen on the page, from the tax or benefit
 * its name says it changes, so a measure published on Budget day gets one
 * without a code change.
 */

// TitleIcon names, by the kind of tax or benefit a measure changes
export const POLICY_TYPE_ICONS = {
  incomeTax: "receipt",
  capitalGainsTax: "briefcase",
  fuelDuty: "fuel",
  vat: "tag",
  electricityVat: "bolt",
  energyBenefit: "flame",
  pension: "clock",
  employerNi: "building",
  studentLoan: "cap",
};

// The first rule whose pattern matches the measure's name picks its icon
const ICON_RULES = [
  [/electric/i, POLICY_TYPE_ICONS.electricityVat],
  [/\bVAT\b/, POLICY_TYPE_ICONS.vat],
  [/fuel duty/i, POLICY_TYPE_ICONS.fuelDuty],
  [/warm home|energy|heating/i, POLICY_TYPE_ICONS.energyBenefit],
  [/student loan/i, POLICY_TYPE_ICONS.studentLoan],
  [/employer|national insurance|\bNI\b/i, POLICY_TYPE_ICONS.employerNi],
  [/pension/i, POLICY_TYPE_ICONS.pension],
  [/capital gains|disposal relief|\bCGT\b/i, POLICY_TYPE_ICONS.capitalGainsTax],
];

/** A measure's icon: by the tax or benefit its name names, else income tax. */
export function policyIcon(measure) {
  const name = measure?.label ?? measure?.name ?? "";
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(name)) return icon;
  }
  return POLICY_TYPE_ICONS.incomeTax;
}
