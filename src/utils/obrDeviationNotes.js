import { policyDetailsFor } from "./policyDetails";

/**
 * Why our estimates differ from the official costings, for the comparison
 * with them on Public finances (OBRComparisonTable).
 *
 * OBR_DEVIATION_STATEMENT: one sentence above the chart naming the four
 * reasons. The side panel beside the chart (ObrDifferencePanel) explains
 * the selected policy in short lines (Vahid, 28 October): OBR_PANEL_BASES
 * (what each side counts) and OBR_DIFFERENCE_POINTS (the reasons, each
 * tagged Timing, Coverage, Behaviour or Scope, by year where a figure
 * changes), and NOT_COMPARABLE_SHORT for a year that cannot be compared.
 * OBR_DEVIATION_NOTES and OBR_COMPARISON_BASES are the full Budget-day
 * texts, for the table's Difference tip and the CSV.
 *
 * Each is keyed by measure id and shows only while the measure's card
 * entry (policyDetails.js) still fits it: the publication describes the
 * measure exactly as the entry's `writtenFor`. A redescribed measure shows
 * the statement alone until they are rewritten.
 */
export const OBR_DEVIATION_STATEMENT =
  "Gaps come from timing, coverage, behaviour and scope.";

/** The four kinds of reason a gap can have, each a chip in the panel. */
export const REASON_TYPES = ["Timing", "Coverage", "Behaviour", "Scope"];

/**
 * Why each policy's estimate differs, as short tagged points (Vahid, 28
 * October: no paragraphs, each point a fragment of about 12 words at most;
 * the content as he approved it). Each is true to the Budget-day notes
 * (#296, #297, #298). `reason` is one of REASON_TYPES, or null for a plain
 * line; `years` limits a point to the fiscal years (start year) its figure
 * is true for; `byYear` gives a point's text by year where its figure
 * changes, and the point is left out in a year it has none for.
 */
export const OBR_DIFFERENCE_POINTS = {
  fuel_duty_rise_deferral: [
    // EFO October 2026: about £13bn of £24bn of fuel duty in 2026-27
    { reason: "Coverage", text: "Households buy about £13bn of £24bn duty", years: [2026] },
    {
      reason: "Coverage",
      byYear: {
        2026: "Scaled to all fuel, ours would be about £450m",
        2027: "Scaled to all fuel, ours would be about £760m",
      },
    },
    { reason: "Timing", text: "Official assumes 5p back on 1 Jan, law phases it", years: [2026] },
  ],
  domestic_electricity_zero_vat: [
    // The ONS base is 10% to 12% lower than DESNZ's
    { reason: "Coverage", text: "ONS spending base is 10–12% below ours (DESNZ)" },
    { reason: "Scope", text: "On the ONS base, ours is within about 4%" },
  ],
  state_pension_income_tax_protection: [
    // About 670,000 gain in 2027-28, against the Treasury's 500,000
    { reason: "Coverage", text: "More pensioners gain in our data (670,000 vs 500,000)", years: [2027] },
    // Net of benefits: £30m of £42m, £83m of £112m, £144m of £193m
    { reason: "Scope", text: "Pension Credit, HB and CTR take back about a quarter", years: [2027, 2028, 2029] },
  ],
  household_energy_payment_2026: [
    { reason: "Scope", text: "Excluding devolved funding and the council fund, ours is 94% of it", years: [2026] },
  ],
  carers_allowance_earnings_taper: [
    // OBR policy Table 1.1: £4.92m and £10.16m of block grant (#290, 6479807374)
    { reason: "Scope", text: "Official includes Scotland's block grant (£5m, £10m)" },
    // Before tax, ours £39m and £79m against £33m and £69m of spending
    { reason: "Scope", text: "Before income tax, ours is about a sixth above" },
    { reason: "Behaviour", text: "Official adds people working more" },
  ],
  property_income_rates_up: [
    { reason: "Timing", text: "Self Assessment pays later, so 2027-28 and 2028-29 aren't comparable" },
    { reason: null, text: "From 2029-30, within 1.5% of the official costing" },
  ],
  trading_allowance_raise: [
    { reason: "Timing", text: "First receipts land in 2028-29" },
    { reason: "Behaviour", text: "Official includes switching from actual expenses" },
    { reason: "Coverage", text: "No gross receipts in our data" },
  ],
  savings_income_rates_up: [
    { reason: "Timing", text: "Self Assessment pays later, so 2027-28 and 2028-29 aren't comparable" },
    { reason: "Coverage", text: "Our savings calibration included ISA interest, so too little is taxed" },
    { reason: null, text: "We are correcting the data" },
  ],
  bus_fare_cap_2027: [
    { reason: "Scope", text: "Ours is the official costing shared out by bus spending" },
    { reason: "Behaviour", text: "Ours holds spending fixed: no extra travel" },
    { reason: "Timing", text: "Later official gains are the funding reprioritised", years: [2028, 2029] },
  ],
};

