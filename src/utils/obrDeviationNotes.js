import { policyDetailsFor } from "./policyDetails";

/**
 * Why our estimates differ from the official costings, for the comparison
 * with them on Public finances (OBRComparisonTable).
 *
 * OBR_DEVIATION_STATEMENT is the comparison's general statement, in its
 * "About this chart": the reasons any estimate can differ.
 *
 * OBR_DEVIATION_NOTES has one note per measure the comparison costs (each
 * measure data_inputs/treasury/mapping.csv maps to the Budget's Table 6.1),
 * keyed by measure id. Each was written on Budget day by the policy's
 * review seat, from its own runs and the Budget documents: the gap in the
 * compared years, in £m or %, and its reasons (timing, coverage, behaviour,
 * scope or forecast). A measure within its band still has one. The
 * comparison shows a measure's note behind the ⓘ at the right of its
 * difference, in the chart and the table (OBRDeviationExplanation.jsx),
 * which a tap opens on a phone too.
 *
 * OBR_COMPARISON_BASES has one line per compared measure, keyed by measure
 * id: what each side counts ("Official: …. Ours: …."), from each measure's
 * policy costing note (#297). It sits above the measure's note, behind its
 * ⓘ and in the CSV, so a reader sees what the two figures measure before
 * the gap.
 *
 * A note or line was written for the measure as the publication then
 * described it, so it shows only while its card entry (policyDetails.js)
 * still fits: the publication describes the measure exactly as the entry's
 * `writtenFor` (deviationNoteFor, comparisonBasisFor). A redescribed measure
 * shows the statement alone until its entry, its note and its line are
 * rewritten.
 */
export const OBR_DEVIATION_STATEMENT =
  "Our estimates differ from the official costings for four main reasons: when tax is counted (we score each tax year's liability; the official costings are on a National Accounts basis, in which tax paid through Self Assessment can fall in a later year), coverage (we use household survey data, so effects outside households, and on incomes the survey records thinly, are estimated less fully in ours), behaviour (ours are static; most official costings include responses) and scope (the parts of a policy each models). The ⓘ beside each policy's difference says which apply.";

export const OBR_DEVIATION_NOTES = {
  household_energy_payment_2026:
    "Our £1,969 million in 2026-27 is 25% below the official £2,625 million, because the official figure also covers two things we don't model: the devolved governments' share of the funding (about £425 million, our estimate using the Barnett formula) and £100 million for councils in England to target the households hit hardest. Without them, about £2,100 million remains for the £100 payments in England, and our estimate is 94% of that; the Budget doesn't itemise the remaining £130 million or so. Both estimates are zero in every later year.",
  domestic_electricity_zero_vat:
    "Our cost is £85m (11%) above the official costing in 2026-27 and £48m (16%) above it in 2027-28. The official costing also covers charities, residential care and some businesses, and it counts households switching from gas to electricity; both make the official figure larger, so neither explains the gap. Ours starts from DESNZ's domestic electricity volumes at average prices paid, grown with CPI. The official costing starts from ONS consumer spending, which is 10% to 12% lower; at that level our cost would be within about 4% of the official figure in both years.",
  carers_allowance_earnings_taper:
    "Our static estimate is about 60% of the official costing in both compared years: £24 million against £40 million in 2030-31, and £48 million against £80 million in 2031-32. The gap is close to the income tax on the higher allowance, which our net cost subtracts (£15 million and £32 million): before that tax, ours is £39 million and £79 million, and the official costing note describes Carer's Allowance spending and Universal Credit interactions without mentioning income tax. The official figure also includes a labour-supply response, which ours does not, and the model does not count the income tax collected on the allowance through PAYE against Universal Credit earnings, which makes its Universal Credit saving larger.",
  state_pension_income_tax_protection:
    "The official costing counts income tax only. Ours is £42m, £112m and £193m, in line in 2027-28 and 25% and 29% higher in 2028-29 and 2029-30, because our data put more pensioners just above the personal allowance (about 670,000 gain in 2027-28, against the Treasury's 500,000). After Pension Credit, Housing Benefit and Council Tax Reduction take back part of it, our net cost is £30m, £83m and £144m. For 2028-29 and 2029-30 we set the allowance at £182 and £250 a year, from the October 2026 forecast of the State Pension.",
  trading_allowance_raise:
    "From 2028-29 our estimate is £46m to £107m a year below the Treasury's (28% to 47%), with the largest gap in 2028-29. The Treasury's costing includes people switching from actual expenses to the larger allowance, which we don't model. Without gross receipts in the survey data, we give traders with profits above £3,000 nothing from the change and give miscellaneous income no allowance at all, while for some profits between £1,000 and £3,000 we overstate the gain, because we leave them unrelieved under the current £1,000 allowance.",
  fuel_duty_rise_deferral:
    "PolicyEngine's cost is £274 million below the official costing in 2026-27 (£301 million against £575 million) and £259 million below in 2027-28 (£521 million against £780 million); from 2028-29 both are zero. Most of the gap is coverage: PolicyEngine counts only the petrol and diesel that households buy, about £13 billion of the £24 billion of fuel duty the OBR forecasts for 2026-27, while the official costing covers all taxable fuel, including fuel that businesses buy, and scaled to the OBR's fuel duty receipts PolicyEngine's fuel duty cost would be about £450 million in 2026-27 and £760 million in 2027-28. VAT and behaviour narrow the gap rather than explain it (PolicyEngine's figure includes £50 million and £87 million of VAT on the lower pump price, which the official fuel duty figure leaves out, and the official costing's demand response makes its cost smaller). The rest of the 2026-27 gap fits the official costing assuming the full 5p returns on 1 January 2027 (about £555 million on 45 billion litres), where the law brings it back as 3p and then 2p from 1 March (about £410 million).",
  property_income_rates_up:
    "The official costing puts the tax later than the year it's owed: the OBR adds £0.0bn (rounded) of Self Assessment receipts from the savings and property rate rises in 2027-28 and £1.0bn in 2028-29, so those two years aren't comparable with our tax-year figures. From 2029-30 we're within 1.5% of the Treasury's costing (Table 6.1) every year, +£429m against +£435m in 2029-30 (the OBR's own table has £400m). The official costing takes off about £0.1bn a year for landlords incorporating and lower compliance, which ours leaves out, so before behaviour ours is about £0.1bn a year lower.",
  savings_income_rates_up:
    "Timing affects 2027-28 and 2028-29, as for property; from 2029-30 ours is 58% to 59% of the official costing (+£307m against +£520m in 2029-30), and behaviour widens the gap, because the official figure is already after about £0.2bn a year of savers moving money into ISAs. The gap is in how much savings income is taxed at the raised basic, higher and additional rates: about £36bn to £40bn a year in the official costing from 2029-30 to 2031-32, against £15bn to £17bn in ours. Most of the gap is in our data. We calibrated savings interest to HMRC's figures on a different basis: ours included interest in ISAs, which HMRC's figures leave out, so our taxable interest came out about a third too low. We are correcting this, with HMRC's other savings income and the OBR's savings income growth, and will update the dashboard with the corrected data.",
};

