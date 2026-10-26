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
      for (const field of ["summary", "starts", "type", "details", "inForce"]) {
        expect(policy[field], `${policy.id} ${field}`).toBeTruthy();
      }
      // A temporary measure says when it ends; a lasting one has no end
      expect(Boolean(policy.ends), policy.id).toBe(Boolean(policy.inForce.to));
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
    const raises = screen.getByRole("region", { name: "Raises revenue" });
    const costs = screen.getByRole("region", { name: "Costs revenue" });
    expect(within(raises).getAllByRole("listitem")).toHaveLength(1);
    expect(raises).toHaveTextContent("Threshold freeze to 2031-32");
    expect(within(costs).getAllByRole("listitem")).toHaveLength(1);
    expect(costs).toHaveTextContent("Warm Home Discount top-up");
    expect(screen.queryByText("Fuel duty rises deferred")).toBeNull();
  });

  it("gives each card its type, start and end, with the modelling closed until opened", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["warm_home_discount_top_up"]} />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Warm Home Discount top-up" })).toBeTruthy();
    expect(card).toHaveTextContent("Benefit");
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("EndsAfter one winter");
    expect(card).toHaveTextContent("Temporary");
    expect(within(card).getByRole("img", { name: /^In force from October 2026 to March 2027 \(one winter\)\.$/ })).toBeTruthy();
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("How it is modelled"));
    expect(details.open).toBe(true);
    const source = within(card).getByRole("link", { name: /Warm Home Discount/ });
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("marks a lasting measure as continuing, with no end date", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["badr_lifetime_limit_cut"]} />);
    const card = screen.getByRole("listitem");
    expect(card).not.toHaveTextContent("Ends");
    expect(card).not.toHaveTextContent("Temporary");
    const timeline = within(card).getByRole("img", {
      name: "In force from April 2027; no end date.",
    });
    expect(timeline).toHaveTextContent("Continues");
    expect(timeline).toHaveTextContent("Budget");
  });

  it("shows fuel duty's two-step restore as diamonds", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["fuel_duty_rise_deferral"]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027;/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(2);
    expect(timeline.getAttribute("aria-label")).toBe(
      "In force from January 2027; 3p of the 5p restored in September 2027, the other 2p restored in December 2027; no end date.",
    );
  });

  it("counts each group's measures", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={POLICIES.map((p) => p.id)} />);
    expect(screen.getByRole("region", { name: "Raises revenue" })).toHaveTextContent("2 measures");
    expect(screen.getByRole("region", { name: "Costs revenue" })).toHaveTextContent("7 measures");
  });

  it("asks for only that measure's effect", () => {
    const onShowEffect = vi.fn();
    render(
      <PolicyCards
        policies={POLICIES}
        selectedPolicies={["road_fuel_vat_cut"]}
        onShowEffect={onShowEffect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /effect of VAT cut on road fuel/ }));
    expect(onShowEffect).toHaveBeenCalledWith("road_fuel_vat_cut");
  });

  it("leaves out a group with nothing selected", () => {
    render(<PolicyCards policies={POLICIES} selectedPolicies={["road_fuel_vat_cut"]} />);
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).toBeNull();
  });
});

describe("the in-force timeline", () => {
  it("places each measure's months on the charts' years", () => {
    // VAT cut on road fuel: December 2026 to May 2027, six of 72 months
    const vat = timelineSpan({ from: "2026-12", to: "2027-05" });
    expect(vat.left).toBeCloseTo(8 / 72);
    expect(vat.width).toBeCloseTo(6 / 72);
    // The threshold freeze starts in the last year and lasts
    const freeze = timelineSpan({ from: `${TIMELINE_START_YEAR + TIMELINE_YEARS - 1}-04` });
    expect(freeze.left).toBeCloseTo(5 / 6);
    expect(freeze.left + freeze.width).toBeCloseTo(1);
  });

  it("counts a temporary measure's months", () => {
    const byId = Object.fromEntries(POLICIES.map((p) => [p.id, p]));
    expect(durationLabel(byId.road_fuel_vat_cut)).toBe("6 months");
    expect(durationLabel(byId.domestic_electricity_zero_vat)).toBe("18 months");
    expect(durationLabel(byId.warm_home_discount_top_up)).toBe("One winter");
    expect(timelineDescription(byId.road_fuel_vat_cut)).toBe(
      "In force from December 2026 to May 2027 (6 months).",
    );
  });

  it("puts Budget day in late October 2026", () => {
    expect(BUDGET_DAY_MONTH).toBeGreaterThan(6.8);
    expect(BUDGET_DAY_MONTH).toBeLessThan(7);
  });

  it("keeps every measure's span on the timeline", () => {
    for (const policy of POLICIES) {
      const { left, width } = timelineSpan(policy.inForce);
      expect(left, policy.id).toBeGreaterThanOrEqual(0);
      expect(width, policy.id).toBeGreaterThan(0);
      expect(left + width, policy.id).toBeLessThanOrEqual(1);
    }
  });
});
