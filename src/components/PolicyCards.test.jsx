import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards, {
  BUDGET_DAY_MONTH,
  TIMELINE_START_YEAR,
  TIMELINE_YEARS,
  durationLabel,
  timelineDescription,
  timelineSpan,
} from "./PolicyCards";
import { buildMeasureCatalogue } from "../utils/measureCatalogue";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { ALPHA, BETA, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const detailsById = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));

// A published catalogue measure under a real id, so policyDetails.js adds
// its card text (#185 on #104: the catalogue decides membership and names)
const published = (id, name, direction = "cost") => ({
  ...catalogue.byId.get(ALPHA),
  id,
  seriesKey: `measure:${id}`,
  name,
  label: name,
  direction,
});

describe("the card details (policyDetails.js)", () => {
  it("give every entry a card's fields, and a temporary one its end", () => {
    for (const policy of POLICY_DETAILS) {
      for (const field of ["summary", "starts", "type", "details", "inForce"]) {
        expect(policy[field], `${policy.id} ${field}`).toBeTruthy();
      }
      expect(Boolean(policy.ends), policy.id).toBe(Boolean(policy.inForce.to));
    }
  });

  it("never repeat a revenue figure in a card", () => {
    for (const policy of POLICY_DETAILS) {
      const text = [policy.summary, policy.details].join(" ");
      expect(text, policy.id).not.toMatch(/£[\d.]+ ?(bn|billion)/);
    }
  });
});

describe("PolicyCards", () => {
  it("shows selected verified catalogue measures grouped and coloured like the charts", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    for (const [heading, id] of [["Raises revenue", BETA], ["Costs revenue", ALPHA]]) {
      const group = screen.getByRole("region", { name: heading });
      const measure = catalogue.byId.get(id);
      expect(within(group).getAllByRole("listitem")).toHaveLength(1);
      expect(group).toHaveTextContent(measure.label);
      // No card details for a mock id: the published description
      expect(group).toHaveTextContent(measure.description);
      expect(within(group).getByRole("listitem").style.getPropertyValue("--policy-accent")).toBe(measure.color);
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).label)).not.toBeInTheDocument();
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

  it("gives a card with details its type, start and end, with the modelling closed until opened", () => {
    const id = "warm_home_discount_top_up";
    render(<PolicyCards policies={[published(id, "Warm Home Discount top-up")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Warm Home Discount top-up" })).toBeTruthy();
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("EndsAfter one winter");
    expect(card.querySelector(".policy-card-topline")).toHaveTextContent("BenefitTemporary");
    expect(within(card).getByRole("img", { name: /^In force from October 2026 to March 2027 \(one winter\)\.$/ })).toBeTruthy();
    const source = within(card).getByRole("link", { name: /Warm Home Discount/ });
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("How it is modelled"));
    expect(details.open).toBe(true);
  });

  it("marks a lasting measure as continuing, with no end date", () => {
    const id = "badr_lifetime_limit_cut";
    render(<PolicyCards policies={[published(id, "Business Asset Disposal Relief restricted", "revenue")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(card).not.toHaveTextContent("Ends");
    expect(card.querySelector(".policy-card-ends")).toBeEmptyDOMElement();
    expect(card).not.toHaveTextContent("Temporary");
    const timeline = within(card).getByRole("img", { name: "In force from April 2027; no end date." });
    expect(timeline).toHaveTextContent("Continues");
    expect(timeline).toHaveTextContent("Budget");
    expect(timeline.textContent).not.toMatch(/BudgetContinues/);
    expect(timeline.querySelectorAll(".ptl-span")).toHaveLength(1);
  });

  it("shows fuel duty's two-step restore as diamonds", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[published(id, "Fuel duty rises deferred")]} selectedPolicies={[id]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027;/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(2);
  });

  it("counts each group's measures", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} />);
    expect(screen.getByRole("region", { name: "Raises revenue" })).toHaveTextContent("1 measure");
    expect(screen.getByRole("region", { name: "Costs revenue" })).toHaveTextContent("1 measure");
  });

  it("asks for only that measure's effect", () => {
    const onShowEffect = vi.fn();
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA]} onShowEffect={onShowEffect} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`effect of ${catalogue.byId.get(ALPHA).label}`) }));
    expect(onShowEffect).toHaveBeenCalledWith(ALPHA);
  });
});

describe("the in-force timeline", () => {
  it("places each measure's months on the charts' years", () => {
    const vat = timelineSpan({ from: "2026-12", to: "2027-05" });
    expect(vat.left).toBeCloseTo(8 / 72);
    expect(vat.width).toBeCloseTo(6 / 72);
    const freeze = timelineSpan({ from: `${TIMELINE_START_YEAR + TIMELINE_YEARS - 1}-04` });
    expect(freeze.left).toBeCloseTo(5 / 6);
    expect(freeze.left + freeze.width).toBeCloseTo(1);
  });

  it("counts a temporary measure's months", () => {
    expect(durationLabel(detailsById.road_fuel_vat_cut)).toBe("6 months");
    expect(durationLabel(detailsById.domestic_electricity_zero_vat)).toBe("18 months");
    expect(durationLabel(detailsById.warm_home_discount_top_up)).toBe("One winter");
    expect(timelineDescription(detailsById.road_fuel_vat_cut)).toBe(
      "In force from December 2026 to May 2027 (6 months).",
    );
  });

  it("puts Budget day in late October 2026", () => {
    expect(BUDGET_DAY_MONTH).toBeGreaterThan(6.8);
    expect(BUDGET_DAY_MONTH).toBeLessThan(7);
  });

  it("keeps every measure's span on the timeline", () => {
    for (const policy of POLICY_DETAILS) {
      const { left, width } = timelineSpan(policy.inForce);
      expect(left, policy.id).toBeGreaterThanOrEqual(0);
      expect(width, policy.id).toBeGreaterThan(0);
      expect(left + width, policy.id).toBeLessThanOrEqual(1);
    }
  });
});
