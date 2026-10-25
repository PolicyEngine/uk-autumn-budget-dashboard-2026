import fc from "fast-check";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PersonalImpactTab from "./PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fixtureJson } from "../test/publicationFixture";

vi.mock("./HouseholdCalculator", () => ({
  default: ({ selectedPolicies, publicationKey, expectedEngine }) => (
    <div data-testid="live-calculator" data-policies={selectedPolicies.join(",")} data-snapshot={publicationKey} data-engine={JSON.stringify(expectedEngine)}>£123,456</div>
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
    tablesByKey: verified ? { alpha: { engine: ENGINE } } : {},
  });
}
function show(value) {
  return render(
    <MeasureCatalogueProvider catalogue={value}>
      <PersonalImpactTab selectedPolicies={["alpha"]} policies={value.measures} year={year} />
    </MeasureCatalogueProvider>,
  );
}

describe("Household impact's publication gate", () => {
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
      tablesByKey: { alpha: { engine: ENGINE } },
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
      tablesByKey: { alpha: { engine: ENGINE }, beta: { engine: other } },
    });
    render(
      <MeasureCatalogueProvider catalogue={value}>
        <PersonalImpactTab selectedPolicies={["alpha", "beta"]} policies={value.measures} year={year} />
      </MeasureCatalogueProvider>,
    );
    expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
    expect(screen.getByText("Household impact is unavailable for the selected measures")).toBeInTheDocument();
    expect(screen.getByText(/do not name one model version/)).toBeInTheDocument();
  });

  it("never renders held, unpublished, unverified or unsupported measures as numbers", () => {
    fc.assert(fc.property(
      fc.constantFrom("held", "staged", "withdrawn", "not_computable", "approved"),
      fc.boolean(), fc.boolean(), fc.boolean(),
      (status, verified, supported, manifest) => {
        fc.pre(status !== "approved" || !verified || !supported || !manifest);
        show(catalogue({ status, verified, supported, manifest }));
        expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
        expect(screen.getByText("Household impact is unavailable for the selected measures")).toBeInTheDocument();
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
