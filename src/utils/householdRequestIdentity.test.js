/**
 * The household model moved to policyengine-household-wizard's
 * uk-household; the request it builds must be the one the page built
 * before, byte for byte. Results are cached, and computed ahead, by
 * requestKey(body), so a single byte moved would miss every cache and
 * stale every stored result.
 *
 * Three checks of the same claim:
 * - the golden file: the bytes the old code gave for 1,318 cases (every
 *   example and the defaults across the years, measure lists and stages
 *   the page asks with, edge cases of each rule, and 400 seeded random
 *   answers), captured once by running it;
 * - a property test against a verbatim copy of the old code
 *   (src/test/householdRequestReference.js), for generated answers;
 * - the form's answers and the shared draft carry the same household
 *   (householdDraft.js), checked both ways.
 *
 * The one difference is intended, and only on requests the API refuses:
 * without a partner, the old request carried whatever partner age the form
 * held, and the API refused the whole request for one it does not take (it
 * reads the age only with a partner). The new request leaves such an age
 * out. The form keeps the partner's age from 18 to 80, so it cannot arise
 * from the form's own boxes.
 */
import fc from "fast-check";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UK_COUNCIL_TAX_BANDS,
  UK_HOUSEHOLD_LIMITS,
  UK_POLICY_YEARS,
  UK_REGIONS,
  UK_STUDENT_LOAN_PLANS,
  UK_TENURES,
  deserializeDraft,
  serializeDraft,
  toHouseholdImpactRequest,
  validate,
} from "policyengine-household-wizard/uk-household";
import golden from "../test/fixtures/householdRequests.golden.json";
import { CASE_INCLUDES, CASE_POLICIES, curatedCases, sampledCases } from "../test/householdRequestCases";
import * as reference from "../test/householdRequestReference";
import budgetYears from "../uk_budget_data/budget_years.json";
import statePensionTable from "../uk_budget_data/state_pension.json";
import { CHOICE_CONFIGS, NUMBER_CONFIGS, REGION_OPTIONS, WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { CONSTITUENCIES } from "./constituencies";
import { HOUSEHOLD_EXAMPLES } from "./householdExamples";
import { answersFromDraft, draftFromAnswers, parseChildrenAges } from "./householdDraft";
import { OLDEST_CHILD_AGE, atStatePensionAge, buildHouseholdRequest, requestKey, statePensionFor } from "./householdImpactApi";

// This file is src/utils/householdRequestIdentity.test.js
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const POLICY_YEARS = budgetYears.policy_years;

/** The first 16 hex digits of the text's SHA-256, as the golden file keeps it. */
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const hashes = (body) => [hash(JSON.stringify(body)), hash(requestKey(body))];
const build = ({ inputs, year, policies, include }) => buildHouseholdRequest(inputs, { year, policies, include });

describe("the household request, against the bytes the old code gave", () => {
  it("starts from the same answers, in the same order", () => {
    expect(WIZARD_DEFAULTS).toEqual(golden.wizard_defaults);
    expect(Object.keys(WIZARD_DEFAULTS)).toEqual(Object.keys(golden.wizard_defaults));
  });

  it("gives every recorded request, byte for byte", () => {
    const names = Object.keys(golden.bodies);
    expect(names).toHaveLength(31);
    for (const name of names) {
      const recorded = golden.bodies[name];
      const { year, policies, include } = JSON.parse(recorded);
      const body = buildHouseholdRequest(golden.households[name], { year, policies, include });
      expect(JSON.stringify(body), name).toBe(recorded);
    }
  });

  it("gives the recorded bytes and cache key for every curated case", () => {
    const cases = curatedCases(WIZARD_DEFAULTS);
    expect(cases).toHaveLength(golden.cases.length);
    cases.forEach((testCase, index) => {
      const [name, year, policiesIndex, includeIndex, bodyHash, keyHash] = golden.cases[index];
      expect([testCase.name, testCase.year, testCase.policies, testCase.include]).toEqual([
        name,
        year,
        CASE_POLICIES[policiesIndex],
        CASE_INCLUDES[includeIndex],
      ]);
      expect(testCase.inputs, name).toEqual(golden.households[name]);
      expect(hashes(build(testCase)), `${name} ${year} ${policiesIndex} ${includeIndex}`).toEqual([bodyHash, keyHash]);
    });
  });

  it("gives the recorded bytes and cache key for every sampled case", () => {
    const { seed, count, hashes: recorded } = golden.sampled;
    const cases = sampledCases(seed, count);
    expect(cases).toHaveLength(recorded.length);
    cases.forEach((testCase, index) => {
      expect(hashes(build(testCase)), testCase.name).toEqual(recorded[index]);
    });
  });
});

// Answers of every kind the form's state can hold, and more: ages and
// amounts past the form's limits, text the age parser drops, unknown codes,
// and education answers that are not booleans
const amount = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 600000 }),
  fc.integer({ min: 0, max: 60000000 }).map((pennies) => pennies / 100),
  fc.double({ min: -1000, max: 1e7, noNaN: true, noDefaultInfinity: true }).map((value) => (value === 0 ? 0 : value)),
);
const ageToken = fc.oneof(
  fc.integer({ min: 0, max: 25 }).map(String),
  fc.constantFrom("", "x", "3.7", "-1", " 7 ", "19", "20", "16"),
);
const code = (codes, unknown) => fc.oneof(fc.constantFrom(...codes), fc.constantFrom(...unknown));
const answers = fc.record({
  current_age: fc.oneof(fc.integer({ min: 16, max: 100 }), fc.constantFrom(null, 15, 101, 66.5)),
  current_salary: amount,
  region: code(
    UK_REGIONS.map((region) => region.code),
    ["ATLANTIS", null, ""],
  ),
  tenure: code(UK_TENURES, ["HOUSEBOAT", null]),
  monthly_rent: fc.option(amount, { nil: null }),
  student_loan_plan: code(UK_STUDENT_LOAN_PLANS, ["PLAN_3"]),
  has_partner: fc.boolean(),
  partner_age: fc.oneof(fc.integer({ min: 16, max: 100 }), fc.constantFrom(null, 15, 101, 44.5)),
  partner_salary: amount,
  children_ages: fc
    .tuple(fc.array(ageToken, { maxLength: 7 }), fc.constantFrom(", ", ",", " , "))
    .map(([ages, separator]) => ages.join(separator)),
  children_in_education: fc.array(fc.constantFrom(true, false, null, "no", undefined), { maxLength: 8 }),
  claims_universal_credit: fc.constantFrom(true, false, null),
  council_tax_band: code(UK_COUNCIL_TAX_BANDS, ["J"]),
  salary_sacrifice_per_year: amount,
  petrol_spending_per_year: amount,
  diesel_spending_per_year: amount,
  electricity_spending_per_year: fc.option(amount, { nil: null }),
  dividends_per_year: amount,
  savings_interest_per_year: amount,
  property_income_per_year: amount,
  private_pension_per_year: fc.option(amount, { nil: null }),
  partner_private_pension_per_year: fc.option(amount, { nil: null }),
  monthly_childcare: amount,
  state_pension_per_year: fc.option(amount, { nil: null }),
  partner_state_pension_per_year: fc.option(amount, { nil: null }),
});
const year = fc.constantFrom(0, 2025, ...POLICY_YEARS, 2032);
const policies = fc.constantFrom(...CASE_POLICIES);
const include = fc.constantFrom(...CASE_INCLUDES);

