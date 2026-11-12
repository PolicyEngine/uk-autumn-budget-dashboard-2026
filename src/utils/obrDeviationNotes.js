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
    { reason: "Coverage", text: "Households pay about £13bn of £24bn duty", years: [2026] },
    {
      reason: "Coverage",
      byYear: {
        2026: "If we scaled to all fuel, we would estimate about £460m",
        2027: "If we scaled to all fuel, we would estimate about £780m",
      },
    },
    { reason: "Timing", text: "Government appears to assume 5p back on 1 Jan; law phases it", years: [2026] },
  ],
  domestic_electricity_zero_vat: [
    // OBR policy table 1.1, measure 2: VAT −733.95 and −295.80, Other AME
    // (current) −21.03 and −8.48; Table 6.1 rounds the totals to −755 and −305.
    // The panel's official line gives the VAT figures, so the point gives only
    // what the total adds (Vahid, 30 October, item 4)
    {
      reason: "Scope",
      byYear: {
        2026: "Official total also includes £21m Other AME (current)",
        2027: "Official total also includes £8m Other AME (current)",
      },
    },
    // The ONS base is 10% to 12% lower than DESNZ's
    { reason: "Coverage", text: "ONS spending base falls 10–12% below ours (DESNZ)" },
  ],
  state_pension_income_tax_protection: [
    // About 670,000 gain in 2027-28, against the Treasury's 500,000
    { reason: "Coverage", text: "More pensioners gain in our data (670,000 vs 500,000)", years: [2027] },
    // Net of benefits: £30m of £42m, £83m of £112m, £144m of £193m
    { reason: "Scope", text: "Pension Credit, HB and CTR savings offset about a quarter", years: [2027, 2028, 2029] },
  ],
  household_energy_payment_2026: [
    { reason: "Scope", text: "Ours reaches 94% of the official cost less devolved and council funding", years: [2026] },
  ],
  carers_allowance_earnings_taper: [
    // OBR policy Table 1.1: £4.92m and £10.16m of block grant (#290, 6479807374)
    { reason: "Scope", text: "Official includes Scotland's block grant (£5m, £10m)" },
    // Before tax, ours £39m and £79m against £33m and £69m of spending
    { reason: "Scope", text: "Before income tax, ours exceeds official spending by about a sixth" },
    { reason: "Behaviour", text: "Official includes people working more" },
  ],
  property_income_rates_up: [
    { reason: "Timing", text: "Self Assessment taxpayers pay later, so we don't compare 2027-28 or 2028-29" },
    // OBR policy table 1.1, measure 61, income tax: +£394m, +£403m and +£412m
    // against ours +£429m, +£446m and +£459m; Table 6.1's total adds Onshore
    // CT, Scottish BGA (current) and Scottish self-financed expenditure
    {
      reason: "Scope",
      byYear: {
        2029: "Ours exceeds income tax by 9%; official total includes other lines",
        2030: "Ours exceeds income tax by 10%; official total includes other lines",
        2031: "Ours exceeds income tax by 11%; official total includes other lines",
      },
    },
  ],
  trading_allowance_raise: [
    { reason: "Timing", text: "Self Assessment taxpayers first pay less in 2028-29" },
    { reason: "Behaviour", text: "Official includes switching from actual expenses" },
    // The data draw who already claims the £1,000 allowance (Microcosm's
    // trading_allowance_receipts stage, from the national build 0639b9c7);
    // only they gain
    { reason: "Coverage", text: "We count only traders we assume already claim the £1,000 allowance" },
  ],
  savings_income_rates_up: [
    { reason: "Timing", text: "Self Assessment taxpayers pay later, so we don't compare 2027-28 or 2028-29" },
    { reason: "Coverage", text: "Our savings calibration included ISA interest, so we estimate too little tax" },
    { reason: null, text: "We are correcting the data" },
  ],
  bus_fare_cap_2027: [
    // OBR policy table 1.1, measure 4: the grant (PSCE in RDEL) −113.10 and
    // −353.59, less DESNZ capital savings (PSGI in CDEL) +63.03 and +172.54;
    // Table 6.1 rounds the net totals to −50 and −180
    { reason: "Scope", text: "We share out the official net cost by bus spending" },
    { reason: "Behaviour", text: "We hold spending fixed: no extra travel" },
    { reason: "Timing", text: "Government counts later gains from reprioritising budgets", years: [2028, 2029] },
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
  property_income_rates_up: "Self Assessment taxpayers pay later.",
  savings_income_rates_up: "Self Assessment taxpayers pay later.",
  trading_allowance_raise: "Self Assessment taxpayers pay later.",
  state_pension_income_tax_protection: "The allowance ends in April 2030, so we don't compare later years.",
  bus_fare_cap_2027: "The cap ends in December 2027, so we don't compare later years.",
};

