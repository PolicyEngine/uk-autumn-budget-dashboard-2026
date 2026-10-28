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
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).toMatch(/^The official costing counts no benefit savings: its income tax is £44m, £83m and £144m/);
    expect(OBR_DEVIATION_NOTES.state_pension_income_tax_protection).not.toMatch(/because our data put more pensioners/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).toMatch(/£5 million and £10 million of extra block grant for Scotland/);
    expect(OBR_DEVIATION_NOTES.carers_allowance_earnings_taper).not.toMatch(/gap is close to the income tax/);
    expect(text("carers_allowance_earnings_taper")).not.toMatch(/explains most of the gap/);
    expect(text("state_pension_income_tax_protection")).toMatch(/670,000 vs 500,000/);
    expect(text("domestic_electricity_zero_vat")).not.toMatch(/meter records/);
    expect(text("domestic_electricity_zero_vat")).toMatch(/ONS spending base falls 10–12% below ours \(DESNZ\)/);
    expect(text("fuel_duty_rise_deferral")).toMatch(/5p back on 1 Jan, law phases it/);
    expect(text("savings_income_rates_up")).toMatch(/included ISA interest/);
    expect(text("savings_income_rates_up")).not.toMatch(/miss(?:es)? ISA interest/);
  });

  // Max, 28 Oct: compare with the line of the OBR's policy Table 1.1 that
  // matches what we model (efo-october-2026-detailed-forecast-tables-policy
  // .xlsx, sheet 1.1), call it the government's costing, certified by the
  // OBR, and give Table 6.1's rounded total as context
  it("compares each re-based note with its OBR Table 1.1 line, Table 6.1 as context", () => {
    const note = (id) => OBR_DEVIATION_NOTES[id];
    const text = (id) => OBR_DIFFERENCE_POINTS[id].map((point) => point.text ?? Object.values(point.byYear).join(" ")).join(" ");
    expect(note("household_energy_payment_2026")).toMatch(/^Our £1,969 million in 2026-27 falls 25% short of the government's costing of £2,627 million, certified by the OBR/);
    expect(note("domestic_electricity_zero_vat")).toMatch(/^Our cost exceeds the VAT receipts in the government's costing, certified by the OBR, by £106m \(14%\) in 2026-27 \(£840m against £734m\) and by £57m \(19%\)/);
    expect(note("domestic_electricity_zero_vat")).not.toMatch(/within about 4%/);
    expect(note("trading_allowance_raise")).toMatch(/^Against the matching Income tax and NICs lines of the government's costing, certified by the OBR \(the OBR's detailed policy table, Table 1\.1: £221m, £165m, £171m and £178m\)/);
    expect(note("property_income_rates_up")).toMatch(/ours exceeds the income tax line of the government's costing, certified by the OBR, by 9% to 11%: \+£429m against \+£394m in 2029-30/);
    expect(note("savings_income_rates_up")).toMatch(/68% to 69% of the income tax line of the government's costing, certified by the OBR[^]*\+£307m against \+£443m in 2029-30/);
    // Fuel duty's is the one costing the OBR could not certify (EFO October 2026, chapter 3)
    expect(note("fuel_duty_rise_deferral")).toMatch(/£273 million below the official figure in 2026-27 \(£301 million against £574 million\)[^]*the government's estimate, which the OBR used but could not certify/);
    expect(note("fuel_duty_rise_deferral")).not.toMatch(/certified by the OBR/);
    expect(OBR_COMPARISON_BASES.fuel_duty_rise_deferral).toMatch(/could not certify/);
    // The Pension Tax Allowance's "the Treasury's 500,000" is a count, not a costing
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    for (const line of strings([OBR_DIFFERENCE_POINTS, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES])) {
      expect(line).not.toMatch(/the Treasury['’]s (?!500,000)/);
    }
    expect(text("domestic_electricity_zero_vat")).not.toMatch(/within about 4%/);
    expect(text("property_income_rates_up")).not.toMatch(/within 1\.5%/);
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
    expect(note("household_energy_payment_2026")).toContain(`rounds it to £${t61(1, "2026-27").toLocaleString("en-GB")} million`);
    expect(note("domestic_electricity_zero_vat")).toContain(`Table 6.1 rounds the totals to £${t61(2, "2026-27")}m and £${t61(2, "2027-28")}m`);
    expect(note("fuel_duty_rise_deferral")).toContain(`Table 6.1 rounds it to £${t61(3, "2026-27")} million and £${t61(3, "2027-28")} million`);
    expect(note("trading_allowance_raise")).toContain(`(£${t61(15, "2028-29")}m, £${t61(15, "2029-30")}m, £${t61(15, "2030-31")}m and £${t61(15, "2031-32")}m from 2028-29)`);
    expect(note("property_income_rates_up")).toContain(`The Table 6.1 total shown here, +£${t61(61, "2029-30")}m in 2029-30`);
    expect(note("savings_income_rates_up")).toContain(`The Table 6.1 total shown here, +£${t61(62, "2029-30")}m in 2029-30`);
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
    expect(point("household_energy_payment_2026", 2026)).toContain(`ours is ${m((our("household_energy_payment_2026", "2026-27") / (england - 100)) * 100)}% of it`);
    expect(panel("household_energy_payment_2026")).toMatch(new RegExp(`^£${m(hep).toLocaleString("en-GB")}m:`));

    // Electricity: the VAT line, Other AME (current) beside it
    const vat = (year) => line(2, "VAT", year);
    const elec = (year) => our("domestic_electricity_zero_vat", year);
    const gap = (year) => `by £${m(elec(year)) - m(vat(year))}m (${m((elec(year) / vat(year) - 1) * 100)}%)`;
    expect(note("domestic_electricity_zero_vat")).toContain(`${gap("2026-27")} in 2026-27 (£${m(elec("2026-27"))}m against £${m(vat("2026-27"))}m) and ${gap("2027-28")} in 2027-28 (£${m(elec("2027-28"))}m against £${m(vat("2027-28"))}m)`);
    expect(note("domestic_electricity_zero_vat")).toContain(`adds £${m(line(2, "Other AME (current)", "2026-27"))}m and £${m(line(2, "Other AME (current)", "2027-28"))}m of Other AME (current)`);
    for (const [year, label] of [[2026, "2026-27"], [2027, "2027-28"]]) {
      expect(point("domestic_electricity_zero_vat", year)).toContain(`Official VAT line £${m(vat(label))}m, plus £${m(line(2, "Other AME (current)", label))}m Other AME (current)`);
    }
    expect(panel("domestic_electricity_zero_vat")).toMatch(new RegExp(`^VAT £${m(vat("2026-27"))}m, £${m(vat("2027-28"))}m:`));
    // The ONS base, 88% to 90% of ours (2024 and 2025)
    const scaled = (year) => [0.88, 0.9].map((share) => (elec(year) * share) / vat(year) - 1);
    expect(note("domestic_electricity_zero_vat")).toContain(`exceed the VAT line by ${span(scaled("2026-27").map((x) => x * 100), "%")} in 2026-27 and ${span(scaled("2027-28").map((x) => x * 100), "%")} in 2027-28`);

    // Fuel duty: the only line, and gaps a reader can check against the labels
    const duty = (year) => m(line(3, "Fuel Duty", year));
    const fuel = (year) => m(our("fuel_duty_rise_deferral", year));
    expect(note("fuel_duty_rise_deferral")).toContain(`£${duty("2026-27") - fuel("2026-27")} million below the official figure in 2026-27 (£${fuel("2026-27")} million against £${duty("2026-27")} million) and £${duty("2027-28") - fuel("2027-28")} million below in 2027-28 (£${fuel("2027-28")} million against £${duty("2027-28")} million)`);

    // Trading allowance: Income tax and NICs together, other lines beside them
    const taxNics = (year) => line(15, "Income tax", year) + line(15, "NICs", year);
    const trading = (year) => our("trading_allowance_raise", year);
    const shown = FROM_2028.map((year) => `£${m(taxNics(year))}m`);
    expect(note("trading_allowance_raise")).toContain(`Table 1.1: ${shown.slice(0, 3).join(", ")} and ${shown[3]}), our estimate falls ${pounds(FROM_2028.map((year) => taxNics(year) - trading(year)), "m")} a year below them from 2028-29 (${span(FROM_2028.map((year) => (1 - trading(year) / taxNics(year)) * 100), "%")})`);
    // The other lines: the total (a cost, like the two lines) beyond Income tax and NICs
    expect(FROM_2028.map((year) => m(total(15, year) - taxNics(year)))).toEqual([2, 2, 2, 2]);
    expect(note("trading_allowance_raise")).toContain("lines, about £2m a year");
    expect(note("trading_allowance_raise")).toContain(`while ours stays between £${Math.min(...FROM_2028.map((year) => m(trading(year))))}m and £${Math.max(...FROM_2028.map((year) => m(trading(year))))}m a year`);
    expect(note("trading_allowance_raise")).toContain(`the NICs line's ${pounds(FROM_2028.map((year) => line(15, "NICs", year)), "m")} a year`);
    const largest = (f) => FROM_2028.reduce((a, b) => (f(b) > f(a) ? b : a));
    expect([largest((year) => taxNics(year) - trading(year)), largest(taxNics)]).toEqual(["2028-29", "2028-29"]);
    expect(panel("trading_allowance_raise")).toContain(`from 2028-29: ${shown.join(", ")}`);

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
    expect(note("savings_income_rates_up")).toContain(`ours is ${span(FROM_2029.map((year) => (sav(year) / savTax(year)) * 100), "%")} of the income tax line`);
    expect(note("savings_income_rates_up")).toContain(`+£${m(sav("2029-30"))}m against +£${m(savTax("2029-30"))}m in 2029-30`);
    const base = (value) => value / 0.02 / 1000;
    expect(note("savings_income_rates_up")).toContain(`about ${pounds(FROM_2029.map((year) => base(savTax(year) + 200)), "bn")} a year from 2029-30 to 2031-32 on the official income tax line before that response, against ${pounds(FROM_2029.map((year) => base(sav(year))), "bn")} in ours`);
    expect(panel("savings_income_rates_up")).toContain(`from 2029-30: ${FROM_2029.map((year) => `£${m(savTax(year))}m`).join(", ")}`);
  });

  // Max, 28 Oct: "'is above' -> 'exceeds'", and active voice throughout;
  // "above" and "below" as prepositions stay
  it("says exceeds or falls below, never is above or below", () => {
    const strings = (value) => (typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(strings));
    const all = strings([OBR_DEVIATION_STATEMENT, OBR_DIFFERENCE_POINTS, NOT_COMPARABLE_SHORT, OBR_DEVIATION_NOTES, OBR_COMPARISON_BASES, OBR_PANEL_BASES]);
    expect(all.length).toBeGreaterThan(40);
    for (const line of all) expect(line).not.toMatch(/\b(?:is|are|was|were|be|been)\b[^.;:,]{0,40}\b(?:above|below)\b/);
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
      "Households buy about £13bn of £24bn duty",
      "Scaled to all fuel, ours would be about £450m",
      "Official assumes 5p back on 1 Jan, law phases it",
    ]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.fuel_duty_rise_deferral, 2027).map((p) => p.text)).toEqual(["Scaled to all fuel, ours would be about £760m"]);
    expect(pointsForYear(OBR_DIFFERENCE_POINTS.state_pension_income_tax_protection, 2028).map((p) => p.text)).toEqual(["Pension Credit, HB and CTR take back about a quarter"]);
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
