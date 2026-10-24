import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import ConstituencyRankings from "./ConstituencyRankings";
import { downloadFile } from "../utils/downloadFile";
import { parseCsv } from "../utils/publication/csv";
import { RANKING_CSV_COLUMNS } from "../utils/constituencyRanking";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { AREA_ROUTING_URL, areaRouting, geographyFetch } from "../test/geographyFixture";

vi.mock("../utils/downloadFile", () => ({
  downloadFile: vi.fn(),
  downloadSvg: vi.fn(),
}));

vi.mock("../utils/chartLogo", () => ({
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

// TEST DATA ONLY: the synthetic geography fixtures (fake Z14 codes).
const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const ALL = POLICIES.map((policy) => policy.id);
const FIGURES = /[+-]£|[+-][\d.]+%/;

beforeEach(() => {
  resetGeographyCache();
  vi.stubGlobal("fetch", geographyFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(downloadFile).mockClear();
});

const renderRankings = (props = {}) =>
  render(
    <ConstituencyRankings
      selectedPolicies={ALL}
      selectedYear={2029}
      policies={POLICIES}
      {...props}
    />,
  );

const bodyRows = (table) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").firstChild.textContent);

describe("ConstituencyRankings", () => {
  it("ranks the seats with a published figure, by % of income first", async () => {
    renderRankings();
    const table = await screen.findByRole("table");
    // Westmoor is withheld and Z14000006 has no row: neither is ranked.
    expect(bodyRows(table)).toEqual([
      "Northfield East",
      "Harbour, Mill and Quay",
      "Dale Valley",
      "Marshgate",
      "Fenland Reach",
      "Glen Ardoch",
    ]);
    expect(within(table).getByText("+1.12%")).toBeInTheDocument();
    expect(within(table).getByText("+£310")).toBeInTheDocument();
    expect(within(table).getAllByText("North East").length).toBeGreaterThan(0);
    // The approximate seat is marked, and the mark explained once.
    expect(screen.getByText(/few survey households, so the interval understates/)).toBeInTheDocument();
  });

  it("re-ranks by £ per household", async () => {
    renderRankings();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Rank by/ }));
    fireEvent.click(screen.getByRole("option", { name: /£ per household/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Change (£)" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(bodyRows(table)[0]).toBe("Northfield East");
    expect(bodyRows(table).at(-1)).toBe("Glen Ardoch");
  });

  it("downloads every constituency on the map as CSV, the unranked ones last", async () => {
    renderRankings();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Download all 8 constituencies/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^CSV/ }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [text, name] = vi.mocked(downloadFile).mock.calls[0];
    expect(name).toBe("constituency-rankings-autumn_budget_2026_combined-2029-by-pct.csv");
    expect(text.startsWith("﻿")).toBe(true);
    const [header, ...rows] = parseCsv(text.slice(1).trimEnd());
    expect(header).toEqual([...RANKING_CSV_COLUMNS]);
    expect(rows).toHaveLength(8);
    // Westmoor (withheld) and Lough Side (no row) have no rank, in name order.
    expect(rows.slice(-2).map((row) => [row[3], row[0], row[1], row[9]])).toEqual([
      ["Lough Side", "", "", ""],
      ["Westmoor", "", "", "withheld"],
    ]);
    expect(rows[0].slice(2, 8)).toEqual([
      "Z14000001",
      "Northfield East",
      "North East",
      "England",
      "310.0",
      "170.0",
    ]);
  });
});

describe("ConstituencyRankings with the map: one gate, one notice", () => {
  const renderBoth = () =>
    render(
      <>
        <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />
        <ConstituencyRankings selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />
      </>,
    );

  const expectEmptyRankings = (container) => {
    const card = container.querySelector(".constituency-rankings");
    expect(card).not.toBeNull();
    expect(within(card).queryByRole("status")).toBeNull();
    expect(card.textContent).not.toMatch(FIGURES);
    expect(card.querySelectorAll("tbody th")).toHaveLength(0);
    expect(within(card).getByRole("button", { name: /Download chart/ })).toBeDisabled();
    expect(within(card).queryByRole("button", { name: /Rank by/ })).toBeNull();
  };

  it.each([
    ["the release routes no results by area", { [AREA_ROUTING_URL]: areaRouting("not_available") }, "Results by constituency are not available on this release."],
    ["the routing can't be read", { [AREA_ROUTING_URL]: 404 }, "Results by constituency could not be loaded."],
    ["no constituency file is published", { "/data/constituency.csv": 404 }, "Results by constituency are not yet published."],
  ])("shows no rankings, and the map's notice alone, when %s", async (_, overrides, notice) => {
    vi.stubGlobal("fetch", geographyFetch(overrides));
    const { container } = renderBoth();
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expectEmptyRankings(container);
  });

  it("requests no constituency file the build does not publish", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_GEOGRAPHY", "regional.csv");
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { container } = renderBoth();
    expect(await screen.findByText("Results by constituency are not yet published.")).toBeInTheDocument();
    expect(fetchImpl.calls).not.toContain("/data/constituency.csv");
    expectEmptyRankings(container);
  });

  it("ranks exactly the seats the map draws", async () => {
    const { container } = renderBoth();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
    );
    const drawn = [...container.querySelectorAll("path.constituency-path")]
      .filter((path) => ["reported", "approximate"].includes(path.getAttribute("data-state")))
      .map((path) => path.getAttribute("data-code"))
      .sort();
    expect(drawn).toHaveLength(6);
    expect(container.querySelectorAll(".constituency-rankings tbody tr")).toHaveLength(6);
  });
});
