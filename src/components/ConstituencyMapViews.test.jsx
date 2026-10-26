import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { geographyFetch } from "../test/geographyFixture";
import { GeographyCatalogueProvider } from "../test/geographyCatalogueFixture";

// The fixture's fake seats (Z14...) placed on a small hex grid, so the hex
// view draws every one of them: two rows of four.
vi.mock("../../data_inputs/constituency_hexes.json", () => ({
  default: {
    Z14000001: [0, 0],
    Z14000002: [1, 0],
    Z14000003: [2, 0],
    Z14000004: [3, 0],
    Z14000005: [0, -1],
    Z14000006: [1, -1],
    Z14000007: [2, -1],
    Z14000008: [3, -1],
  },
}));

vi.mock("../utils/publication/flat", async (importOriginal) => {
  const { unverifiedFlatLoader } = await import("../test/flatLoaderMock");
  return { ...(await importOriginal()), ...unverifiedFlatLoader() };
});

vi.mock("../utils/chartLogo", () => ({
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const ALL = POLICIES.map((policy) => policy.id);
const CODES = Array.from({ length: 8 }, (_, i) => `Z1400000${i + 1}`);

beforeEach(() => {
  resetGeographyCache();
  vi.stubGlobal("fetch", geographyFetch());
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

async function renderMap() {
  const utils = renderReact(
    <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    { wrapper: GeographyCatalogueProvider },
  );
  await waitFor(() =>
    expect(utils.container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8),
  );
  return utils;
}

const mapSvg = (container) => container.querySelector('svg[role="img"]');
const seatPath = (container, code) =>
  container.querySelector(`path.constituency-path[data-code="${code}"]`);

describe("ConstituencyMap views", () => {
  it("offers Hex map, Map and Table, opening on the hex map", async () => {
    const { container } = await renderMap();
    // The dashboard's shared segmented control
    const switcher = screen.getByRole("radiogroup", { name: "Show constituencies as" });
    const radios = within(switcher).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Hex map", "Map", "Table"]);
    expect(within(switcher).getByRole("radio", { name: "Hex map" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(mapSvg(container)).toHaveAttribute("data-view", "hex");
    expect(window.location.search).toBe("");

    fireEvent.click(within(switcher).getByRole("radio", { name: "Map" }));
    await waitFor(() => expect(mapSvg(container)).toHaveAttribute("data-view", "map"));
    expect(window.location.search).toBe("?map=map");

    fireEvent.click(within(switcher).getByRole("radio", { name: "Table" }));
    expect(window.location.search).toBe("?map=table");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector(".map-content")).toHaveAttribute("hidden");
  });

  it("keeps the same controls, in the same places, in every view", async () => {
    const { container } = await renderMap();
    const row = () =>
      [...container.querySelector(".map-top-bar").children].map((child) => child.className);
    const hex = row();
    expect(hex).toEqual(["map-view-switch", "control-bar", "map-search-section"]);
    for (const view of ["Map", "Table", "Hex map"]) {
      fireEvent.click(screen.getByRole("radio", { name: view }));
      expect(row()).toEqual(hex);
      expect(screen.getAllByRole("searchbox")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: /^Options:/ })).toHaveLength(1);
    }
  });

  it("highlights the seats a key entry covers, and says how many", async () => {
    const { container } = await renderMap();
    const key = screen.getByRole("group", { name: "Key" });
    const segment = key.querySelector('[data-key="cat:large_gain"]');
    fireEvent.mouseEnter(segment);
    const dimmed = CODES.filter((code) => seatPath(container, code).getAttribute("data-dim") === "true");
    const lit = CODES.filter((code) => !dimmed.includes(code));
    expect(lit.length).toBeGreaterThan(0);
    expect(dimmed.length).toBeGreaterThan(0);
    expect(within(key).getByText(`${lit.length} ${lit.length === 1 ? "seat" : "seats"}`)).toBeInTheDocument();
    fireEvent.mouseLeave(segment);
    expect(container.querySelector('path[data-dim="true"]')).toBeNull();
  });

  it("opens the Table view from a link made for the old Rankings view", async () => {
    window.history.replaceState({}, "", "/?map=rankings");
    await renderMap();
    expect(screen.getByRole("radio", { name: "Table" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("draws one hexagon per seat, matched by code, with the map's colours and textures", async () => {
    const { container } = await renderMap();
    for (const code of CODES) {
      const d = seatPath(container, code).getAttribute("d");
      // A closed hexagon: a move and five lines
      expect(d).toMatch(/^M[^L]+(L[^L]+){5}Z$/);
    }
    // The same states as the boundary map draws
    const states = CODES.map((code) => seatPath(container, code).getAttribute("data-state"));
    fireEvent.click(screen.getByRole("radio", { name: "Map" }));
    await waitFor(() => expect(mapSvg(container)).toHaveAttribute("data-view", "map"));
    await waitFor(() =>
      expect(CODES.map((code) => seatPath(container, code).getAttribute("data-state"))).toEqual(
        states,
      ),
    );
  });

  it("fits the whole map in the SVG's view, and Reset returns to that fit", async () => {
    const { container } = await renderMap();
    const svg = mapSvg(container);
    const [x, y, width, height] = svg.getAttribute("viewBox").split(" ").map(Number);
    // Every hexagon lies inside the view
    for (const code of CODES) {
      const numbers = seatPath(container, code)
        .getAttribute("d")
        .match(/-?\d+(\.\d+)?/g)
        .map(Number);
      for (let i = 0; i < numbers.length; i += 2) {
        expect(numbers[i]).toBeGreaterThanOrEqual(x);
        expect(numbers[i]).toBeLessThanOrEqual(x + width);
        expect(numbers[i + 1]).toBeGreaterThanOrEqual(y);
        expect(numbers[i + 1]).toBeLessThanOrEqual(y + height);
      }
    }
    const layer = container.querySelector("g.map-zoom-layer");
    // Selecting a seat zooms to it...
    fireEvent.click(seatPath(container, "Z14000001"));
    await waitFor(() => expect(layer.getAttribute("transform")).toMatch(/scale\((?!1\))/));
    // ...and Reset returns to the full fit
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    await waitFor(() =>
      expect(layer.getAttribute("transform")).toBe("translate(0,0) scale(1)"),
    );
    expect(container.querySelector(".constituency-tooltip")).toBeNull();
  });

  it("lists every constituency in the table, searchable and sortable", async () => {
    window.history.replaceState({}, "", "/?map=table");
    await renderMap();
    const table = screen.getByRole("table");
    const rows = () => within(table).getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(8);
    expect(screen.getByText(/^8 of 8 constituencies; \d+ reported/)).toBeInTheDocument();
    const valueHeader = within(table).getByRole("columnheader", { name: /Change in household income/ });
    expect(valueHeader).toHaveAttribute("aria-sort", "descending");
    // A withheld seat says so, at the foot of the list
    expect(rows().at(-1)).toHaveTextContent(/Not published|No data/);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search by constituency or region" }), {
      target: { value: "glen" },
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Glen Ardoch");
    expect(screen.getByText(/^1 of 8 constituencies/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search by constituency or region" }), {
      target: { value: "" },
    });
    fireEvent.click(within(table).getByRole("button", { name: /Constituency/ }));
    const names = rows().map((row) => within(row).getByRole("rowheader").firstChild.textContent);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en-GB")));
  });
});

describe("constituencyInfo", () => {
  it("says which dataset the seats come from, and the disclosure rules the generator applies", async () => {
    const { constituencyInfo } = await import("./ConstituencyMap");
    const base = { label: "Rail fares freeze", yearLabel: "2029-30", outcome: "relative_change" };
    const local = constituencyInfo({ ...base, releaseKind: "local_area" });
    const national = constituencyInfo({ ...base, releaseKind: "area_coded_national" });
    expect(local.how[0]).toMatch(/local-area dataset/);
    expect(national.how[0]).toMatch(/enhanced Family Resources Survey/);
    const how = local.how.join(" ");
    expect(how).toMatch(/90% interval from 1,000 bootstrap resamples/);
    expect(how).toMatch(/fewer than 30 effective survey households is approximate/);
    expect(how).toMatch(/fewer than 10 survey households/);
    expect(how).toMatch(/under 0.1% either way, a small change 0.1% to 1%, a large change 1% or more/);
    expect(local.definitions.map((d) => d.term ?? d.ref)).toContain("Hex map");
    // A release that routes nothing by area: what it shows, no method
    expect(constituencyInfo({ ...base, notRouted: true }).how).toBeUndefined();
  });
});
