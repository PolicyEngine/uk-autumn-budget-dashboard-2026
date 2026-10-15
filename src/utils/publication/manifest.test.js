// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isDisplayable,
  isSafeArtifactPath,
  ManifestError,
  measureAvailability,
  parseManifest,
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
      "gamma",
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
});

describe("parseManifest refusals", () => {
  const cases = {
    "a different schema": (m) => (m.schema = "other/v1"),
    "revision zero": (m) => (m.revision = 0),
    "an unknown status": (m) => (m.measures.alpha.status = "published"),
    "a bad digest": (m) => (m.measures.alpha.outputs_sha256 = "abc"),
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
