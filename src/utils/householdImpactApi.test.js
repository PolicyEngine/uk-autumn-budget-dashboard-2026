import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  DefinitionMismatchError,
  EngineMismatchError,
  HouseholdApiError,
  STAGE_ENGINE_PACKAGES,
  StageMismatchError,
  UNREGISTERED,
  atStatePensionAge,
  buildHouseholdRequest,
  consistentRound,
  definitionRefusals,
  engineDifferences,
  mergeStages,
  normaliseHouseholdImpact,
  postHouseholdImpact,
  requestKey,
  stageMismatch,
  statePensionFor,
  unregisteredMeasures,
} from "./householdImpactApi";
import contract from "./publication/contract.json";
import { definitionDifferences } from "./publication/definitions";
import { approvedDefinition, requestedDefinitions, route } from "../test/definitionsFixture";
import {
  areaName,
  groupTotals,
  headlineVerb,
  pinnedRound,
  policyRows,
  programmeGroups,
  programmeNotes,
  roundProgrammeGroups,
} from "./singleYear";
import { headlineTotals } from "../components/personal/SingleYearResults";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { DEFAULT_SALARY, REGIONAL_RENT } from "./householdDefaults";
import { HOUSEHOLD_FIXTURE } from "../test/householdFixture";
import { POLICIES_FOR_TEST } from "../test/personalPolicies";

describe("buildHouseholdRequest", () => {
  it("asks 16- to 19-year-olds' education, yes until answered, and keeps a child of 20 for the API to refuse", () => {
    const body = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, children_ages: "15, 16, 18, 19, 20", children_in_education: [true, true, false] },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(body.household.children).toEqual([
      { age: 15 },
      { age: 16, in_education: true },
      { age: 18, in_education: false },
      { age: 19, in_education: true },
      { age: 20 },
    ]);
  });

  it("sends private pensions, the partner's only with a partner", () => {
    const single = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, private_pension_per_year: 10000, partner_private_pension_per_year: 5000 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(single.household.private_pension_income).toBe(10000);
    expect(single.household.partner_private_pension_income).toBe(0);
    const couple = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, has_partner: true, partner_private_pension_per_year: 5000 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(couple.household.private_pension_income).toBe(0);
    expect(couple.household.partner_private_pension_income).toBe(5000);
  });


  it("sends rent only for renters and childcare only with children", () => {
    const owner = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, tenure: "OWNED_OUTRIGHT", monthly_rent: 900, monthly_childcare: 400 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(owner.household.monthly_rent).toBe(0);
    expect(owner.household.monthly_childcare).toBe(0);
    const family = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, children_ages: "4, 7", monthly_childcare: 400, has_partner: true },
      { year: 2029, policies: ["two_child_limit"], include: ["by_policy"] },
    );
    // Rent left as prefilled: the region's average private rent (ONS)
    expect(family.household).toMatchObject({
      children: [{ age: 4 }, { age: 7 }],
      monthly_childcare: 400,
      region: "NORTH_WEST",
      monthly_rent: REGIONAL_RENT.NORTH_WEST,
      partner_employment_income: DEFAULT_SALARY,
    });
    const entered = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, region: "LONDON", monthly_rent: 1200 },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(entered.household.monthly_rent).toBe(1200);
    const london = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, region: "LONDON" },
      { year: 2029, policies: ["two_child_limit"] },
    );
    expect(london.household.monthly_rent).toBe(REGIONAL_RENT.LONDON);
    expect(family.include).toEqual(["by_policy"]);
    // Only fields the API's HouseholdAnswersRequest takes (it refuses others)
    expect(Object.keys(family.household).sort()).toEqual(
      [
        "age",
        "employment_income",
        "has_partner",
        "partner_age",
        "partner_employment_income",
        "children",
        "region",
        "claims_universal_credit",
        "tenure",
        "monthly_rent",
        "dividend_income",
        "electricity_spending",
        "savings_interest_income",
        "property_income",
        "private_pension_income",
        "partner_private_pension_income",
        "petrol_spending",
        "diesel_spending",
        "salary_sacrifice_pension_contributions",
        "student_loan_plan",
        "council_tax_band",
        "monthly_childcare",
        "salary_year",
      ].sort(),
    );
    // The stage is not part of the cache key
    expect(requestKey(family)).toBe(requestKey({ ...family, include: [] }));
  });

  it("sends a State Pension only as entered, and only at State Pension age", () => {
    const { age, full } = statePensionFor(2029);
    expect(age).toBe(67);
    expect(full).toBeCloseTo(13696.98, 2);
    expect(atStatePensionAge(67, 2029)).toBe(true);
    expect(atStatePensionAge(66, 2029)).toBe(false);
    expect(atStatePensionAge(66, 2026)).toBe(true);
    const options = { year: 2029, policies: ["two_child_limit"] };
    // Left as prefilled: not sent, so the API uses the year's full rate
    const prefilled = buildHouseholdRequest({ ...WIZARD_DEFAULTS, current_age: 72 }, options);
    expect(prefilled.household).not.toHaveProperty("state_pension");
    const entered = buildHouseholdRequest(
      {
        ...WIZARD_DEFAULTS,
        current_age: 72,
        state_pension_per_year: 9000,
        has_partner: true,
        partner_age: 70,
        partner_state_pension_per_year: 6000,
      },
      options,
    );
    expect(entered.household).toMatchObject({ state_pension: 9000, partner_state_pension: 6000 });
    // Under State Pension age, or with no partner, it is not sent
    const young = buildHouseholdRequest(
      { ...WIZARD_DEFAULTS, current_age: 66, state_pension_per_year: 9000, partner_state_pension_per_year: 6000 },
      options,
    );
    expect(young.household).not.toHaveProperty("state_pension");
    expect(young.household).not.toHaveProperty("partner_state_pension");
  });
});

describe("consistentRound", () => {
  it("rounds rows so they add up to the rounded total", () => {
    // Naive rounding gives 0 + 0 + 0 = 0, not 1
    expect(consistentRound([0.4, 0.4, 0.4], 1.2)).toEqual([1, 0, 0]);
    expect(consistentRound([-0.4, -0.4, -0.4], -1.2)).toEqual([-1, 0, 0]);
    const rounded = consistentRound([-143.64, -147.15, -36, 40], -286.79);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(-287);
  });
});

