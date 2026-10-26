import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { PovertyMeasuresRow, measurePovertyRows, povertyCardRows, povertyWaterfall } from "./MeasuresPovertyCard";
import { povertyMetric } from "./SummaryMetricChart";
import { wholeSelectionRun } from "../utils/ageImpact";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";
import { FLAT_EXTRA_COLUMNS } from "../utils/publication/csv";
import { outlookPopulation } from "../utils/povertyPeople";

const PUBLIC = join(__dirname, "..", "..", "public");
const published = (file) => parseDashboardCsv(readFileSync(join(PUBLIC, "data", file), "utf8"));

// A catalogue built from the flat files' own measures, as a manifest with
// every one approved and every artifact verified (test only, as in
// HouseholdChartLegends.test.jsx)
const COMBINED = "autumn_budget_2026_combined";
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const budget = published("budgetary_impact.csv");
const metrics = published("metrics.csv");
const ALL = [...new Set(budget.map((row) => row.reform_id))].filter((id) => id !== COMBINED);
const nameOf = (id) => budget.find((row) => row.reform_id === id).reform_name;
const entry = (extra) => ({ status: "approved", years: YEARS, unsupported_years: [], ...extra });
const detailsOf = (id) => POLICY_DETAILS.find((policy) => policy.id === id);
const catalogue = buildMeasureCatalogue({
  manifest: {
    measures: Object.fromEntries(ALL.map((id) => [id, entry({ name: nameOf(id), description: detailsOf(id)?.writtenFor, outputs_sha256: "a".repeat(64) })])),
    combined: { [COMBINED]: entry({ name: nameOf(COMBINED), measures: ALL, member_outputs_sha256: Object.fromEntries(ALL.map((id) => [id, "a".repeat(64)])) }) },
  },
  budgetary: budget,
  metrics,
  tablesByKey: Object.fromEntries([...ALL, COMBINED].map((id) => [id, { budgetary_impact: budget.filter((row) => row.reform_id === id) }])),
});

beforeEach(() => {
  // The outlook (for the populations), as the page reads it
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = join(PUBLIC, new URL(String(url), "http://localhost").pathname);
      return existsSync(path) ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/?sub=poverty");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("measurePovertyRows and povertyWaterfall", () => {
  const row = (reform_id, value, affected = 1) => ({
    reform_id,
    year: "2027",
    people_affected: String(affected),
    poverty_change_pp: String(value),
  });
  const rows = [
    row("autumn_budget_2026_combined", -0.008),
    row("state_pension_income_tax_protection", -0.002),
    row("plan_2_threshold_unfreeze", -0.005),
    row("fuel_duty_rise_deferral", 0),
    row("employer_ni_relief_under_25s", 0, 0),
  ];

  it("reads each measure's own change by its short name, the package from the combined run", () => {
    const { members, measures, total } = measurePovertyRows(rows, catalogue, ALL, 2027, "poverty_change_pp");
    expect(measures.map((m) => m.name)).toContain("Plan 2 threshold unfrozen");
    expect(total).toBe(-0.008);
    // Employer NI changes no household's income: in More info, not a step
    expect(members.find((member) => member.id === "employer_ni_relief_under_25s").muted).toBe(true);
    expect(measures.some((m) => m.id === "employer_ni_relief_under_25s")).toBe(false);
  });

  it("steps by size in people out of poverty, closes the gap with an interaction step and ends at the package", () => {
    const { measures, total } = measurePovertyRows(rows, catalogue, ALL, 2027, "poverty_change_pp");
    // 70 million people: 0.001pp is 700 people
    const { steps, zero, peopleMode } = povertyWaterfall(measures, total, 70);
    expect(peopleMode).toBe(true);
    expect(steps.map((s) => [s.kind, s.id])).toEqual([
      ["measure", "plan_2_threshold_unfreeze"],
      ["measure", "state_pension_income_tax_protection"],
      ["interaction", "interaction"],
      ["total", "package"],
    ]);
    // A fall in poverty steps right; each step starts where the last ended
    expect(steps[0].x).toBeCloseTo(3500);
    expect(steps[1].start).toBeCloseTo(3500);
    expect(steps[2].x).toBeCloseTo(700);
    expect(steps[3].start).toBe(0);
    expect(steps[3].end).toBeCloseTo(5600);
    // Measures that move no one are one line, not rows
    expect(zero.map((m) => m.id)).toEqual(["fuel_duty_rise_deferral"]);
  });

  it("falls back to percentage points without a population, and has no package for a part selection", () => {
    const { measures } = measurePovertyRows(rows, catalogue, ["plan_2_threshold_unfreeze", "fuel_duty_rise_deferral"], 2027, "poverty_change_pp");
    const { steps, peopleMode } = povertyWaterfall(measures, null, null);
    expect(peopleMode).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(["measure"]);
    expect(steps[0].x).toBeCloseTo(0.005);
  });
});

