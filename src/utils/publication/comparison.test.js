import { describe, expect, it } from "vitest";
import { comparisonProblems, orderedModifierCounts, resolveOrderedPlan } from "./comparison";
import { canonicalSha256, orderedPlanIdentity, parameterIdentity } from "./orderedPlans";
import { modifierTemplatesProblems } from "./digest";
import wire from "../../test/fixtures/ordered-comparison-wire.json";
import nativeNine from "../../test/fixtures/native-nine-comparison-wire.json";

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
      synthetic: true
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
      shared_parameter_prefixes: ["gov.simulation.capital_gains_responses."]
    },
    receipt: {
      execution_receipt: {
        model: {
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
    document.execution_receipt.model.version = "historical-synthetic";
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