describe("normaliseHouseholdImpact", () => {
  it("reads the API's answer: baseline and reform, the salary used, and each part", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    expect(data.net).toEqual({ before: 65370.9, after: 69135.74, change: 3764.84 });
    expect(data.salaryUsed).toBe(34192.26);
    expect(data.partnerSalaryUsed).toBe(12822.1);
    expect(data.notModelled).toEqual([expect.objectContaining({ id: "rail_fares_freeze", name: "Rail fares freeze" })]);
    expect(data.byPolicy.measures).toHaveLength(8);
    expect(data.byPolicy.residual).toBe(0.04);
    expect(data.sweep.points).toHaveLength(50);
    expect(data.sweep.rates).toHaveLength(49);
    expect(data.sweep.max).toBe(150000);
    expect(data.sweep.own).toMatchObject({ income: 34192.26, after: 69135.74, afterRate: 0.6765 });
    expect(data.area).toEqual({ region: "NORTH_WEST", brma: "CENTRAL_GREATER_MANCHESTER", brmaDefault: true });
    expect(data.engine.policyengine).toBeTruthy();
    // The headline stage: the slow parts are null, not missing
    const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, by_policy: null, sweep: null });
    expect(headline.byPolicy).toBeNull();
    expect(headline.sweep).toBeNull();
  });

  it("reads the marginal rate's parts when the API sends them, and none when it does not", () => {
    expect(normaliseHouseholdImpact(HOUSEHOLD_FIXTURE).sweep.parts).toBeNull();
    const steps = HOUSEHOLD_FIXTURE.sweep.marginal_rates.map((rate) => ({
      income_tax: 0.2,
      national_insurance: 0.08,
      other: rate.reform - 0.28,
    }));
    const data = normaliseHouseholdImpact({
      ...HOUSEHOLD_FIXTURE,
      sweep: {
        ...HOUSEHOLD_FIXTURE.sweep,
        marginal_rate_parts: {
          parts: ["income_tax", "national_insurance", "other"],
          baseline: steps,
          reform: steps,
          own_point: {
            baseline: { income_tax: 0.2, national_insurance: 0.08, other: 0 },
            reform: { income_tax: 0.2, national_insurance: 0.08, other: 0 },
          },
        },
      },
    });
    const parts = data.sweep.parts;
    expect(parts.names).toEqual(["income_tax", "national_insurance", "other"]);
    expect(parts.after).toHaveLength(data.sweep.rates.length);
    expect(parts.after[0]).toEqual({ income_tax: 0.2, national_insurance: 0.08, other: steps[0].other });
    expect(parts.own.after).toEqual({ income_tax: 0.2, national_insurance: 0.08, other: 0 });
  });
});

