import { expect, it } from "vitest";
import fc from "fast-check";
import { POLICY_DETAILS, policyDetails, withPolicyDetails } from "./policyDetails";

// The catalogue decides which measures exist, their names, descriptions,
// order and colours (#104); a details entry only adds a card's text. These
// hold for any catalogue measure, published under a known id or not.
const KNOWN_IDS = POLICY_DETAILS.map((entry) => entry.id);
const catalogueMeasure = fc.record({
  id: fc.oneof(fc.constantFrom(...KNOWN_IDS), fc.string()),
  name: fc.string(),
  description: fc.string(),
  color: fc.string(),
  order: fc.integer(),
  displayable: fc.boolean(),
});

it("keeps every field the catalogue publishes, whatever details exist for the id", () => {
  fc.assert(
    fc.property(catalogueMeasure, (measure) => {
      const shown = withPolicyDetails(measure);
      for (const [field, value] of Object.entries(measure)) expect(shown[field]).toEqual(value);
    }),
  );
});

it("adds nothing to a measure it has no entry for", () => {
  fc.assert(
    fc.property(catalogueMeasure, (measure) => {
      fc.pre(policyDetails(measure.id) === null);
      expect(withPolicyDetails(measure)).toEqual(measure);
    }),
  );
});

it("carries no revenue figures, which stay with the verified charts", () => {
  for (const entry of POLICY_DETAILS) {
    for (const field of ["cost", "revenue", "budgetaryImpact", "impact", "values"]) expect(entry).not.toHaveProperty(field);
  }
});
