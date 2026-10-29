import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { PovertyMeasuresRow, TOGETHER, measurePovertyRows, povertyCardRows, povertyWaterfall } from "./MeasuresPovertyCard";
import { povertyMetric } from "./SummaryMetricChart";
import { wholeSelectionRun } from "../utils/ageImpact";
import { FLAT_EXTRA_COLUMNS } from "../utils/publication/csv";
import { outlookPopulation, roundPeople } from "../utils/povertyPeople";
import { POLICY_DETAILS, shortNameOf } from "../utils/policyDetails";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";

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
    const { members, measures, idle, total } = measurePovertyRows(rows, catalogue, ALL, 2027, "poverty_change_pp");
    expect(measures.map((m) => m.name)).toContain("Student loan threshold unfrozen");
    expect(total).toBe(-0.008);
    // Employer NI changes no household's income: a "No change" row, not a step
    expect(members.find((member) => member.id === "employer_ni_relief_under_25s").muted).toBe(true);
    expect(measures.some((m) => m.id === "employer_ni_relief_under_25s")).toBe(false);
    expect(idle.find((m) => m.id === "employer_ni_relief_under_25s")).toMatchObject({ value: 0 });
  });

  it("draws each policy from zero by size, with no interaction row, and ends with all of them together (POV2, POV3)", () => {
    const selected = ["state_pension_income_tax_protection", "plan_2_threshold_unfreeze", "fuel_duty_rise_deferral", "employer_ni_relief_under_25s"];
    const { measures, idle, total } = measurePovertyRows(rows, catalogue, selected, 2027, "poverty_change_pp");
    // 70 million people: 0.001pp is 700 people
    const { steps, zero, peopleMode } = povertyWaterfall(measures, total ?? -0.008, 70, idle);
    expect(peopleMode).toBe(true);
    // Every selected policy is a row: the steps by size, then the ones that
    // move no one (no bar), then the package
    expect(steps.map((s) => [s.kind, s.id])).toEqual([
      ["measure", "plan_2_threshold_unfreeze"],
      ["measure", "state_pension_income_tax_protection"],
      ["none", "fuel_duty_rise_deferral"],
      ["none", "employer_ni_relief_under_25s"],
      ["total", "package"],
    ]);
    // A "No change" row sits at 0 and never moves the steps after it
    expect(steps.filter((s) => s.kind === "none").every((s) => s.x === 0 && s.start === 0 && s.end === 0)).toBe(true);
    // A fall in poverty points right; every bar starts at 0, so nothing
    // reads as stacking
    expect(steps[0].x).toBeCloseTo(3500);
    expect(steps.every((s) => s.start === 0)).toBe(true);
    expect(steps[1].end).toBeCloseTo(steps[1].x);
    // The last row is the combined run's own figure, never the bars summed
    expect(steps.at(-1).name).toBe(TOGETHER);
    expect(steps.at(-1).end).toBeCloseTo(5600);
    expect(zero.map((m) => m.id)).toEqual(["fuel_duty_rise_deferral", "employer_ni_relief_under_25s"]);
  });

  it("falls back to percentage points without a population, and has no package for a part selection", () => {
    const { measures, idle } = measurePovertyRows(rows, catalogue, ["plan_2_threshold_unfreeze", "fuel_duty_rise_deferral"], 2027, "poverty_change_pp");
    const { steps, peopleMode } = povertyWaterfall(measures, null, null, idle);
    expect(peopleMode).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(["measure", "none"]);
    expect(steps[0].x).toBeCloseTo(0.005);
  });

  it("keeps a bar for a small non-zero change, and keeps exactly 0 as no change", () => {
    const small = [
      { id: "a", name: "A", value: -0.0001 },
      { id: "b", name: "B", value: 0 },
    ];
    const { steps } = povertyWaterfall(small, null, 70);
    expect(steps.map((s) => [s.id, s.kind])).toEqual([["a", "measure"], ["b", "none"]]);
    // 0.0001pp of 70 million is 70 people: a step, not "No change"
    expect(steps[0].x).toBeCloseTo(70);
  });
});

