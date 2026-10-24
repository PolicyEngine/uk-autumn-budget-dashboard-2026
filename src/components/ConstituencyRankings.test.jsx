import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, waitFor, within } from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import { downloadFile } from "../utils/downloadFile";
import { parseCsv } from "../utils/publication/csv";
import { RANKING_CSV_COLUMNS } from "../utils/constituencyRanking";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { AREA_ROUTING_URL, areaRouting, geographyFetch } from "../test/geographyFixture";
import { GeographyCatalogueProvider } from "../test/geographyCatalogueFixture";

// Byte verification against the release index is tested in
// src/utils/publication/flat.test.js; these tests cover the rankings view.
vi.mock("../utils/publication/flat", () => ({
  loadVerifiedFlatCsv: async (name, _catalogue, { fetchImpl = fetch, basePath = "" } = {}) => {
    const response = await fetchImpl(`${basePath}/data/${name}`);
    if (!response.ok) throw new Error(`${name} is unavailable`);
    return new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
  },
}));

const render = (element, options = {}) => renderReact(element, { wrapper: GeographyCatalogueProvider, ...options });

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
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", geographyFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(downloadFile).mockClear();
});

const renderCard = () =>
  render(<ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />);

const switchButton = (name) => screen.getByRole("button", { name, exact: true });

const showRankings = () => fireEvent.click(switchButton("Rankings"));

const bodyRows = (table) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").firstChild.textContent);

async function renderRankings() {
  const utils = renderCard();
  // Wait for the map's rows, then switch
  await waitFor(() =>
    expect(utils.container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
  );
  showRankings();
  return utils;
}

describe("The map card's Map / Rankings switch", () => {
  it("is a group of two pressed buttons, Map first", () => {
    renderCard();
    const group = screen.getByRole("group", { name: "Show constituencies as" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Map", "Rankings"]);
    expect(switchButton("Map")).toHaveAttribute("aria-pressed", "true");
    expect(switchButton("Rankings")).toHaveAttribute("aria-pressed", "false");
    // Real buttons: Tab reaches them, Enter and Space press them.
    buttons.forEach((button) => {
      expect(button.tagName).toBe("BUTTON");
      button.focus();
      expect(button).toHaveFocus();
    });
  });

  it("switches the description, the controls and the body, and keeps one title", async () => {
    const { container } = await renderRankings();
    expect(switchButton("Rankings")).toHaveAttribute("aria-pressed", "true");
    expect(switchButton("Map")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Constituency-level impacts, 2029-30",
    );
    expect(
      screen.getByText(
        /The 10 constituencies with the largest gains and the 10 with the largest losses, ranked by % of income/,
      ),
    ).toBeInTheDocument();
    // Search is the map's; Rank by is the rankings'.
    expect(screen.queryByLabelText("Search constituency")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rank by/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show the change as/ })).toBeNull();
    // The map stays mounted, hidden, so it keeps its zoom.
    expect(container.querySelector(".map-content")).toHaveAttribute("hidden");

    fireEvent.click(switchButton("Map"));
    expect(screen.getByLabelText("Search constituency")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rank by/ })).toBeNull();
    expect(container.querySelector(".map-content")).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the view in the URL as ?map=rankings, and opens on it", async () => {
    window.history.replaceState({}, "", "/?policies=a&tab=x");
    const { unmount } = await renderRankings();
    expect(new URLSearchParams(window.location.search).get("map")).toBe("rankings");
    expect(new URLSearchParams(window.location.search).get("policies")).toBe("a");
    fireEvent.click(switchButton("Map"));
    expect(new URLSearchParams(window.location.search).has("map")).toBe(false);
    unmount();

    window.history.replaceState({}, "", "/?map=rankings");
    renderCard();
    expect(switchButton("Rankings")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("table", { name: /Highest average change/ })).toBeInTheDocument();
  });
});

describe("The Rankings view", () => {
  it("ranks the seats with a published figure, by % of income first", async () => {
    await renderRankings();
    const table = await screen.findByRole("table");
    // Westmoor is withheld and Lough Side has no row: neither is ranked.
    expect(bodyRows(table)).toEqual([
      "Northfield East",
      "Harbour, Mill and Quay",
      "Dale Valley",
      "Marshgate",
      "Fenland Reach",
      "Glen Ardoch",
    ]);
    expect(within(table).getByText("+1.12%")).toBeInTheDocument();
    expect(within(table).getAllByText("North East").length).toBeGreaterThan(0);
    expect(within(table).getByRole("columnheader", { name: "Change (%)" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    // The approximate seat is marked, and the mark explained once.
    expect(
      screen.getByText(/few survey households, so the interval understates/),
    ).toBeInTheDocument();
  });

  it("re-ranks by £ per household, and the map follows", async () => {
    await renderRankings();
    fireEvent.click(screen.getByRole("button", { name: /Rank by/ }));
    fireEvent.click(screen.getByRole("option", { name: /£ per household/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Change (£)" })).toBeInTheDocument();
    expect(within(table).getByText("+£310")).toBeInTheDocument();
    expect(bodyRows(table).at(-1)).toBe("Glen Ardoch");
    fireEvent.click(switchButton("Map"));
    expect(screen.getByRole("button", { name: /Show the change as/ })).toHaveTextContent(
      "£ per household",
    );
  });

  it("downloads every constituency on the map as CSV, the unranked ones last", async () => {
    await renderRankings();
    fireEvent.click(
      screen.getByRole("button", { name: "Download chart: Constituency-level impacts, 2029-30" }),
    );
    // The rankings' download is the CSV alone
    expect(screen.queryByRole("button", { name: /^PNG/ })).toBeNull();
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

describe("Unpublished: one gate, one notice, in either view", () => {
  const expectEmptyRankings = (container) => {
    const panel = container.querySelector(".rankings-panel");
    expect(panel).not.toBeNull();
    expect(panel.textContent).not.toMatch(FIGURES);
    expect(panel.querySelectorAll("tbody th")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /Download chart: Constituency-level impacts/ }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Rank by/ })).toBeNull();
  };

  it.each([
    [
      "the release routes no results by area",
      { [AREA_ROUTING_URL]: areaRouting("not_available") },
      "Results by constituency are not available on this release.",
    ],
    [
      "the routing can't be read",
      { [AREA_ROUTING_URL]: 404 },
      "Results by constituency could not be loaded.",
    ],
    [
      "no constituency file is published",
      { "/data/constituency.csv": 404 },
      "Results by constituency are not yet published.",
    ],
  ])(
    "shows the same single notice on the map and the rankings when %s",
    async (_, overrides, notice) => {
      vi.stubGlobal("fetch", geographyFetch(overrides));
      const { container } = renderCard();
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      showRankings();
      expect(screen.getByText(notice)).toBeInTheDocument();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expectEmptyRankings(container);
    },
  );

  it("requests no constituency file the build does not publish", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLISHED_GEOGRAPHY", "regional.csv");
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { container } = renderCard();
    expect(
      await screen.findByText("Results by constituency are not yet published."),
    ).toBeInTheDocument();
    showRankings();
    expect(fetchImpl.calls).not.toContain("/data/constituency.csv");
    expectEmptyRankings(container);
  });
});