// Review of 428d209, finding 2: a breakdown from one deployment was merged
// under a headline from another, and kept the headline's engine label.
describe("the household answer's package versions", () => {
  const ENGINE = HOUSEHOLD_FIXTURE.engine;
  const stage = (engine, change, parts) => normaliseHouseholdImpact({
    ...HOUSEHOLD_FIXTURE,
    engine,
    net_income: { ...HOUSEHOLD_FIXTURE.net_income, change },
    ...parts,
  });

  it("refuses to merge stages from different package versions", () => {
    const headline = stage(ENGINE, 100, { by_policy: null, sweep: null });
    const detail = stage({ ...ENGINE, "policyengine-uk": "9.9.9" }, 999, {});
    expect(() => mergeStages(headline, detail)).toThrow(EngineMismatchError);
    try {
      mergeStages(headline, detail);
    } catch (error) {
      expect(error.packages).toEqual(["policyengine-uk"]);
      expect(error.kind).toBe("engine");
    }
    // The same versions merge as before
    const merged = mergeStages(headline, stage(ENGINE, 100, {}));
    expect(merged.byPolicy).not.toBeNull();
    expect(merged.engine).toEqual(ENGINE);
  });

  const versions = fc.dictionary(
    fc.constantFrom("policyengine", "policyengine-uk", "policyengine-core"),
    fc.stringMatching(/^[0-9]{1,2}\.[0-9]{1,3}\.[0-9]{1,2}$/),
    { minKeys: 1 },
  );

  it("names exactly the expected packages the API reports otherwise", () => {
    fc.assert(fc.property(versions, versions, fc.dictionary(fc.constantFrom("uk_budget_data"), fc.string()), (expected, other, extra) => {
      // Matching versions, plus packages no receipt records: nothing differs
      expect(engineDifferences(expected, { ...expected, ...extra })).toEqual([]);
      const reported = { ...expected, ...other };
      const differ = engineDifferences(expected, reported);
      expect(differ).toEqual(Object.keys(expected).filter((name) => reported[name] !== expected[name]).sort());
      // A package the API leaves out always differs
      for (const name of Object.keys(expected)) {
        const missing = { ...reported };
        delete missing[name];
        expect(engineDifferences(expected, missing)).toContain(name);
      }
    }));
  });

  // Review of e9d7c76, finding 1: the Modal build reports no uk_budget_data
  // version and Cloud Run reports one, so comparing it refused every
  // calculation. The stages compare the model packages only, and each must
  // be reported. Review of d2ec6f2: the oracle names the three packages
  // itself, so dropping one from STAGE_ENGINE_PACKAGES fails here.
  const MODEL_PACKAGES = ["policyengine", "policyengine-core", "policyengine-uk"];
  const project = fc.option(fc.constantFrom("0.1.0", "0.2.0"), { nil: null });
  it("merges two stages exactly when they report the same model packages", () => {
    expect([...STAGE_ENGINE_PACKAGES].sort()).toEqual(MODEL_PACKAGES);
    fc.assert(fc.property(versions, versions, fc.boolean(), project, project, (first, random, same, ownA, ownB) => {
      const second = same ? { ...first } : random;
      const headline = stage({ ...first, uk_budget_data: ownA }, 1, { by_policy: null, sweep: null });
      const detail = stage({ ...second, uk_budget_data: ownB }, 1, {});
      const agree = MODEL_PACKAGES.every((name) => typeof first[name] === "string" && first[name] === second[name]);
      if (agree) expect(mergeStages(headline, detail).engine).toEqual(headline.engine);
      else expect(() => mergeStages(headline, detail)).toThrow(StageMismatchError);
    }));
  });

  // Review of e9d7c76, finding 3, and of d2ec6f2, finding 2: net income is
  // compared in whole pennies, so £10,000.00 and £10,000.01 agree although
  // their float difference is just over 0.01
  const full = { policyengine: "6.10.2", "policyengine-core": "3.33.3", "policyengine-uk": "2.132.6" };
  const withNet = (baseline, reform, parts = {}) => normaliseHouseholdImpact({
    ...HOUSEHOLD_FIXTURE,
    engine: full,
    net_income: { baseline, reform, change: reform - baseline },
    ...parts,
  });
  it("accepts a breakdown within a penny of the headline's net income, either way, and refuses two pennies", () => {
    const headline = withNet(10000, 10000, { by_policy: null, sweep: null });
    for (const reform of [10000, 10000.01, 9999.99]) {
      expect(stageMismatch(headline, withNet(10000, reform))).toBeNull();
    }
    for (const reform of [10000.02, 9999.98]) {
      expect(stageMismatch(headline, withNet(10000, reform)).packages).toEqual(["net_income"]);
    }
    for (const baseline of [10000.01, 9999.99]) {
      expect(stageMismatch(headline, withNet(baseline, 10000))).toBeNull();
    }
    for (const baseline of [10000.02, 9999.98]) {
      expect(stageMismatch(headline, withNet(baseline, 10000)).packages).toEqual(["net_income"]);
    }
  });

  it("refuses a breakdown whose net income differs from the headline's by more than a penny", () => {
    const raw = { ...HOUSEHOLD_FIXTURE, engine: full };
    const headline = normaliseHouseholdImpact({ ...raw, by_policy: null, sweep: null });
    const shifted = (shift) => normaliseHouseholdImpact({ ...raw, net_income: { ...raw.net_income, change: raw.net_income.change + shift, reform: raw.net_income.reform + shift } });
    // Whole pennies: one either way agrees, two or more doesn't
    fc.assert(fc.property(fc.integer({ min: -500000, max: 500000 }), (n) => {
      const detail = shifted(n / 100);
      if (Math.abs(n) <= 1) expect(mergeStages(headline, detail).engine).toEqual(full);
      else {
        expect(() => mergeStages(headline, detail)).toThrow(StageMismatchError);
        expect(stageMismatch(headline, detail).packages).toEqual(["net_income"]);
      }
    }));
    // Any amount: under a penny agrees, two pennies or more doesn't
    fc.assert(fc.property(fc.double({ min: -5000, max: 5000, noNaN: true }), (shift) => {
      const detail = shifted(shift);
      if (Math.abs(shift) < 0.01) expect(stageMismatch(headline, detail)).toBeNull();
      if (Math.abs(shift) >= 0.02) expect(stageMismatch(headline, detail).packages).toEqual(["net_income"]);
    }));
  });

  // Review of d2ec6f2, finding 1: two builds with the same package versions
  // can agree on this household's net income and still differ elsewhere on
  // its earnings sweep (a threshold change above its earnings). Only the
  // build commit tells them apart.
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const otherSweep = (sweep) => ({
    ...sweep,
    points: sweep.points.map((point, i) => (i === sweep.points.length - 1 ? { ...point, reform: point.reform - 250, change: point.change - 250 } : point)),
  });
  it("refuses a breakdown from another build commit even when net income agrees", () => {
    const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A, by_policy: null, sweep: null });
    const older = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: B, sweep: otherSweep(HOUSEHOLD_FIXTURE.sweep) });
    expect(older.net).toEqual(headline.net);
    expect(older.engine).toEqual(headline.engine);
    expect(stageMismatch(headline, older).packages).toEqual(["build"]);
    expect(() => mergeStages(headline, older)).toThrow(StageMismatchError);
    const same = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A });
    expect(mergeStages(headline, same).sweep).toEqual(same.sweep);
    expect(mergeStages(headline, same).build).toBe(A);
  });

  it("keeps the build commit an answer reports, and none for a missing or empty one", () => {
    expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A }).build).toBe(A);
    expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A }).builds).toEqual([A]);
    for (const git_sha of [undefined, null, ""]) {
      expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha }).build).toBeNull();
      expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha }).builds).toEqual([]);
    }
  });

  // Review of e78fbf4: a malformed commit matched an identical malformed one
  it("matches a malformed commit with nothing, not even itself", () => {
    const headline = (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, by_policy: null, sweep: null });
    const part = (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha });
    for (const bad of [7, "abc", "A".repeat(40), "a".repeat(39), ` ${A}`]) {
      expect(stageMismatch(headline(bad), part(bad)).packages).toEqual(["build"]);
      expect(stageMismatch(headline(A), part(bad)).packages).toEqual(["build"]);
      expect(stageMismatch(headline(bad), part(A)).packages).toEqual(["build"]);
      expect(stageMismatch(headline(null), part(bad), { sameBuild: true }).packages).toEqual(["build"]);
    }
    // A 64-character commit (a SHA-256 repository) is well formed
    const long = "f".repeat(64);
    expect(stageMismatch(headline(long), part(long), { sameBuild: true })).toBeNull();
  });

  // Review of cc15d50, finding 2: a malformed commit passed beside answers
  // that report none, though invariant 7 says every reported commit is one
  // well-formed commit
  it("refuses a malformed commit beside answers that report none", () => {
    const headline = (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, by_policy: null, sweep: null });
    const sweep = (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, by_policy: null });
    const split = (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, sweep: null });
    for (const bad of [7, "not-a-commit", "A".repeat(40)]) {
      // A malformed headline, a part with none
      expect(stageMismatch(headline(bad), sweep(null)).packages).toEqual(["build"]);
      expect(() => mergeStages(headline(bad), sweep(null))).toThrow(StageMismatchError);
      // No headline commit, a malformed part
      expect(stageMismatch(headline(null), sweep(bad)).packages).toEqual(["build"]);
      // A malformed part already merged under a headline with none (as an
      // older build would have let through), then a part with none
      const half = { ...mergeStages(headline(null), sweep(null)), builds: [{ malformed: String(bad) }] };
      expect(stageMismatch(half, split(null)).packages).toEqual(["build"]);
    }
    // Answers that all report none still merge
    expect(mergeStages(mergeStages(headline(null), sweep(null)), split(null)).builds).toEqual([]);
  });

  // Review of e78fbf4, finding 2: under a headline that reports no commit,
  // a sweep from one Cloud Run revision and a split from another each
  // passed against the headline's null, and made a complete result
  it("never puts two parts from different commits together, under any headline", () => {
    const parts = {
      sweep: (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, by_policy: null }),
      byPolicy: (git_sha) => normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha, sweep: null }),
    };
    for (const headlineBuild of [null, A]) {
      const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: headlineBuild, by_policy: null, sweep: null });
      for (const [firstPart, secondPart] of [["sweep", "byPolicy"], ["byPolicy", "sweep"]]) {
        for (const [one, two] of [[A, B], [B, A]]) {
          if (headlineBuild !== null && one !== headlineBuild) {
            expect(() => mergeStages(headline, parts[firstPart](one))).toThrow(StageMismatchError);
            continue;
          }
          const half = mergeStages(headline, parts[firstPart](one));
          // The headline's own commit is kept apart from what its parts reported
          expect(half.build).toBe(headlineBuild);
          expect(half.builds).toEqual([one]);
          expect(() => mergeStages(half, parts[secondPart](two))).toThrow(StageMismatchError);
          expect(stageMismatch(half, parts[secondPart](two)).packages).toEqual(["build"]);
          // The same commit, or none, completes it
          expect(mergeStages(half, parts[secondPart](one)).builds).toEqual([one]);
          expect(mergeStages(half, parts[secondPart](null)).builds).toEqual([one]);
        }
      }
    }
  });

  it("never lets a part's commit stand in for a headline that reports none", () => {
    const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: null, by_policy: null, sweep: null });
    const half = mergeStages(headline, normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A, by_policy: null }));
    // A retry from this partial result still refuses the detail service
    const modal = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: A, sweep: null });
    expect(stageMismatch(half, modal, { sameBuild: true }).packages).toEqual(["build"]);
    expect(stageMismatch(half, modal)).toBeNull();
  });

  // Every reported commit, the headline's and each part's in turn, must be
  // one well-formed commit; answers that report none are compared on the
  // rest, and a malformed one refuses the next part whatever it reports.
  // The oracle reads only the raw answers.
  it("merges a sequence of parts exactly when every commit they report is one", () => {
    const raw = fc.constantFrom(null, A, B, "not-a-commit");
    fc.assert(fc.property(raw, fc.array(raw, { minLength: 1, maxLength: 4 }), (headlineSha, partShas) => {
      let result = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: headlineSha, by_policy: null, sweep: null });
      let refused = false;
      for (const git_sha of partShas) {
        try {
          result = mergeStages(result, normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha }));
        } catch (error) {
          expect(error).toBeInstanceOf(StageMismatchError);
          refused = true;
          break;
        }
      }
      // Up to the first refusal, in order: each part is merged only if the
      // commits reported so far and its own are all one well-formed commit
      const wellFormed = (sha) => /^[0-9a-f]{40}$/.test(sha);
      let expectRefused = false;
      const reported = headlineSha === null ? [] : [headlineSha];
      for (const sha of partShas) {
        const identities = sha === null ? reported : [...reported, sha];
        if (!identities.every((seen) => wellFormed(seen) && seen === identities[0])) {
          expectRefused = true;
          break;
        }
        if (sha !== null) reported.push(sha);
      }
      expect(refused).toBe(expectRefused);
      if (!refused) expect(result.build).toEqual(headlineSha === "not-a-commit" ? { malformed: headlineSha } : headlineSha);
    }));
  });

  // The detail service's answers (sameBuild) must report the headline's
  // commit. The main API's need only agree where both report one, as a build
  // older than the commit field reports none.
  it("matches build commits exactly as the stage rules say", () => {
    const build = fc.constantFrom(null, A, B);
    fc.assert(fc.property(build, build, fc.boolean(), (first, second, sameBuild) => {
      const headline = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: first, by_policy: null, sweep: null });
      const detail = normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, git_sha: second });
      const agree = first !== null && second !== null ? first === second : !sameBuild;
      const mismatch = stageMismatch(headline, detail, { sameBuild });
      if (agree) expect(mismatch).toBeNull();
      else expect(mismatch.packages).toEqual(["build"]);
    }));
  });
});

