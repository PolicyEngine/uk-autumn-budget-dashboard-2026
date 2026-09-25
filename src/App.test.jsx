import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

vi.mock("./components/BudgetaryImpactChart", () => ({
  default: ({ data }) => <div data-testid="budget-chart">{JSON.stringify(data?.[0])}</div>,
}));
vi.mock("./components/DistributionalChart", () => ({ default: () => null }));
vi.mock("./components/WaterfallChart", () => ({ default: () => null }));
vi.mock("./components/ConstituencyMap", () => ({ default: () => null }));
vi.mock("./components/EmploymentIncomeChart", () => ({ default: () => null }));
vi.mock("./components/EmploymentIncomeDiffChart", () => ({ default: () => null }));
vi.mock("./components/HouseholdChart", () => ({ default: () => null }));
vi.mock("./components/PersonalImpactTab", () => ({ default: ({ selectedPolicies }) => <div data-testid="personal-policies">{selectedPolicies.join(",")}</div> }));
vi.mock("./components/YearSlider", () => ({ default: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/uk/autumn-budget-2026");
});

function useCheckedInData() {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({
    ok: true,
    text: async () => readFileSync(`public${new URL(url, "http://localhost").pathname.replace(/^\/uk\/autumn-budget-2026/, "")}`, "utf8"),
  })));
}

describe("dashboard URL behavior", () => {
  it("renders a 2025 shared policy with its checked-in chart result", async () => {
    useCheckedInData();
    window.history.replaceState({}, "", "/uk/autumn-budget-2026?policies=two_child_limit");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("budget-chart")).toHaveTextContent("-2.9481590085316145"));
  });

  it("shows a usable empty state when every policy is deselected", async () => {
    useCheckedInData();
    window.history.replaceState({}, "", "/uk/autumn-budget-2026?policies=");
    render(<App />);
    expect(await screen.findByRole("button", { name: "Select all 2026 policies" })).toBeInTheDocument();
  });

  it("opens the historical combined link without double counting its components", async () => {
    useCheckedInData();
    window.history.replaceState({}, "", "/uk/autumn-budget-2026?policies=autumn_budget_2025_combined,two_child_limit");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("budget-chart")).toHaveTextContent("-6.6170900474099215"));
    expect(screen.getByTestId("budget-chart")).toHaveTextContent('"2 child limit repeal":0');
  });

  it("retains selected policies when a personal-impact URL is reloaded", async () => {
    useCheckedInData();
    const selected = "cgt_equalisation,fuel_duty_rise_cancellation,bus_fare_cap";
    window.history.replaceState({}, "", `/uk/autumn-budget-2026?tab=personal&policies=${selected}`);
    const view = render(<App />);
    await waitFor(() => expect(screen.getByTestId("personal-policies")).toHaveTextContent(selected));
    expect(new URLSearchParams(window.location.search).get("policies")).toBe(selected);
    view.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("personal-policies")).toHaveTextContent(selected));
  });
});
