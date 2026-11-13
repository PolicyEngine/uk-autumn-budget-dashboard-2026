import { describe, expect, it } from "vitest";
import { comparisonProblems, orderedModifierCounts, resolveOrderedPlan } from "./comparison";
import { canonicalSha256, orderedPlanIdentity, parameterIdentity } from "./orderedPlans";
import { artifactSha256, modifierTemplatesProblems, receiptProblems } from "./digest";
import { loadArtifact } from "./load";
import { BASE_PATH, fixtureFetch, fixtureJson } from "../../test/publicationFixture";
import wire from "../../test/fixtures/ordered-comparison-wire.json";
import nativeNine from "../../test/fixtures/native-nine-comparison-wire.json";
import archivedLegacy from "../../../public/data/artifacts/household_energy_payment_2026/220d79f0f70e2679/receipt.json";

// Synthetic protocol fixtures. No model run, approval or released API is claimed.
const leaf = name => ({
  module: "synthetic.never_imported",
  qualname: name,
  source_sha256: "1".repeat(64),
  module_source_sha256: "2".repeat(64),
  module_defaults: null,
  code_revision: {
    repository: "synthetic/test",
    git_sha: "a".repeat(40)
  }
});
const plan = (changes = {}, before = [], after = []) => ({
  application: "before_data_load_then_after_data_load",
  adapter_source_sha256: "3".repeat(64),
  before: {
    parameter_changes: changes,
    modifier_leaves: before
  },
  after: {
    parameter_changes: {},
    modifier_leaves: after
  }
});
function wireDocument(kind) {
  const document = structuredClone(wire[kind]);
  // The API fixture isolates recipe metadata; complete the enclosing artifact
  // membership exactly as the publication generator records it.
  if (document.dashboard.members) document.dashboard.measure_ids = document.dashboard.members.map(member => member.id);
  return document;
}
async function single() {
  const common = {
    schema: "uk-budget-dashboard/common-policy-reference/v1",
    parameter_changes: {
      "gov.synthetic.common": {
        "2027": 1
      }
    },
    policy_record: {
      synthetic: true,
      native_model_version: "2.174.1"
    }
  };
  common.identity = await parameterIdentity(common.parameter_changes);
  common.policy_record_sha256 = await canonicalSha256(common.policy_record);
  const recipe = {
    schema: "uk-budget-dashboard/policy-comparison/v2",
    common_policy_reference: structuredClone(common),
    baseline_delta: plan(),
    reform_delta: plan({
      "gov.synthetic.own": {
        "2027": 2
      }
    }, [leaf("first"), leaf("second")], [leaf("first"), leaf("first")])
  };
  for (const side of ["baseline", "reform"]) recipe[`${side}_plan`] = resolveOrderedPlan(common, [recipe[`${side}_delta`]]);
  return {
    expected: {
      common_policy_reference: common,
      required_model_versions: ["2.174.1"],
      required_model_version_floor: "2.174.1",
      shared_parameter_prefixes: ["gov.simulation.capital_gains_responses."]
    },
    receipt: {
      execution_receipt: {
        model: {
          name: "policyengine-uk",
          version: "2.174.1"
        },
        baseline: await orderedPlanIdentity(recipe.baseline_plan),
        reform: await orderedPlanIdentity(recipe.reform_plan)
      },
      dashboard: {
        key: "synthetic",
        measure_ids: ["synthetic"],
        policy_comparison: recipe
      }
    }
  };
}
describe("ordered comparison recipes", () => {
  it.each([
    ["missing model", r => { delete r.execution_receipt.model; }],
    ["null model", r => { r.execution_receipt.model = null; }],
    ["array model", r => { r.execution_receipt.model = []; }],
    ["missing name", r => { delete r.execution_receipt.model.name; }],
    ["wrong model", r => { r.execution_receipt.model.name = "synthetic-other-model"; }],
    ["missing version", r => { delete r.execution_receipt.model.version; }],
    ["null version", r => { r.execution_receipt.model.version = null; }],
    ["numeric version", r => { r.execution_receipt.model.version = 2.1741; }],
    ["empty version", r => { r.execution_receipt.model.version = ""; }],
    ["blank version", r => { r.execution_receipt.model.version = "  "; }],
    ["unparseable version", r => { r.execution_receipt.model.version = "historical-synthetic"; }],
    ["unknown future version", r => { r.execution_receipt.model.version = "2.999.0"; }],
    ["unreviewed old version", r => { r.execution_receipt.model.version = "1.0.0"; }],
    ["unknown model field", r => { r.execution_receipt.model.unrecognised = true; }],
    ["unknown install origin", r => { r.execution_receipt.model.install_origin = "synthetic-origin"; }],
    ["non-string install origin", r => { r.execution_receipt.model.install_origin = true; }],
    ["short wheel hash", r => { r.execution_receipt.model.wheel_sha256 = "a".repeat(63); }],
    ["newline wheel hash", r => { r.execution_receipt.model.wheel_sha256 = "a".repeat(64) + "\n"; }],
    ["unknown wheel evidence", r => { r.execution_receipt.model.wheel_sha256_evidence = "synthetic-evidence"; }],
    ["non-string wheel evidence", r => { r.execution_receipt.model.wheel_sha256_evidence = false; }],
  ])("rejects malformed actual model metadata: %s", async (_, tamper) => {
    const { receipt, expected } = await single();
    expect(await comparisonProblems(receipt, expected)).toEqual([]);
    tamper(receipt);
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
  });
  it("accepts the official optional model identity values", async () => {
    const { receipt, expected } = await single();
    Object.assign(receipt.execution_receipt.model, {
      install_origin: "archive",
      wheel_sha256: "a".repeat(64),
      wheel_sha256_evidence: "installer_archive_hash"
    });
    expect(await comparisonProblems(receipt, expected)).toEqual([]);
  });
  it.each(["2.999.0", "3.0.0rc1", "1!0.1", "2.174.1rc1", "2.174.1.dev1", "2.174.1+local"])("requires native comparison metadata for future/native release %s", async version => {
    const { receipt, expected } = await single();
    receipt.execution_receipt.model.version = version;
    delete receipt.dashboard.policy_comparison;
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
  });
  it("accepts a future comparison only with its exact trusted native model record", async () => {
    const { receipt, expected } = await single();
    receipt.execution_receipt.model.version = "2.999.0";
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
    const common = receipt.dashboard.policy_comparison.common_policy_reference;
    common.policy_record.native_model_version = "2.999.0";
    common.policy_record_sha256 = await canonicalSha256(common.policy_record);
    expected.common_policy_reference = structuredClone(common);
    expect(await comparisonProblems(receipt, expected)).toEqual([]);
  });
  it("keeps a complete pre-floor model on its metadata-free historical path", async () => {
    const entry = fixtureJson("manifest.json").measures.alpha;
    const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
    receipt.execution_receipt.model.version = "2.174.0";
    expect(await comparisonProblems(receipt, nativeNine.native_policy_comparison)).toEqual([]);
  });
  it("keeps a complete valid archived model on its original legacy path", async () => {
    const entry = fixtureJson("manifest.json").measures.alpha;
    const document = fixtureJson(`${entry.artifact}/receipt.json`);
    expect(document.execution_receipt.model).toMatchObject({ name: "policyengine-uk", version: "2.165.1" });
    expect(document.dashboard.policy_comparison).toBeUndefined();
    expect(await comparisonProblems(document, nativeNine.native_policy_comparison)).toEqual([]);
  });
  it("preserves the genuine archived UK2.151.0 receipt without a new recipe", async () => {
    expect(archivedLegacy.execution_receipt.model).toMatchObject({ name: "policyengine-uk", version: "2.151.0" });
    expect(archivedLegacy.dashboard.policy_comparison).toBeUndefined();
    expect(await comparisonProblems(structuredClone(archivedLegacy), nativeNine.native_policy_comparison)).toEqual([]);
  });
  it("cannot erase the actual model along with a native recipe", async () => {
    const document = structuredClone(nativeNine.documents[0]);
    delete document.dashboard.policy_comparison;
    expect((await comparisonProblems(document, nativeNine.native_policy_comparison)).length).toBeGreaterThan(0);
    delete document.execution_receipt.model;
    expect((await comparisonProblems(document, nativeNine.native_policy_comparison)).length).toBeGreaterThan(0);
  });
  it.each([false, true])("refuses the full reader before CSV fetches after recipe erasure (model erased=%s)", async eraseModel => {
    // Negative synthetic artifact: retain the fixture CSVs, alter only receipt metadata.
    const entry = structuredClone(fixtureJson("manifest.json").measures.alpha);
    const document = fixtureJson(`${entry.artifact}/receipt.json`);
    document.execution_receipt.model.version = "2.174.1";
    delete document.dashboard.policy_comparison;
    if (eraseModel) delete document.execution_receipt.model;
    entry.artifact_sha256 = await artifactSha256(document);
    expect((await receiptProblems(document, "alpha", entry)).length).toBeGreaterThan(0);
    const fetchImpl = fixtureFetch({ overrides: { [`${entry.artifact}/receipt.json`]: JSON.stringify(document) } });
    await expect(loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl })).rejects.toThrow(/policy comparison/);
    expect(fetchImpl.calls.filter(url => url.endsWith(".csv"))).toEqual([]);
  });
  it.each(nativeNine.documents.map((document, index) => ({
    document,
    index
  })))("retains genuine installed native parameter identity $index", async ({
    document
  }) => {
    expect(await comparisonProblems(document, nativeNine.native_policy_comparison)).toEqual([]);
    expect(document.dashboard.policy_comparison.schema).toBe("uk-budget-dashboard/policy-comparison/v1");
    for (const side of ["baseline", "reform"]) expect(document.execution_receipt[side].representation).toBe("policyengine-uk.scenario/v1");
    expect(orderedModifierCounts(document)).toBeNull();
  });
  it.each(nativeNine.documents.map((document, index) => ({
    document,
    index
  })))("refuses a removed native parameter comparison $index", async ({
    document
  }) => {
    const changed = structuredClone(document);
    delete changed.dashboard.policy_comparison;
    changed.dashboard.basis = {
      policy: "historical"
    };
    expect((await comparisonProblems(changed, nativeNine.native_policy_comparison)).length).toBeGreaterThan(0);
  });
  it.each(["single", "combined"])("verifies the genuine API-generated %s protocol fixture", async kind => {
    expect(await comparisonProblems(wireDocument(kind), wire.native_policy_comparison)).toEqual([]);
  });
  it("refuses composition metadata after all combined members are removed", async () => {
    const document = wireDocument("combined");
    delete document.dashboard.members;
    document.execution_receipt.model.version = "2.165.1";
    for (const side of ["baseline", "reform"]) {
      document.execution_receipt[side] = await parameterIdentity({});
    }
    expect((await comparisonProblems(document, wire.native_policy_comparison)).length).toBeGreaterThan(0);
  });
  it("counts the four genuine combined leaf occurrences rather than one wrapper", () => {
    expect(orderedModifierCounts(wireDocument("combined"))).toEqual({
      baseline: 0,
      reform: 4
    });
  });
  it.each([["reordered members", r => {
    r.dashboard.members.reverse();
  }], ["duplicate members", r => {
    r.dashboard.members[1].id = r.dashboard.members[0].id;
  }], ["unbound own baseline", r => {
    r.dashboard.members[0].baseline_bound = false;
  }], ["changed member source", r => {
    r.dashboard.members[0].reform_delta.before.modifier_leaves[0].source_sha256 = "f".repeat(64);
  }], ["unknown composition", r => {
    r.dashboard.composition.method = "resolved_common_policy_phases/v99";
  }], ["removed members", r => {
    delete r.dashboard.members;
  }], ["one aggregate proof", r => {
    r.dashboard.composition.reform_plan.after.modifier_leaves = [];
  }]])("refuses genuine combined fixture tamper: %s", async (_, tamper) => {
    const document = wireDocument("combined");
    tamper(document);
    expect((await comparisonProblems(document, wire.native_policy_comparison)).length).toBeGreaterThan(0);
  });
  it("rebuilds shared parameters once and retains every phase occurrence", async () => {
    const {
      receipt,
      expected
    } = await single();
    expect(await comparisonProblems(receipt, expected)).toEqual([]);
    expect(orderedModifierCounts(receipt)).toEqual({
      baseline: 0,
      reform: 4
    });
    receipt.dashboard.modifier_templates = {
      baseline: [],
      reform: [null, null, null, null]
    };
    receipt.dashboard.generation_id = "a".repeat(32);
    expect(modifierTemplatesProblems(receipt)).toEqual([]);
    receipt.dashboard.modifier_templates.reform = [null];
    expect(modifierTemplatesProblems(receipt).join(" ")).toContain("do not match");
  });
  it.each([["missing metadata", r => {
    delete r.dashboard.policy_comparison;
  }], ["unknown schema", r => {
    r.dashboard.policy_comparison.schema = "uk-budget-dashboard/policy-comparison/v99";
  }], ["unknown field", r => {
    r.dashboard.policy_comparison.locator = "synthetic.never_imported";
  }], ["phase order", r => {
    r.dashboard.policy_comparison.reform_plan.before.modifier_leaves.reverse();
  }], ["repetition removed", r => {
    r.dashboard.policy_comparison.reform_plan.after.modifier_leaves.pop();
  }], ["source changed", r => {
    r.dashboard.policy_comparison.reform_plan.before.modifier_leaves[0].source_sha256 = "4".repeat(64);
  }], ["revision changed", r => {
    r.dashboard.policy_comparison.reform_plan.before.modifier_leaves[0].code_revision.git_sha = "b".repeat(40);
  }], ["unknown representation", r => {
    r.execution_receipt.reform.representation = "unrecognised/v1";
  }]])("refuses %s even when the artifact digest could be rebound", async (_, tamper) => {
    const {
      receipt,
      expected
    } = await single();
    tamper(receipt);
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
  });
  it("refuses a self-consistent changed common reference", async () => {
    const {
      receipt,
      expected
    } = await single();
    const c = receipt.dashboard.policy_comparison.common_policy_reference;
    c.parameter_changes["gov.synthetic.common"]["2027"] = 2;
    c.identity = await parameterIdentity(c.parameter_changes);
    for (const side of ["baseline", "reform"]) {
      const recipe = receipt.dashboard.policy_comparison;
      recipe[`${side}_plan`] = resolveOrderedPlan(c, [recipe[`${side}_delta`]]);
      receipt.execution_receipt[side] = await orderedPlanIdentity(recipe[`${side}_plan`]);
    }
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
  });
  it("keeps the native downgrade guard independent of basis labels", async () => {
    const {
      receipt,
      expected
    } = await single();
    receipt.dashboard.basis = {
      policy: "historical"
    };
    delete receipt.dashboard.policy_comparison;
    expect((await comparisonProblems(receipt, expected)).length).toBeGreaterThan(0);
  });
  it("refuses overlapping member parameters and keeps ordered leaves", async () => {
    const {
      expected
    } = await single();
    const a = plan({
      "gov.synthetic.own": {
        "2027": 2
      }
    }, [leaf("first")]);
    const b = plan({
      "gov.synthetic.own": {
        "2027": 2
      }
    }, [leaf("second")]);
    expect(() => resolveOrderedPlan(expected.common_policy_reference, [a, b])).toThrow();
    b.before.parameter_changes = {
      "gov.synthetic.other": {
        "2027": 3
      }
    };
    expect(resolveOrderedPlan(expected.common_policy_reference, [a, b]).before.modifier_leaves.map(x => x.qualname)).toEqual(["first", "second"]);
  });
});