describe("policyRows", () => {
  const POLICIES = POLICIES_FOR_TEST;
  const measure = (id, change) => ({ id, change, status: change === 0 ? "not_affected" : "affected" });

  it("gives each measure its own bar, adding up to the tile, from the fixture", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const change = Math.round(data.net.after) - Math.round(data.net.before);
    const { rows, noEffect, underAPound } = policyRows(data.byPolicy, change, POLICIES);
    expect(rows.map((row) => [row.id, row.rounded])).toEqual([
      ["two_child_limit", 3882],
      ["threshold_freeze_extension", -95],
      ["salary_sacrifice_cap", -24],
      ["fuel_duty_freeze", 2],
    ]);
    expect(rows.reduce((sum, row) => sum + row.rounded, 0)).toBe(change);
    // The residual (4p) is under £1: no interaction row
    expect(rows.some((row) => row.id === "interaction")).toBe(false);
    expect(noEffect).toContain("Dividend tax increase (+2pp)");
    expect(underAPound).toEqual([]);
  });

  it("shows the interaction between policies from £1, so the bars still add up", () => {
    const byPolicy = {
      measures: [measure("threshold_freeze_extension", -100.4), measure("two_child_limit", 400.2), measure("fuel_duty_freeze", 0)],
      residual: -20.3,
    };
    const { rows, noEffect } = policyRows(byPolicy, 279.5, POLICIES);
    expect(rows.map((row) => [row.name, row.rounded])).toEqual([
      ["2 child limit repeal", 400],
      ["Threshold freeze extension", -100],
      ["Interaction between policies", -20],
    ]);
    expect(noEffect).toEqual(["Fuel duty freeze extension"]);
    const small = policyRows({ ...byPolicy, residual: 0.6 }, 300.4, POLICIES);
    expect(small.rows.some((row) => row.id === "interaction")).toBe(false);
    expect(small.rows.reduce((sum, row) => sum + row.rounded, 0)).toBe(300);
  });

  it("notes an employer cost apart from no effect, and the Warm Home Discount if received", () => {
    const byPolicy = normaliseHouseholdImpact({
      ...HOUSEHOLD_FIXTURE,
      by_policy: {
        measures: [
          {
            id: "employer_ni_relief_under_25s",
            name: "Employer NI relief for under-25s",
            change: 0,
            status: "not_affected",
            note: "No household effect (employer cost): wages are held fixed.",
            note_kind: "employer_cost",
          },
          {
            id: "warm_home_discount_top_up",
            name: "Warm Home Discount top-up",
            change: 100,
            status: "affected",
            note: "If received: £100.",
            note_kind: "if_received",
          },
        ],
        combined: 100,
        sum_of_singles: 100,
        residual: 0,
      },
    }).byPolicy;
    const { rows, noEffect, notes } = policyRows(byPolicy, 100, POLICIES);
    expect(rows.map((row) => [row.id, row.rounded])).toEqual([["warm_home_discount_top_up", 100]]);
    expect(noEffect).toEqual([]);
    expect(notes.map((note) => [note.id, note.kind])).toEqual([
      ["employer_ni_relief_under_25s", "employer_cost"],
      ["warm_home_discount_top_up", "if_received"],
    ]);
    expect(notes[0].text).toMatch(/^No household effect \(employer cost\)/);
    // Not received: no "if received" note
    const none = policyRows(
      { ...byPolicy, measures: byPolicy.measures.map((row) => ({ ...row, change: 0, status: "not_affected" })) },
      0,
      POLICIES,
    );
    expect(none.notes.map((note) => note.id)).toEqual(["employer_ni_relief_under_25s"]);
  });

  it("lists a measure worth under £1 apart from those with no effect", () => {
    const { rows, underAPound } = policyRows(
      { measures: [measure("two_child_limit", 50), measure("fuel_duty_freeze", 0.3)], residual: 0 },
      50.3,
      POLICIES,
    );
    expect(rows.map((row) => row.id)).toEqual(["two_child_limit"]);
    expect(underAPound).toEqual(["Fuel duty freeze extension"]);
  });
});

describe("consistentRound", () => {
  it("does not move a row by more than £1", () => {
    expect(consistentRound([3881.89, -95.05, -24.42, 2.37], 3765)).toEqual([3882, -95, -24, 2]);
  });
});