/**
 * Each policy's full note, for the table's Difference tip and the CSV's
 * "Why it differs" column (the panel shows the points above). Written on
 * Budget day by each policy's review seat. Each compares ours with the
 * line of the OBR's policy Table 1.1 that matches what we model, the
 * government's costing as the OBR certified it (fuel duty's, which it
 * could not certify, as the government's estimate), and gives Table 6.1's
 * rounded total, the one the chart shows, as context (Max, 28 October);
 * Carer's Allowance and the Pension Tax Allowance as Max corrected them
 * (#290, 6479807374). The bus fare cap's compares with the net cost we
 * share out: the grant less the DESNZ savings the government counts
 * against it (#329).
 */
export const OBR_DEVIATION_NOTES = {
  bus_fare_cap_2027:
    "The government pays bus operators a grant to keep single fares at £2 instead of £3 in England outside London from January to December 2027. It funds the grant by reprioritising Department for Energy Security and Net Zero budgets. It counts the savings from those budgets in the same years against the grant, so it puts the net cost at £50 million in 2026-27 and £180 million in 2027-28, £230 million in all. We share that net cost out across households by their bus fare spending in England outside London: each household gets 10.0% of its spending at £3 fares while the cap runs. We calculate the 10.0% by dividing the £230 million by 0.9 for operator participation and by £2,557 million of spending. Over the two years, ours exceeds the official net cost by about the participation adjustment: £254 million against £230 million. Each year, we scale ours by the days the cap runs and households' bus fare spending, while the government counts savings worth 56% of the grant in 2026-27 and 49% in 2027-28. So ours exceeds the official net cost by 28% in 2026-27 and 6% in 2027-28. After the cap ends, the government counts a further +£65 million in 2028-29 and +£170 million in 2029-30 from that reprioritisation, so we don't compare those years.",
  household_energy_payment_2026:
    "Our £1,969 million in 2026-27 falls 25% short of the government's costing of £2,627 million, which the OBR certified (the Treasury rounds it to £2,625 million in the Budget's Table 6.1). The gap arises because the costing also covers two things we don't model: the devolved governments' share of the funding (about £425 million, our estimate using the Barnett formula) and £100 million for councils in England for targeted support. Without them, about £2,100 million remains for the payment in England, and our estimate reaches 94% of it. The government spends up to £2,000 million of that on £100 payments to as many as 20 million households, and neither the OBR nor the Treasury itemises the rest. Both estimates fall to zero from 2027-28.",
  domestic_electricity_zero_vat:
    "Our cost exceeds the VAT receipts in the government's costing, which the OBR certified, by £106m (14%) in 2026-27 (£840m against £734m) and by £57m (19%) in 2027-28 (£353m against £296m). The OBR adds £21m and £8m of Other AME (current) in its detailed policy table, Table 1.1, and the Treasury rounds the totals to £755m and £305m in Table 6.1. The official costing also covers charities, residential care and some businesses, and includes households switching from gas to electricity. Both make the official figure larger, so neither explains the gap. We price DESNZ's domestic electricity volumes at the average prices households pay, and grow that spending with CPI. The government based its costing on ONS consumer spending, which falls 10% to 12% below our DESNZ base. If we scaled our cost down by that much, it would exceed the VAT line by 1% to 3% in 2026-27 and 5% to 8% in 2027-28.",
  carers_allowance_earnings_taper:
    "Our static estimate reaches about 60% of the official costing in both years we compare: £24 million against £40 million in 2030-31, and £48 million against £80 million in 2031-32. The OBR gives £38 million and £79 million before the Treasury rounds them. They include £5 million and £10 million of extra block grant for Scotland, where the Scottish Government pays Carer Support Payment in place of Carer's Allowance. The UK government spends the rest, £33 million and £69 million, on Carer's Allowance and Universal Credit, and the costing has no line for income tax (OBR policy Table 1.1). Before we subtract the income tax on the higher allowance (£15 million and £32 million) for our net cost, we estimate £39 million and £79 million, which exceed that spending by about a sixth. The official figure also includes a labour-supply response, which we don't model. HMRC collects the income tax on the allowance through PAYE, and we don't count that tax against Universal Credit earnings, so we estimate a larger Universal Credit saving.",
  state_pension_income_tax_protection:
    "The official costing includes no benefit savings, and the OBR puts the costing's income tax line at £44m, £83m and £144m in its detailed policy table, Table 1.1. Ours, £42m, £112m and £193m, falls about 5% short of that line in 2027-28 and exceeds it by 35% and 34% in 2028-29 and 2029-30. More pensioners gain in our data (about 670,000 in 2027-28, against the Treasury's 500,000). After we subtract the savings on Pension Credit, Housing Benefit and Council Tax Reduction, we estimate a net cost of £30m, £83m and £144m. For 2028-29 and 2029-30 we set the allowance at £182 and £250 a year, from the October 2026 forecast of the State Pension.",
  trading_allowance_raise:
    "From 2028-29 our estimate trails the matching income tax and NICs lines of the government's costing, which the OBR certified, by £46m to £103m a year (27% to 47%). The OBR gives those lines as £221m, £165m, £171m and £178m in its detailed policy table, Table 1.1. The rounded Table 6.1 total we show (£225m, £165m, £175m and £180m from 2028-29) also includes the costing's PSCE in RDEL, Scottish BGA (current) and Scottish self-financed expenditure lines, about £2m a year. The gap peaks in 2028-29, the official line's largest year, while ours stays between £118m and £130m a year. The official costing includes people switching from actual expenses to the larger allowance, which we don't model. We count only traders we assume already claim the £1,000 allowance. We assume 72% of traders with profits up to £4,500 claim it, 14% of those with profits from £4,500 to £9,000, and none above. We set those shares so that an earlier version of our data gave HMRC's estimate of about 400,000 people paying £380 less on average. Those traders' profits fall below the £12,570 at which Class 4 starts, so we estimate no Class 4 effect against the NICs line's £11m to £15m a year. Each deducts up to about £1,900 more in 2027-28 and £1,800 by 2031-32, short of the £2,000 the law gives, because we grow the £1,000 they deduct today with self-employment incomes. We give miscellaneous income no allowance either.",
  fuel_duty_rise_deferral:
    "Our cost falls £273 million below the official figure in 2026-27 (£301 million against £574 million) and £261 million below in 2027-28 (£521 million against £782 million). Both estimates fall to zero from 2028-29. We compare with the government's estimate, which the OBR used but could not certify, and the Treasury rounds it to £575 million and £780 million in Table 6.1. Most of the gap arises because we count only the petrol and diesel that households buy, about £13 billion of the £24 billion of fuel duty the OBR forecasts for 2026-27. The official estimate covers all taxable fuel, including fuel that businesses buy. We also count £50 million and £87 million of VAT on the lower pump price, which the government leaves out of its fuel duty figure. Without that VAT, if we scaled ours to the OBR's fuel duty receipts, we would estimate a fuel duty cost of about £460 million in 2026-27 and £780 million in 2027-28. The government also expects drivers to buy more fuel at the lower price, so it estimates a smaller cost. The rest of the 2026-27 gap fits a costing in which the full 5p returns on 1 January 2027 (about £555 million on 45 billion litres). Under the law, 3p comes back on 1 January and 2p on 1 March (about £410 million).",
  property_income_rates_up:
    "The government counts the tax in its costing when taxpayers pay it, after the tax year it relates to. The OBR adds almost no Self Assessment receipts from the savings and property rate rises in 2027-28 and £1.0bn in 2028-29 (Economic and fiscal outlook, Table 4.4), so we don't compare those two years with our tax-year figures. From 2029-30 ours exceeds the income tax line of the government's costing, which the OBR certified, by 9% to 11%: +£429m against +£394m in 2029-30 (the OBR's detailed policy table, Table 1.1, measure 61). The Table 6.1 total we show, +£435m in 2029-30, also includes the costing's onshore corporation tax, Scottish BGA (current) and Scottish self-financed expenditure lines. The OBR says landlords incorporating and lower compliance reduce the costing's yield by about £0.1bn a year (paragraph 3.17), which we don't model, so before behaviour the official income tax line would exceed ours.",
  savings_income_rates_up:
    "Self Assessment taxpayers pay later, so we don't compare 2027-28 or 2028-29. From 2029-30 ours reaches 68% to 69% of the income tax line of the government's costing, which the OBR certified (the OBR's detailed policy table, Table 1.1, measure 62): +£307m against +£443m in 2029-30. The Table 6.1 total we show, +£520m in 2029-30, also includes the costing's Onshore CT line. The OBR says savers moving money into ISAs and other tax-advantaged assets reduce the costing's yield by about £0.2bn a year (Economic and fiscal outlook, paragraph 3.17). We don't model that response, so before it the official income tax line would exceed ours by more. The gap turns on how much savings income faces the raised basic, higher and additional rates: about £32bn to £36bn a year from 2029-30 to 2031-32 on the official income tax line before that response, against £15bn to £17bn in ours. Most of that difference comes from our data. We calibrated savings interest to HMRC's figures on a different basis: ours included interest in ISAs, which HMRC leaves out of its figures, so our taxable interest came out about a third too low. We are correcting this, with HMRC's other savings income and the OBR's savings income growth, and will update the dashboard with the corrected data.",
};

