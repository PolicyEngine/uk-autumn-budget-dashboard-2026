import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, waitFor } from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { geographyFetch, geographyFixture } from "../test/geographyFixture";
import { GeographyCatalogueProvider } from "../test/geographyCatalogueFixture";

/*
 * The card in the states it passes through on Budget day (synthetic seats
 * and invented figures only):
 *
 * - before the area run, when the build ships no constituency table;
 * - after it, with each measure by constituency but no package (the area
 *   run publishes the package only when its combined run is approved with
 *   the members geography.PACKAGES lists, which on Budget day it may not
 *   be), and one measure that moves no seat's income in the local-area
 *   data (every figure zero or withheld, as BADR's was in the rehearsal).
 */

vi.mock("../utils/publication/flat", async (importOriginal) => {
  const { unverifiedFlatLoader } = await import("../test/flatLoaderMock");
  return { ...(await importOriginal()), ...unverifiedFlatLoader() };
});

const render = (element) => renderReact(element, { wrapper: GeographyCatalogueProvider });

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const ALL = POLICIES.map((policy) => policy.id);

/**
 * The fixture's seats with no package: its package rows stand for one
 * measure, and a second measure has every figure zero or withheld.
 */
function budgetDayTable() {
  const [header, ...rows] = geographyFixture("constituency.csv").trim().split("\n");
  const measure = rows.map((row) =>
    row.replace(",autumn_budget_2026_combined,", ",two_child_limit,"),
  );
  const flat = rows.map((row, index) => {
    const [head, rest] = row.split(",autumn_budget_2026_combined,");
    const [year, outcome] = rest.split(",");
    return index % 4 < 2
      ? `${head},rail_fares_freeze,${year},${outcome},,,,,withheld,disclosure_control,,False,direct`
      : `${head},rail_fares_freeze,${year},${outcome},0,0,0,no_change,reported,,30+,False,direct`;
  });
  return `${[header, ...measure, ...flat].join("\n")}\n`;
}


beforeEach(() => {
  resetGeographyCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ConstituencyMap on Budget day", () => {
  it("says results by constituency are not yet published before the area run", async () => {
    // The build ships no constituency table (next.config.ts lists only the
    // files in public/data), so the page never asks for one
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_GEOGRAPHY", "regional.csv");
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { container } = render(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    );
    expect(
      await screen.findByText("Results by constituency are not yet published."),
    ).toBeInTheDocument();
    // A plain notice, not a failure
    expect(screen.queryByText(/could not be (read|loaded)/)).toBeNull();
    expect(fetchImpl.calls).not.toContain("/data/constituency.csv");
    // No figures: no coloured seat, no key, search off, no downloads
    expect(container.querySelector("path.constituency-path[data-state]")).toBeNull();
    expect(screen.queryByRole("group", { name: "Key" })).toBeNull();
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Available when results are published/ }),
    ).toBeDisabled();
  });

  it("says the same in the Table view", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_GEOGRAPHY", "");
    vi.stubGlobal("fetch", geographyFetch());
    window.history.replaceState({}, "", "/?map=table");
    try {
      render(<ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />);
      expect(
        await screen.findByText("Results by constituency are not yet published."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/could not be (read|loaded)/)).toBeNull();
      // The notice alone: no empty table, count or "no match" line behind it
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByText(/0 of 0|No constituency or region matches/)).toBeNull();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("shows one measure when no package is published, and offers no measure that moves no seat", async () => {
    vi.stubGlobal(
      "fetch",
      // No region file on Budget day either: the region view's run is separate
      geographyFetch({ "/data/constituency.csv": budgetDayTable(), "/data/regional.csv": 404 }),
    );
    const { container } = render(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
    );
    // The title names the one measure shown, never "all measures"
    expect(container.querySelector(".map-title-focus")).toHaveTextContent("2 child limit repeal");
    // The flat measure is not offered, so there is nothing to pick between
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    expect(screen.queryByRole("radiogroup", { name: "Policy" })).toBeNull();
  });

  it("draws a measure that moves no seat as no change and withheld, never as a figure", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/constituency.csv": budgetDayTable() }),
    );
    const { container } = render(
      <ConstituencyMap
        selectedPolicies={["rail_fares_freeze"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
    );
    const states = [...container.querySelectorAll("path.constituency-path[data-state]")].map(
      (path) => path.getAttribute("data-state"),
    );
    // A seat the table has no row for is drawn as no data
    expect(new Set(states)).toEqual(new Set(["withheld", "reported", "no-data"]));
    const categories = [...container.querySelectorAll("path.constituency-path[data-category]")]
      .map((path) => path.getAttribute("data-category"))
      .filter(Boolean);
    expect(categories.every((category) => category === "no_change")).toBe(true);    // One line under the map says why every seat is grey or hatched
    expect(
      screen.getByText(
        "No constituency shows a change large enough to publish for this policy in 2029-30.",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing of the kind for a measure that moves seats", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/constituency.csv": budgetDayTable() }),
    );
    const { container } = render(
      <ConstituencyMap
        selectedPolicies={["two_child_limit"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
    );
    expect(screen.queryByText(/No constituency shows a change/)).toBeNull();
  });
});