/** A policy's points for fiscal year `year` (start year): each with its text that year. */
export function pointsForYear(points, year) {
  return (points ?? [])
    .map((point) => ({ reason: point.reason ?? null, text: point.byYear ? point.byYear[year] : point.text, years: point.years }))
    .filter((point) => point.text && (!point.years || point.years.includes(Number(year))))
    .map(({ reason, text }) => ({ reason, text }));
}

/**
 * One line a year's "Not comparable" row shows in the panel, by measure
 * id: the reviewer's full reason stays in the table's note and the CSV.
 */
export const NOT_COMPARABLE_SHORT = {
  property_income_rates_up: "Self Assessment pays later.",
  savings_income_rates_up: "Self Assessment pays later.",
  trading_allowance_raise: "Self Assessment pays later.",
  state_pension_income_tax_protection: "The allowance has ended; official figures fall after it.",
  bus_fare_cap_2027: "The cap has ended; official figures are its funding.",
};

/**
 * Each policy's full note, for the table's Difference tip and the CSV's
 * "Why it differs" column (the panel shows the points above). Written on
 * Budget day by each policy's review seat; Carer's Allowance and the
 * Pension Tax Allowance as Max corrected them against the OBR's policy
 * Table 1.1 (#290, 6479807374).
 */
export const OBR_DEVIATION_NOTES = {
  bus_fare_cap_2027:
    "The official costing is the grant that pays bus operators to keep single fares at £2 instead of £3 in England outside London from January to December 2027 (-£50 million in 2026-27, -£180 million in 2027-28). Ours is that costing shared out across households by their bus fare spending in England outside London: 10.0% of spending at £3 fares while the cap runs, which is the £230 million divided by 0.9 for operator participation and by £2,557 million of spending. So ours is above the official figure by about the participation adjustment, and moves with the model's bus fare spending in each year. The official +£65 million in 2028-29 and +£170 million in 2029-30 are the reprioritised Department for Energy Security and Net Zero budgets that fund the cap, after it has ended, so those years are not compared.",
  household_energy_payment_2026:
    "Our £1,969 million in 2026-27 is 25% below the official £2,625 million, because the official figure also covers two things we don't model: the devolved governments' share of the funding (about £425 million, our estimate using the Barnett formula) and £100 million for councils in England to target the households hit hardest. Without them, about £2,100 million remains for the £100 payments in England, and our estimate is 94% of that; the Budget doesn't itemise the remaining £130 million or so. Both estimates are zero in every later year.",
  domestic_electricity_zero_vat:
    "Our cost is £85m (11%) above the official costing in 2026-27 and £48m (16%) above it in 2027-28. The official costing also covers charities, residential care and some businesses, and it counts households switching from gas to electricity; both make the official figure larger, so neither explains the gap. Ours starts from DESNZ's domestic electricity volumes at average prices paid, grown with CPI. The official costing starts from ONS consumer spending, which is 10% to 12% lower; at that level our cost would be within about 4% of the official figure in both years.",
  carers_allowance_earnings_taper:
    "Our static estimate is about 60% of the official costing in both compared years: £24 million against £40 million in 2030-31, and £48 million against £80 million in 2031-32. The official figure, the OBR's £38 million and £79 million before the Treasury rounds them, includes £5 million and £10 million of extra block grant for Scotland, where Carer's Allowance is devolved; the rest, £33 million and £69 million, is Carer's Allowance and Universal Credit spending, with no line for income tax (OBR policy Table 1.1). Before the income tax on the higher allowance (£15 million and £32 million), which our net cost subtracts, ours is £39 million and £79 million, about a sixth more than that spending. The official figure also includes a labour-supply response, which ours does not, and the model does not count the income tax collected on the allowance through PAYE against Universal Credit earnings, which makes its Universal Credit saving larger.",
  state_pension_income_tax_protection:
    "The official costing counts no benefit savings: its income tax is £44m, £83m and £144m (OBR detailed table 1.1). Ours is £42m, £112m and £193m: about 5% lower in 2027-28 and 35% and 34% higher in 2028-29 and 2029-30. More pensioners gain in our data (about 670,000 in 2027-28, against the Treasury's 500,000). After Pension Credit, Housing Benefit and Council Tax Reduction take back part of it, our net cost is £30m, £83m and £144m. For 2028-29 and 2029-30 we set the allowance at £182 and £250 a year, from the October 2026 forecast of the State Pension.",
  trading_allowance_raise:
    "From 2028-29 our estimate is £46m to £107m a year below the Treasury's (28% to 47%), with the largest gap in 2028-29. The Treasury's costing includes people switching from actual expenses to the larger allowance, which we don't model. Without gross receipts in the survey data, we give traders with profits above £3,000 nothing from the change and give miscellaneous income no allowance at all, while for some profits between £1,000 and £3,000 we overstate the gain, because we leave them unrelieved under the current £1,000 allowance.",
  fuel_duty_rise_deferral:
    "Our cost is £274 million below the official costing in 2026-27 (£301 million against £575 million) and £259 million below in 2027-28 (£521 million against £780 million); from 2028-29 both are zero. Most of the gap is coverage: we count only the petrol and diesel that households buy, about £13 billion of the £24 billion of fuel duty the OBR forecasts for 2026-27, while the official costing covers all taxable fuel, including fuel that businesses buy, and scaled to the OBR's fuel duty receipts our fuel duty cost would be about £450 million in 2026-27 and £760 million in 2027-28. VAT and behaviour narrow the gap rather than explain it (ours includes £50 million and £87 million of VAT on the lower pump price, which the official fuel duty figure leaves out, and the official costing's demand response makes its cost smaller). The rest of the 2026-27 gap fits the official costing assuming the full 5p returns on 1 January 2027 (about £555 million on 45 billion litres), where the law brings it back as 3p and then 2p from 1 March (about £410 million).",
  property_income_rates_up:
    "The official costing puts the tax later than the year it's owed: the OBR adds almost no Self Assessment receipts from the savings and property rate rises in 2027-28 and £1.0bn in 2028-29, so those two years aren't comparable with our tax-year figures. From 2029-30 we're within 1.5% of the Treasury's costing (Table 6.1) every year, +£429m against +£435m in 2029-30 (the OBR's own table has £400m). The official costing takes off about £0.1bn a year for landlords incorporating and lower compliance, which ours leaves out, so before behaviour ours is about £0.1bn a year lower.",
  savings_income_rates_up:
    "Timing affects 2027-28 and 2028-29, as for property; from 2029-30 ours is 58% to 59% of the official costing (+£307m against +£520m in 2029-30), and behaviour widens the gap, because the official figure is already after about £0.2bn a year of savers moving money into ISAs. The gap is in how much savings income is taxed at the raised basic, higher and additional rates: about £36bn to £40bn a year in the official costing from 2029-30 to 2031-32, against £15bn to £17bn in ours. Most of the gap is in our data. We calibrated savings interest to HMRC's figures on a different basis: ours included interest in ISAs, which HMRC's figures leave out, so our taxable interest came out about a third too low. We are correcting this, with HMRC's other savings income and the OBR's savings income growth, and will update the dashboard with the corrected data.",
};

