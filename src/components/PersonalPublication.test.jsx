import fc from "fast-check";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PersonalImpactTab from "./PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fixtureJson } from "../test/publicationFixture";
import { approvedDefinition } from "../test/definitionsFixture";
import { SAVINGS_INCOME_RATES_ID } from "../utils/calculatorOnlyMeasures";

vi.mock("./HouseholdCalculator", () => ({
  default: ({ selectedPolicies, publicationKey, expectedEngine, expectedDefinitions, presetEngine, presetDefinitions }) => (
    <div data-testid="live-calculator" data-policies={selectedPolicies.join(",")} data-snapshot={publicationKey} data-engine={JSON.stringify(expectedEngine)} data-definitions={JSON.stringify(expectedDefinitions)} data-preset-engine={JSON.stringify(presetEngine)} data-preset-definitions={JSON.stringify(presetDefinitions)}>£123,456</div>
  ),
}));
afterEach(cleanup);

const base = fixtureJson("manifest.json");
// What the fixture's receipts record (receiptEngine)
const ENGINE = { policyengine: "6.10.2", "policyengine-uk": "2.132.6", "policyengine-core": "3.33.3" };
const year = base.measures.alpha.years.find((value) => !base.measures.alpha.unsupported_years.includes(value));
function catalogue({ status = "approved", verified = true, supported = true, manifest = true } = {}) {
  return buildMeasureCatalogue({
    manifest: manifest ? {
      ...base, snapshotSha256: "a".repeat(64),
      measures: { alpha: { ...base.measures.alpha, status, years: [year], unsupported_years: supported ? [] : [year] } }, combined: {},
    } : null,
    tablesByKey: verified ? { alpha: { engine: ENGINE, definition: approvedDefinition() } } : {},
  });
}
function show(value) {
  return render(
    <MeasureCatalogueProvider catalogue={value}>
      <PersonalImpactTab selectedPolicies={["alpha"]} policies={value.measures} year={year} />
    </MeasureCatalogueProvider>,
  );
}

