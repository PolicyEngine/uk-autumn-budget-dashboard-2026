import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import { dashboardFixtureFetch } from "./test/dashboardFixture";

// The charts and the views that load their own files are stood in for, so
// the render is the page's own markup and the figures it hands the charts.
// The rows come in the order their artifacts verified, which can differ
// between loads, so the stand-ins list them sorted.
const { inOrder } = vi.hoisted(() => ({
  inOrder: (rows) => [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
}));
vi.mock("./components/BudgetaryImpactChart", () => ({
  default: ({ data, selectedYear }) => <div data-testid="budget-figures" data-year={selectedYear} data-rows={JSON.stringify(data)} />,
}));
vi.mock("./components/DistributionalChart", () => ({
  default: ({ rawData, selectedPolicies, selectedYear }) => <div data-testid="distributional-figures" data-year={selectedYear} data-rows={JSON.stringify(inOrder(rawData))} data-selected={JSON.stringify(selectedPolicies)} />,
}));
vi.mock("./components/WaterfallChart", () => ({
  default: ({ rawData, selectedYear }) => <div data-testid="winners-losers-figures" data-year={selectedYear} data-rows={JSON.stringify(inOrder(rawData))} />,
}));
vi.mock("./components/ConstituencyMap", () => ({ default: () => <div data-testid="constituency-view" /> }));
vi.mock("./components/HouseholdScatter", () => ({ default: () => <div data-testid="scatter-view" /> }));
vi.mock("./components/EmploymentIncomeChart", () => ({ default: () => <div data-testid="income-curve-view" /> }));
vi.mock("./components/EmploymentIncomeDiffChart", () => ({ default: () => <div data-testid="income-change-view" /> }));
vi.mock("./components/PersonalImpactTab", () => ({ default: () => <div data-testid="household-view" /> }));
vi.mock("./components/OBRComparisonTable", () => ({ default: () => null, ObrComparisonFoot: () => <div data-testid="obr-foot-2026" /> }));
vi.mock("./components/YoungPeopleSection", () => ({ default: () => <div data-testid="young-view" />, YOUNG_PEOPLE_ANCHOR: "young-people" }));
vi.mock("./components/MethodologyTab", () => ({ default: () => <div data-testid="methodology-view" />, METHOD_SECTIONS: { geography: "geography" } }));
vi.mock("./components/livingStandards/LivingStandardsTab", () => ({ default: () => <div data-testid="living-view" /> }));

/** A fetch stand-in serving this Budget's fixture, recording every URL. */
function recordingFetch(options) {
  const serve = dashboardFixtureFetch(options);
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(String(url));
    return serve(url, init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

beforeEach(() => { window.history.replaceState({}, "", "/"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the 2026 page with no past event to choose", () => {
  // Captured at #107's head, before the budget selector: with only this
  // Budget published, the page renders exactly this and requests exactly
  // these files. Regenerate (vitest -u) only for an intended change to the
  // 2026 page.
  it("renders byte for byte as before the budget selector, and requests nothing more", async () => {
    const fetchImpl = recordingFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { container } = render(<App />);
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/app-2026-loading.html");
    await screen.findByTestId("budget-figures");
    await expect(container.innerHTML).toMatchFileSnapshot("./__snapshots__/app-2026-loaded.html");
    expect(window.location.search).toBe("");
    await expect(`${[...fetchImpl.calls].sort().join("\n")}\n`).toMatchFileSnapshot("./__snapshots__/app-2026-requests.txt");
  });
});