/**
 * What each side counts, as one line ("Official: …. Ours: …."), for the
 * table's tip and the CSV.
 */
export const OBR_COMPARISON_BASES = {
  bus_fare_cap_2027:
    "Official: grant to bus operators. Ours: that costing shared out by households' bus fare spending, static.",
  household_energy_payment_2026:
    "Official: the £100 payments in England, devolved funding and a £100m fund for councils. Ours: the £100 payments in England.",
  domestic_electricity_zero_vat:
    "Official: VAT on electricity bought by households, charities, care homes and small firms, after fuel switching. Ours: households, static.",
  fuel_duty_rise_deferral:
    "Official: fuel duty on every litre, business included, after behaviour. Ours: duty and VAT on households' petrol and diesel, static.",
  carers_allowance_earnings_taper:
    "Official: Carer's Allowance and Universal Credit spending after behaviour, plus Scotland's block grant. Ours: the same two benefits, static, with no block grant, less the income tax on the allowance.",
  trading_allowance_raise:
    "Official: income tax on a National Accounts basis, with switching from expenses. Ours: income tax and Class 4 by tax year, static.",
  state_pension_income_tax_protection:
    "Official: income tax and small Scottish and departmental spending lines; no benefit savings, no behaviour. Ours: income tax less Pension Credit, Housing Benefit and Council Tax Reduction savings.",
  property_income_rates_up:
    "Official: income tax on a National Accounts basis, after incorporation. Ours: income tax by tax year, static.",
  savings_income_rates_up:
    "Official: income tax on a National Accounts basis, after moves into ISAs. Ours: income tax by tax year, static.",
};