/** An age the API takes for partner_age. */
const acceptedAge = (age) => Number.isInteger(age) && age >= 16 && age <= 100;

describe("the household request, against a copy of the old code", () => {
  it("is the same text for every answer, but a partner age the API refused", () => {
    let leftOut = 0;
    fc.assert(
      fc.property(answers, year, policies, include, (inputs, y, p, i) => {
        const now = buildHouseholdRequest(inputs, { year: y, policies: p, include: i });
        const before = reference.buildHouseholdRequest(inputs, { year: y, policies: p, include: i });
        if (inputs.has_partner || acceptedAge(inputs.partner_age)) {
          expect(JSON.stringify(now)).toBe(JSON.stringify(before));
          expect(requestKey(now)).toBe(reference.requestKey(before));
          return;
        }
        leftOut += 1;
        expect(now.household).not.toHaveProperty("partner_age");
        const { partner_age: _, ...household } = before.household;
        expect(JSON.stringify(now)).toBe(JSON.stringify({ ...before, household }));
      }),
      { numRuns: 3000 },
    );
    expect(leftOut).toBeGreaterThan(0);
  });

  it("is the same text for the examples in every year, stage and measure list", () => {
    for (const example of HOUSEHOLD_EXAMPLES) {
      const inputs = { ...WIZARD_DEFAULTS, ...example.inputs };
      for (const y of [0, ...POLICY_YEARS]) {
        for (const p of CASE_POLICIES) {
          for (const i of CASE_INCLUDES) {
            const options = { year: y, policies: p, include: i };
            expect(JSON.stringify(buildHouseholdRequest(inputs, options)), example.id).toBe(
              JSON.stringify(reference.buildHouseholdRequest(inputs, options)),
            );
          }
        }
      }
    }
  });

  it("reads State Pension age from this page's state_pension.json", () => {
    for (const y of [0, 2025, ...POLICY_YEARS, 2040]) {
      expect(statePensionFor(y)).toEqual(reference.statePensionFor(y));
      for (const age of [null, 60, 65, 66, 67, 68]) {
        expect(atStatePensionAge(age, y)).toBe(reference.atStatePensionAge(age, y));
      }
    }
    const [first] = Object.keys(statePensionTable.years);
    expect(statePensionFor(Number(first)).age).toBe(statePensionTable.years[first].state_pension_age);
  });
});

