import { expect, it } from "vitest";
import fc from "fast-check";
import { POLICY_DETAILS, policyDetailsFor, withPolicyDetails } from "./policyDetails";

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
  .map(({ asWritten, ...measure }) => (asWritten && writtenFor[measure.id] ? { ...measure, description: writtenFor[measure.id] } : measure));

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