/**
 * What each side counts, as the panel's two short lines (Vahid, 28 October;
 * Carer's Allowance and the Pension Tax Allowance after 6479807374).
 */
export const OBR_PANEL_BASES = {
  fuel_duty_rise_deferral: { official: "Duty on all fuel, businesses too, after behaviour", ours: "Duty and VAT on households' fuel, static" },
  domestic_electricity_zero_vat: { official: "Households, charities, care homes, small firms, after switching", ours: "Households, static" },
  state_pension_income_tax_protection: { official: "Income tax £44m, £83m, £144m; no benefit savings", ours: "Income tax, less benefit savings" },
  household_energy_payment_2026: { official: "England payments, devolved funding, £100m council fund", ours: "The £100 payments in England" },
  carers_allowance_earnings_taper: { official: "CA and UC spending, after behaviour, plus Scotland's block grant", ours: "The same two benefits, static, less income tax" },
  property_income_rates_up: { official: "Income tax when paid, after incorporation", ours: "Income tax by tax year, static" },
  trading_allowance_raise: { official: "Income tax when paid, with expense switching", ours: "Income tax and Class 4 by tax year, static" },
  savings_income_rates_up: { official: "Income tax when paid, after moves into ISAs", ours: "Income tax by tax year, static" },
  bus_fare_cap_2027: { official: "Grant to bus operators", ours: "That costing shared out by bus spending" },
};

/** A basis line's two sides: { official, ours }, or null. */
export function basisSides(line) {
  const match = /^Official: (.+?)\. Ours: (.+?)\.$/s.exec(line ?? "");
  return match ? { official: match[1], ours: match[2] } : null;
}

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

/**
 * A comparison row's points, by the same rule: those `points` has for its
 * catalogue measure, while its card entry fits it; else null.
 */
export function differencePointsFor(measure, points = OBR_DIFFERENCE_POINTS) {
  const list = measure ? points[measure.id] : undefined;
  return Array.isArray(list) && list.length && policyDetailsFor(measure) ? list : null;
}

/** A comparison row's two short basis lines for the panel, by the same rule; else null. */
export function panelBasisFor(measure, panel = OBR_PANEL_BASES) {
  const sides = measure ? panel[measure.id] : undefined;
  return sides?.official && sides?.ours && policyDetailsFor(measure) ? sides : null;
}

/** The measures in `ids` with no note in `notes` (or line in `bases`), in order. */
export function missingDeviationNotes(ids, notes = OBR_DEVIATION_NOTES) {
  return ids.filter((id) => typeof notes[id] !== "string" || !notes[id].trim());
}
