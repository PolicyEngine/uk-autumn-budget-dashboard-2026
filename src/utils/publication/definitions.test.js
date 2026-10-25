import { describe, expect, it } from "vitest";
import fc from "fast-check";
import contract from "./contract.json";
import {
  definitionDifferences,
  definitionQuery,
  FULL_COMMIT,
  IDENTITY_FIELDS,
  identityCore,
  receiptDefinition,
} from "./definitions";

describe("the page's definition check against uk_budget_data.definitions", () => {
  // Differential: contract.json's vectors are the Python functions'
  // answers (uk_budget_data.publication.contract)
  it.each(contract.definition_vectors.differences.map((v, i) => [i, v]))(
    "differences, vector %i",
    (_, vector) => {
      expect(definitionDifferences(vector.approved, vector.reported)).toEqual(vector.problems);
    },
  );

  it.each(contract.definition_vectors.receipts.map((v, i) => [i, v]))(
    "receipt_definition, vector %i",
    (_, vector) => {
      expect(receiptDefinition(vector.receipt)).toEqual(vector.definition);
    },
  );

  it("covers a match, each kind of difference and each malformed report", () => {
    const answers = contract.definition_vectors.differences.map((v) => v.problems.join("|"));
    expect(answers).toContain("");
    for (const pattern of [/^no definition reported$/, /^the running code cannot bind it: /, /^reported at commit /, /^its baseline \w+ differs/, /^its reform \w+ differs/, /no baseline identity reported/, /no reform identity reported/]) {
      expect(answers.some((answer) => pattern.test(answer)), String(pattern)).toBe(true);
    }
  });
});

describe("FULL_COMMIT", () => {
  it("takes exactly a full lowercase sha of 40 or 64 hex digits", () => {
    fc.assert(fc.property(fc.string({ unit: fc.constantFrom(..."0123456789abcdefABCDEFg :\n"), maxLength: 70 }), (value) => {
      expect(FULL_COMMIT.test(value)).toBe(/^[0-9a-f]*$/.test(value) && [40, 64].includes(value.length));
    }));
  });

  it("is anchored at both ends (the API's fullmatch)", () => {
    const sha = "a".repeat(40);
    expect(FULL_COMMIT.test(sha)).toBe(true);
    expect(FULL_COMMIT.test(`${sha}\n`)).toBe(false);
    expect(FULL_COMMIT.test(`x${sha}`)).toBe(false);
    expect(FULL_COMMIT.test("a".repeat(52))).toBe(false);
  });
});

// Identity values as receipts and the API give them
const identityValue = fc.option(fc.string({ maxLength: 12 }), { nil: null });
const identity = fc.record(Object.fromEntries(IDENTITY_FIELDS.map((name) => [name, identityValue])));
const definition = fc.record({
  git_sha: fc.oneof(fc.constant("1".repeat(40)), fc.constant("2".repeat(64)), identityValue),
  baseline: identity,
  reform: identity,
});
// Labels and other fields the digest doesn't depend on
const labels = fc.dictionary(
  fc.string({ maxLength: 6 }).filter((key) => ![...IDENTITY_FIELDS, "git_sha", "baseline", "reform", "error"].includes(key) && key !== "__proto__"),
  fc.jsonValue(),
  { maxKeys: 3 },
);

const reversed = (object) => Object.fromEntries(Object.entries(object).reverse());

