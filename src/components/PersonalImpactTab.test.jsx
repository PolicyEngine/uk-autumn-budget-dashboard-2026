import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PersonalImpactTab from "./PersonalImpactTab";

afterEach(() => vi.unstubAllGlobals());
it("waits for the statement without calculating old drill measures", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<PersonalImpactTab selectedPolicies={["mock_fuel_duty_freeze", "two_child_limit"]} />);
  expect(screen.getByRole("note")).toHaveTextContent("Awaiting the 12:30 statement");
  expect(screen.queryByRole("button", { name: /Calculate/ })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("sends the pension salary sacrifice amount in the request payload", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
  vi.stubGlobal("fetch", fetch);
  render(<PersonalImpactTab />);
  fireEvent.change(screen.getByLabelText("Pension salary sacrifice (£ a year)"), { target: { value: "3000" } });
  fireEvent.click(screen.getByRole("button", { name: "Calculate impact" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.pension_contributions_salary_sacrifice).toBe(3000);
});