describe("the Poverty sub-tab's measures pair", () => {
  it("is two cards in a row under one poverty choice: the change, then which measures move it", async () => {
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={metrics} policies={catalogue.measures} selectedPolicies={ALL} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const panel = document.body;
    const card = async (name) =>
      (await within(panel).findByRole("heading", { level: 3, name }, { timeout: 5000 })).closest(".charts-grid > div");
    const change = await card(/^Change in the poverty rate$/);
    const measures = await card(/^Which measures move poverty/);
    expect(change.parentElement).toBe(measures.parentElement);

    // The pair's one poverty choice sits above both cards, not in each
    const choice = within(panel).getByRole("group", { name: "Poverty measure" });
    expect(choice.nextElementSibling).toBe(change.parentElement);
    for (const c of [change, measures]) {
      expect(within(c).queryByRole("button", { name: /^Poverty line:/ })).toBeNull();
    }
    // The change in people, from the outlook's population
    await waitFor(() => expect(change.querySelector(".chart-description")).toHaveTextContent(/2027-28: −0\.008pp \(≈[\d,]+ fewer people\)/), { timeout: 5000 });
    // A waterfall in people: short names, the package last, the measures
    // that move no one on one muted line
    const rows = within(measures).getAllByRole("rowheader").map((r) => r.textContent);
    expect(rows[0]).toBe("Plan 2 threshold unfrozen");
    expect(rows.at(-1)).toBe("Package");
    expect(rows).not.toContain("Employer NI relief, under-25s");
    expect(within(measures).getByText(/^No effect on poverty: /)).toHaveTextContent(/BADR restricted/);
    expect(measures.querySelector(".wf-total .wf-main")).toHaveTextContent(/^≈[\d,]+ fewer$/);
    expect(measures.querySelector(".chart-description")).toHaveTextContent(/Biggest: Plan 2 threshold unfrozen, ≈[\d,]+ fewer people \(−0\.005pp\)/);

    // One poverty choice for both cards
    fireEvent.click(within(choice).getByRole("button", { name: /^Poverty line:/ }));
    fireEvent.click(within(choice).getByRole("option", { name: "Relative" }));
    expect(within(choice).getByRole("button", { name: /^Poverty line:/ })).toHaveTextContent("Relative");
    expect(new URLSearchParams(window.location.search).get("poverty")).toBe("relative-bhc-all");
    expect(change.querySelector(".chart-description")).toHaveTextContent(/relative/i);

    // More info: the £0 measures and that the parts need not add up
    fireEvent.click(within(measures).getByRole("button", { name: "More info" }));
    expect(within(measures).getByText(/need not add up to the package/)).toBeInTheDocument();
    expect(within(measures).getByText(/Employer NI relief for under-25s/)).toBeInTheDocument();
  });
});

