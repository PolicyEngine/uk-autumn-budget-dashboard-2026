import { describe, expect, it } from "vitest";
import {
  attestationProblems,
  isDisplayable,
  isSafeArtifactPath,
  ManifestError,
  measureAvailability,
  parseManifest,
  personalSeriesProblems,
  PROVISIONAL_LABEL,
  publicationLabel,
} from "./manifest";
import { fixtureJson } from "../../test/publicationFixture";

const raw = fixtureJson("manifest.json");
const manifest = parseManifest(raw);

function edited(change) {
  const copy = structuredClone(raw);
  change(copy);
  return copy;
}

describe("parseManifest on the fixture", () => {
  it("accepts the manifest the Python side wrote", () => {
    expect(manifest.revision).toBe(raw.revision);
    expect(Object.keys(manifest.measures).sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "epsilon",
      "eta",
      "gamma",
      "iota",
      "theta",
      "zeta",
    ]);
    expect(Object.keys(manifest.combined)).toEqual(["combined--alpha+beta"]);
  });

  it("allows unknown extra keys", () => {
    expect(() =>
      parseManifest(
        edited((m) => {
          m.future_field = 1;
          m.measures.alpha.another = "x";
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a public description while retaining older manifests", () => {
    expect(manifest.measures.alpha.description).toBeUndefined();
    const updated = parseManifest(edited((m) => {
      m.measures.alpha.description = "A newly announced measure.";
    }));
    expect(updated.measures.alpha.description).toBe("A newly announced measure.");
  });
});

describe("parseManifest refusals", () => {
  const cases = {
    "a different schema": (m) => (m.schema = "other/v1"),
    "revision zero": (m) => (m.revision = 0),
    "an unknown status": (m) => (m.measures.alpha.status = "published"),
    "a non-text public description": (m) => (m.measures.alpha.description = 7),
    "an invalid personal response mapping": (m) => (m.measures.alpha.personal = { key: 7 }),
    "an empty personal response group": (m) => (m.measures.alpha.personal = { key: "impact_alpha", policies: [] }),
    "unknown personal mapping fields": (m) => (m.measures.alpha.personal = { key: "impact_alpha", extra: true }),
    "a bad digest": (m) => (m.measures.alpha.outputs_sha256 = "abc"),
    "a digest with a trailing newline": (m) =>
      (m.measures.alpha.outputs_sha256 += "\n"),
    "an absolute artifact path": (m) =>
      (m.measures.alpha.artifact = "/etc/passwd"),
    "a parent-directory artifact path": (m) =>
      (m.measures.alpha.artifact = "artifacts/../../x"),
    "a URL as artifact path": (m) =>
      (m.measures.alpha.artifact = "https://example.com/x"),
    "years that are not integers": (m) => (m.measures.alpha.years = ["2030"]),
    "a combined run without members": (m) =>
      delete m.combined["combined--alpha+beta"].measures,
    "a displayable entry on another execution identity": (m) =>
      (m.measures.alpha.execution_identity_sha256 = "f".repeat(64)),
    "a missing artifact digest": (m) => delete m.measures.alpha.artifact_sha256,
    "a key used as both a measure and a combined run": (m) =>
      (m.combined.alpha = structuredClone(m.combined["combined--alpha+beta"])),
  };

  it.each(Object.entries(cases))("refuses %s", (_, change) => {
    expect(() => parseManifest(edited(change))).toThrow(ManifestError);
  });

  it("lists every problem at once", () => {
    try {
      parseManifest(
        edited((m) => {
          m.schema = "x";
          m.measures.alpha.status = "nope";
        }),
      );
      throw new Error("expected a ManifestError");
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      expect(error.problems).toHaveLength(2);
    }
  });

  it("does not hold a staged entry to the shared execution identity", () => {
    expect(() =>
      parseManifest(
        edited(
          (m) => (m.measures.delta.execution_identity_sha256 = "f".repeat(64)),
        ),
      ),
    ).not.toThrow();
  });
});

describe("attestations", () => {
  function attestation() {
    return {
      measure_id: "alpha",
      receipt_sha256: "a".repeat(64),
      reason: "The modifier only updates a registered allowance.",
      checker: "First reviewer",
      second: "Second reviewer",
      released_at: "2026-10-22T12:00:00+00:00",
    };
  }

  it("accepts the complete audit record", () => {
    expect(attestationProblems(attestation(), "alpha")).toEqual([]);
    expect(() =>
      parseManifest(
        edited((m) => {
          m.measures.alpha.attestation = attestation();
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["a different measure", (a) => (a.measure_id = "beta")],
    ["a missing receipt digest", (a) => delete a.receipt_sha256],
    [
      "a receipt digest with a trailing newline",
      (a) => (a.receipt_sha256 += "\n"),
    ],
    ["an empty reason", (a) => (a.reason = " ")],
    ["an empty checker", (a) => (a.checker = "\u0085")],
    ["an empty second", (a) => (a.second = " ")],
    ["one name twice", (a) => (a.second = " FIRST REVIEWER ")],
    [
      "Unicode case-folded names",
      (a) => {
        a.checker = "Straße";
        a.second = "STRASSE";
      },
    ],
    ["a date without a time", (a) => (a.released_at = "2026-10-22")],
    [
      "a nonexistent calendar date",
      (a) => (a.released_at = "2026-02-31T12:00:00Z"),
    ],
    ["an invalid hour", (a) => (a.released_at = "2026-10-22T24:00:00Z")],
    [
      "a timestamp before Python's UTC range",
      (a) => (a.released_at = "0001-01-01T00:00:00+23:59"),
    ],
    [
      "a timestamp after Python's UTC range",
      (a) => (a.released_at = "9999-12-31T23:59:59-23:59"),
    ],
    ["a timestamp with a trailing newline", (a) => (a.released_at += "\n")],
    [
      "a timestamp without a timezone",
      (a) => (a.released_at = "2026-10-22T12:00:00"),
    ],
    ["an unknown field", (a) => (a.future_field = true)],
  ])("refuses %s", (_, change) => {
    expect(() =>
      parseManifest(
        edited((m) => {
          const audit = attestation();
          change(audit);
          m.measures.alpha.attestation = audit;
        }),
      ),
    ).toThrow(ManifestError);
  });
});

describe("isSafeArtifactPath", () => {
  it.each([
    ["artifacts/alpha/abc", true],
    ["a", true],
    ["", false],
    ["/a", false],
    ["a/../b", false],
    ["./a", false],
    ["a//b", false],
    ["a\\b", false],
    ["c:/a", false],
  ])("%s → %s", (path, safe) => {
    expect(isSafeArtifactPath(path)).toBe(safe);
  });
});

describe("availability", () => {
  it("describes every fixture entry", () => {
    expect(measureAvailability(manifest, "alpha")).toEqual({
      available: true,
      status: "approved",
      reason: "",
    });
    expect(measureAvailability(manifest, "gamma").available).toBe(true);
    expect(measureAvailability(manifest, "delta")).toEqual({
      available: false,
      status: "staged",
      reason: "Awaiting approval",
    });
    expect(
      measureAvailability(manifest, "combined--alpha+beta").available,
    ).toBe(true);
    expect(measureAvailability(manifest, "missing")).toEqual({
      available: false,
      status: null,
      reason: "Not yet published",
    });
  });

  it("gives the reason for stale and withdrawn entries", () => {
    const changed = parseManifest(
      edited((m) => {
        m.measures.alpha.status = "withdrawn";
        m.measures.alpha.reason = "costing corrected";
        m.measures.beta.status = "stale";
        m.measures.beta.reason = "the execution identity changed";
      }),
    );
    expect(measureAvailability(changed, "alpha").reason).toBe(
      "Withdrawn: costing corrected",
    );
    expect(measureAvailability(changed, "beta").reason).toBe(
      "Stale: the execution identity changed",
    );
  });

  it("gives a not-computable entry its reason and never its figures", () => {
    const entry = manifest.measures.epsilon;
    expect(entry.status).toBe("not_computable");
    expect(isDisplayable(entry)).toBe(false);
    expect(measureAvailability(manifest, "epsilon")).toEqual({
      available: false,
      status: "not_computable",
      reason: `Not computable on current data: ${entry.reason}`,
    });
    expect(entry.reason).toMatch(/additional dwellings/);
  });

  it("refuses a not-computable entry that names no limit or reason", () => {
    for (const change of [
      (m) => (m.measures.epsilon.data_limits = []),
      (m) => delete m.measures.epsilon.reason,
      (m) => (m.measures.epsilon.data_limits = "additional_dwelling_purchases"),
    ]) {
      expect(() => parseManifest(edited(change))).toThrow(ManifestError);
    }
  });

  it("refuses any entry that shows figures while naming data limits", () => {
    for (const status of ["approved", "provisional"]) {
      expect(() =>
        parseManifest(
          edited((m) => {
            m.measures.alpha.data_limits = ["additional_dwelling_purchases"];
            m.measures.alpha.status = status;
          }),
        ),
      ).toThrow(/figures cannot be shown/);
    }
  });

  it("never treats an inherited property as an entry", () => {
    expect(measureAvailability(manifest, "toString").available).toBe(false);
  });

  it("shows only approved and provisional entries", () => {
    expect(isDisplayable(manifest.measures.alpha)).toBe(true);
    expect(isDisplayable(manifest.measures.gamma)).toBe(true);
    expect(isDisplayable(manifest.measures.delta)).toBe(false);
    expect(isDisplayable(undefined)).toBe(false);
  });

  it("labels provisional entries only", () => {
    expect(publicationLabel(manifest.measures.gamma)).toBe(PROVISIONAL_LABEL);
    expect(publicationLabel(manifest.measures.alpha)).toBe("");
  });
});


describe("personal model contract metadata", () => {
  const personal = { key: "impact_alpha", model: "lifecycle", reviewed: true, description: "Reviewed lifetime parameters.", years: [2026, 2029], unsupported_years: [2027] };

  it("reads an explicit contract while retaining old receipts for inspection", () => {
    expect(personalSeriesProblems(personal)).toEqual([]);
    expect(personalSeriesProblems({ key: "impact_alpha" })).toEqual([]);
    expect(parseManifest(edited((m) => { m.measures.alpha.personal = personal; })).measures.alpha.personal).toEqual(personal);
  });

  it.each([
    { ...personal, model: "unknown" },
    { ...personal, key: "gross_income" },
    { ...personal, reviewed: "true" },
    { ...personal, description: " " },
    { ...personal, years: [] },
    { ...personal, years: [2026, 2026] },
    { ...personal, years: ["2026"] },
    { ...personal, unsupported_years: [2026] },
    { ...personal, policies: ["alpha", "alpha"] },
  ])("rejects malformed per-model metadata: %j", (value) => {
    expect(personalSeriesProblems(value).length).toBeGreaterThan(0);
    expect(() => parseManifest(edited((m) => { m.measures.alpha.personal = value; }))).toThrow(ManifestError);
  });
});