/**
 * What each side counts, as one line ("Official: …. Ours: …."), for the
 * table's tip and the CSV.
 */
export const OBR_COMPARISON_BASES = {
  bus_fare_cap_2027:
    "Official: grant to bus operators, less the DESNZ budget savings in the same years. Ours: households' shares of that net cost, by their bus fare spending, static.",
  household_energy_payment_2026:
    "Official: the government's costing, which the OBR certified (its detailed policy table, Table 1.1, measure 1), covering the £100 payments in England, devolved funding and a £100m fund for councils. Ours: the £100 payments in England.",
  domestic_electricity_zero_vat:
    "Official: VAT on the electricity that households, charities, care homes and small firms buy, after fuel switching (the Table 6.1 total also includes Other AME (current)). Ours: households' VAT, static.",
  fuel_duty_rise_deferral:
    "Official: the government's estimate (the OBR used it but could not certify it), fuel duty on every litre, including business fuel, after behaviour. Ours: duty and VAT on households' petrol and diesel, static.",
  carers_allowance_earnings_taper:
    "Official: Carer's Allowance and Universal Credit spending after behaviour, plus Scotland's block grant. Ours: the same two benefits, static, with no block grant, less the income tax on the allowance.",
  trading_allowance_raise:
    "Official: the income tax and NICs lines, on a National Accounts basis, with switching from expenses (the Table 6.1 total also includes about £2m a year of other lines). Ours: income tax net of benefit changes, by tax year, static (no Class 4 change in our data).",
  state_pension_income_tax_protection:
    "Official: income tax and small Scottish and departmental spending lines; no benefit savings, no behaviour. Ours: income tax less Pension Credit, Housing Benefit and Council Tax Reduction savings.",
  property_income_rates_up:
    "Official: the costing's income tax line, on a National Accounts basis, after incorporation and lower compliance (the Table 6.1 total also includes the costing's other lines). Ours: income tax by tax year, static.",
  savings_income_rates_up:
    "Official: the costing's income tax line, on a National Accounts basis, after moves into ISAs and other tax-advantaged assets (the Table 6.1 total also includes the costing's Onshore CT line). Ours: income tax by tax year, static.",
};