describe("programmeGroups", () => {
  it("shows taxes as negative amounts, in sentence case, and hides rows that are £0 throughout", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const groups = programmeGroups(data.programmes);
    // Spring Statement's top rows, in its order; pension contributions from
    // pay are a row of their own when the household has them
    expect(groups.map((group) => group.label)).toEqual(["Market income", "Taxes", "Benefits"]);
    const tax = groups.find((group) => group.id === "tax").rows.find((row) => row.id === "income_tax");
    expect(tax.label).toBe("Income tax");
    expect(tax.before).toBeCloseTo(-4163.65);
    expect(tax.change).toBeCloseTo(-196.18);
    const ids = groups.flatMap((group) => group.rows).map((row) => row.id);
    expect(ids).not.toContain("housing_benefit");
    // 4p of other taxes rounds to £0 and is hidden
    expect(ids).not.toContain("other_taxes");
    expect(ids).toContain("free_childcare");
  });

  it("adds up to the tiles' net income, before and after", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const all = data.programmes;
    const sign = { tax: -1, benefit: 1, income: 1 };
    for (const side of ["before", "after"]) {
      const total = all.reduce((sum, row) => sum + sign[row.group] * row[side], 0);
      expect(total).toBeCloseTo(data.net[side], 1);
    }
  });

  it("keeps a note only for a row it shows", () => {
    const groups = programmeGroups(normaliseHouseholdImpact(HOUSEHOLD_FIXTURE).programmes);
    expect(programmeNotes(groups).map((item) => item.id)).toEqual(["employment_income", "fuel_duty", "universal_credit", "free_childcare"]);
  });

  it("drops employment income's pay-cut note in a year without the pay cut", () => {
    const programmes = HOUSEHOLD_FIXTURE.programmes.map((row) =>
      row.id === "employment_income"
        ? { ...row, reform: row.baseline, change: 0, children: row.children.map((child) => ({ ...child, reform: 0, change: 0 })) }
        : row,
    );
    const groups = programmeGroups(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, programmes }).programmes);
    expect(programmeNotes(groups).map((item) => item.id)).not.toContain("employment_income");
  });
});

describe("the programme table's whole pounds", () => {
  // A pensioner: fuel duty falls by £3.60 under the freeze, income tax rises
  // by £2.40 under the dividend rate. Each rounded on its own, the table
  // said +£4 and −£2 against a tile of +£1, and fuel duty's bar said +£3.
  const byPolicy = {
    measures: [
      { id: "fuel_duty_freeze", name: "Fuel duty freeze", change: 3.6, status: "affected" },
      { id: "dividend_tax_increase_2pp", name: "Dividend tax", change: -2.4, status: "affected" },
    ],
    residual: 0,
  };
  const programmes = [
    { id: "income_tax", group: "tax", before: 43.75, after: 46.15, children: [] },
    { id: "fuel_duty", group: "tax", before: 339.49, after: 335.89, children: [] },
    { id: "state_pension", group: "benefit", before: 13696.98, after: 13696.98, children: [] },
    { id: "dividend_income", group: "income", before: 1000, after: 1000, children: [] },
  ];
  const net = { before: 14313.74, after: 14314.94 };

  it("adds up to the tiles and shows a policy's change as its bar does", () => {
    const totals = headlineTotals(net);
    expect(totals.change).toBe(1);
    const bars = policyRows(byPolicy, totals.change, POLICIES_FOR_TEST);
    const fuelBar = bars.all.find((row) => row.id === "fuel_duty_freeze").rounded;
    const groups = roundProgrammeGroups(programmeGroups(programmes), totals, bars.all);
    const rows = groups.flatMap((group) => group.rows);
    const fuel = rows.find((row) => row.id === "fuel_duty");
    const tax = rows.find((row) => row.id === "income_tax");
    expect(fuel.shown.change).toBe(fuelBar);
    expect(tax.shown.change).toBe(bars.all.find((row) => row.id === "dividend_tax_increase_2pp").rounded);
    for (const side of ["before", "after", "change"]) {
      expect(rows.reduce((sum, row) => sum + row.shown[side], 0)).toBe(totals[side]);
    }
    for (const row of rows) expect(row.shown.after).toBe(row.shown.before + row.shown.change);
  });

  it("adds up to the tiles before the split by policy is in", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const totals = headlineTotals(data.net);
    const groups = roundProgrammeGroups(programmeGroups(data.programmes), totals);
    const rows = groups.flatMap((group) => group.rows);
    for (const side of ["before", "after", "change"]) {
      expect(rows.reduce((sum, row) => sum + row.shown[side], 0)).toBe(totals[side]);
    }
    for (const row of rows) {
      expect(row.shown.after).toBe(row.shown.before + row.shown.change);
      expect(Math.abs(row.shown.change - row.change)).toBeLessThan(1.5);
    }
    // Income tax's parts add up to it
    const tax = rows.find((row) => row.id === "income_tax");
    expect(tax.children.reduce((sum, child) => sum + child.shown.change, 0)).toBe(tax.shown.change);
  });

  it("shows Council Tax as the headline card's Based on does, not nudged to make the column add up", () => {
    // The family on Universal Credit in 2027-28 (live API, 26 October
    // 2026): Council Tax £2,628.58 was −£2,628 in the table and £2,629 under
    // the headline
    const family = [
      { id: "employment_income", group: "income", before: 21504.02, after: 21504.02, children: [] },
      { id: "income_tax", group: "tax", before: 1534.8, after: 1534.8, children: [] },
      { id: "national_insurance", group: "tax", before: 714.73, after: 714.73, children: [] },
      { id: "council_tax", group: "tax", before: 2628.58, after: 2628.58, children: [] },
      { id: "fuel_duty", group: "tax", before: 364.89, after: 338.52, children: [] },
      { id: "vat_change", group: "tax", before: 0, after: -73.85, children: [] },
      { id: "tv_licence", group: "tax", before: 180, after: 180, children: [] },
      { id: "universal_credit", group: "benefit", before: 18443.07, after: 18443.07, children: [] },
      { id: "child_benefit", group: "benefit", before: 2391.15, after: 2391.15, children: [] },
      { id: "free_childcare", group: "benefit", before: 3633.88, after: 3633.88, children: [] },
      { id: "other_taxes", group: "tax", before: 0.04, after: 0.05, children: [] },
    ];
    const totals = headlineTotals({ before: 40549.08, after: 40649.3 });
    const rows = roundProgrammeGroups(programmeGroups(family), totals).flatMap((group) => group.rows);
    const councilTax = rows.find((row) => row.id === "council_tax");
    expect(councilTax.shown.before).toBe(-2629);
    expect(councilTax.shown.after).toBe(-2629);
    for (const side of ["before", "after", "change"]) {
      expect(rows.reduce((sum, row) => sum + row.shown[side], 0)).toBe(totals[side]);
    }
  });

  it("rounds an exact 50p of Council Tax as the Based on does, up to the next pound", () => {
    // money(2628.5) is £2,629; Math.round(-2628.5) alone would give −£2,628
    const programmes = [
      { id: "employment_income", group: "income", before: 30000.2, after: 30000.2, children: [] },
      { id: "council_tax", group: "tax", before: 2628.5, after: 2628.5, children: [] },
    ];
    const totals = headlineTotals({ before: 27371.7, after: 27371.7 });
    const rows = roundProgrammeGroups(programmeGroups(programmes), totals).flatMap((group) => group.rows);
    expect(rows.find((row) => row.id === "council_tax").shown.before).toBe(-2629);
    expect(rows.reduce((sum, row) => sum + row.shown.before, 0)).toBe(totals.before);
  });

  it("pins each bar to one row at most, and falls back when pins cannot reach the total", () => {
    const bars = [{ id: "a", change: 3.5, rounded: 3 }];
    expect(pinnedRound([3.5, 3.5], 7, bars)).toEqual([3, 4]);
    // The only row pinned to £3 but the tile says £4: plain rounding instead
    expect(pinnedRound([3.5], 4, bars)).toEqual([4]);
  });

  it("pins a row a penny off its bar (the API rounds each amount to the penny)", () => {
    // A couple in 2031-32: fuel duty's row +£4.60, its bar +£4.61 (£4)
    const byPolicy = {
      measures: [
        { id: "two_child_limit", change: 4038.71, status: "affected" },
        { id: "threshold_freeze_extension", change: -107.11, status: "affected" },
        { id: "salary_sacrifice_cap", change: -18.75, status: "affected" },
        { id: "fuel_duty_freeze", change: 4.61, status: "affected" },
      ],
      residual: 0,
    };
    const bars = policyRows(byPolicy, 3917, POLICIES_FOR_TEST);
    expect(bars.all.find((row) => row.id === "fuel_duty_freeze").rounded).toBe(4);
    const rounded = pinnedRound([-158.42, -63.39, 4.6, 4192.54, -57.88], 3917, bars.all);
    expect(rounded[2]).toBe(4);
    expect(rounded.reduce((sum, value) => sum + value, 0)).toBe(3917);
    // Rounded on its own the row would be £5 against the bar's £4
    expect(pinnedRound([4.6, 10.4], 15, [{ id: "fuel_duty_freeze", change: 4.61, rounded: 4 }])).toEqual([4, 11]);
  });
});