describe("definitionDifferences", () => {
  it("finds none between a definition and a copy of it, however labelled or ordered", () => {
    fc.assert(fc.property(definition, labels, labels, (approved, extra, sideExtra) => {
      const reported = reversed({
        ...structuredClone(approved),
        ...extra,
        reform: reversed({ ...approved.reform, ...sideExtra, name: "a label" }),
      });
      expect(definitionDifferences(approved, reported)).toEqual([]);
    }));
  });

  it("names exactly the one field that differs", () => {
    fc.assert(fc.property(
      definition,
      fc.constantFrom("baseline", "reform"),
      fc.constantFrom(...IDENTITY_FIELDS),
      identityValue,
      (approved, side, name, value) => {
        fc.pre(value !== approved[side][name]);
        const reported = structuredClone(approved);
        reported[side][name] = value;
        expect(definitionDifferences(approved, reported)).toEqual([`its ${side} ${name} differs`]);
      },
    ));
  });

  it("names a different commit once, whatever else matches", () => {
    fc.assert(fc.property(definition, identityValue, (approved, gitSha) => {
      fc.pre(gitSha !== approved.git_sha);
      const problems = definitionDifferences(approved, { ...structuredClone(approved), git_sha: gitSha });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^reported at commit /);
    }));
  });

  it("treats a missing field as null, as the API's code does", () => {
    fc.assert(fc.property(definition, fc.constantFrom("baseline", "reform"), fc.constantFrom(...IDENTITY_FIELDS), (approved, side, name) => {
      const reported = structuredClone(approved);
      delete reported[side][name];
      expect(definitionDifferences(approved, reported)).toEqual(
        approved[side][name] === null ? [] : [`its ${side} ${name} differs`],
      );
    }));
  });

  it("refuses anything but an object, and any report with an error, with one problem", () => {
    fc.assert(fc.property(definition, fc.jsonValue(), (approved, value) => {
      const notObject = value === null || typeof value !== "object" || Array.isArray(value);
      if (notObject) expect(definitionDifferences(approved, value)).toEqual(["no definition reported"]);
      const withError = { ...structuredClone(approved), error: value };
      expect(definitionDifferences(approved, withError)).toEqual([
        `the running code cannot bind it: ${typeof value === "string" ? value : "no reason given"}`,
      ]);
    }));
  });

  // Review of 0608183, finding 3: JSON.stringify(Infinity) is "null", and
  // a double can't tell 2^53 from 2^53 + 1, where Python's json can
  it("never matches a number this side can't read exactly, though Python could", () => {
    const approved = { git_sha: "1".repeat(40), baseline: identityCore({}), reform: identityCore({ reform_sha256: null }) };
    const withValue = (value) => ({ ...approved, reform: { ...approved.reform, reform_sha256: value } });
    // 1e400 parses as Infinity here, and as a float infinity there
    expect(definitionDifferences(approved, withValue(JSON.parse("1e400")))).toEqual(["its reform reform_sha256 differs"]);
    const big = JSON.parse("9007199254740993");
    expect(big).toBe(2 ** 53);
    expect(definitionDifferences(withValue(2 ** 53), withValue(big))).toEqual(["its reform reform_sha256 differs"]);
    expect(definitionDifferences(withValue(JSON.parse("[9007199254740993]")), withValue([2 ** 53]))).toEqual(["its reform reform_sha256 differs"]);
    // Inside an object too, and on the approved side as well as the
    // reported one (review of 52ec7a10)
    expect(definitionDifferences(withValue({ x: JSON.parse("1e400") }), withValue({ x: null }))).toEqual(["its reform reform_sha256 differs"]);
    expect(definitionDifferences(withValue({ x: null }), withValue({ x: JSON.parse("1e400") }))).toEqual(["its reform reform_sha256 differs"]);
    expect(definitionDifferences(withValue(JSON.parse("1e400")), approved)).toEqual(["its reform reform_sha256 differs"]);
    expect(definitionDifferences(withValue(big), withValue(2 ** 53))).toEqual(["its reform reform_sha256 differs"]);
    // Numbers JSON reads alike on both sides still match
    fc.assert(fc.property(fc.oneof(fc.maxSafeInteger(), fc.double({ noDefaultInfinity: true, noNaN: true }).filter((x) => !Number.isInteger(x))), (value) => {
      expect(definitionDifferences(withValue(value), withValue(JSON.parse(JSON.stringify(value))))).toEqual([]);
    }));
  });

  it("is empty exactly when every compared value is the same", () => {
    fc.assert(fc.property(definition, definition, (approved, reported) => {
      const same = approved.git_sha === reported.git_sha
        && ["baseline", "reform"].every((side) => IDENTITY_FIELDS.every((name) => approved[side][name] === reported[side][name]));
      expect(definitionDifferences(approved, reported).length === 0).toBe(same);
    }));
  });
});

describe("receiptDefinition", () => {
  it("reads the commit and both identities' digest fields, and nothing else", () => {
    fc.assert(fc.property(definition, labels, (approved, extra) => {
      const receipt = {
        dashboard: { git_sha: approved.git_sha, key: "alpha", ...extra },
        execution_receipt: { baseline: { ...approved.baseline, name: "baseline" }, reform: { ...approved.reform, ...extra }, model: {} },
      };
      expect(receiptDefinition(receipt)).toEqual(approved);
      expect(definitionDifferences(receiptDefinition(receipt), approved)).toEqual([]);
    }));
  });

  it("reads nothing from what isn't an object", () => {
    const empty = { git_sha: null, baseline: identityCore(null), reform: identityCore(null) };
    for (const receipt of [null, undefined, "receipt", [], { execution_receipt: [], dashboard: "x" }]) {
      expect(receiptDefinition(receipt)).toEqual(empty);
    }
  });
});

describe("definitionQuery", () => {
  const ids = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }).filter((id) => !id.includes(":") && id !== "__proto__"), { maxLength: 6 });

  it("names each measure's commit once, in id order, as the API parses them", () => {
    fc.assert(fc.property(ids, (measureIds) => {
      const definitions = Object.fromEntries(measureIds.map((id, i) => [id, { git_sha: String(i).padStart(40, "0") }]));
      const named = new URLSearchParams(definitionQuery(definitions)).getAll("definition");
      expect(named).toEqual([...measureIds].sort().map((id) => `${id}:${definitions[id].git_sha}`));
      // The API splits each at its first ":" (str.partition)
      for (const value of named) {
        const at = value.indexOf(":");
        expect(definitions[value.slice(0, at)].git_sha).toBe(value.slice(at + 1));
      }
    }));
  });

  it("is empty when none are named", () => {
    expect(definitionQuery({})).toBe("");
    expect(definitionQuery(null)).toBe("");
  });
});
