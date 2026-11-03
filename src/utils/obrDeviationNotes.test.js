import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDashboardCsv } from "./loadDashboard";
import {
  NOT_COMPARABLE_SHORT,
  OBR_COMPARISON_BASES,
  OBR_DEVIATION_NOTES,
  OBR_DEVIATION_STATEMENT,
  OBR_DIFFERENCE_POINTS,
  OBR_PANEL_BASES,
  REASON_TYPES,
  basisSides,
  pointsForYear,
  comparisonBasisFor,
  deviationNoteFor,
  missingDeviationNotes,
} from "./obrDeviationNotes";
import { POLICY_DETAILS } from "./policyDetails";

// The measures the comparison costs: each one the Treasury mapping maps to
// the Budget's Table 6.1
const COMPARED = parseDashboardCsv(readFileSync("data_inputs/treasury/mapping.csv", "utf8"))
  .filter((row) => row.source_id === "AB2026-T6.1")
  .map((row) => row.measure_id);
// Every measure the registry defines (reforms.py), as the measure guard
// reads it (measureCatalogue.test.jsx), the combined package aside
const REGISTERED = [
  ...readFileSync("src/uk_budget_data/reforms.py", "utf8").matchAll(/^(?!AUTUMN_BUDGET_2026_COMBINED)[A-Z0-9_]+_ID = "([a-z0-9_]+)"$/gm),
].map((match) => match[1]);

