import { describe, expect, it } from "vitest";
import vectors from "./schemas/ordered_scenario_plan.v1.vectors.json";
import { closed, orderedPlanIdentity, validateOrderedPlan } from "./orderedPlans";

// Synthetic inert provenance: these names are never imported or executed.
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
export function syntheticPlan() {
  return {
    application: "before_data_load_then_after_data_load",
    adapter_source_sha256: "3".repeat(64),
    before: {
      parameter_changes: {
        "gov.synthetic.rate": {
          "2027": 0.2
        }
      },
      modifier_leaves: [leaf("add_one"), leaf("double")]
    },
    after: {
      parameter_changes: {},
      modifier_leaves: [leaf("add_one")]
    }
  };
}
describe("ordered execution plans as inert data", () => {
  it("does not confuse embedded separators with distinct required fields", () => {
    expect(() => closed({ "after\0before": true }, ["before", "after"])).toThrow();
  });
  it.each(["\u0301", "\u203f", "\u200c", "\u200d", "\u03b1", "\u0661"])("matches the upstream Unicode identifier class for %j", character => {
    const plan = syntheticPlan();
    plan.before.modifier_leaves[0].qualname = `a${character}`;
    expect(validateOrderedPlan(plan)).toBe(plan);
  });
  it("refuses a non-word Unicode numeric character allowed by a broader number class", () => {
    const plan = syntheticPlan();
    plan.before.modifier_leaves[0].qualname = "a\u00b2";
    expect(() => validateOrderedPlan(plan)).toThrow();
  });
  it.each(vectors.valid)("matches the official API vector $id", async ({
    plan,
    identity
  }) => {
    const fields = ["kind", "representation", "reform_sha256", "binding"];
    expect(await orderedPlanIdentity(plan)).toEqual(Object.fromEntries(fields.map(field => [field, identity[field]])));
  });
  it.each(vectors.invalid)("refuses the official invalid vector $id", ({
    plan
  }) => {
    expect(() => validateOrderedPlan(plan)).toThrow();
  });
  it("binds exact phase order and repeated occurrences", async () => {
    const plan = syntheticPlan();
    expect(validateOrderedPlan(plan)).toBe(plan);
    const original = await orderedPlanIdentity(plan);
    expect(original).toMatchObject({
      representation: "policyengine-uk.phased_scenario_composition/v1",
      binding: "code_revision"
    });
    plan.before.modifier_leaves.reverse();
    expect((await orderedPlanIdentity(plan)).reform_sha256).not.toBe(original.reform_sha256);
    plan.before.modifier_leaves.reverse();
    plan.after.modifier_leaves.push(leaf("add_one"));
    expect((await orderedPlanIdentity(plan)).reform_sha256).not.toBe(original.reform_sha256);
    const repeated = await orderedPlanIdentity(plan);
    plan.before.modifier_leaves.push(plan.after.modifier_leaves.pop());
    expect((await orderedPlanIdentity(plan)).reform_sha256).not.toBe(repeated.reform_sha256);
  });
  it("preserves current-law and parameter-only legacy identity forms", async () => {
    const plan = syntheticPlan();
    plan.before.modifier_leaves = [];
    plan.after.modifier_leaves = [];
    expect(await orderedPlanIdentity(plan)).toMatchObject({
      kind: "reform",
      representation: "policyengine-uk.scenario/v1",
      binding: "content"
    });
    plan.before.parameter_changes = {};
    expect(await orderedPlanIdentity(plan)).toEqual({
      kind: "current_law",
      representation: null,
      reform_sha256: null,
      binding: "content"
    });
  });
  it.each([["new top field", p => {
    p.extra = true;
  }], ["new phase field", p => {
    p.before.extra = true;
  }], ["late parameters", p => {
    p.after.parameter_changes.x = 1;
  }], ["unknown application", p => {
    p.application = "after_then_before";
  }], ["short source", p => {
    p.before.modifier_leaves[0].source_sha256 = "a";
  }], ["source newline", p => {
    p.before.modifier_leaves[0].source_sha256 += "\n";
  }], ["module newline", p => {
    p.before.modifier_leaves[0].module += "\n";
  }], ["qualname newline", p => {
    p.before.modifier_leaves[0].qualname += "\n";
  }], ["commit newline", p => {
    p.before.modifier_leaves[0].code_revision.git_sha += "\n";
  }], ["new leaf field", p => {
    p.before.modifier_leaves[0].locator = "x";
  }], ["closure locator", p => {
    p.before.modifier_leaves[0].qualname = "outer.<locals>.inner";
  }], ["missing defaults", p => {
    delete p.before.modifier_leaves[0].module_defaults;
  }], ["empty defaults", p => {
    p.before.modifier_leaves[0].module_defaults = {};
  }], ["new revision field", p => {
    p.before.modifier_leaves[0].code_revision.extra = true;
  }], ["invalid commit", p => {
    p.before.modifier_leaves[0].code_revision.git_sha = "main";
  }], ["null parameter", p => {
    p.before.parameter_changes.x = null;
  }], ["string parameter", p => {
    p.before.parameter_changes.x = "0.2";
  }], ["unsafe integer", p => {
    p.before.parameter_changes.x = Number.MAX_SAFE_INTEGER + 1;
  }], ["numeric infinity", p => {
    p.before.parameter_changes.x = Infinity;
  }], ["forged marker", p => {
    p.before.parameter_changes.x = {
      $nonfinite: "Infinity",
      extra: 1
    };
  }], ["reserved path", p => {
    p.before.parameter_changes.$nonfinite = 1;
  }], ["nested parameter map", p => {
    p.before.parameter_changes.x = {
      "2027": {
        deeper: 1
      }
    };
  }]])("refuses %s", (_, mutate) => {
    const plan = syntheticPlan();
    mutate(plan);
    expect(() => validateOrderedPlan(plan)).toThrow();
  });
  it.each([{
    type: "float",
    hex: "0x1.0000000000000p+0"
  }, {
    type: "float",
    hex: "-0x0.0p+0"
  }, {
    type: "float",
    hex: "0x0.0000000000001p-1022"
  }, {
    type: "float",
    hex: "inf"
  }, {
    type: "dict",
    items: [["z", {
      type: "none"
    }], ["a", {
      type: "bool",
      value: true
    }]]
  }])("accepts canonical typed defaults %j", value => {
    const plan = syntheticPlan();
    plan.before.modifier_leaves[0].module_defaults = {
      helper: value
    };
    expect(validateOrderedPlan(plan)).toBe(plan);
  });
  it.each([{
    type: "float",
    hex: "0x1.0p+0"
  }, {
    type: "float",
    hex: "0x1.0000000000000p+1024"
  }, {
    type: "float",
    hex: "nan"
  }, {
    type: "float",
    hex: "0x0.0000000000000p-1022"
  }, {
    type: "int",
    value: true
  }, {
    type: "dict",
    items: [["x", {
      type: "none"
    }], ["x", {
      type: "none"
    }]]
  }])("refuses noncanonical typed defaults %j", value => {
    const plan = syntheticPlan();
    plan.before.modifier_leaves[0].module_defaults = {
      helper: value
    };
    expect(() => validateOrderedPlan(plan)).toThrow();
  });
});