describe("a measure whose artifact predates the poverty and inequality measures", () => {
  // Plan 2's run as an artifact written before poverty_inequality: its
  // metrics rows have only the contract's columns, while every other run's
  // carry the measures too (loadArtifact's withPovertyInequality)
  const OLDER = "plan_2_threshold_unfreeze";
  const EXTRAS = new Set(FLAT_EXTRA_COLUMNS.metrics.map(([column]) => column));
  const without = (row) => Object.fromEntries(Object.entries(row).filter(([column]) => !EXTRAS.has(column)));
  const mixed = metrics.map((row) => (row.reform_id === OLDER ? without(row) : row));
  const CHILD_REL_AHC = povertyMetric({ basis: "relative", housing: "ahc", group: "children" });
  const HEADLINE = povertyMetric({ basis: "absolute", housing: "bhc", group: "all" });
  const published2027 = (id) => metrics.find((row) => row.reform_id === id && row.year === "2027");
  const NOTE = /Not every measure shown has the chosen poverty line published, so this shows the share of people in absolute poverty before housing costs\./;

  const renderCard = async (rows, selected) => {
    window.history.replaceState({}, "", "/?sub=poverty&poverty=relative-ahc-children");
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={rows} policies={catalogue.measures} selectedPolicies={selected} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const heading = await within(document.body).findByRole("heading", { level: 3, name: /^Which measures move poverty/ }, { timeout: 5000 });
    return heading.closest(".charts-grid > div");
  };

  it("reads the measure the run lacks, or an empty cell, as missing, not as no change", () => {
    const read = measurePovertyRows(mixed, catalogue, [OLDER], 2027, CHILD_REL_AHC.key);
    expect(read.measures.map((m) => [m.id, m.value])).toEqual([[OLDER, null]]);
    expect(read.missing).toEqual([OLDER]);
    const empty = metrics.map((row) => (row.reform_id === OLDER ? { ...row, [CHILD_REL_AHC.key]: "" } : row));
    expect(measurePovertyRows(empty, catalogue, [OLDER], 2027, CHILD_REL_AHC.key).missing).toEqual([OLDER]);
  });

  it("shows the headline for every measure then, and keeps the chosen measure where every run read carries it", () => {
    const card = povertyCardRows(mixed, catalogue, [OLDER], 2027, CHILD_REL_AHC);
    expect([card.metric.key, card.fellBack]).toEqual([HEADLINE.key, true]);
    expect(card.measures.map((m) => [m.id, m.value])).toEqual([[OLDER, Number(published2027(OLDER).poverty_change_pp)]]);
    // A true 0 stays a 0, under the chosen measure
    const carried = povertyCardRows(mixed, catalogue, ["state_pension_income_tax_protection"], 2027, CHILD_REL_AHC);
    expect([carried.metric.key, carried.fellBack]).toEqual([CHILD_REL_AHC.key, false]);
    expect(carried.measures.map((m) => m.value)).toEqual([0]);
  });

  it("falls back when the package's combined run lacks the measure, though every measure's carries it", () => {
    const rows = metrics.map((row) => (row.reform_id === COMBINED ? without(row) : row));
    expect(measurePovertyRows(rows, catalogue, ALL, 2027, CHILD_REL_AHC.key).missing).toEqual([COMBINED]);
    const card = povertyCardRows(rows, catalogue, ALL, 2027, CHILD_REL_AHC);
    expect(card.metric.key).toBe(HEADLINE.key);
    expect(card.total).toBe(Number(published2027(COMBINED).poverty_change_pp));
  });

  it("shows the headline, not nothing, when no run carries the chosen measure", () => {
    // An older file throughout, and a measure that changes no income in 2027
    const older = metrics.map(without);
    const card = povertyCardRows(older, catalogue, ["employer_ni_relief_under_25s"], 2027, CHILD_REL_AHC);
    expect([card.metric.key, card.fellBack, card.measures]).toEqual([HEADLINE.key, true, []]);
  });

  it("is never said to have no effect on a measure its run does not carry, and says it shows the headline", async () => {
    const card = await renderCard(mixed, [OLDER]);
    expect(within(card).queryByText(/^No effect on poverty: /)).toBeNull();
    const summary = card.querySelector(".chart-description");
    expect(summary).toHaveTextContent(/^Change in absolute poverty \(BHC\)/);
    expect(summary).toHaveTextContent(NOTE);
    expect(within(card).getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["Plan 2 threshold unfrozen"]);
    // In people, as the headline counts them: the population of everyone,
    // not of the children chosen
    const population = outlookPopulation(JSON.parse(readFileSync(join(PUBLIC, "data", "living_standards_outlook.json"), "utf8")));
    const count = (millions) => {
      const n = Math.abs((Number(published2027(OLDER).poverty_change_pp) / 100) * millions * 1e6);
      return n < 1000 ? "<1,000" : `≈${new Intl.NumberFormat("en-GB").format(Math.round(n / 1000) * 1000)}`;
    };
    expect(count(population(2027, "children"))).not.toBe(count(population(2027, "all")));
    await waitFor(() => expect(summary).toHaveTextContent(`Biggest: Plan 2 threshold unfrozen, ${count(population(2027, "all"))} fewer people`), { timeout: 5000 });
  });

  it("still says so of a measure whose run carries the measure as no change, with no note", async () => {
    const card = await renderCard(mixed, ["state_pension_income_tax_protection"]);
    const summary = card.querySelector(".chart-description");
    expect(summary).toHaveTextContent(/^Change in relative child poverty \(AHC\)/);
    expect(summary).not.toHaveTextContent(NOTE);
    expect(within(card).getByText(/^No effect on poverty: /)).toBeInTheDocument();
  });

  it("lists as a step or no effect only what a run carries, and keeps the chosen measure exactly when every run read, and some run, carries it", () => {
    const CHOICES = ["absolute", "relative"].flatMap((basis) =>
      ["bhc", "ahc"].flatMap((housing) => ["all", "children"].map((group) => povertyMetric({ basis, housing, group }))),
    );
    const value = fc.oneof(fc.constant(0), fc.double({ min: -1, max: 1, noNaN: true }));
    // A run's row: none, or one whose chosen cell is absent, empty or a value
    const run = fc.option(
      fc.record({
        affected: fc.oneof(fc.constant(0), fc.double({ min: 0.001, max: 100, noNaN: true })),
        headline: value,
        chosen: fc.oneof(fc.constant(undefined), fc.constant(""), value.map(String)),
      }),
      { freq: 6 },
    );
    const IDS = [...ALL, COMBINED];
    fc.assert(
      fc.property(
        fc.constantFrom(...CHOICES),
        fc.oneof(fc.constant(ALL), fc.subarray(ALL, { minLength: 1 })),
        fc.tuple(...IDS.map(() => run)),
        (chosen, selected, runs) => {
          const rows = IDS.flatMap((id, i) =>
            runs[i] === null
              ? []
              : [
                  {
                    reform_id: id,
                    year: "2027",
                    people_affected: String(runs[i].affected),
                    [HEADLINE.key]: String(runs[i].headline),
                    ...(runs[i].chosen === undefined || chosen.key === HEADLINE.key ? {} : { [chosen.key]: runs[i].chosen }),
                  },
                ],
          );
          const rowOf = (id) => rows.find((row) => row.reform_id === id);
          const carries = (row) => row !== undefined && row[chosen.key] !== undefined && row[chosen.key] !== "";
          const card = povertyCardRows(rows, catalogue, selected, 2027, chosen);
          if (rows.length === 0) {
            expect(card).toBeNull();
            return;
          }
          expect(card).not.toBeNull();
          // Every value shown is the run's own, under the measure shown
          for (const measure of card.measures) {
            expect(rowOf(measure.id)).toHaveProperty(card.metric.key);
            expect(measure.value).toBe(Number(rowOf(measure.id)[card.metric.key]));
          }
          const { zero } = povertyWaterfall(card.measures, card.total, null);
          for (const measure of zero) expect(Number(rowOf(measure.id)[card.metric.key])).toBe(0);
          // The package is the combined run's own, under the measure shown
          const whole = wholeSelectionRun(catalogue.displayable, selected, COMBINED) === COMBINED;
          expect(card.total).toBe(whole && rowOf(COMBINED) ? Number(rowOf(COMBINED)[card.metric.key]) : null);
          // The chosen measure exactly when every run read, and some run, carries it
          const read = card.members.filter((member) => !member.muted).map((member) => member.id);
          if (whole && rowOf(COMBINED)) read.push(COMBINED);
          const keeps = read.every((id) => carries(rowOf(id))) && rows.some(carries);
          expect(card.metric.key === chosen.key).toBe(chosen.key === HEADLINE.key || keeps);
          expect(card.fellBack).toBe(card.metric.key !== chosen.key);
        },
      ),
      { numRuns: 300 },
    );
  });
});
