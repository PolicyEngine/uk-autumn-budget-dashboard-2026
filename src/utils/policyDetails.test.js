import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import fc from "fast-check";
import { measureSummary, POLICY_DETAILS, policyDetailsFor, withPolicyDetails } from "./policyDetails";

// The catalogue decides which measures exist, their names, descriptions,
// order and colours (#104); a details entry only adds a card's text, and
// only to the measure as described when the entry was written (writtenFor):
// one changed since shows as published. These hold for any catalogue
// measure, published under a known id or not, described as written or not.
const KNOWN_IDS = POLICY_DETAILS.map((entry) => entry.id);
const writtenFor = Object.fromEntries(POLICY_DETAILS.map((entry) => [entry.id, entry.writtenFor]));
const catalogueMeasure = fc
  .record({
    id: fc.oneof(fc.constantFrom(...KNOWN_IDS), fc.string()),
    name: fc.string(),
    description: fc.string(),
    asWritten: fc.boolean(),
    color: fc.string(),
    order: fc.integer(),
    displayable: fc.boolean(),
  })
  .map(({ asWritten, ...measure }) => (asWritten && Object.hasOwn(writtenFor, measure.id) ? { ...measure, description: writtenFor[measure.id] } : measure));

it("keeps every field the catalogue publishes, whatever details exist for the id", () => {
  fc.assert(
    fc.property(catalogueMeasure, (measure) => {
      const shown = withPolicyDetails(measure);
      for (const [field, value] of Object.entries(measure)) expect(shown[field]).toEqual(value);
    }),
  );
});

it("adds nothing unless the measure is described exactly as its entry was written for", () => {
  fc.assert(
    fc.property(catalogueMeasure, (measure) => {
      fc.pre(measure.description !== writtenFor[measure.id]);
      expect(policyDetailsFor(measure)).toBeNull();
      expect(withPolicyDetails(measure)).toEqual(measure);
    }),
  );
});

it("adds its entry's card text to a measure described as written", () => {
  for (const { id, name: _name, description: _description, writtenFor: description, ...fields } of POLICY_DETAILS) {
    expect(withPolicyDetails({ id, name: "Published name", description })).toEqual({ ...fields, id, name: "Published name", description });
  }
});

it("records for each entry the description it was written for, and carries no revenue figures", () => {
  for (const entry of POLICY_DETAILS) {
    expect(typeof entry.writtenFor, entry.id).toBe("string");
    expect(entry.writtenFor.length, entry.id).toBeGreaterThan(0);
    for (const field of ["cost", "revenue", "budgetaryImpact", "impact", "values"]) expect(entry).not.toHaveProperty(field);
  }
});

it("gives every measure with a description a summary: its entry's while it holds, else the description's first sentence", () => {
  fc.assert(
    fc.property(catalogueMeasure, (measure) => {
      const summary = measureSummary(measure);
      const details = policyDetailsFor(measure);
      if (details?.summary) expect(summary).toBe(details.summary);
      else if (measure.description.trim().replace(/^Candidate measure\.\s*/i, "").trim()) {
        expect(summary).toBeTruthy();
        expect(summary).not.toMatch(/…$/);
      } else expect(summary).toBeNull();
    }),
  );
});

it("falls back to the whole first published sentence, without its Candidate measure label, never cut short", () => {
  expect(measureSummary({ id: "x", description: "Candidate measure. Rates rise by 2p. Then more." })).toBe("Rates rise by 2p.");
  const sentence = `${"word ".repeat(60)}end.`;
  expect(measureSummary({ id: "x", description: `Candidate measure. ${sentence} Next sentence.` })).toBe(sentence);
  expect(measureSummary({ id: "x", description: "Rates rise by 2.5% from April" })).toBe("Rates rise by 2.5% from April");
  expect(measureSummary({ id: "x", description: "" })).toBeNull();
});

it("gives every measure policyDetails was written for a tip as described now, or as published if changed", () => {
  for (const entry of POLICY_DETAILS) {
    expect(measureSummary({ id: entry.id, description: entry.writtenFor })).toBe(entry.summary);
    expect(measureSummary({ id: entry.id, description: `Candidate measure. Changed ${entry.id}.` })).toBe(`Changed ${entry.id}.`);
  }
});

// The measures of the Budget 2026 package (28 October 2026), as the file
// the page serves describes them (`uk-budget-data policy-table` copies
// reforms.py's description verbatim): each entry must be written for
// exactly that text, or its card falls back to the bare description.
const CANDIDATES = [
  "fuel_duty_rise_deferral",
  "state_pension_income_tax_protection",
  "domestic_electricity_zero_vat",
  "unearned_income_rates_up",
  "carers_allowance_earnings_taper",
  "household_energy_payment_2026",
  "trading_allowance_raise",
];

it("has an entry written for each candidate measure's published description, byte for byte", () => {
  const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
  for (const id of CANDIDATES) {
    const entry = POLICY_DETAILS.find((policy) => policy.id === id);
    expect(entry, id).toBeTruthy();
    expect(file.measures[id], id).toBeTruthy();
    expect(entry.writtenFor, id).toBe(file.measures[id].description);
    expect(policyDetailsFor({ id, description: file.measures[id].description }), id).not.toBeNull();
  }
});

// Every card the page publishes is complete and parallel: a plain one-line
// summary, a start, when it is in force, the modelling details and a source.
it("gives every published measure a summary, start, timeline, who it affects, how it is calculated and a source", () => {
  const file = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
  for (const [id, measure] of Object.entries(file.measures)) {
    const fields = policyDetailsFor({ id, description: measure.description });
    expect(fields, id).not.toBeNull();
    expect(fields.summary, id).toMatch(/^[A-Z].*\.$/);
    expect(fields.summary.startsWith("Candidate measure"), id).toBe(false);
    expect(fields.starts, id).toBeTruthy();
    expect(fields.inForce?.from, id).toMatch(/^\d{4}-\d{2}$/);
    if (fields.inForce.to) expect(fields.ends, id).toBeTruthy();
    expect(fields.summary.length, id).toBeLessThanOrEqual(200);
    expect(fields.affects, id).toBeTruthy();
    expect(fields.howCalculated, id).toBeTruthy();
    expect(fields.details, id).toBeTruthy();
    expect(fields.source?.label, id).toBeTruthy();
    expect(fields.source?.href, id).toMatch(/^https:\/\/www\.(gov\.uk|legislation\.gov\.uk)\//);
  }
});