describe("the form's answers and the shared draft", () => {
  it("carry the same household both ways", () => {
    fc.assert(
      fc.property(answers, year, (inputs, y) => {
        const draft = draftFromAnswers(inputs);
        const again = answersFromDraft(draft);
        // The children's text is read once: the ages it parses, then the
        // same ages written back
        expect(parseChildrenAges(again.children_ages)).toEqual(parseChildrenAges(inputs.children_ages));
        const options = { year: y, policies: ["a"], statePension: statePensionTable };
        expect(JSON.stringify(toHouseholdImpactRequest(draftFromAnswers(again), options))).toBe(
          JSON.stringify(toHouseholdImpactRequest(draft, options)),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("make the starting answers the shared model's typical household", () => {
    // The constituency is the form's own: it sets the region, and is not sent
    const { constituency, ...answers } = WIZARD_DEFAULTS;
    expect(constituency).toBeNull();
    const draft = draftFromAnswers(WIZARD_DEFAULTS);
    expect(answersFromDraft(draft)).toEqual(answers);
    expect(Object.keys(answersFromDraft(draft))).toEqual(Object.keys(answers));
  });

  it("validate every example in every year, and keep its request through a link", () => {
    for (const example of [{ id: "defaults", inputs: {} }, ...HOUSEHOLD_EXAMPLES]) {
      const draft = draftFromAnswers({ ...WIZARD_DEFAULTS, ...example.inputs });
      for (const y of POLICY_YEARS) {
        const result = validate(draft, { year: y, years: POLICY_YEARS, statePension: statePensionTable });
        expect(result.issues, `${example.id} ${y}`).toEqual([]);
        const options = { year: y, policies: ["a"], statePension: statePensionTable };
        expect(JSON.stringify(toHouseholdImpactRequest(deserializeDraft(serializeDraft(draft)), options))).toBe(
          JSON.stringify(toHouseholdImpactRequest(draft, options)),
        );
      }
    }
  });
});

describe("the form's questions and the shared model", () => {
  it("offer only the shared model's codes", () => {
    expect(REGION_OPTIONS).toEqual(UK_REGIONS.map(({ code, name }) => [code, name]));
    // The region is set by the constituency picked
    const regions = UK_REGIONS.map(({ code }) => code);
    for (const seat of CONSTITUENCIES) expect(regions, seat.name).toContain(seat.region);
    const values = (id) => CHOICE_CONFIGS[id].options.map((option) => option.value);
    expect([...values("tenure")].sort()).toEqual([...UK_TENURES].sort());
    expect(values("student_loan_plan")).toEqual([...UK_STUDENT_LOAN_PLANS]);
    // Band I is Wales's top band; the form offers A to H
    for (const band of values("council_tax_band")) expect(UK_COUNCIL_TAX_BANDS).toContain(band);
  });

  it("keep every box within the API's limits", () => {
    const limits = UK_HOUSEHOLD_LIMITS;
    const within = (id, max, min = 0) => {
      expect(NUMBER_CONFIGS[id].min, id).toBeGreaterThanOrEqual(min);
      expect(NUMBER_CONFIGS[id].max, id).toBeLessThanOrEqual(max);
    };
    within("current_age", limits.adultAge.max, limits.adultAge.min);
    within("partner_age", limits.adultAge.max, limits.adultAge.min);
    for (const id of [
      "current_salary",
      "partner_salary",
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "private_pension_per_year",
      "partner_private_pension_per_year",
      "salary_sacrifice_per_year",
    ]) {
      within(id, limits.maxAmount);
    }
    within("monthly_rent", limits.maxMonthlyRent);
    within("monthly_childcare", limits.maxMonthlyChildcare);
    for (const id of ["petrol_spending_per_year", "diesel_spending_per_year", "electricity_spending_per_year"]) {
      within(id, limits.maxSpending);
    }
    within("state_pension_per_year", limits.maxStatePension);
    within("partner_state_pension_per_year", limits.maxStatePension);
    const childCounts = CHOICE_CONFIGS.children_count.options.map((option) => option.value);
    expect(Math.max(...childCounts)).toBeLessThanOrEqual(limits.maxChildren);
    expect(OLDEST_CHILD_AGE).toBe(limits.childAge.max);
  });

  it("make a household the API accepts from any answers within the boxes", () => {
    const box = (id) => {
      const { min, max } = NUMBER_CONFIGS[id];
      return fc.integer({ min, max });
    };
    const choice = (id) => fc.constantFrom(...CHOICE_CONFIGS[id].options.map((option) => option.value));
    const form = fc.record({
      current_age: box("current_age"),
      current_salary: box("current_salary"),
      // The constituency picked, or none: it sets the region, as the form does
      seat: fc.option(fc.constantFrom(...CONSTITUENCIES), { nil: null }),
      tenure: choice("tenure"),
      monthly_rent: fc.option(box("monthly_rent"), { nil: null }),
      student_loan_plan: choice("student_loan_plan"),
      has_partner: fc.boolean(),
      partner_age: box("partner_age"),
      partner_salary: box("partner_salary"),
      children_ages: fc
        .array(fc.integer({ min: 0, max: OLDEST_CHILD_AGE }), { maxLength: Math.max(...CHOICE_CONFIGS.children_count.options.map((o) => o.value)) })
        .map((ages) => ages.join(", ")),
      children_in_education: fc.array(fc.boolean(), { maxLength: 6 }),
      claims_universal_credit: choice("claims_universal_credit"),
      council_tax_band: choice("council_tax_band"),
      salary_sacrifice_per_year: box("salary_sacrifice_per_year"),
      petrol_spending_per_year: box("petrol_spending_per_year"),
      diesel_spending_per_year: box("diesel_spending_per_year"),
      electricity_spending_per_year: box("electricity_spending_per_year"),
      dividends_per_year: box("dividends_per_year"),
      savings_interest_per_year: box("savings_interest_per_year"),
      property_income_per_year: box("property_income_per_year"),
      private_pension_per_year: box("private_pension_per_year"),
      partner_private_pension_per_year: box("partner_private_pension_per_year"),
      monthly_childcare: box("monthly_childcare"),
      state_pension_per_year: fc.option(box("state_pension_per_year"), { nil: null }),
      partner_state_pension_per_year: fc.option(box("partner_state_pension_per_year"), { nil: null }),
    }).map(({ seat, ...answers }) => ({
      ...answers,
      constituency: seat?.name ?? null,
      region: seat?.region ?? WIZARD_DEFAULTS.region,
    }));
    fc.assert(
      fc.property(form, fc.constantFrom(...POLICY_YEARS), (inputs, y) => {
        const result = validate(draftFromAnswers(inputs), { year: y, years: POLICY_YEARS, statePension: statePensionTable });
        expect(result.issues).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("the shared model's limits, against the API's own", () => {
  const api = readFileSync(join(ROOT, "src/uk_budget_data/api.py"), "utf8");
  const impact = readFileSync(join(ROOT, "src/uk_budget_data/household_impact.py"), "utf8");
  const constant = (source, name) => Number(source.match(new RegExp(`^${name} = ([0-9_]+)$`, "m"))[1].replaceAll("_", ""));
  const value = (text) => {
    if (text === "MAX_AMOUNT") return constant(api, "MAX_AMOUNT");
    if (text === "household_impact.OLDEST_CHILD_AGE") return constant(impact, "OLDEST_CHILD_AGE");
    return Number(text.replaceAll("_", ""));
  };
  const model = (name) => {
    const start = api.indexOf(`class ${name}(BaseModel):`);
    return api.slice(start, api.indexOf("\nclass ", start + 1));
  };
  // A field's line and the lines of its Field(...) under it
  const bounds = (name, field) => {
    const text = model(name).match(new RegExp(`\\n    ${field}: [^\\n]*(?:\\n(?!    \\S)[^\\n]*)*`))[0];
    const read = (key) => {
      const found = text.match(new RegExp(`\\b${key}=([\\w.]+)`));
      return found ? value(found[1]) : undefined;
    };
    return { ge: read("ge"), le: read("le"), maxLength: read("max_length") };
  };
  const tuple = (name) =>
    [...impact.match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"))[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
  const limits = UK_HOUSEHOLD_LIMITS;

  it("bound every answer as api.py does", () => {
    const household = (field) => bounds("HouseholdAnswersRequest", field);
    expect(household("age")).toMatchObject({ ge: limits.adultAge.min, le: limits.adultAge.max });
    expect(household("partner_age")).toMatchObject({ ge: limits.adultAge.min, le: limits.adultAge.max });
    for (const field of [
      "employment_income",
      "partner_employment_income",
      "dividend_income",
      "savings_interest_income",
      "property_income",
      "private_pension_income",
      "partner_private_pension_income",
      "salary_sacrifice_pension_contributions",
    ]) {
      expect(household(field), field).toMatchObject({ ge: 0, le: limits.maxAmount });
    }
    expect(household("monthly_rent")).toMatchObject({ ge: 0, le: limits.maxMonthlyRent });
    expect(household("monthly_childcare")).toMatchObject({ ge: 0, le: limits.maxMonthlyChildcare });
    for (const field of ["petrol_spending", "diesel_spending", "electricity_spending"]) {
      expect(household(field), field).toMatchObject({ ge: 0, le: limits.maxSpending });
    }
    for (const field of ["state_pension", "partner_state_pension"]) {
      expect(household(field), field).toMatchObject({ ge: 0, le: limits.maxStatePension });
    }
    expect(household("children").maxLength).toBe(limits.maxChildren);
    expect(bounds("HouseholdChildRequest", "age")).toMatchObject({ ge: limits.childAge.min, le: limits.childAge.max });
  });

  it("know the regions and tenures household_impact.py does, and the policy years", () => {
    expect(tuple("REGIONS")).toEqual(UK_REGIONS.map((region) => region.code));
    expect([...tuple("TENURES")].sort()).toEqual([...UK_TENURES].sort());
    expect(POLICY_YEARS).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    // validate() checks these years unless told others
    expect(UK_POLICY_YEARS).toEqual(POLICY_YEARS);
  });
});