describe("areaName", () => {
  it("names a rent area from the API's BRMA", () => {
    expect(areaName("INNER_SOUTH_EAST_LONDON")).toBe("Inner South East London");
    expect(areaName(null)).toBeNull();
  });
});

describe("the breakdown's top rows", () => {
  it("add up to net income before and after, with pension contributions on their own", () => {
    const data = normaliseHouseholdImpact(HOUSEHOLD_FIXTURE);
    const totals = headlineTotals(data.net);
    const groups = groupTotals(roundProgrammeGroups(programmeGroups(data.programmes), totals));
    for (const side of ["before", "after", "change"]) {
      expect(groups.reduce((sum, group) => sum + group.shown[side], 0)).toBe(totals[side]);
    }
    const programmes = [
      ...HOUSEHOLD_FIXTURE.programmes,
      { id: "pension_contributions", group: "tax", baseline: 1200, reform: 1200, change: 0, children: [] },
    ];
    const withPension = programmeGroups(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, programmes }).programmes);
    const pension = withPension.find((group) => group.id === "pension");
    expect(pension.label).toBe("Pension contributions");
    expect(pension.rows[0].before).toBe(-1200);
    expect(withPension.find((group) => group.id === "tax").rows.map((row) => row.id)).not.toContain(
      "pension_contributions",
    );
  });

  it("words the headline as Spring Statement does", () => {
    expect(headlineVerb(103)).toBe("raise");
    expect(headlineVerb(-570)).toBe("lower");
    expect(headlineVerb(0)).toBe("not change");
  });
});

