import fc from "fast-check";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PersonalImpactTab from "./PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fixtureJson } from "../test/publicationFixture";

vi.mock("./HouseholdCalculator", () => ({
  default: ({ selectedPolicies, publicationKey }) => (
    <div data-testid="live-calculator" data-policies={selectedPolicies.join(",")} data-snapshot={publicationKey}>£123,456</div>
  ),
}));
afterEach(cleanup);

const base = fixtureJson("manifest.json");
const year = base.measures.alpha.years.find((value) => !base.measures.alpha.unsupported_years.includes(value));
function catalogue({ status = "approved", verified = true, supported = true, manifest = true } = {}) {
  return buildMeasureCatalogue({
    manifest: manifest ? {
      ...base, snapshotSha256: "a".repeat(64),
      measures: { alpha: { ...base.measures.alpha, status, years: [year], unsupported_years: supported ? [] : [year] } }, combined: {},
    } : null,
    tablesByKey: verified ? { alpha: {} } : {},
  });
}
function show(value) {
  return render(
    <MeasureCatalogueProvider catalogue={value}>
      <PersonalImpactTab selectedPolicies={["alpha"]} policies={value.measures} year={year} />
    </MeasureCatalogueProvider>,
  );
}

describe("Personal impact's publication gate", () => {
  it("keeps the live single-year calculator for a verified published measure", () => {
    show(catalogue());
    expect(screen.getByTestId("live-calculator")).toHaveAttribute("data-policies", "alpha");
    expect(screen.getByTestId("live-calculator")).toHaveAttribute("data-snapshot", "a".repeat(64));
  });

  it("never renders held, unpublished, unverified or unsupported measures as numbers", () => {
    fc.assert(fc.property(
      fc.constantFrom("held", "staged", "withdrawn", "not_computable", "approved"),
      fc.boolean(), fc.boolean(), fc.boolean(),
      (status, verified, supported, manifest) => {
        fc.pre(status !== "approved" || !verified || !supported || !manifest);
        show(catalogue({ status, verified, supported, manifest }));
        expect(screen.queryByTestId("live-calculator")).not.toBeInTheDocument();
        expect(screen.getByText("Personal impact is unavailable for the selected measures")).toBeInTheDocument();
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
