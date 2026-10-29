import { readFileSync } from "node:fs";
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

// The view is chosen in the card's Options popover
const viewGroup = () => {
  if (!screen.queryByRole("radiogroup", { name: "View" })) {
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
  }
  return screen.getByRole("radiogroup", { name: "View" });
};
const pickView = (name) => fireEvent.click(within(viewGroup()).getByRole("radio", { name }));

const mapSvg = (container) => container.querySelector('svg[role="img"]');
const seatPath = (container, code) =>
  container.querySelector(`path.constituency-path[data-code="${code}"]`);

describe("ConstituencyMap views", () => {
  it("offers Hex map, Map and Table in the Options popover, opening on the hex map", async () => {
    const { container } = await renderMap();
    // No view switch of its own: the pill names the view
    expect(screen.getByRole("button", { name: /^Options:/ }).getAttribute("aria-label")).toMatch(/ · Hex map$/);
    const switcher = viewGroup();
    const radios = within(switcher).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Hex map", "Map", "Table"]);
    expect(within(switcher).getByRole("radio", { name: "Hex map" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(mapSvg(container)).toHaveAttribute("data-view", "hex");
    expect(window.location.search).toBe("");

    pickView("Map");
    await waitFor(() => expect(mapSvg(container)).toHaveAttribute("data-view", "map"));
    expect(window.location.search).toBe("?map=map");

    pickView("Table");
    expect(window.location.search).toBe("?map=table");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector(".map-content")).toHaveAttribute("hidden");
  });

  it("keeps the same controls, in the same places, in every view", async () => {
    const { container } = await renderMap();
    const row = () =>
      [...container.querySelector(".map-top-bar").children].map((child) => child.className);
    const hex = row();
    expect(hex).toEqual(["control-bar", "map-search-section"]);
    for (const view of ["Map", "Table", "Hex map"]) {
      pickView(view);
      expect(row()).toEqual(hex);
      expect(screen.getAllByRole("searchbox")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: /^Options:/ })).toHaveLength(1);
    }
  });

  it("highlights the seats a key entry covers, and says how many", async () => {
    const { container } = await renderMap();
    const key = screen.getByRole("group", { name: "Key" });
    // The one No data chip: not published, no row, or too uncertain
    const segment = key.querySelector('[data-key="no-data"]');
    fireEvent.mouseEnter(segment);
    const dimmed = CODES.filter((code) => seatPath(container, code).getAttribute("data-dim") === "true");
    const lit = CODES.filter((code) => !dimmed.includes(code));
    expect(lit.length).toBeGreaterThan(0);
    expect(dimmed.length).toBeGreaterThan(0);
    expect(within(key).getByText(`${lit.length} ${lit.length === 1 ? "seat" : "seats"}`)).toBeInTheDocument();
    // Withheld, too uncertain and no row alike
    expect(lit).toEqual(expect.arrayContaining(["Z14000003", "Z14000004", "Z14000006"]));
    fireEvent.mouseLeave(segment);
    expect(container.querySelector('path[data-dim="true"]')).toBeNull();
  });

  it("shows the hovered chip's seat count out of the flow, so nothing moves", async () => {
    // Vahid, 28 October: hovering the key "changes the position". The count
    // used to appear as a new line in the key's head, so the key (centred
    // beside the map) jumped and the chip slid from under the pointer.
    // It now hangs off the chip's right, absolutely placed, always mounted.
    await renderMap();
    const key = screen.getByRole("group", { name: "Key" });
    const count = key.querySelector(".map-key-count");
    expect(count).not.toBeNull();
    expect(count.textContent).toBe("");
    expect(key.querySelector(".map-key-head .map-key-count")).toBeNull();
    expect(count.parentElement).toHaveClass("map-key-statuses");
    fireEvent.mouseEnter(key.querySelector('[data-key="no-data"]'));
    expect(key.querySelector(".map-key-count")).toBe(count);
    expect(count.textContent).toMatch(/^\d+ seats?$/);
    const css = readFileSync("src/components/ConstituencyMap.css", "utf8");
    const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[2] ?? "";
    expect(rule(".map-key-count")).toMatch(/position: absolute;/);
    expect(rule(".map-key-statuses")).toMatch(/position: relative;/);
    expect(css).not.toMatch(/\.map-key-count:empty/);
  });

  it("opens the Table view from a link made for the old Rankings view", async () => {
    window.history.replaceState({}, "", "/?map=rankings");
    await renderMap();
    expect(within(viewGroup()).getByRole("radio", { name: "Table" })).toHaveAttribute("aria-checked", "true");
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
    pickView("Map");
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
    // No data and the approximate rule (10 households, 30) are said
    // here, once: the key has only the scale and a No data chip
    expect(how).toMatch(/^.*No data: we do not publish the figure/);
    expect(how).toMatch(/under 10 survey households/);
    expect(how).toMatch(/Some figures are approximate, resting on fewer than 30 survey households/);
    expect(how).not.toMatch(/dotted/i);
    expect(how).not.toMatch(/either way|hatched/);
    expect(local.definitions.map((d) => d.term ?? d.ref)).toEqual(expect.arrayContaining(["Hex map", "No data"]));
    expect(local.definitions.map((d) => d.term ?? d.ref)).not.toContain("Too uncertain");
    // A release that routes nothing by area: what it shows, no method
    expect(constituencyInfo({ ...base, notRouted: true }).how).toBeUndefined();
  });
});

describe("InfoSections", () => {
  it("styles every section alike, bullets only 2+ items, and ends with one More in Methodology line", async () => {
    const { render } = await import("@testing-library/react");
    const { default: InfoSections, infoPreview } = await import("./InfoSections");
    const info = {
      shows: "One line.",
      how: ["Step one.", "Step two."],
      definitions: [{ ref: "netIncome" }, { term: "Hex map", meaning: "One hexagon per seat." }],
      caveats: ["Only caveat."],
      method: { anchor: "method-area", label: "How we estimate the figures by area" },
    };
    const { container } = render(<InfoSections info={info} />);
    expect(container.querySelectorAll(".info-section-caveat")).toHaveLength(0);
    expect(container.querySelector(".info-caveats").tagName).toBe("DIV");
    expect(container.querySelectorAll("ul.info-list li")).toHaveLength(2);
    expect(container.querySelector(".info-term dt")).toHaveTextContent("Hex map");
    expect(container.querySelector(".info-term dd")).toHaveTextContent("One hexagon per seat.");
    const last = container.querySelector(".info-sections").lastElementChild;
    expect(last).toHaveClass("info-method");
    expect(last).toHaveTextContent(/^More in Methodology: How we estimate the figures by area · Household net income →$/);
    // Shared terms alone make no Definitions section
    expect(infoPreview({ ...info, definitions: [{ ref: "netIncome" }] })).toBe("What it shows · How it's calculated · Caveats");
  });
});