/**
 * What each side counts, as the panel's two short lines (Vahid, 28 October;
 * Carer's Allowance and the Pension Tax Allowance after 6479807374; the
 * official side's figures, where given, are its OBR Table 1.1 line in the
 * years compared).
 */
export const OBR_PANEL_BASES = {
  fuel_duty_rise_deferral: { official: "Government's estimate (OBR could not certify): duty on all fuel, after behaviour", ours: "Duty and VAT on households' fuel, static" },
  domestic_electricity_zero_vat: { official: "VAT £734m, £296m: households, charities, care homes, small firms, after switching", ours: "Households' VAT, static" },
  state_pension_income_tax_protection: { official: "Income tax £44m, £83m, £144m; no benefit savings", ours: "Income tax, less benefit savings" },
  household_energy_payment_2026: { official: "£2,627m: England payments, devolved funding, £100m council fund", ours: "The £100 payments in England" },
  carers_allowance_earnings_taper: { official: "CA and UC spending, after behaviour, plus Scotland's block grant", ours: "The same two benefits, static, less income tax" },
  property_income_rates_up: { official: "Income tax by payment, from 2029-30: £394m, £403m, £412m, after incorporation", ours: "Income tax by tax year, static" },
  trading_allowance_raise: { official: "Income tax and NICs by payment, from 2028-29: £221m, £165m, £171m, £178m", ours: "Income tax less benefit changes, by tax year, static" },
  savings_income_rates_up: { official: "Income tax from 2029-30: £443m, £475m, £510m; total includes Onshore CT", ours: "Income tax by tax year, static" },
  bus_fare_cap_2027: { official: "Grant to bus operators, less DESNZ budget savings", ours: "Households' shares of that net cost, by bus spending" },
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
