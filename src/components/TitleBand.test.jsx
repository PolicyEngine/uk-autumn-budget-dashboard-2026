import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TitleBand from "./TitleBand";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
];

function renderBand(props = {}) {
  return render(
    <TitleBand
      activeTab="dashboard"
      onTabChange={vi.fn()}
      policies={POLICIES}
      selectedPolicies={["two_child_limit"]}
      onPolicyToggle={vi.fn()}
      {...props}
    />,
  );
}

describe("the title band", () => {
  it("holds the page title, the view control and the policy control", () => {
    renderBand();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "UK Autumn Budget 2026",
    );
    expect(
      screen.getByRole("button", { name: "View: Population impact" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select policies" }),
    ).toBeInTheDocument();
  });

  it("has no year control: each chart chooses its own year", () => {
    renderBand();
    expect(screen.queryByRole("button", { name: /^Year, / })).toBeNull();
  });
});
