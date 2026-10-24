import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards from "./PolicyCards";
import { buildMeasureCatalogue } from "../utils/measureCatalogue";
import { ALPHA, BETA, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());

describe("PolicyCards", () => {
  it("shows selected verified catalogue measures grouped and coloured like the charts", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    for (const [heading, id] of [["Raises revenue", BETA], ["Costs revenue", ALPHA]]) {
      const group = screen.getByRole("heading", { name: heading }).parentElement;
      const measure = catalogue.byId.get(id);
      expect(within(group).getAllByRole("listitem")).toHaveLength(1);
      expect(group).toHaveTextContent(measure.label);
      expect(group).toHaveTextContent(measure.description);
      expect(group.querySelector(".policy-card-swatch")).toHaveStyle({ background: measure.color });
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).label)).not.toBeInTheDocument();
    expect(screen.queryByText("Starts")).not.toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("keeps optional bound card facts and details closed until opened", () => {
    const policy = { ...catalogue.byId.get(ALPHA), summary: "Published summary", starts: "April 2029", type: "Benefit", details: "Published modelling detail", source: { href: "https://example.com/source", label: "Published source" } };
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} />);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("Published summary");
    expect(card).toHaveTextContent("StartsApril 2029");
    expect(card).toHaveTextContent("TypeBenefit");
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("Details"));
    expect(details.open).toBe(true);
    expect(within(card).getByRole("link", { name: "Published source" })).toHaveAttribute("target", "_blank");
  });

  it("keeps neutral measures in their own group and leaves empty groups out", () => {
    const policy = { ...catalogue.byId.get(ALPHA), direction: "neutral" };
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} />);
    expect(screen.getByRole("heading", { name: "Other measures" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Costs revenue" })).not.toBeInTheDocument();
  });

  it("shows no cards when the catalogue has no verified measures", () => {
    const unverified = buildMeasureCatalogue({ manifest: measureCatalogueFixture().manifest });
    render(<PolicyCards policies={unverified.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