describe("the household answer's definitions", () => {
  afterEach(() => vi.unstubAllEnvs());
  const ask = async (apiUrl, definitions) => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", apiUrl);
    const fetchImpl = vi.fn(async () => Response.json(HOUSEHOLD_FIXTURE));
    await postHouseholdImpact({ year: 2029 }, { fetchImpl, definitions });
    return fetchImpl.mock.calls[0][0];
  };

  it("names each selected measure's approved commit in the query, the body unchanged", async () => {
    const definitions = { beta: { ...approvedDefinition(), git_sha: "b".repeat(64) }, alpha: approvedDefinition() };
    const url = await ask("https://api.test/api/household-impact", definitions);
    expect(url.startsWith("https://api.test/api/household-impact?")).toBe(true);
    expect(requestedDefinitions(url)).toEqual([["alpha", "c".repeat(40)], ["beta", "b".repeat(64)]]);
    expect(await ask("https://api.test/api/household-impact?key=1", definitions)).toMatch(/\?key=1&definition=/);
  });

  it("asks the route as before when no definitions are named", async () => {
    expect(await ask("https://api.test/api/household-impact", undefined)).toBe("https://api.test/api/household-impact");
    expect(await ask("https://api.test/api/household-impact", {})).toBe("https://api.test/api/household-impact");
  });

  it("keeps the reported definitions, and null from a build that reports none", () => {
    const definitions = { alpha: approvedDefinition() };
    expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, definitions }).definitions).toEqual(definitions);
    for (const value of [undefined, null, [], "x"]) {
      expect(normaliseHouseholdImpact({ ...HOUSEHOLD_FIXTURE, definitions: value }).definitions).toBeNull();
    }
  });

  it("refuses each selected measure whose definition differs, and only those, in id order", () => {
    const measureIds = fc.uniqueArray(fc.constantFrom("alpha", "beta", "gamma", "delta", "constructor", "toString"), { minLength: 1 });
    fc.assert(fc.property(measureIds, fc.func(fc.constantFrom("same", "commit", "reform", "error", "missing")), (ids, how) => {
      const expected = Object.fromEntries(ids.map((id) => [id, approvedDefinition()]));
      const reported = {};
      for (const id of ids) {
        const kind = how(id);
        if (kind === "same") reported[id] = approvedDefinition();
        if (kind === "commit") reported[id] = { ...approvedDefinition(), git_sha: "e".repeat(40) };
        if (kind === "reform") reported[id] = { ...approvedDefinition(), reform: { ...approvedDefinition().reform, reform_sha256: "f".repeat(64) } };
        if (kind === "error") reported[id] = { git_sha: "c".repeat(40), error: "not a measure the running code registers" };
      }
      const refused = definitionRefusals(expected, reported, ids);
      expect(refused.map((item) => item.id)).toEqual(ids.filter((id) => how(id) !== "same").sort());
      for (const item of refused) expect(item.problems).toEqual(definitionDifferences(expected[item.id], reported[item.id]));
    }));
  });

  it("refuses every measure when the answer reports no definitions", () => {
    const expected = { alpha: approvedDefinition(), beta: approvedDefinition() };
    for (const reported of [null, undefined, [], {}]) {
      expect(definitionRefusals(expected, reported)).toEqual([
        { id: "alpha", problems: ["no definition reported"] },
        { id: "beta", problems: ["no definition reported"] },
      ]);
    }
  });

  it("refuses a selected measure with no approved definition to check it against", () => {
    const refused = definitionRefusals({ alpha: approvedDefinition() }, { alpha: approvedDefinition(), beta: approvedDefinition() }, ["beta", "alpha", "beta"]);
    expect(refused).toEqual([{ id: "beta", problems: ["no approved definition to check it against"] }]);
  });

  it("explains a refusal as a definition mismatch naming the measures", () => {
    const error = new DefinitionMismatchError([{ id: "alpha", problems: ["no definition reported"] }]);
    expect(error.kind).toBe("definition");
    expect(error.refused).toEqual([{ id: "alpha", problems: ["no definition reported"] }]);
    expect(error.message).toMatch(/does not compute alpha from the definitions/);
    expect(error.unchecked).toBe(false);
    expect(new DefinitionMismatchError([], { unchecked: true }).unchecked).toBe(true);
  });

  // Review of 0608183, finding 2: the API refuses a measure its code doesn't
  // register with a 422, before it reports any definition
  describe("a 422 naming measures the running code doesn't register", () => {
    // The API's answer (HouseholdImpactRequest._known_measures, through
    // FastAPI), as captured from api.py on 25 October
    const unknown = (ids, requested) => ({
      detail: [{
        type: "value_error",
        loc: ["body", "policies"],
        msg: `Value error, Unknown measures: ${ids.join(", ")}`,
        input: requested,
        ctx: { error: {} },
      }],
    });
    const post = async (payload, policies) => {
      vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
      const fetchImpl = vi.fn(async () => Response.json(payload, { status: 422 }));
      return postHouseholdImpact({ year: 2029, policies }, { fetchImpl }).then(() => null, (error) => error);
    };

    it("refuses them as definitions the running code can't bind, in the API's words", async () => {
      const policies = ["badr_lifetime_limit_cut", "zz_new_measure", "aa_other"];
      const error = await post(unknown(["aa_other", "zz_new_measure"], policies), policies);
      expect(error).toBeInstanceOf(DefinitionMismatchError);
      expect(error.unchecked).toBe(false);
      const problem = `the running code cannot bind it: ${UNREGISTERED}`;
      expect(error.refused).toEqual([{ id: "aa_other", problems: [problem] }, { id: "zz_new_measure", problems: [problem] }]);
      // As the page words a reported UNREGISTERED (the contract's vectors)
      expect(UNREGISTERED).toBe(contract.definition_unregistered);
      expect(definitionDifferences(approvedDefinition(), { git_sha: "c".repeat(40), error: UNREGISTERED })).toEqual([problem]);
      expect(contract.definition_vectors.differences.some((vector) => vector.problems.includes(problem))).toBe(true);
    });

    it("keeps any other 422 as it was", async () => {
      const policies = ["badr_lifetime_limit_cut"];
      // A measure it didn't ask for
      expect(await post(unknown(["zz_new_measure"], ["zz_new_measure"]), policies)).toBeInstanceOf(HouseholdApiError);
      // Another field refused beside it
      const both = unknown(["badr_lifetime_limit_cut"], policies);
      both.detail.push({ type: "less_than_equal", loc: ["body", "household", "children", 0, "age"], msg: "Input should be less than or equal to 19" });
      const error = await post(both, policies);
      expect(error).toBeInstanceOf(HouseholdApiError);
      expect(error.fields.map((field) => field.field)).toEqual(["policies", "household.children.0.age"]);
      // Another refusal of the measures
      expect(await post({ detail: [{ loc: ["body", "policies"], msg: "List should have at most 12 items" }] }, policies)).toBeInstanceOf(HouseholdApiError);
    });

    it("names them exactly when every refusal is of measures the request asked for", () => {
      const id = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
      // Named ids drawn from the requested ones as well as new ones, so a
      // mix (some asked for, some not) is common (review of 52ec7a10)
      const requestedAndNamed = fc.uniqueArray(id, { minLength: 1, maxLength: 6 }).chain((requested) =>
        fc.tuple(fc.constant(requested), fc.uniqueArray(fc.oneof(fc.constantFrom(...requested), id), { minLength: 1, maxLength: 4 })),
      );
      fc.assert(fc.property(requestedAndNamed, ([requested, named]) => {
        const found = unregisteredMeasures(unknown(named, requested).detail, requested);
        expect(found).toEqual(named.every((name) => requested.includes(name)) ? [...named].sort() : []);
      }));
      for (const detail of [undefined, null, "Unknown measures: a", [], [{ loc: ["body", "year"], msg: "Value error, Unknown measures: a" }]]) {
        expect(unregisteredMeasures(detail, ["a"])).toEqual([]);
      }
    });
  });
});

