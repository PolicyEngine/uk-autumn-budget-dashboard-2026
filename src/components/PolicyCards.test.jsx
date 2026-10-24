import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards from "./PolicyCards";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, measureCatalogueFixture } from "../test/measureCatalogueFixture";

// The card text comes from each measure's published display metadata
// (reforms.PUBLIC_DISPLAY; tests/test_public_display.py checks the real
// measures' cards). ALPHA costs revenue, BETA raises it.
function renderCards(selectedPolicies, edit = () => {}) {
  const fixture = measureCatalogueFixture({ held: false });
  fixture.manifest.measures[ALPHA].display = {
    color: "#0D9488",
    summary: "Mock support for households.",
    starts: "Winter 2026-27",
    type: "Benefit",
    details: "An assumption about mock households.",
    source: { label: "Mock source", href: "https://example.org/mock" },
  };
  edit(fixture);
  const catalogue = buildMeasureCatalogue(fixture);
  return render(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <PolicyCards selectedPolicies={selectedPolicies} />
    </MeasureCatalogueProvider>,
  );
}

describe("PolicyCards", () => {
  it("shows only the selected policies, grouped by revenue effect", () => {
    renderCards([ALPHA, BETA]);
    const raises = screen.getByRole("heading", { name: "Raises revenue" }).parentElement;
    const costs = screen.getByRole("heading", { name: "Costs revenue" }).parentElement;
    expect(within(raises).getAllByRole("listitem")).toHaveLength(1);
    expect(raises).toHaveTextContent("Mock beta contribution");
    expect(within(costs).getAllByRole("listitem")).toHaveLength(1);
    expect(costs).toHaveTextContent("Mock alpha support");
  });

  it("gives each card its start and type, with details closed until opened", () => {
    renderCards([ALPHA]);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("TypeBenefit");
    expect(card.querySelector(".policy-card-swatch")).toHaveStyle({ background: "#0D9488" });
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("Details"));
    expect(details.open).toBe(true);
    expect(within(card).getByRole("link", { name: "Mock source" })).toHaveAttribute("target", "_blank");
  });

  it("falls back to the public description for a measure published without card text", () => {
    renderCards([BETA]);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("Published contribution from mock households.");
    expect(card.querySelector("dl")).toBeNull();
  });

  it("leaves out a group with nothing selected", () => {
    renderCards([ALPHA]);
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).toBeNull();
  });
});
