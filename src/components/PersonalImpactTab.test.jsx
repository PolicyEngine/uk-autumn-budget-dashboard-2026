import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PersonalImpactTab from "./PersonalImpactTab";

vi.mock("./PersonalImpactForm", () => ({
  default: ({ onSubmit }) => <button onClick={() => onSubmit({ employment_income: 50000 })}>Calculate</button>,
}));
vi.mock("./PersonalImpactResults", () => ({ default: () => null }));
afterEach(() => vi.unstubAllGlobals());

it("shows an actionable error when the household API is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
  render(<PersonalImpactTab />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the household calculator");
});

it("explains a proxy timeout or unavailable backend", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<PersonalImpactTab />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
});

it("sends only selected featured policies to the calculator", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<PersonalImpactTab selectedPolicies={["cgt_equalisation", "bus_fare_cap", "two_child_limit"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
  await screen.findByRole("button", { name: "Calculate" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).policy_ids).toEqual([
    "cgt_equalisation", "bus_fare_cap",
  ]);
});

it("asks for a featured selection when an old shared link is active", () => {
  render(<PersonalImpactTab selectedPolicies={["two_child_limit"]} />);
  expect(screen.getByRole("note")).toHaveTextContent("Select a 2026 measure");
  expect(screen.queryByRole("button", { name: "Calculate" })).not.toBeInTheDocument();
});