export const OBR_COMPARISON_BASES = {
  household_energy_payment_2026:
    "Official: the £100 payments in England, devolved funding and a £100m fund for councils. Ours: the £100 payments in England.",
  domestic_electricity_zero_vat:
    "Official: VAT on electricity bought by households, charities, care homes and small firms, after fuel switching. Ours: households, static.",
  fuel_duty_rise_deferral:
    "Official: fuel duty on every litre, business included, after behaviour. Ours: duty and VAT on households' petrol and diesel, static.",
  carers_allowance_earnings_taper:
    "Official: Carer's Allowance and Universal Credit spending, after behaviour. Ours: also the income tax on the allowance, static.",
  trading_allowance_raise:
    "Official: income tax on a National Accounts basis, with switching from expenses. Ours: income tax and Class 4 by tax year, static.",
  state_pension_income_tax_protection:
    "Official: income tax only, no behaviour. Ours: income tax less Pension Credit, Housing Benefit and Council Tax Reduction savings.",
  property_income_rates_up:
    "Official: income tax on a National Accounts basis, after incorporation. Ours: income tax by tax year, static.",
  savings_income_rates_up:
    "Official: income tax on a National Accounts basis, after moves into ISAs. Ours: income tax by tax year, static.",
};

// The text `texts` has for a catalogue measure, trimmed, while its card
// entry fits it (policyDetailsFor); else null
const fittingText = (measure, texts) => {
  const text = measure ? texts[measure.id] : undefined;
  return typeof text === "string" && text.trim() && policyDetailsFor(measure) ? text.trim() : null;
};

/**
 * A comparison row's note: the one `notes` has for its catalogue measure,
 * while its card entry fits it (policyDetailsFor); else null.
 */
export function deviationNoteFor(measure, notes = OBR_DEVIATION_NOTES) {
  return fittingText(measure, notes);
}

/**
 * A comparison row's "what each side counts" line, by the same rule as its
 * note: the one `bases` has for its catalogue measure, while its card entry
 * fits it; else null.
 */
export function comparisonBasisFor(measure, bases = OBR_COMPARISON_BASES) {
  return fittingText(measure, bases);
}

/** The measures in `ids` with no note in `notes` (or line in `bases`), in order. */
export function missingDeviationNotes(ids, notes = OBR_DEVIATION_NOTES) {
  return ids.filter((id) => typeof notes[id] !== "string" || !notes[id].trim());
}