describe("the Poverty sub-tab's measures pair", () => {
  it("is two cards stacked full width under one poverty choice: which measures move it, then the change", async () => {
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={metrics} policies={catalogue.measures} selectedPolicies={ALL} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const panel = document.body;
    const card = async (name) =>
      (await within(panel).findByRole("heading", { level: 3, name }, { timeout: 5000 })).closest(".charts-stack > div");
    const change = await card(/^Change in the poverty rate$/);
    const measures = await card(/^Which policies move poverty/);
    expect(change.parentElement).toBe(measures.parentElement);
    // Which measures first, on top
    expect(measures.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // No bar above the pair: each card's own Options pill holds the
    // poverty measure, the same in both
    expect(within(panel).queryByRole("group", { name: "Poverty measure" })).toBeNull();
    for (const c of [change, measures]) {
      expect(within(c).getByRole("button", { name: /^Options:/ })).toHaveAccessibleName("Options: Absolute · Before housing costs · All people");
    }
    // The change in people, from the outlook's population
    await waitFor(() => expect(change.querySelector(".chart-description")).toHaveTextContent(/^In 2027-28 the selected policies move about [\d,]+ people out of absolute poverty before housing costs, lowering the rate by about 0\.0075 percentage points\.$/), { timeout: 5000 });
    // A waterfall in people: short names, the package last; every selected
    // policy a row, the ones that move no one after the steps with "No
    // change" and why, and no bar
    const rows = within(measures).getAllByRole("rowheader").map((r) => r.querySelector(".mrl-name")?.textContent ?? r.textContent);
    expect(rows[0]).toBe("Student loan threshold unfrozen");
    expect(rows.at(-1)).toBe(TOGETHER);
    expect(measures.querySelector(".wf-join")).toBeNull();
    const shownIds = [...measures.querySelectorAll(".wf-measure, .wf-none")].length;
    expect(shownIds).toBe(catalogue.displayable.filter((m) => ALL.includes(m.id)).length);
    expect(rows).toContain("Employer National Insurance relief, under-25s");
    const none = [...measures.querySelectorAll(".wf-none")];
    expect(none.length).toBeGreaterThan(0);
    for (const row of none) {
      expect(row.querySelector(".wf-main")).toHaveTextContent(/^No change$/);
      expect(row.querySelector(".wf-reason").textContent.length).toBeGreaterThan(0);
      expect(row.querySelector(".wf-bar")).toBeNull();
    }
    const reasonFor = (name) => none.find((row) => row.textContent.includes(name))?.querySelector(".wf-reason")?.textContent;
    expect(reasonFor("Business sale relief limit halved")).toBe("taxes capital gains, not incomes");
    expect(reasonFor("Employer National Insurance relief, under-25s")).toBe("changes employers' costs; we hold wages fixed");
    // The steps come first, then the no-change rows, then the total
    const kinds = [...measures.querySelectorAll(".wf-measure, .wf-interaction, .wf-none, .wf-total")].map((r) => r.className.match(/wf-(measure|interaction|none|total)/)[1]);
    expect(kinds.join(" ")).toMatch(/^(measure )+(none )+total$/);
    expect(measures.querySelector(".wf-total .wf-main")).toHaveTextContent(/^about [\d,]+ fewer people$/);
    // A plain sentence, no "≈" or "pp"
    const headline = measures.querySelector(".chart-description");
    expect(headline).toHaveTextContent(/^The selected policies together move about [\d,]+ people out of poverty\. On its own, unfreezing the student loan threshold moves the most \(about [\d,]+\)\.$/);
    expect(measures.textContent).not.toMatch(/package/i);
    expect(headline.textContent).not.toMatch(/≈|pp/);

    // Chosen in one card's pill, followed by the other's
    fireEvent.click(within(change).getByRole("button", { name: /^Options:/ }));
    fireEvent.click(within(within(change).getByRole("radiogroup", { name: "Poverty line" })).getByRole("radio", { name: "Relative" }));
    expect(within(change).getByRole("button", { name: /^Options:/ })).toHaveTextContent(/^Relative · /);
    expect(within(measures).getByRole("button", { name: /^Options:/ })).toHaveTextContent(/^Relative · /);
    expect(new URLSearchParams(window.location.search).get("poverty")).toBe("relative-bhc-all");
    // The card's line is the figure; what it measures is in More info
    fireEvent.click(within(change).getByRole("button", { name: "About this chart" }));
    expect(change.querySelector(".chart-footer")).toHaveTextContent(/relative/i);

    // About this chart: that the parts need not add up; the policies that
    // move no one are in their rows, not listed again here
    fireEvent.click(within(measures).getByRole("button", { name: "About this chart" }));
    expect(within(measures).getByText(/so the bars need not add up to it/)).toBeInTheDocument();
    // Why, linked to Limitations (critic W2, round 3)
    expect(within(measures).getByRole("link", { name: "Policies added up" })).toHaveAttribute("href", "?tab=methodology#method-limitations");
    // The policy's own effect is said once, in the sentence, not again here
    expect(within(measures).queryByText("Each bar is one policy on its own.")).toBeNull();
    const about = measures.querySelector(".chart-more-info");
    expect(about).not.toHaveTextContent(/No effect on/);
    expect(about.querySelector("[data-zero-measure]")).toBeNull();
    // The card says each fact once: the people rule is in Methodology
    expect(about).not.toHaveTextContent(/nearest 1,000/);
  });
});

describe("a published file with only the headline poverty column", () => {
  it("still shows Which measures move poverty, on the headline measure, whatever ?poverty= says", async () => {
    // As the per-measure artifacts publish metrics.csv: the headline column only
    const HEADLINE = ["reform_id", "reform_name", "year", "people_affected", "gini_change", "poverty_change_pp", "poverty_change_pct"];
    const narrow = metrics.map((row) => Object.fromEntries(HEADLINE.map((key) => [key, row[key]])));
    window.history.replaceState({}, "", "/?sub=poverty&poverty=relative-ahc-children");
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={narrow} policies={catalogue.measures} selectedPolicies={ALL} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const heading = await within(document.body).findByRole("heading", { level: 3, name: /^Which policies move poverty/ }, { timeout: 5000 });
    const card = heading.closest(".mp-card");
    // No choice to make, and the steps are the headline measure's
    expect(within(card).queryByRole("button", { name: /^Options:/ })).toBeNull();
    expect(within(card).getAllByRole("rowheader").length).toBeGreaterThan(0);
  });
});

describe("a measure whose artifact predates the poverty and inequality measures", () => {
  // Plan 2's run as an artifact written before poverty_inequality: its
  // metrics rows have only the contract's columns, while every other run's
  // carry the measures too (loadArtifact's withPovertyInequality)
  const OLDER = "plan_2_threshold_unfreeze";
  // Its name as the card and the chart give it
  const OLDER_NAME = shortNameOf(catalogue.byId.get(OLDER));
  const EXTRAS = new Set(FLAT_EXTRA_COLUMNS.metrics.map(([column]) => column));
  const without = (row) => Object.fromEntries(Object.entries(row).filter(([column]) => !EXTRAS.has(column)));
  const mixed = metrics.map((row) => (row.reform_id === OLDER ? without(row) : row));
  const CHILD_REL_AHC = povertyMetric({ basis: "relative", housing: "ahc", group: "children" });
  const HEADLINE = povertyMetric({ basis: "absolute", housing: "bhc", group: "all" });
  const published2027 = (id) => metrics.find((row) => row.reform_id === id && row.year === "2027");
  const NOTE = "Not every policy shown has the chosen poverty line published, so this shows the share of people in absolute poverty before housing costs.";
  const nameOf = (r) => r.querySelector(".mrl-name")?.textContent ?? r.textContent;
  const about = (millions) => {
    const n = Math.abs((Number(published2027(OLDER).poverty_change_pp) / 100) * millions * 1e6);
    return n < 1000 ? "under 1,000" : `about ${roundPeople(n)}`;
  };

  const renderCard = async (rows, selected) => {
    window.history.replaceState({}, "", "/?sub=poverty&poverty=relative-ahc-children");
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={rows} policies={catalogue.measures} selectedPolicies={selected} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const heading = await within(document.body).findByRole("heading", { level: 3, name: /^Which policies move poverty/ }, { timeout: 5000 });
    const card = heading.closest(".mp-card");
    fireEvent.click(within(card).getByRole("button", { name: "About this chart" }));
    return card;
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
    expect(card.querySelector(".wf-none")).toBeNull();
    expect(card.querySelector(".mp-fell-back")).toHaveTextContent(NOTE);
    expect(within(card).getAllByRole("rowheader").map(nameOf)).toEqual([OLDER_NAME]);
    // In people, as the headline counts them: the population of everyone,
    // not of the children chosen
    const population = outlookPopulation(JSON.parse(readFileSync(join(PUBLIC, "data", "living_standards_outlook.json"), "utf8")));
    expect(about(population(2027, "children"))).not.toBe(about(population(2027, "all")));
    await waitFor(() => expect(card.querySelector(".chart-description")).toHaveTextContent(`moves ${about(population(2027, "all"))} people out of poverty.`), { timeout: 5000 });
  });

  it("still says so of a measure whose run carries the measure as no change, with no note", async () => {
    const card = await renderCard(mixed, ["state_pension_income_tax_protection"]);
    expect(card.querySelector(".mp-fell-back")).toBeNull();
    expect(card.querySelector(".wf-none .wf-main")).toHaveTextContent(/^No change$/);
  });

  it("the chart beside it, each measure on its own, shows the headline rather than hide a run without the choice as no effect", async () => {
    window.history.replaceState({}, "", "/?sub=poverty&poverty=relative-ahc-children");
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={mixed} policies={catalogue.measures} selectedPolicies={[OLDER, "state_pension_income_tax_protection"]} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const heading = await within(document.body).findByRole("heading", { level: 3, name: /^Change in the poverty rate$/ }, { timeout: 5000 });
    const chart = heading.closest(".charts-stack > div");
    expect(chart).not.toHaveTextContent(/with no effect hidden|changes this on its own/);
    expect(chart).toHaveTextContent(OLDER_NAME);
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

describe("About this chart and the sentence follow the selection (W6 G1)", () => {
  const renderMeasures = async (selected) => {
    render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <PovertyMeasuresRow rows={metrics} policies={catalogue.measures} selectedPolicies={selected} selectedYear={2027} />
      </MeasureCatalogueProvider>,
    );
    const heading = await within(document.body).findByRole("heading", { level: 3, name: /^Which policies move poverty/ }, { timeout: 5000 });
    const card = heading.closest(".mp-card");
    fireEvent.click(within(card).getByRole("button", { name: "About this chart" }));
    return card;
  };

  it("describes the last bar only when it is drawn", async () => {
    // Two policies, not every one: no run of the whole selection, so no
    // "All selected policies together" bar and no line about it
    const card = await renderMeasures(["plan_2_threshold_unfreeze", "state_pension_income_tax_protection"]);
    expect(card.querySelector(".wf-total")).toBeNull();
    expect(within(card).queryByText(TOGETHER)).toBeNull();
    expect(card.querySelector(".chart-more-info")).not.toHaveTextContent(/The last bar/);
    expect(within(card).queryByRole("link", { name: "Policies added up" })).toBeNull();
  });

  it("names the poverty line, not 'this line', when no selected policy moves anyone", async () => {
    const card = await renderMeasures(["fuel_duty_rise_deferral"]);
    expect(card.querySelector(".chart-description")).toHaveTextContent(
      /^No selected policy on its own moves anyone across the poverty line in 2027-28\.$/,
    );
  });
});