describe("why our estimates differ from the official costings", () => {
  it("reads the Table 6.1 measures from the mapping, each once", () => {
    expect(COMPARED.length).toBeGreaterThan(0);
    expect(new Set(COMPARED).size).toBe(COMPARED.length);
  });

  it("explains every compared measure, and says what each side counts for it", () => {
    expect(missingDeviationNotes(COMPARED)).toEqual([]);
    expect(missingDeviationNotes(COMPARED, OBR_COMPARISON_BASES)).toEqual([]);
  });

  // A note may wait for a measure the registry defines but the comparison
  // does not yet cost (one left out of a release keeps its note); an id that
  // is no measure at all is a typo
  it("keeps notes only for measures the registry defines", () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    expect(COMPARED.filter((id) => !REGISTERED.includes(id))).toEqual([]);
    expect(Object.keys(OBR_DEVIATION_NOTES).filter((id) => !REGISTERED.includes(id))).toEqual([]);
    expect(Object.keys(OBR_COMPARISON_BASES).filter((id) => !REGISTERED.includes(id))).toEqual([]);
  });

  it("writes each note and the statement as whole sentences", () => {
    for (const text of [OBR_DEVIATION_STATEMENT, ...Object.values(OBR_DEVIATION_NOTES), ...Object.values(OBR_COMPARISON_BASES)]) {
      expect(text).toBe(text.trim());
      expect(text).toMatch(/^[A-Z].*\.$/s);
    }
  });

  it("says what each side counts as one line: the official side, then ours", () => {
    for (const [id, line] of Object.entries(OBR_COMPARISON_BASES)) {
      expect(line, id).toMatch(/^Official: [^]+\. Ours: [^]+\.$/);
      expect(line.match(/Official: /g), id).toHaveLength(1);
      expect(line.match(/Ours: /g), id).toHaveLength(1);
    }
  });

  // The corrections #297 made to the notes, from each measure's policy
  // costing note, kept in the short points (Vahid, 28 Oct)
  it("keeps the PR 297 corrections in the points", () => {
    const text = (id) => OBR_DIFFERENCE_POINTS[id].map((point) => point.text ?? Object.values(point.byYear).join(" ")).join(" ");
    // Pension Tax Allowance and Carer's Allowance as Max corrected them
    // against the OBR's policy Table 1.1 (PR 290, 6479807374)
    expect(OBR_COMPARISON_BASES.state_pension_income_tax_protection).toMatch(/^Official: income tax and small Scottish and departmental spending lines; no benefit savings/);
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).toMatch(/^The official costing includes no benefit savings, and the OBR puts the costing's income tax line at £44m, £83m and £144m in its detailed policy table, Table 1\.1\./);
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).not.toMatch(/because our data put more pensioners/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).toMatch(/£5 million and £10 million of extra block grant for Scotland/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).not.toMatch(/gap is close to the income tax/);
    expect(text("carers_allowance_earnings_taper")).not.toMatch(/explains most of the gap/);
    expect(text("state_pension_income_tax_protection")).toMatch(/670,000 vs 500,000/);
    expect(text("domestic_electricity_zero_vat")).not.toMatch(/meter records/);
    expect(text("domestic_electricity_zero_vat")).toMatch(/ONS spending base falls 10–12% below ours \(DESNZ\)/);
    expect(text("fuel_duty_rise_deferral")).toMatch(/Government appears to assume 5p back on 1 Jan; law phases it/);
    expect(text("savings_income_rates_up")).toMatch(/included ISA interest/);
    expect(text("savings_income_rates_up")).not.toMatch(/miss(?:es)? ISA interest/);
  });

  // Max, 28 Oct: compare with the line of the OBR's policy Table 1.1 that
  // matches what we model (efo-october-2026-detailed-forecast-tables-policy
  // .xlsx, sheet 1.1) and give Table 6.1's rounded total as context. The
  // notes name it the government's costing, which the OBR certified
  it("compares each re-based note with its OBR Table 1.1 line, Table 6.1 as context", () => {
    const note = (id) => OBR_DEVIATION_NOTES[id];
    const text = (id) => OBR_DIFFERENCE_POINTS[id].map((point) => point.text ?? Object.values(point.byYear).join(" ")).join(" ");
    expect(note("household_energy_payment_2026")).toMatch(/^Our £1,969 million in 2026-27 falls 25% short of the government's costing of £2,627 million, which the OBR certified/);
    expect(note("domestic_electricity_zero_vat")).toMatch(/^Our cost exceeds the VAT receipts in the government's costing, which the OBR certified, by £106m \(14%\) in 2026-27 \(£840m against £734m\) and by £57m \(19%\)/);
    expect(note("domestic_electricity_zero_vat")).not.toMatch(/within about 4%/);
    expect(note("trading_allowance_raise")).toMatch(/^From 2028-29 our estimate trails the matching income tax and NICs lines of the government's costing, which the OBR certified, by [^]*The OBR gives those lines as £221m, £165m, £171m and £178m in its detailed policy table, Table 1\.1\./);
    expect(note("property_income_rates_up")).toMatch(/ours exceeds the income tax line of the government's costing, which the OBR certified, by 9% to 11%: \+£429m against \+£394m in 2029-30/);
    expect(note("savings_income_rates_up")).toMatch(/^Self Assessment taxpayers pay later, so we don't compare 2027-28 or 2028-29\. From 2029-30 ours reaches 68% to 69% of the income tax line of the government's costing, which the OBR certified[^]*\+£307m against \+£443m in 2029-30/);
    // Fuel duty's is the one costing the OBR could not certify (EFO October 2026, chapter 3)
    expect(note("fuel_duty_rise_deferral")).toMatch(/£273 million below the official figure in 2026-27 \(£301 million against £574 million\)[^]*the government's estimate, which the OBR used but could not certify/);
    expect(note("fuel_duty_rise_deferral")).not.toMatch(/OBR certified|certified by the OBR/);
    expect(OBR_COMPARISON_BASES.fuel_duty_rise_deferral).toMatch(/could not certify/);
    // The Pension Tax Allowance's "the Treasury's 500,000" is a count, not a costing
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    for (const line of strings([OBR_DIFFERENCE_POINTS, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES])) {
      expect(line).not.toMatch(/the Treasury['’]s (?!500,000)/);
    }
    expect(text("domestic_electricity_zero_vat")).not.toMatch(/within about 4%/);
    expect(text("property_income_rates_up")).not.toMatch(/within 1\.5%/);
    // The page shows the not-comparable reasons from official_costings.json
    // (written from data_inputs/treasury/mapping.csv), so the Table 6.1
    // comparison can't come back there either (Pavel, 29 October)
    const reasons = Object.values(JSON.parse(readFileSync("public/data/official_costings.json", "utf8")).measures)
      .flatMap((measure) => Object.values(measure.years))
      .map((year) => year.not_comparable?.reason)
      .filter(Boolean);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(reason).not.toMatch(/within 1\.5%/);
    expect(readFileSync("data_inputs/treasury/mapping.csv", "utf8")).not.toMatch(/within 1\.5%/);
    // The years official_costings.json marks not comparable: the Pension Tax
    // Allowance's after it ends in April 2030, the bus fare cap's after the cap
    const costings = JSON.parse(readFileSync("public/data/official_costings.json", "utf8")).measures;
    const notCompared = (id) => Object.entries(costings[id].years).filter(([, year]) => year.not_comparable).map(([year]) => year);
    expect(notCompared("state_pension_income_tax_protection")).toEqual(["2030", "2031"]);
    expect(NOT_COMPARABLE_SHORT.state_pension_income_tax_protection).toBe("The allowance ends in April 2030, so we don't compare later years.");
    expect(notCompared("bus_fare_cap_2027")).toEqual(["2028", "2029"]);
    expect(NOT_COMPARABLE_SHORT.bus_fare_cap_2027).toBe("The cap ends in December 2027, so we don't compare later years.");
    expect(note("bus_fare_cap_2027")).toMatch(/in 2028-29 and \+£170 million in 2029-30 from that reprioritisation, so we don't compare those years\.$/);
  });

  // The Table 6.1 figures a note gives as context are the Budget's own
  // (data_inputs/treasury/sources/AB2026-T6.1.csv, the chart's official column)
  it("gives Table 6.1's figures as the source file has them", () => {
    const rows = parseDashboardCsv(readFileSync("data_inputs/treasury/sources/AB2026-T6.1.csv", "utf8"));
    const t61 = (row, year) => {
      const found = rows.find((r) => r.row_id === String(row) && r.fiscal_year === year);
      return Math.round(Math.abs(Number(found.value_bn)) * 1000);
    };
    const note = (id) => OBR_DEVIATION_NOTES[id];
    expect(note("household_energy_payment_2026")).toContain(`rounds it to £${t61(1, "2026-27").toLocaleString("en-GB")} million in the Budget's Table 6.1`);
    expect(note("domestic_electricity_zero_vat")).toContain(`rounds the totals to £${t61(2, "2026-27")}m and £${t61(2, "2027-28")}m in Table 6.1`);
    expect(note("fuel_duty_rise_deferral")).toContain(`rounds it to £${t61(3, "2026-27")} million and £${t61(3, "2027-28")} million in Table 6.1`);
    expect(note("trading_allowance_raise")).toContain(`(£${t61(15, "2028-29")}m, £${t61(15, "2029-30")}m, £${t61(15, "2030-31")}m and £${t61(15, "2031-32")}m from 2028-29)`);
    expect(note("property_income_rates_up")).toContain(`The Table 6.1 total we show, +£${t61(61, "2029-30")}m in 2029-30`);
    expect(note("savings_income_rates_up")).toContain(`The Table 6.1 total we show, +£${t61(62, "2029-30")}m in 2029-30`);
    expect(note("bus_fare_cap_2027")).toContain(`so it puts the net cost at £${t61(4, "2026-27")} million in 2026-27 and £${t61(4, "2027-28")} million in 2027-28, £${t61(4, "2026-27") + t61(4, "2027-28")} million in all.`);
    expect(note("bus_fare_cap_2027")).toContain(`dividing the £${t61(4, "2026-27") + t61(4, "2027-28")} million by 0.9`);
    expect(note("bus_fare_cap_2027")).toContain(`a further +£${t61(4, "2028-29")} million in 2028-29 and +£${t61(4, "2029-30")} million in 2029-30`);
    // Ours against that net cost (fixtures/obrNotesOurFigures.json): about
    // the participation adjustment over the two years, and by year as our
    // day weights and the government's savings shares split it
    const ourBus = JSON.parse(readFileSync("src/test/fixtures/obrNotesOurFigures.json", "utf8")).measures.bus_fare_cap_2027.values;
    const bus = (year) => Math.abs(ourBus[year]);
    const busNet = t61(4, "2026-27") + t61(4, "2027-28");
    expect(note("bus_fare_cap_2027")).toContain(`Over the two years, ours exceeds the official net cost by about the participation adjustment: £${Math.round(bus("2026-27") + bus("2027-28"))} million against £${busNet} million.`);
    expect((bus("2026-27") + bus("2027-28")) / busNet).toBeCloseTo(1 / 0.9, 1);
    expect(note("bus_fare_cap_2027")).toContain(`So ours exceeds the official net cost by ${Math.round((bus("2026-27") / t61(4, "2026-27") - 1) * 100)}% in 2026-27 and ${Math.round((bus("2027-28") / t61(4, "2027-28") - 1) * 100)}% in 2027-28.`);
    // Carer's Allowance: ours against the rounded totals, as a share of the
    // figures the note shows
    const ourCarers = JSON.parse(readFileSync("src/test/fixtures/obrNotesOurFigures.json", "utf8")).measures.carers_allowance_earnings_taper.values;
    const carers = (year) => Math.round(Math.abs(ourCarers[year]));
    const carersShare = (year) => Math.round((carers(year) / t61(7, year)) * 100);
    expect(carersShare("2030-31")).toBe(carersShare("2031-32"));
    expect(note("carers_allowance_earnings_taper")).toContain(`Our static estimate reaches about ${carersShare("2030-31")}% of the official costing in both years we compare: £${carers("2030-31")} million against £${t61(7, "2030-31")} million in 2030-31, and £${carers("2031-32")} million against £${t61(7, "2031-32")} million in 2031-32.`);
  });

  // Every OBR Table 1.1 figure, gap and ratio the notes, points and panel
  // lines give, computed from the table's lines (fixtures/obrPolicyTable11.json,
  // from the OBR's policy.xlsx) and our release figures
  // (fixtures/obrNotesOurFigures.json), with the rounding the text uses
  it("computes each Table 1.1 figure, gap and ratio from the OBR's lines and our figures", () => {
    const t11 = JSON.parse(readFileSync("src/test/fixtures/obrPolicyTable11.json", "utf8")).lines;
    const ours = JSON.parse(readFileSync("src/test/fixtures/obrNotesOurFigures.json", "utf8")).measures;
    const line = (measure, category, year) => Math.abs(t11.find((l) => l.measure === measure && l.category === category).values[year]);
    const total = (measure, year) => Math.abs(t11.find((l) => l.measure === measure && l.head === "Total").values[year]);
    const our = (id, year) => Math.abs(ours[id].values[year]);
    const gross = (id, year) => Math.abs(ours[id].officialBasis[year]);
    const m = Math.round;
    const span = (values, unit) => `${Math.min(...values.map(m))}${unit} to ${Math.max(...values.map(m))}${unit}`;
    const pounds = (values, unit) => `£${Math.min(...values.map(m))}${unit} to £${Math.max(...values.map(m))}${unit}`;
    const note = (id) => OBR_DEVIATION_NOTES[id];
    const panel = (id) => OBR_PANEL_BASES[id].official;
    const point = (id, year) => pointsForYear(OBR_DIFFERENCE_POINTS[id], year).map((p) => p.text).join(" | ");
    const FROM_2028 = ["2028-29", "2029-30", "2030-31", "2031-32"];
    const FROM_2029 = ["2029-30", "2030-31", "2031-32"];

    // Household Energy Payment: the Barnett split divides by 1.1931 (HM
    // Treasury's Statement of Funding Policy, as in the energy bills post)
    const hep = line(1, "PSCE in RDEL", "2026-27");
    const england = hep / 1.1931;
    expect(note("household_energy_payment_2026")).toContain(`Our £${m(our("household_energy_payment_2026", "2026-27")).toLocaleString("en-GB")} million in 2026-27 falls ${m((1 - our("household_energy_payment_2026", "2026-27") / hep) * 100)}% short of the government's costing of £${m(hep).toLocaleString("en-GB")} million`);
    expect(note("household_energy_payment_2026")).toContain(`about £${m(hep - england)} million, our estimate using the Barnett formula`);
    expect(note("household_energy_payment_2026")).toContain(`about £${(m((england - 100) / 100) * 100).toLocaleString("en-GB")} million remains`);
    expect(point("household_energy_payment_2026", 2026)).toContain(`Ours reaches ${m((our("household_energy_payment_2026", "2026-27") / (england - 100)) * 100)}% of the official cost less devolved and council funding`);
    expect(note("household_energy_payment_2026")).toContain(`our estimate reaches ${m((our("household_energy_payment_2026", "2026-27") / (england - 100)) * 100)}% of it`);
    expect(note("household_energy_payment_2026")).toContain("on £100 payments to as many as 20 million households");
    // Both fall to zero from 2027-28: ours, and every Table 1.1 line of measure 1
    expect(note("household_energy_payment_2026")).toMatch(/Both estimates fall to zero from 2027-28\.$/);
    for (const [year, value] of Object.entries(ours.household_energy_payment_2026.values)) if (year >= "2027-28") expect(Math.abs(value), year).toBe(0);
    for (const l of t11.filter((l) => l.measure === 1)) for (const [year, value] of Object.entries(l.values)) if (year >= "2027-28") expect(Math.abs(value), `${l.category} ${year}`).toBe(0);
    expect(panel("household_energy_payment_2026")).toMatch(new RegExp(`^£${m(hep).toLocaleString("en-GB")}m:`));

    // Electricity: the VAT line, Other AME (current) beside it
    const vat = (year) => line(2, "VAT", year);
    const elec = (year) => our("domestic_electricity_zero_vat", year);
    const gap = (year) => `by £${m(elec(year)) - m(vat(year))}m (${m((elec(year) / vat(year) - 1) * 100)}%)`;
    expect(note("domestic_electricity_zero_vat")).toContain(`${gap("2026-27")} in 2026-27 (£${m(elec("2026-27"))}m against £${m(vat("2026-27"))}m) and ${gap("2027-28")} in 2027-28 (£${m(elec("2027-28"))}m against £${m(vat("2027-28"))}m)`);
    expect(note("domestic_electricity_zero_vat")).toContain(`adds £${m(line(2, "Other AME (current)", "2026-27"))}m and £${m(line(2, "Other AME (current)", "2027-28"))}m of Other AME (current)`);
    for (const [year, label] of [[2026, "2026-27"], [2027, "2027-28"]]) {
      expect(point("domestic_electricity_zero_vat", year)).toContain(`Official total also includes £${m(line(2, "Other AME (current)", label))}m Other AME (current)`);
      // The panel's official line gives the VAT figure; the point doesn't repeat it (Vahid, 30 October, item 4)
      expect(point("domestic_electricity_zero_vat", year)).not.toContain(`£${m(vat(label))}m`);
    }
    expect(panel("domestic_electricity_zero_vat")).toMatch(new RegExp(`^VAT £${m(vat("2026-27"))}m, £${m(vat("2027-28"))}m:`));
    // The ONS base, 88% to 90% of ours (2024 and 2025)
    const scaled = (year) => [0.88, 0.9].map((share) => (elec(year) * share) / vat(year) - 1);
    expect(note("domestic_electricity_zero_vat")).toContain(`exceed the VAT line by ${span(scaled("2026-27").map((x) => x * 100), "%")} in 2026-27 and ${span(scaled("2027-28").map((x) => x * 100), "%")} in 2027-28`);

    // Fuel duty: the only line, and gaps a reader can check against the labels
    const duty = (year) => m(line(3, "Fuel Duty", year));
    const fuel = (year) => m(our("fuel_duty_rise_deferral", year));
    expect(note("fuel_duty_rise_deferral")).toContain(`£${duty("2026-27") - fuel("2026-27")} million below the official figure in 2026-27 (£${fuel("2026-27")} million against £${duty("2026-27")} million) and £${duty("2027-28") - fuel("2027-28")} million below in 2027-28 (£${fuel("2027-28")} million against £${duty("2027-28")} million)`);
    expect(note("fuel_duty_rise_deferral")).toContain("Both estimates fall to zero from 2028-29.");
    for (const [year, value] of Object.entries(ours.fuel_duty_rise_deferral.values)) if (year >= "2028-29") expect(Math.abs(value), year).toBe(0);
    for (const [year, value] of Object.entries(t11.find((l) => l.measure === 3 && l.head === "Total").values)) if (year >= "2028-29") expect(Math.abs(value), year).toBe(0);
    // Our VAT: the modifier moves VAT by ROAD_FUEL_VAT_RATE of the duty change
    // on each litre (pump_vat_on_fuel_duty_deferral.py), so VAT makes up
    // 0.2 / 1.2 of our cost
    const vatRate = Number(readFileSync("src/uk_budget_data/budget_measures/pump_vat_on_fuel_duty_deferral.py", "utf8").match(/^ROAD_FUEL_VAT_RATE = ([\d.]+)$/m)[1]);
    const fuelVat = (year) => (our("fuel_duty_rise_deferral", year) * vatRate) / (1 + vatRate);
    expect(note("fuel_duty_rise_deferral")).toContain(`We also count £${m(fuelVat("2026-27"))} million and £${m(fuelVat("2027-28"))} million of VAT on the lower pump price`);
    // Scaled to all fuel: our fuel duty cost, without that VAT, times the
    // OBR's fuel duty receipts (EFO October 2026 receipts table 4.8) over our
    // households' fuel duty, to the nearest £10m. The OBR's receipts include
    // the deferral, so we take our households' fuel duty after it too: their
    // duty before it, which we don't publish in the release and took from a
    // baseline run of #290 at 9b98370e on 28 October, less our duty cost
    const receipts = { "2026-27": 23.95, "2027-28": 25.713 };
    const baselineDuty = { "2026-27": 13.3635, "2027-28": 14.6503 };
    const ourDuty = (year) => our("fuel_duty_rise_deferral", year) - fuelVat(year);
    const householdDuty = (year) => baselineDuty[year] - ourDuty(year) / 1000;
    const allFuel = (year) => m((ourDuty(year) * receipts[year]) / householdDuty(year) / 10) * 10;
    expect(note("fuel_duty_rise_deferral")).toContain(`about £${m(householdDuty("2026-27"))} billion of the £${m(receipts["2026-27"])} billion of fuel duty the OBR forecasts for 2026-27`);
    expect(point("fuel_duty_rise_deferral", 2026)).toContain(`Households pay about £${m(householdDuty("2026-27"))}bn of £${m(receipts["2026-27"])}bn duty`);
    expect(note("fuel_duty_rise_deferral")).toContain(`Without that VAT, if we scaled ours to the OBR's fuel duty receipts, we would estimate a fuel duty cost of about £${allFuel("2026-27")} million in 2026-27 and £${allFuel("2027-28")} million in 2027-28.`);
    expect(point("fuel_duty_rise_deferral", 2026)).toContain(`If we scaled to all fuel, we would estimate about £${allFuel("2026-27")}m`);
    expect(point("fuel_duty_rise_deferral", 2027)).toContain(`If we scaled to all fuel, we would estimate about £${allFuel("2027-28")}m`);

    // Carer's Allowance: the UK's benefit spending and Scotland's block grant
    // make the total, with no income tax line. Ours before income tax is the
    // release's official basis (Carer's Allowance and Universal Credit), and
    // the note's income tax on the allowance is that less our net cost
    const CA_YEARS = ["2030-31", "2031-32"];
    const caSpend = (year) => line(7, "Welfare inside cap", year);
    const caBlock = (year) => line(7, "Scottish BGA (current)", year);
    const caGross = (year) => gross("carers_allowance_earnings_taper", year);
    const caTax = (year) => caGross(year) - our("carers_allowance_earnings_taper", year);
    expect(t11.filter((l) => l.measure === 7).map((l) => l.category)).toEqual(["Welfare inside cap", "Scottish BGA (current)", null]);
    for (const year of CA_YEARS) {
      expect(total(7, year), year).toBeCloseTo(caSpend(year) + caBlock(year), 3);
      expect(caTax(year), year).toBeGreaterThan(0);
      // "about a sixth": within 2.5 points of it
      expect(Math.abs(caGross(year) / caSpend(year) - 1 - 1 / 6), year).toBeLessThan(0.025);
    }
    expect(note("carers_allowance_earnings_taper")).toContain(`The OBR gives £${m(total(7, "2030-31"))} million and £${m(total(7, "2031-32"))} million before the Treasury rounds them. They include £${m(caBlock("2030-31"))} million and £${m(caBlock("2031-32"))} million of extra block grant for Scotland`);
    expect(note("carers_allowance_earnings_taper")).toContain(`The UK government spends the rest, £${m(caSpend("2030-31"))} million and £${m(caSpend("2031-32"))} million, on Carer's Allowance and Universal Credit, and the costing has no line for income tax`);
    expect(note("carers_allowance_earnings_taper")).toContain(`Before we subtract the income tax on the higher allowance (£${m(caTax("2030-31"))} million and £${m(caTax("2031-32"))} million) for our net cost, we estimate £${m(caGross("2030-31"))} million and £${m(caGross("2031-32"))} million, which exceed that spending by about a sixth.`);
    expect(point("carers_allowance_earnings_taper", 2030)).toContain(`Official includes Scotland's block grant (£${m(caBlock("2030-31"))}m, £${m(caBlock("2031-32"))}m)`);
    expect(point("carers_allowance_earnings_taper", 2030)).toContain("Before income tax, ours exceeds official spending by about a sixth");

    // Trading allowance: Income tax and NICs together, other lines beside them
    const taxNics = (year) => line(15, "Income tax", year) + line(15, "NICs", year);
    const trading = (year) => our("trading_allowance_raise", year);
    const shown = FROM_2028.map((year) => `£${m(taxNics(year))}m`);
    expect(note("trading_allowance_raise")).toContain(`trails the matching income tax and NICs lines of the government's costing, which the OBR certified, by ${pounds(FROM_2028.map((year) => m(taxNics(year)) - m(trading(year))), "m")} a year (${span(FROM_2028.map((year) => (1 - trading(year) / taxNics(year)) * 100), "%")})`);
    expect(note("trading_allowance_raise")).toContain(`The OBR gives those lines as ${shown.slice(0, 3).join(", ")} and ${shown[3]} in its detailed policy table, Table 1.1.`);
    // The other lines: the total (a cost, like the two lines) beyond Income tax and NICs
    expect(FROM_2028.map((year) => m(total(15, year) - taxNics(year)))).toEqual([2, 2, 2, 2]);
    expect(note("trading_allowance_raise")).toContain("lines, about £2m a year");
    expect(note("trading_allowance_raise")).toContain(`while ours stays between £${Math.min(...FROM_2028.map((year) => m(trading(year))))}m and £${Math.max(...FROM_2028.map((year) => m(trading(year))))}m a year`);
    expect(note("trading_allowance_raise")).toContain(`the NICs line's ${pounds(FROM_2028.map((year) => line(15, "NICs", year)), "m")} a year`);
    const largest = (f) => FROM_2028.reduce((a, b) => (f(b) > f(a) ? b : a));
    expect([largest((year) => taxNics(year) - trading(year)), largest(taxNics)]).toEqual(["2028-29", "2028-29"]);
    expect(panel("trading_allowance_raise")).toContain(`from 2028-29: ${shown.join(", ")}`);

    // Pension Tax Allowance: the income tax line, with a zero welfare line.
    // Ours before benefit savings is the release's official basis (income
    // tax), and the savings are that less our net cost
    const PTA_YEARS = ["2027-28", "2028-29", "2029-30"];
    const ptaTax = (year) => line(52, "Income tax", year);
    const ptaGross = (year) => gross("state_pension_income_tax_protection", year);
    const pta = (year) => our("state_pension_income_tax_protection", year);
    for (const value of Object.values(t11.find((l) => l.measure === 52 && l.category === "Welfare inside cap").values)) expect(value).toBe(0);
    // "about a quarter": 25.6% to 28.7% at revision 60
    for (const year of PTA_YEARS) {
      expect(1 - pta(year) / ptaGross(year), year).toBeGreaterThanOrEqual(0.25);
      expect(1 - pta(year) / ptaGross(year), year).toBeLessThan(0.3);
    }
    const ptaLine = PTA_YEARS.map((year) => `£${m(ptaTax(year))}m`);
    expect(note("state_pension_income_tax_protection")).toContain(`the OBR puts the costing's income tax line at ${ptaLine[0]}, ${ptaLine[1]} and ${ptaLine[2]} in its detailed policy table, Table 1.1.`);
    // The percentages compare the figures the note shows, so a reader can
    // check them; the unrounded figures can round differently (2027-28 falls
    // 5.7% short at revision 60)
    const shownPct = (year) => m((m(ptaGross(year)) / m(ptaTax(year)) - 1) * 100);
    expect(note("state_pension_income_tax_protection")).toContain(`Ours, £${m(ptaGross("2027-28"))}m, £${m(ptaGross("2028-29"))}m and £${m(ptaGross("2029-30"))}m, falls about ${-shownPct("2027-28")}% short of that line in 2027-28 and exceeds it by ${shownPct("2028-29")}% and ${shownPct("2029-30")}% in 2028-29 and 2029-30.`);
    expect(note("state_pension_income_tax_protection")).toContain(`we estimate a net cost of £${m(pta("2027-28"))}m, £${m(pta("2028-29"))}m and £${m(pta("2029-30"))}m.`);
    // The pensioners who gain: the people whose own income tax falls, to the
    // nearest 10,000, against the Treasury's count
    const gainers = (m(ours.state_pension_income_tax_protection.peopleDirectlyAffected["2027-28"] / 10000) * 10000).toLocaleString("en-GB");
    expect(note("state_pension_income_tax_protection")).toContain(`More pensioners gain in our data (about ${gainers} in 2027-28, against the Treasury's 500,000).`);
    expect(point("state_pension_income_tax_protection", 2027)).toContain(`More pensioners gain in our data (${gainers} vs 500,000)`);
    // The allowance in the later years, as the release publishes it
    // (public/data/policy_parameters.json, from pension_tax_allowance.py)
    const allowance = (year) => JSON.parse(readFileSync("public/data/policy_parameters.json", "utf8")).measures.state_pension_income_tax_protection.rows[0].points.find((p) => p.year === year).after;
    expect(note("state_pension_income_tax_protection")).toContain(`For 2028-29 and 2029-30 we set the allowance at £${allowance(2028)} and £${allowance(2029)} a year, from the October 2026 forecast of the State Pension.`);
    expect(point("state_pension_income_tax_protection", 2028)).toContain("Pension Credit, HB and CTR savings offset about a quarter");
    expect(panel("state_pension_income_tax_protection")).toBe(`Income tax ${ptaLine.join(", ")}; no benefit savings`);

    // Property: the income tax line, and ours above it by year
    const prop = (year) => our("property_income_rates_up", year);
    const propTax = (year) => line(61, "Income tax", year);
    const propPct = FROM_2029.map((year) => (prop(year) / propTax(year) - 1) * 100);
    expect(note("property_income_rates_up")).toContain(`by ${span(propPct, "%")}: +£${m(prop("2029-30"))}m against +£${m(propTax("2029-30"))}m in 2029-30`);
    FROM_2029.forEach((year, i) => expect(point("property_income_rates_up", 2029 + i)).toContain(`Ours exceeds income tax by ${m(propPct[i])}%`));
    expect(panel("property_income_rates_up")).toContain(`from 2029-30: ${FROM_2029.map((year) => `£${m(propTax(year))}m`).join(", ")}`);

    // Savings: the income tax line; the base taxed at the 2-point higher
    // rates, before the OBR's £0.2bn a year ISA response (paragraph 3.17)
    const sav = (year) => our("savings_income_rates_up", year);
    const savTax = (year) => line(62, "Income tax", year);
    expect(note("savings_income_rates_up")).toContain(`ours reaches ${span(FROM_2029.map((year) => (sav(year) / savTax(year)) * 100), "%")} of the income tax line`);
    expect(note("savings_income_rates_up")).toContain(`+£${m(sav("2029-30"))}m against +£${m(savTax("2029-30"))}m in 2029-30`);
    const base = (value) => value / 0.02 / 1000;
    expect(note("savings_income_rates_up")).toContain(`about ${pounds(FROM_2029.map((year) => base(savTax(year) + 200)), "bn")} a year from 2029-30 to 2031-32 on the official income tax line before that response, against ${pounds(FROM_2029.map((year) => base(sav(year))), "bn")} in ours`);
    expect(panel("savings_income_rates_up")).toContain(`from 2029-30: ${FROM_2029.map((year) => `£${m(savTax(year))}m`).join(", ")}`);

    // The OBR's responses (savers moving into ISAs, about £0.2bn a year;
    // landlords incorporating and lower compliance, about £0.1bn) cut its
    // income tax lines, and we model neither, so before them each line
    // would exceed ours by more (savings) or at all (property)
    for (const year of FROM_2029) {
      expect(savTax(year), year).toBeGreaterThan(sav(year));
      expect(propTax(year) + 100, year).toBeGreaterThan(prop(year));
    }
    expect(note("savings_income_rates_up")).toContain("We don't model that response, so before it the official income tax line would exceed ours by more.");
    expect(note("savings_income_rates_up")).not.toMatch(/widens the gap/);
    expect(note("property_income_rates_up")).toContain("so before behaviour the official income tax line would exceed ours.");

    // Bus fares: the government counts the DESNZ capital savings (PSGI in
    // CDEL) against the grant (PSCE in RDEL) in the same years, so the total
    // we share out is a net cost; after the cap, only the savings remain (#329)
    const busSavings = (year) => t11.find((l) => l.measure === 4 && l.category === "PSGI in CDEL").values[year];
    for (const year of ["2026-27", "2027-28"]) {
      expect(busSavings(year), year).toBeGreaterThan(0);
      expect(total(4, year), year).toBeCloseTo(line(4, "PSCE in RDEL", year) - busSavings(year), 3);
    }
    for (const year of ["2028-29", "2029-30"]) {
      expect(line(4, "PSCE in RDEL", year), year).toBe(0);
      expect(busSavings(year), year).toBeGreaterThan(0);
    }
    // With signs, too: each year's total is the grant, a cost, plus the savings
    const signed = (pred, year) => t11.find((l) => l.measure === 4 && pred(l)).values[year];
    for (const year of ["2026-27", "2027-28", "2028-29", "2029-30"]) {
      expect(signed((l) => l.head === "Total", year), year).toBeCloseTo(signed((l) => l.category === "PSCE in RDEL", year) + busSavings(year), 3);
    }
    const savingsShare = (year) => m((busSavings(year) / line(4, "PSCE in RDEL", year)) * 100);
    expect(note("bus_fare_cap_2027")).toContain(`while the government counts savings worth ${savingsShare("2026-27")}% of the grant in 2026-27 and ${savingsShare("2027-28")}% in 2027-28`);
    // "Each year, we scale ours by the days the cap runs": the modifier's day
    // shares, and the end date the short reason gives (bus_fare_cap_2027.py)
    const busModifier = readFileSync("src/uk_budget_data/budget_measures/bus_fare_cap_2027.py", "utf8");
    expect(busModifier).toMatch(/capped_2026=95 \/ 365,\n\s+capped_2027=270 \/ 366,/);
    expect(busModifier).toMatch(/CAP_TO = "2027-12-31"/);
    expect(note("bus_fare_cap_2027")).toContain("It counts the savings from those budgets in the same years against the grant, so it puts the net cost at");
    expect(note("bus_fare_cap_2027")).not.toMatch(/costing covers the grant|is the grant/);
    expect(panel("bus_fare_cap_2027")).toBe("Grant to bus operators, less DESNZ budget savings");
  });

  // The figures those notes compute from are the release's own: each
  // measure's artifact in public/data/manifest.json, its
  // budgetary_impact.csv and, where a note gives our figure before offsets,
  // its official_basis.csv, in £ million, and, where a note counts the
  // people who gain, its age_impact.csv. When we regenerate, the artifacts
  // change, so this fails until the fixture, and each note figure computed
  // from it, matches the new release
  it("computes from the figures the release publishes", () => {
    const fixture = JSON.parse(readFileSync("src/test/fixtures/obrNotesOurFigures.json", "utf8")).measures;
    const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8"));
    // Every measure with a note has its figures here
    expect(Object.keys(fixture).sort()).toEqual(Object.keys(OBR_DEVIATION_NOTES).sort());
    for (const [id, entry] of Object.entries(fixture)) {
      // A measure held back from the release stays out of the manifest
      if (!entry.artifact.startsWith("artifacts/")) {
        expect(manifest.measures[id], id).toBeUndefined();
        continue;
      }
      expect(manifest.measures[id]?.artifact, id).toBe(entry.artifact);
      const check = (file, values) => {
        const rows = parseDashboardCsv(readFileSync(`public/data/${entry.artifact}/${file}`, "utf8"));
        for (const [label, value] of Object.entries(values)) {
          expect(Number(rows.find((row) => row.year === label.slice(0, 4)).value) * 1000, `${id} ${file} ${label}`).toBeCloseTo(value, 3);
        }
      };
      check("budgetary_impact.csv", entry.values);
      if (entry.officialBasis) check("official_basis.csv", entry.officialBasis);
      // The people whose own income tax changes, all ages together
      if (entry.peopleDirectlyAffected) {
        const ages = parseDashboardCsv(readFileSync(`public/data/${entry.artifact}/age_impact.csv`, "utf8"));
        for (const [label, value] of Object.entries(entry.peopleDirectlyAffected)) {
          expect(Number(ages.find((row) => row.year === label.slice(0, 4) && row.age_band === "all").people_directly_affected), `${id} age_impact.csv ${label}`).toBeCloseTo(value, 3);
        }
      }
    }
  });

  // Max, 28 Oct: "'is above' -> 'exceeds'", and active voice throughout;
  // "above" and "below" as prepositions stay
  it("says exceeds or falls below, never is above or below", () => {
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    const all = strings([OBR_DEVIATION_STATEMENT, OBR_DIFFERENCE_POINTS, NOT_COMPARABLE_SHORT, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES]);
    expect(all.length).toBeGreaterThan(40);
    for (const line of all) expect(line).not.toMatch(/\b(?:is|are|was|were|be|been)\b[^.;:,]{0,40}\b(?:above|below)\b/);
    // Max counts be-verb plus complement as passive: "we would estimate", not "ours would be"
    for (const line of all) expect(line).not.toMatch(/\b[Oo]urs (?:would |will )?(?:is|are|was|were|be)\b/);
  });

  // Max, 28 Oct: active voice, reduced passives included, so the OBR certifies,
  // we show, households buy and taxpayers pay
  it("names who certifies, shows, buys and pays, with no reduced passive", () => {
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    const all = strings([OBR_DEVIATION_STATEMENT, OBR_DIFFERENCE_POINTS, NOT_COMPARABLE_SHORT, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES]);
    for (const line of all) {
      expect(line).not.toMatch(/certified by the OBR|\bshown here\b|\btotal shown\b|Self Assessment pays|\bwhen paid\b|\bprices paid\b|\bbought by\b|\bbusiness included\b|\bgrown with\b|\bcollected on\b/);
    }
  });

  // Max, 31 Oct: a document, rule or measure doesn't act, so the government
  // assumes and spends, the OBR adds and we subtract; a total only includes.
  // Nor does a concept explain or narrow a gap
  it("gives each action to whoever takes it, never to the Budget, a total, figure, costing, estimate, benefit or the model", () => {
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    const all = strings([OBR_DEVIATION_STATEMENT, OBR_DIFFERENCE_POINTS, NOT_COMPARABLE_SHORT, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES]);
    for (const line of all) {
      expect(line).not.toMatch(/\b(?:[Tt]otals?|[Oo]fficial|costings?|estimates?|figures?|Budget|[Oo]urs) (?:adds?|assumes?|puts?|starts? from|takes? off|grows?|counts?|leaves? out|itemises?)\b|\b(?:Credit|HB|CTR|Benefit|Reduction) take back\b|\bestimate assuming\b|\b(?:[Tt]he|[Oo]ur)(?: static)? model\b|\b(?:Coverage|Timing|Scope|Behaviour|VAT(?: and behaviour)?) (?:explains?|narrows?|widens?|affects?)\b/);
    }
  });

  it("writes every point and basis side as a short fragment, tagged with one of the four reasons, \"ours\" never PolicyEngine's (Vahid, 28 Oct)", () => {
    const words = (text) => text.split(/\s+/).length;
    for (const [id, points] of Object.entries(OBR_DIFFERENCE_POINTS)) {
      expect(points.length, id).toBeGreaterThan(0);
      expect(points.length, id).toBeLessThanOrEqual(3);
      for (const point of points) {
        if (point.reason !== null) expect(REASON_TYPES, id).toContain(point.reason);
        for (const text of point.text ? [point.text] : Object.values(point.byYear)) expect(words(text), text).toBeLessThanOrEqual(12);
      }
    }
    for (const [id, sides] of Object.entries(OBR_PANEL_BASES)) {
      expect(words(sides.official), id).toBeLessThanOrEqual(12);
      expect(words(sides.ours), id).toBeLessThanOrEqual(12);
    }
    for (const line of Object.values(OBR_COMPARISON_BASES)) expect(basisSides(line)).not.toBeNull();
    for (const text of [OBR_DEVIATION_STATEMENT, ...Object.values(OBR_DEVIATION_NOTES), ...Object.values(OBR_COMPARISON_BASES), ...Object.values(NOT_COMPARABLE_SHORT)]) {
      expect(text).not.toMatch(/PolicyEngine|£0\.0bn|\(rounded\)/);
    }
  });

  it("gives a point only in the years its figure holds", () => {
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.fuel_duty_rise_deferral, 2026).map((p) => p.text)).toEqual([
      "Households pay about £13bn of £24bn duty",
      "If we scaled to all fuel, we would estimate about £460m",
      "Government appears to assume 5p back on 1 Jan; law phases it",
    ]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.fuel_duty_rise_deferral, 2027).map((p) => p.text)).toEqual(["If we scaled to all fuel, we would estimate about £780m"]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.state_pension_income_tax_protection, 2028).map((p) => p.text)).toEqual(["Pension Credit, HB and CTR savings offset about a quarter"]);
  });

  it("names the four reasons in one sentence", () => {
    for (const reason of ["timing", "coverage", "behaviour", "scope"]) {
      expect(OBR_DEVIATION_STATEMENT).toContain(reason);
    }
    expect(OBR_DEVIATION_STATEMENT.match(/\./g)).toHaveLength(1);
  });

  it("finds a missing, empty or blank note, in the order given", () => {
    const notes = { a: "Timing.", b: "", c: "   ", e: 4 };
    expect(missingDeviationNotes(["a", "b", "c", "d", "e"], notes)).toEqual(["b", "c", "d", "e"]);
    expect(missingDeviationNotes([], notes)).toEqual([]);
  });

  it("shows every note and line for its measure as its card entry was written for", () => {
    for (const id of new Set([...COMPARED, ...Object.keys(OBR_DEVIATION_NOTES), ...Object.keys(OBR_COMPARISON_BASES)])) {
      const entry = POLICY_DETAILS.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(deviationNoteFor({ id, description: entry.writtenFor }), id).toBe(OBR_DEVIATION_NOTES[id]);
      expect(comparisonBasisFor({ id, description: entry.writtenFor }), id).toBe(OBR_COMPARISON_BASES[id]);
    }
  });

  it("shows a note for no other description, and none for a missing measure or note", () => {
    const written = Object.fromEntries(POLICY_DETAILS.map((entry) => [entry.id, entry.writtenFor]));
    fc.assert(
      fc.property(fc.constantFrom(...COMPARED), fc.string(), (id, description) => {
        fc.pre(description !== written[id]);
        expect(deviationNoteFor({ id, description })).toBeNull();
        expect(comparisonBasisFor({ id, description })).toBeNull();
      }),
    );
    for (const textFor of [deviationNoteFor, comparisonBasisFor]) {
      expect(textFor(undefined)).toBeNull();
      expect(textFor(null)).toBeNull();
      const [id] = COMPARED;
      expect(textFor({ id, description: written[id] }, {})).toBeNull();
      expect(textFor({ id, description: written[id] }, { [id]: "  " })).toBeNull();
      expect(textFor({ id, description: written[id] }, { [id]: " Timing. " })).toBe("Timing.");
    }
  });
});