describe("postHouseholdDetail", () => {
  const ok = { net_income: { baseline: 1, reform: 2, change: 1 } };
  const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

  it("asks the detail URL when the build has one, and falls back to the main API when it fails", async () => {
    const { postHouseholdDetail } = await import("./householdImpactApi");
    const main = "https://main.example/api/household-impact";
    const detail = "https://detail.example/api/household-impact";
    const saved = { ...process.env };
    process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = main;
    process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = detail;
    try {
      const asked = [];
      const fetchOk = async (url) => {
        asked.push(url);
        return respond(200, ok);
      };
      await postHouseholdDetail({ include: ["sweep"] }, { fetchImpl: fetchOk });
      expect(asked).toEqual([detail]);

      asked.length = 0;
      const fetchDetailDown = async (url) => {
        asked.push(url);
        if (url === detail) return respond(503, {});
        return respond(200, ok);
      };
      const payload = await postHouseholdDetail({ include: ["sweep"] }, { fetchImpl: fetchDetailDown });
      expect(payload).toEqual(ok);
      expect(asked).toEqual([detail, main]);

      // A refusal from the detail URL (an older build may not know a
      // measure) is asked again of the main API, whose answer stands
      asked.length = 0;
      const fetchInvalid = async (url) => {
        asked.push(url);
        return respond(400, { detail: "no" });
      };
      await expect(
        postHouseholdDetail({ include: ["sweep"] }, { fetchImpl: fetchInvalid }),
      ).rejects.toMatchObject({ kind: "invalid" });
      expect(asked).toEqual([detail, main]);

      // An answer `accept` refuses (another build) is asked of the main API
      asked.length = 0;
      const other = { net_income: { baseline: 1, reform: 3, change: 2 } };
      const fetchOther = async (url) => {
        asked.push(url);
        return respond(200, url === detail ? other : ok);
      };
      const accepted = await postHouseholdDetail(
        { include: ["sweep"] },
        { fetchImpl: fetchOther, accept: (raw) => raw.net_income.reform === 2 },
      );
      expect(accepted).toEqual(ok);
      expect(asked).toEqual([detail, main]);
    } finally {
      process.env = saved;
    }
  });

  it("names the asked measures' definitions on the detail URL and on the fallback", async () => {
    const { postHouseholdDetail } = await import("./householdImpactApi");
    const main = "https://main.example/api/household-impact";
    const detail = "https://detail.example/api/household-impact";
    const saved = { ...process.env };
    process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = main;
    process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = detail;
    try {
      const asked = [];
      const fetchDetailDown = async (url) => {
        asked.push(url);
        if (route(url) === detail) return respond(503, {});
        return respond(200, ok);
      };
      const definitions = { alpha: approvedDefinition() };
      await postHouseholdDetail({ include: ["sweep"] }, { fetchImpl: fetchDetailDown, definitions });
      expect(asked.map(route)).toEqual([detail, main]);
      for (const url of asked) expect(requestedDefinitions(url)).toEqual([["alpha", "c".repeat(40)]]);
    } finally {
      process.env = saved;
    }
  });

  // Coordinator, 25 October (m13): a detail build that doesn't register a
  // measure (one deployed before it, or rolled back) is asked again of the
  // main API; only the main API's own refusal reaches the page
  it("asks the main API when the detail URL's code doesn't register a measure, and passes on the main API's own refusal", async () => {
    const { postHouseholdDetail } = await import("./householdImpactApi");
    const main = "https://main.example/api/household-impact";
    const detail = "https://detail.example/api/household-impact";
    const saved = { ...process.env };
    process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = main;
    process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = detail;
    const unknown = { detail: [{ type: "value_error", loc: ["body", "policies"], msg: "Value error, Unknown measures: beta" }] };
    const body = { include: ["sweep"], policies: ["alpha", "beta"] };
    try {
      const asked = [];
      const fetchDetailUnregistered = async (url) => {
        asked.push(url);
        return url === detail ? respond(422, unknown) : respond(200, ok);
      };
      expect(await postHouseholdDetail(body, { fetchImpl: fetchDetailUnregistered })).toEqual(ok);
      expect(asked).toEqual([detail, main]);

      asked.length = 0;
      const fetchBothUnregistered = async (url) => {
        asked.push(url);
        return respond(422, unknown);
      };
      const refusal = await postHouseholdDetail(body, { fetchImpl: fetchBothUnregistered }).catch((error) => error);
      expect(refusal).toBeInstanceOf(DefinitionMismatchError);
      expect(refusal.refused.map((item) => item.id)).toEqual(["beta"]);
      expect(asked).toEqual([detail, main]);
    } finally {
      process.env = saved;
    }
  });

  // W5's review of #104: a signal aborted before the call never fired its
  // abort event, so the request went out regardless
  it("never sends a request for a signal already aborted", async () => {
    const { postHouseholdImpact } = await import("./householdImpactApi");
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(init.signal.aborted);
      if (init.signal.aborted) throw new DOMException("aborted", "AbortError");
      return respond(200, ok);
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      postHouseholdImpact({ include: [] }, { signal: controller.signal, fetchImpl, url: "https://main.example/api/household-impact" }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([true]);
  });

  // Coordinator, 26 October (W5's reviewer on #104's code): the timeout and
  // the caller's abort ended once the response arrived, so a body that never
  // ended left the part loading instead of falling back to the main API
  describe("a body that never ends", () => {
    const main = "https://main.example/api/household-impact";
    const detail = "https://detail.example/api/household-impact";
    const stalled = () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
    // How the call settles, or "stalled" if it hasn't within `ms`
    const within = (promise, ms = 2000) => {
      let timer;
      const stall = new Promise((resolve) => {
        timer = setTimeout(() => resolve("stalled"), ms);
      });
      return Promise.race([promise.then((value) => ({ value }), (error) => ({ error })), stall]).finally(() =>
        clearTimeout(timer),
      );
    };
    let saved;
    beforeEach(() => {
      saved = { ...process.env };
      process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = main;
      process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL = detail;
    });
    afterEach(() => {
      process.env = saved;
    });

    it("is a timeout, whether the response came in time or after it", async () => {
      const { postHouseholdImpact } = await import("./householdImpactApi");
      const inTime = await within(postHouseholdImpact({ include: [] }, { fetchImpl: async () => stalled(), timeoutMs: 20 }));
      expect(inTime.error).toBeInstanceOf(HouseholdApiError);
      expect(inTime.error.kind).toBe("timeout");
      // A fetch that ignores the abort and answers after the timeout
      const late = async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return stalled();
      };
      const after = await within(postHouseholdImpact({ include: [] }, { fetchImpl: late, timeoutMs: 20 }));
      expect(after.error).toBeInstanceOf(HouseholdApiError);
      expect(after.error.kind).toBe("timeout");
    });

    it("from the detail URL, is asked again of the main API", async () => {
      const { postHouseholdDetail } = await import("./householdImpactApi");
      const asked = [];
      const fetchImpl = async (url) => {
        asked.push(url);
        return url === detail ? stalled() : respond(200, ok);
      };
      // With a signal of the caller's own, as the page always passes
      const { signal } = new AbortController();
      const outcome = await within(postHouseholdDetail({ include: ["sweep"] }, { fetchImpl, signal, timeoutMs: 20 }));
      expect(outcome).toEqual({ value: ok });
      expect(asked).toEqual([detail, main]);
    });

    it("rejects with the AbortError when the caller aborts, and nothing more is asked", async () => {
      const { postHouseholdDetail } = await import("./householdImpactApi");
      const asked = [];
      const controller = new AbortController();
      const fetchImpl = async (url) => {
        asked.push(url);
        setTimeout(() => controller.abort(), 10);
        return stalled();
      };
      const outcome = await within(postHouseholdDetail({ include: ["sweep"] }, { fetchImpl, signal: controller.signal }));
      expect(outcome.error).toMatchObject({ name: "AbortError" });
      expect(asked).toEqual([detail]);
    });
  });

  it("reads a body that isn't JSON by the status alone", async () => {
    const { postHouseholdImpact } = await import("./householdImpactApi");
    const notJson = (status) => async () => ({
      ok: status < 400,
      status,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    });
    const url = "https://main.example/api/household-impact";
    await expect(postHouseholdImpact({ include: [] }, { fetchImpl: notJson(504), url })).rejects.toMatchObject({
      kind: "timeout",
      status: 504,
    });
    await expect(postHouseholdImpact({ include: [] }, { fetchImpl: notJson(200), url })).rejects.toMatchObject({
      kind: "server",
      status: 200,
    });
  });

  it("uses the main API alone when no detail URL is set", async () => {
    const { postHouseholdDetail } = await import("./householdImpactApi");
    const saved = { ...process.env };
    process.env.NEXT_PUBLIC_HOUSEHOLD_API_URL = "https://main.example/api/household-impact";
    delete process.env.NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL;
    try {
      const asked = [];
      await postHouseholdDetail(
        { include: ["by_policy"] },
        {
          fetchImpl: async (url) => {
            asked.push(url);
            return respond(200, ok);
          },
        },
      );
      expect(asked).toEqual(["https://main.example/api/household-impact"]);
    } finally {
      process.env = saved;
    }
  });
});
