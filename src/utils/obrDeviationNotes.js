/**
 * Why our estimates differ from the official costings, for the comparison
 * with them on Public finances (OBRComparisonTable).
 *
 * OBR_DEVIATION_STATEMENT is the comparison's general statement, shown
 * under its chart or table: the reasons any estimate can differ, as "About
 * this chart" gives them.
 *
 * OBR_DEVIATION_NOTES has one note per measure the comparison costs (each
 * measure data_inputs/treasury/mapping.csv maps to the Budget's Table 6.1),
 * keyed by measure id. Each was written on Budget day by the policy's
 * review seat, from its own runs and the Budget documents: the gap in the
 * compared years, in £m or %, and its reasons (timing, coverage, behaviour,
 * scope or forecast). A measure within its band still has one. The
 * comparison shows a measure's note in the tooltip of its row and in "Why
 * each policy differs" under the chart, which works on a phone.
 */
export const OBR_DEVIATION_STATEMENT =
  "Our estimates differ from the official costings for four main reasons: when tax is counted (we score each tax year's liability; official costings count tax when it is paid), coverage (we use household survey data, so effects outside households, and on incomes the survey records thinly, are estimated less fully in ours), behaviour (ours are static; most official costings include responses) and scope (the parts of a policy each models). Each policy's note below says which apply.";

export const OBR_DEVIATION_NOTES = {
  household_energy_payment_2026:
    "Our £1,969 million in 2026-27 is 25% below the official £2,625 million, because the official figure also covers two things we don't model: the devolved governments' share of the funding (about £425 million, our estimate using the Barnett formula) and £100 million for councils in England to target the households hit hardest. Without them, about £2,100 million remains for the £100 payments in England, and our estimate is 94% of that; the Budget doesn't itemise the remaining £130 million or so. Both estimates are zero in every later year.",
  domestic_electricity_zero_vat:
    "Our cost is £85m (11%) above the official costing in 2026-27 and £48m (16%) above it in 2027-28. The official costing also covers charities, residential care and some businesses, and it counts households switching from gas to electricity; both make the official figure larger, so neither explains the gap. The two start from different spending: ours is household spending from survey data, calibrated to meter records and grown with CPI, while the official costing uses ONS consumer spending grown with the OBR's forecast for electricity spending, and it names the size of this base as its main uncertainty.",
  carers_allowance_earnings_taper:
    "Our static estimate is about 60% of the official costing in both compared years: £24 million against £40 million in 2030-31, and £48 million against £80 million in 2031-32. The gap is close to the income tax on the higher allowance, which our net cost subtracts (£15 million and £32 million): before that tax, ours is £39 million and £79 million, and the official costing note describes Carer's Allowance spending and Universal Credit interactions without mentioning income tax. The official figure also includes a labour-supply response, which ours does not, and the model does not count the income tax collected on the allowance through PAYE against Universal Credit earnings, which makes its Universal Credit saving larger.",
  state_pension_income_tax_protection:
    "Our cost is £15m (34%) below the official costing in 2027-28, £7m (8%) below in 2028-29 and £6m (4%) below in 2029-30. Ours is the net cost to the government, after lower spending, mostly on Pension Credit, Housing Benefit and Council Tax Reduction (£12m, £29m and £48m), as pensioners' income after tax rises; our income tax cut alone is £42m, £112m and £193m, against the official £45m, £90m and £150m. For 2028-29 and 2029-30 we set the allowance at £182 and £250 a year, from the October 2026 forecast of the State Pension.",
  trading_allowance_raise:
    "From 2028-29 our estimate is £46m to £107m a year below the Treasury's (28% to 47%), with the largest gap in 2028-29. The Treasury's costing includes people switching from actual expenses to the larger allowance, which we don't model. Without gross receipts in the survey data, we give traders with profits above £3,000 nothing from the change and give miscellaneous income no allowance at all, while for some profits between £1,000 and £3,000 we overstate the gain, because we leave them unrelieved under the current £1,000 allowance.",
  fuel_duty_rise_deferral:
    "PolicyEngine's cost is £274 million below the official costing in 2026-27 (£301 million against £575 million) and £259 million below in 2027-28 (£521 million against £780 million); from 2028-29 both are zero. Most of the gap is coverage: PolicyEngine counts only the petrol and diesel that households buy, about £13 billion of the £24 billion of fuel duty the OBR forecasts for 2026-27, while the official costing covers all taxable fuel, including fuel that businesses buy, and scaled to the OBR's fuel duty receipts PolicyEngine's fuel duty cost would be about £450 million in 2026-27 and £760 million in 2027-28. VAT and behaviour narrow the gap rather than explain it (PolicyEngine's figure includes £50 million and £87 million of VAT on the lower pump price, which the official fuel duty figure leaves out, and the official costing's demand response makes its cost smaller), so after scaling about £125 million of the 2026-27 gap has no explanation in the published documents.",
};

/** The measures in `ids` with no note in `notes`, in order. */
export function missingDeviationNotes(ids, notes = OBR_DEVIATION_NOTES) {
  return ids.filter((id) => typeof notes[id] !== "string" || !notes[id].trim());
}
