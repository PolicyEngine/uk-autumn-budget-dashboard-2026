import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