describe("Household calculator's publication gate", () => {
  it("offers to remove only the unavailable selected measures", () => {
    // Review of 62febdd, finding 4: a withdrawn selection had no way out
    const value = buildMeasureCatalogue({
      manifest: {
        ...base, snapshotSha256: "a".repeat(64),
        measures: {
          alpha: { ...base.measures.alpha, years: [year], unsupported_years: [] },
          beta: { ...base.measures.beta, status: "withdrawn", years: [year], unsupported_years: [] },
        },
        combined: {},
      },
      tablesByKey: { alpha: { engine: ENGINE, definition: approvedDefinition() } },
    });
    const remove = vi.fn();
    render(
      <MeasureCatalogueProvider catalogue={value}>
        <PersonalImpactTab selectedPolicies={["alpha", "beta"]} policies={value.measures} year={year} onRemoveUnavailable={remove} />
      </MeasureCatalogueProvider>,
    );
    expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith(["beta"]);
  });

  it("keeps the live single-year calculator for a verified published measure", () => {
    show(catalogue());
    expect(screen.getByTestId("live-calculator")).toHaveAttribute("data-policies", "alpha");
    expect(screen.getByTestId("live-calculator")).toHaveAttribute("data-snapshot", "a".repeat(64));
    // The versions the household API's answers must come from
    expect(JSON.parse(screen.getByTestId("live-calculator").dataset.engine)).toEqual(ENGINE);
    // And the definition each measure's must be computed from
    expect(JSON.parse(screen.getByTestId("live-calculator").dataset.definitions)).toEqual({ alpha: approvedDefinition() });
  });

  it.each([
    ["records no definition", { engine: ENGINE }, /record no definition/],
    ["names a short commit", { engine: ENGINE, definition: { ...approvedDefinition(), git_sha: "abc1234" } }, /names no full commit/],
    ["names no commit", { engine: ENGINE, definition: { ...approvedDefinition(), git_sha: null } }, /names no full commit/],
    ["names an uppercase commit", { engine: ENGINE, definition: { ...approvedDefinition(), git_sha: "C".repeat(40) } }, /names no full commit/],
  ])("shows a measure unavailable, with why, when its receipt %s", (_, tables, why) => {
    // Coordinator's ruling for W5's page follow-up: missing definitions
    // fail closed, each measure shown unavailable with the reason
    const value = buildMeasureCatalogue({
      manifest: {
        ...base, snapshotSha256: "a".repeat(64),
        measures: {
          alpha: { ...base.measures.alpha, years: [year], unsupported_years: [] },
          beta: { ...base.measures.beta, years: [year], unsupported_years: [] },
        },
        combined: {},
      },
      tablesByKey: { alpha: { engine: ENGINE, definition: approvedDefinition() }, beta: tables },
    });
    const remove = vi.fn();
    render(
      <MeasureCatalogueProvider catalogue={value}>
        <PersonalImpactTab selectedPolicies={["alpha", "beta"]} policies={value.measures} year={year} onRemoveUnavailable={remove} />
      </MeasureCatalogueProvider>,
    );
    expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
    expect(screen.getByText("Household calculator is unavailable for the selected measures")).toBeInTheDocument();
    const listed = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(new RegExp(`^${value.byId.get("beta").name}: `));
    expect(listed[0]).toMatch(why);
    fireEvent.click(screen.getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith(["beta"]);
  });

  it.each([
    ["no recorded versions", {}],
    ["different versions", { ...ENGINE, policyengine: "6.10.1" }],
  ])("withholds the calculator when the selected receipts name %s", (_, other) => {
    // Review of 428d209, finding 2: the household API is compared with one
    // set of published versions, so selected receipts must agree on it
    const value = buildMeasureCatalogue({
      manifest: {
        ...base, snapshotSha256: "a".repeat(64),
        measures: {
          alpha: { ...base.measures.alpha, years: [year], unsupported_years: [] },
          beta: { ...base.measures.beta, years: [year], unsupported_years: [] },
        },
        combined: {},
      },
      tablesByKey: { alpha: { engine: ENGINE, definition: approvedDefinition() }, beta: { engine: other, definition: approvedDefinition() } },
    });
    render(
      <MeasureCatalogueProvider catalogue={value}>
        <PersonalImpactTab selectedPolicies={["alpha", "beta"]} policies={value.measures} year={year} />
      </MeasureCatalogueProvider>,
    );
    expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
    expect(screen.getByText("Household calculator is unavailable for the selected policies")).toBeInTheDocument();
    expect(screen.getByText(/do not name one model version/)).toBeInTheDocument();
  });

  describe("the calculator-only savings rise, which every household request carries", () => {
    // Review of bc51d6d2, finding 1: published but not selected, it went in
    // every request unchecked. Once the manifest names it, its receipt's
    // engine and definition are required as a selected measure's are
    const SAVINGS = SAVINGS_INCOME_RATES_ID;
    const savingsDefinition = { ...approvedDefinition(), reform: { ...approvedDefinition().reform, reform_sha256: "e".repeat(64) } };
    function withSavings({ named = true, tables = { engine: ENGINE, definition: savingsDefinition } } = {}) {
      return buildMeasureCatalogue({
        manifest: {
          ...base, snapshotSha256: "a".repeat(64),
          measures: {
            alpha: { ...base.measures.alpha, years: [year], unsupported_years: [] },
            ...(named ? { [SAVINGS]: { ...base.measures.beta, years: [year], unsupported_years: [] } } : {}),
          },
          combined: {},
        },
        tablesByKey: { alpha: { engine: ENGINE, definition: approvedDefinition() }, ...(named && tables ? { [SAVINGS]: tables } : {}) },
      });
    }
    function showAlpha(value, remove = vi.fn()) {
      render(
        <MeasureCatalogueProvider catalogue={value}>
          <PersonalImpactTab selectedPolicies={["alpha"]} policies={value.measures} year={year} onRemoveUnavailable={remove} />
        </MeasureCatalogueProvider>,
      );
      return remove;
    }
    const data = (name) => JSON.parse(screen.getByTestId("live-calculator").dataset[name]);

    it("is checked against its receipt once the publication names it, selected or not", () => {
      showAlpha(withSavings());
      // The household's answers and the examples' both
      expect(data("definitions")).toEqual({ alpha: approvedDefinition(), [SAVINGS]: savingsDefinition });
      expect(data("presetDefinitions")).toEqual({ alpha: approvedDefinition(), [SAVINGS]: savingsDefinition });
      expect(data("engine")).toEqual(ENGINE);
      expect(data("presetEngine")).toEqual(ENGINE);
    });

    it.each([
      ["a receipt with no definition", { engine: ENGINE }, /record no definition/],
      ["a receipt with a short commit", { engine: ENGINE, definition: { ...savingsDefinition, git_sha: "abc1234" } }, /names no full commit/],
    ])("leaves the calculator unavailable when the publication names it with %s", (_, tables, why) => {
      const remove = showAlpha(withSavings({ tables }));
      expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
      const listed = screen.getAllByRole("listitem").map((item) => item.textContent);
      expect(listed).toEqual([expect.stringMatching(new RegExp(`^${withSavings().byId.get(SAVINGS).name}: `))]);
      expect(listed[0]).toMatch(why);
      // Not selected, it can't be removed from the selection: no such button
      expect(screen.queryByRole("button", { name: /from the selection$/ })).not.toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
    });

    it.each([
      ["no verified receipt", null],
      ["a receipt that names other versions", { engine: { ...ENGINE, policyengine: "6.10.1" }, definition: savingsDefinition }],
    ])("withholds the calculator when the publication names it with %s", (_, tables) => {
      showAlpha(withSavings({ tables }));
      expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
      expect(screen.getByText(/do not name one model version/)).toBeInTheDocument();
    });

    // Re-review of edf98756, P3: selected, it still goes back in every
    // request once removed, so no Remove is offered for it either
    it.each([
      ["records no definition", { engine: ENGINE }, /record no definition/],
      ["names a short commit", { engine: ENGINE, definition: { ...savingsDefinition, git_sha: "abc1234" } }, /names no full commit/],
    ])("offers no remove when it is selected and its receipt %s", (_, tables, why) => {
      const value = withSavings({ tables });
      const remove = vi.fn();
      render(
        <MeasureCatalogueProvider catalogue={value}>
          <PersonalImpactTab selectedPolicies={["alpha", SAVINGS]} policies={value.measures} year={year} onRemoveUnavailable={remove} />
        </MeasureCatalogueProvider>,
      );
      expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
      expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringMatching(why)]);
      expect(screen.queryByRole("button", { name: /from the selection$/ })).not.toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
    });

    it("offers no remove when it is selected but the publication holds it back", () => {
      const value = withSavings();
      value.byId.get(SAVINGS).displayable = false;
      const remove = vi.fn();
      render(
        <MeasureCatalogueProvider catalogue={value}>
          <PersonalImpactTab selectedPolicies={["alpha", SAVINGS]} policies={value.measures} year={year} onRemoveUnavailable={remove} />
        </MeasureCatalogueProvider>,
      );
      expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
      expect(screen.getByText("Household calculator is unavailable for the selected policies")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /from the selection$/ })).not.toBeInTheDocument();
    });

    it("is left unchecked while the publication does not name it, as it has no receipt", () => {
      showAlpha(withSavings({ named: false }));
      expect(data("definitions")).toEqual({ alpha: approvedDefinition() });
      expect(data("presetDefinitions")).toEqual({ alpha: approvedDefinition() });
    });
  });

  it("never renders held, unpublished, unverified or unsupported measures as numbers", () => {
    fc.assert(fc.property(
      fc.constantFrom("held", "staged", "withdrawn", "not_computable", "approved"),
      fc.boolean(), fc.boolean(), fc.boolean(),
      (status, verified, supported, manifest) => {
        fc.pre(status !== "approved" || !verified || !supported || !manifest);
        show(catalogue({ status, verified, supported, manifest }));
        expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
        expect(screen.getByText("Household calculator is unavailable for the selected policies")).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent("£123,456");
        cleanup();
      },
    ), { numRuns: 60 });
  });

  it("removes already displayed personal figures immediately when approval is withdrawn", () => {
    const { rerender } = show(catalogue());
    const held = catalogue({ status: "held" });
    rerender(
      <MeasureCatalogueProvider catalogue={held}>
        <PersonalImpactTab selectedPolicies={["alpha"]} policies={held.measures} year={year} />
      </MeasureCatalogueProvider>,
    );
    expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("£123,456");
  });
});
