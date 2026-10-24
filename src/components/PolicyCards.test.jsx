import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards from "./PolicyCards";
import { POLICIES } from "../utils/policies";
import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
  REVENUE_RAISING_NAMES,
} from "../utils/policyConfig";

describe("the candidate measures' config", () => {
  it("gives every measure a colour, a legend place and a card", () => {
    expect(POLICIES).toHaveLength(9);
    expect(new Set(ALL_POLICY_NAMES)).toEqual(new Set(POLICIES.map((p) => p.name)));
    for (const policy of POLICIES) {
      expect(POLICY_COLORS[policy.name]).toMatch(/^#[0-9A-F]{6}$/);
      for (const field of ["summary", "starts", "type", "details"]) {
        expect(policy[field], `${policy.id} ${field}`).toBeTruthy();
      }
    }
    // Raisers first in the legend
    const raisers = ALL_POLICY_NAMES.filter((name) => REVENUE_RAISING_NAMES.has(name));
    expect(ALL_POLICY_NAMES.slice(0, raisers.length)).toEqual(raisers);
  });

  it("never repeats a revenue figure in a card", () => {
    for (const policy of POLICIES) {
      const text = [policy.summary, policy.details].join(" ");
      expect(text, policy.id).not.toMatch(/£[\d.]+ ?(bn|billion)/);
    }
  });
});

describe("PolicyCards", () => {
  it("shows only the selected policies, grouped by revenue effect", () => {
    render(
      <PolicyCards
        policies={POLICIES}
        selectedPolicies={["threshold_freeze_2031_32", "warm_home_discount_top_up"]}
      />,
    );
    const raises = screen.getByRole("heading", { name: "Raises revenue" }).parentElement;
    const costs = screen.getByRole("heading", { name: "Costs revenue" }).parentElement;
    expect(within(raises).getAllByRole("listitem")).toHaveLength(1);
    expect(raises).toHaveTextContent("Threshold freeze to 2031-32");
    expect(within(costs).getAllByRole("listitem")).toHaveLength(1);
    expect(costs).toHaveTextContent("Warm Home Discount top-up");
    expect(screen.queryByText("Fuel duty rises deferred")).toBeNull();
  });

  it("gives each card its start and type, with details closed until opened", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["warm_home_discount_top_up"]} />);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("TypeBenefit");
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("Details"));
    expect(details.open).toBe(true);
    expect(within(card).getByRole("link", { name: "Warm Home Discount" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("leaves out a group with nothing selected", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["road_fuel_vat_cut"]} />);
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).toBeNull();
  });
});
