import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import { CHART_COLOURS } from "../utils/chartTheme";
import { downloadFile, downloadSvg } from "../utils/downloadFile";
import { exportMapAsSvg } from "../utils/exportMapAsSvg";
import { resetGeographyCache } from "../hooks/useGeographyData";
import {
  CATEGORY_COLOURS,
  NO_DATA_FILL,
  WITHHELD_FILL,
  approximateFill,
  approximatePatternId,
} from "../utils/geography/palette";
import {
  AREA_ROUTING_URL,
  areaRouting,
  geographyFetch,
  geographyFixture,
} from "../test/geographyFixture";

import { GeographyCatalogueProvider } from "../test/geographyCatalogueFixture";

vi.mock("../utils/publication/flat", async (importOriginal) => {
  const { unverifiedFlatLoader } = await import("../test/flatLoaderMock");
  return { ...(await importOriginal()), ...unverifiedFlatLoader() };
});

const render = (element, options = {}) => renderReact(element, { wrapper: GeographyCatalogueProvider, ...options });

vi.mock("../utils/downloadFile", () => ({
  downloadFile: vi.fn(),
  downloadSvg: vi.fn(),
}));

// A data URL, so the export embeds the logo without loading an image.
vi.mock("../utils/chartLogo", () => ({
  CHART_LOGO: {
    href: "data:image/png;base64,iVBORw0KGgo=",
    width: 80,
    height: 17,
    padding: 8,
  },
}));

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze extension" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
];
const ALL = POLICIES.map((policy) => policy.id);

beforeEach(() => {
  resetGeographyCache();
  vi.stubGlobal("fetch", geographyFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(downloadSvg).mockClear();
});

async function renderMap(props = {}) {
  const utils = render(
    <ConstituencyMap
      selectedPolicies={ALL}
      selectedYear={2029}
      policies={POLICIES}
      {...props}
    />,
  );
  await waitFor(() =>
    expect(
      utils.container.querySelectorAll("path.constituency-path[data-state]"),
    ).toHaveLength(8),
  );
  return utils;
}

const seat = (container, code) =>
  container.querySelector(`path.constituency-path[data-code="${code}"]`);

const tooltip = (container) => container.querySelector(".constituency-tooltip");

/** Choose how the change is shown, in the card's Options pill. */
function showChangeAs(name) {
  fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
  // A click applies the choice and closes the popover
  fireEvent.click(screen.getByRole("radio", { name }));
}

describe("ConstituencyMap", () => {
  it("defines the withheld hatch as a vector pattern in the map's own defs", async () => {
    const { container } = await renderMap();
    const pattern = container.querySelector(
      "svg > defs > pattern#withheld-hatch",
    );
    expect(pattern).not.toBeNull();
    expect(pattern.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(pattern.querySelector("line")).not.toBeNull();
    expect(pattern.id).not.toMatch(/[\d:]/);
  });

  it("hatches withheld seats and never colours them", async () => {
    const { container } = await renderMap();
    const withheld = seat(container, "Z14000003");
    expect(withheld.getAttribute("fill")).toBe(WITHHELD_FILL);
    expect(withheld.getAttribute("fill")).toBe("url(#withheld-hatch)");
    expect(withheld.getAttribute("data-state")).toBe("withheld");
    expect(withheld.style.fill).toBe("");
  });

  it("colours seats by category, and dots an approximate seat's colour", async () => {
    const { container } = await renderMap();
    const fill = (code) => seat(container, code).getAttribute("fill");
    const opacity = (code) => seat(container, code).getAttribute("fill-opacity");
    expect(fill("Z14000001")).toBe(CATEGORY_COLOURS.large_gain);
    expect(opacity("Z14000001")).toBe("1");
    // Status is a texture over the category's own colour, not a lighter
    // colour that could be read as a smaller change.
    expect(fill("Z14000002")).toBe(approximateFill("small_gain"));
    expect(opacity("Z14000002")).toBe("1");
    const dots = container.querySelector(
      `svg > defs > pattern#${approximatePatternId("small_gain")}`,
    );
    expect(dots.querySelector("rect").getAttribute("fill")).toBe(
      CATEGORY_COLOURS.small_gain,
    );
    expect(dots.querySelector("circle")).not.toBeNull();
    expect(dots.id).not.toMatch(/[\d:]/);
    expect(fill("Z14000004")).toBe(CATEGORY_COLOURS.too_uncertain);
    expect(fill("Z14000005")).toBe(CATEGORY_COLOURS.large_loss);
    expect(fill("Z14000007")).toBe(CATEGORY_COLOURS.little_change);
    expect(fill("Z14000008")).toBe(CATEGORY_COLOURS.little_change);
  });

  it("draws a seat with no row as no data, never as a value", async () => {
    const { container } = await renderMap();
    const missing = seat(container, "Z14000006");
    expect(missing.getAttribute("data-state")).toBe("no-data");
    expect(missing.getAttribute("fill")).toBe(NO_DATA_FILL);
    fireEvent.click(missing);
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Lough Side");
    expect(card).toHaveTextContent(
      "No data. No figure is published for this constituency.",
    );
    expect(card.textContent).not.toMatch(/%|£/);
  });

  it("draws the legend inside the SVG, with categories and tiers", async () => {
    const { container } = await renderMap();
    const legend = container.querySelector("svg > g.map-legend");
    expect(legend).not.toBeNull();
    const text = legend.textContent;
    for (const entry of [
      "Large gain: 1% or more",
      "Small gain: 0.1% to 1%",
      "Little change: under 0.1% either way",
      "Small loss: 0.1% to 1%",
      "Large loss: 1% or more",
      "Too uncertain to classify",
      "Status, shown by texture",
      "Reported: solid",
      "Approximate: dotted, few survey households",
      "Not published: hatched, confidentiality",
      "No data: blank",
    ]) {
      expect(text).toContain(entry);
    }
    expect(legend.querySelector(`rect[fill="${WITHHELD_FILL}"]`)).not.toBeNull();
    // Status swatches carry texture over a gain and a loss colour, so none
    // reads as a size of change.
    expect(
      legend.querySelectorAll(`rect[fill="${approximateFill("large_gain")}"]`),
    ).toHaveLength(1);
    // No explanation of deliberate noise, and no red dot on any seat: the
    // only circles are the dots inside the approximate textures.
    expect(text).not.toMatch(/noise/i);
    const circles = [...container.querySelectorAll('svg[role="img"] circle')];
    expect(circles.every((circle) => circle.closest("pattern"))).toBe(true);

    showChangeAs("£ per household");
    await waitFor(() =>
      expect(container.querySelector("svg > g.map-legend").textContent).toContain(
        "Large gain: £100 or more",
      ),
    );
  });

  it("puts the key under the map, never over it, and keeps the legend for the file", async () => {
    const { container } = await renderMap();
    const map = container.querySelector('svg[role="img"]');
    // On screen the key is HTML, outside the map's SVG: a ramp from loss
    // to gain, too uncertain, and the three status textures
    const key = screen.getByRole("group", { name: "Key" });
    expect(map.contains(key)).toBe(false);
    expect(key).toHaveTextContent("Change in household net income, % of income");
    const entries = [...key.querySelectorAll("button[data-key]")].map((button) => button.getAttribute("aria-label"));
    expect(entries.slice(0, 5)).toEqual([
      expect.stringMatching(/^Large loss, 1% or more: \d+ seats?$/),
      expect.stringMatching(/^Small loss, 0.1% to 1%: /),
      expect.stringMatching(/^Little change, under 0.1% either way: /),
      expect.stringMatching(/^Small gain, 0.1% to 1%: /),
      expect.stringMatching(/^Large gain, 1% or more: /),
    ]);
    expect(key).toHaveTextContent("Too uncertain");
    expect(key).not.toHaveTextContent("Shown by pattern:");
    expect(key).toHaveTextContent("Approximate");
    expect(key).toHaveTextContent("Not published");
    expect(key).toHaveTextContent("No data");
    expect(key).not.toHaveTextContent("Reported");
    // The SVG carries no logo of its own; the card's logo row does
    expect(map.querySelector("image")).toBeNull();
    // The SVG's legend, for the exported file, sits in its corner
    const legend = map.querySelector(":scope > g.map-legend");
    expect(legend.getAttribute("transform")).toBe("translate(12, 12)");
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency-level impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "SVG Vector image" }));
    await waitFor(() => expect(downloadSvg).toHaveBeenCalledTimes(1));
    const [svgText] = vi.mocked(downloadSvg).mock.calls[0];
    const root = new DOMParser().parseFromString(svgText, "image/svg+xml")
      .documentElement;
    expect(root.querySelector("g.map-legend").getAttribute("transform")).toBe(
      "translate(12, 12)",
    );
    expect(root.getAttribute("viewBox")).toMatch(/^0 0 800 /);
  });

  it("has no footnote under the map; the search box says what to do", async () => {
    // The dotted / hatched rules live on the Methodology tab (Figures by area)
    await renderMap();
    expect(
      screen.queryByText(/Dotted constituencies rest on few survey households/),
    ).toBeNull();
    expect(screen.queryByText(/Select a constituency, or search for one/)).toBeNull();
    expect(screen.queryByText(/Lighter constituencies/)).toBeNull();
    expect(
      screen.getByPlaceholderText("Search or select a constituency"),
    ).toBeInTheDocument();
  });

  it("makes the legend as wide as its longest line", async () => {
    // jsdom lays out no text, so each line is measured as 6 units a letter.
    const prototype = window.SVGElement.prototype;
    prototype.getComputedTextLength = function () {
      return this.textContent.length * 6;
    };
    try {
      const { container } = await renderMap();
      const legend = container.querySelector("svg > g.map-legend");
      const ends = [...legend.querySelectorAll("text")].map(
        (line) => Number(line.getAttribute("x")) + line.textContent.length * 6,
      );
      const box = legend.querySelector(":scope > rect");
      expect(Number(box.getAttribute("width"))).toBe(
        Math.ceil(Math.max(...ends) + 10),
      );
    } finally {
      delete prototype.getComputedTextLength;
    }
  });

  it("fits the legend's lines when they cannot be measured", async () => {
    const { container } = await renderMap();
    const legend = container.querySelector("svg > g.map-legend");
    const width = Number(legend.querySelector(":scope > rect").getAttribute("width"));
    for (const line of legend.querySelectorAll("text")) {
      // Half the font size a letter is already wider than most text.
      const size = Number(line.getAttribute("font-size"));
      const end = Number(line.getAttribute("x")) + line.textContent.length * size * 0.5;
      expect(end).toBeLessThan(width);
    }
  });

  it("shows a reported seat's rounded value, interval, direction, tier and band", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000001"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Northfield East");
    expect(card).toHaveTextContent("+1.12%");
    expect(card).toHaveTextContent("90% interval: 0.61% to 1.63%");
    expect(card).toHaveTextContent("Gain");
    expect(card).toHaveTextContent("Reported");
    expect(card).toHaveTextContent("30 or more survey households");
    expect(card).toHaveTextContent("Map category: Large gain");
  });

  it("makes an approximate seat's interval prominent and says why", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000002"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent(
      "Harbour, Mill and Quay",
    );
    expect(card.querySelector(".tooltip-interval-emphasis")).toHaveTextContent(
      "90% interval: 0.12% to 1.24%",
    );
    expect(card).toHaveTextContent(
      "Approximate: few survey households, so the interval understates the uncertainty",
    );
    expect(card).toHaveTextContent("10 to 29 survey households");
  });

  it("says a too-uncertain seat's call and category in words", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000004"));
    const card = tooltip(container);
    expect(card).toHaveTextContent("Too close to call: the interval includes zero");
    expect(card).toHaveTextContent("Map category: Too uncertain to classify");
  });

  it("gives a withheld seat no figure, and its region's figure labelled as such", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000003"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Westmoor");
    const lines = [...card.querySelectorAll("p")].map((line) => line.textContent);
    expect(lines).toEqual([
      "Not published, to protect survey respondents' confidentiality.",
      "Regional figure for London, not an estimate for this constituency: +0.71% (0.52% to 0.94%)",
    ]);
  });

  it("finds a constituency by name, with its published figure", async () => {
    const { container } = await renderMap();
    fireEvent.change(screen.getByLabelText("Search or select a constituency"), {
      target: { value: "harbour" },
    });
    const result = screen.getByRole("button", { name: /Harbour, Mill and Quay/ });
    expect(result).toHaveTextContent("+0.68% (approximate)");
    fireEvent.click(result);
    expect(within(tooltip(container)).getByRole("heading")).toHaveTextContent(
      "Harbour, Mill and Quay",
    );
    fireEvent.change(screen.getByLabelText("Search or select a constituency"), {
      target: { value: "west" },
    });
    expect(screen.getByRole("button", { name: /Westmoor/ })).toHaveTextContent(
      "Not published",
    );
  });

  it("switches to £ per household with the published digits", async () => {
    const { container } = await renderMap();
    showChangeAs("£ per household");
    await waitFor(() =>
      expect(seat(container, "Z14000002").getAttribute("fill")).toBe(
        approximateFill("large_gain"),
      ),
    );
    fireEvent.click(seat(container, "Z14000005"));
    expect(tooltip(container)).toHaveTextContent("-£480");
    expect(tooltip(container)).toHaveTextContent("90% interval: -£610 to -£350");
  });

  it("follows the year, keeping hatched seats hatched", async () => {
    const { container, rerender } = await renderMap();
    rerender(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2030} policies={POLICIES} />,
    );
    await waitFor(() =>
      expect(seat(container, "Z14000001").getAttribute("fill")).toBe(
        CATEGORY_COLOURS.small_gain,
      ),
    );
    expect(seat(container, "Z14000002").getAttribute("data-state")).toBe("no-data");
    expect(seat(container, "Z14000003").getAttribute("fill")).toBe(WITHHELD_FILL);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("2030-31");
  });

  it("never sums, and offers no measure without constituency results in the Measure picker", async () => {
    render(
      <ConstituencyMap
        selectedPolicies={["fuel_duty_freeze", "two_child_limit"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    // Neither selected measure has constituency results (the fuel duty
    // freeze is published by region only), so there is no measure to pick
    // and the card says it shows one measure at a time
    expect(await screen.findByText(/shown for one measure at a time/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    expect(screen.queryByRole("radiogroup", { name: "Measure" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(document.querySelector(".map-title-focus")).toBeNull();
  });

  it("points to the region view for a measure published by region only", async () => {
    render(
      <ConstituencyMap
        selectedPolicies={["fuel_duty_freeze"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    expect(
      await screen.findByText("Results for this measure are published by region only."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "See the results by region." }),
    ).toHaveAttribute("href", "#results-by-region");
  });

  it("says a measure with no results by area is not yet published", async () => {
    render(
      <ConstituencyMap
        selectedPolicies={["rail_fares_freeze"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    expect(
      await screen.findByText(
        "Results by constituency are not yet published for this measure.",
      ),
    ).toBeInTheDocument();
  });

  it("fails closed on last year's table and on a missing file", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/constituency.csv": geographyFixture("legacy-constituency-2025.csv"),
      }),
    );
    const { container, unmount } = render(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    );
    expect(
      await screen.findByText("Results by constituency are not yet published."),
    ).toBeInTheDocument();
    // No results map: at most the unpublished template, every seat grey.
    const drawn = [...container.querySelectorAll("svg path")].filter(
      (path) =>
        !path.closest(
          ".map-template-svg, .chart-download, .pill-select, .title-icon, .control-bar-options, .chart-more-info",
        ),
    );
    expect(drawn).toEqual([]);
    container
      .querySelectorAll(".map-template-svg path")
      .forEach((path) => expect(path.getAttribute("fill")).toBe(CHART_COLOURS.axis));
    unmount();

    resetGeographyCache();
    vi.stubGlobal("fetch", geographyFetch({ "/data/constituency.csv": 404 }));
    render(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    );
    expect(
      await screen.findByText("Results by constituency are not yet published."),
    ).toBeInTheDocument();
    // The package is published by region, so the notice points there.
    expect(
      await screen.findByRole("link", { name: "See the results by region." }),
    ).toHaveAttribute("href", "#results-by-region");
  });

  it("downloads every constituency's published row as CSV", async () => {
    await renderMap();
    vi.mocked(downloadFile).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency-level impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "CSV Data" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [content, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe(
      "constituency-results-autumn_budget_2026_combined-2029.csv",
    );
    expect(mimeType).toBe("text/csv;charset=utf-8");
    const lines = content.slice(1).trim().split("\r\n");
    expect(lines[0]).toMatch(/^# Generated: /);
    expect(lines).toContain("# Reform: autumn_budget_2026_combined");
    expect(lines).toContain("# Year: 2029-30");
    const header = lines.find((line) => !line.startsWith("#") && !line.startsWith('"#'));
    expect(header.split(",")[0]).toBe("area_code");
  });

  it("exports the hatch, the legend and the selected seat's card", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000003"));
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency-level impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "SVG Vector image" }));
    await waitFor(() => expect(downloadSvg).toHaveBeenCalledTimes(1));
    const [svgText, filename] = vi.mocked(downloadSvg).mock.calls[0];
    expect(filename).toBe(
      "constituency-map-autumn_budget_2026_combined-relative_change-2029",
    );
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    expect(root.querySelector(":scope > defs > pattern#withheld-hatch")).not.toBeNull();
    expect(
      root.querySelector('path[data-code="Z14000003"]').getAttribute("fill"),
    ).toBe("url(#withheld-hatch)");
    expect(root.querySelector("g.map-legend").textContent).toContain(
      "Not published: hatched, confidentiality",
    );
    // The exported file carries the dot textures its approximate seats use.
    expect(
      root.querySelector(
        `:scope > defs > pattern#${approximatePatternId("small_gain")}`,
      ),
    ).not.toBeNull();
    expect(root.querySelector("g.map-zoom-layer").hasAttribute("transform")).toBe(
      false,
    );
    // The card wraps long lines into separate text elements.
    const card = [...root.querySelectorAll("g.map-export-card text")]
      .map((line) => line.textContent)
      .join(" ");
    expect(card).toBe(
      "Westmoor Not published, to protect survey respondents' " +
        "confidentiality. Regional figure for London, not an estimate " +
        "for this constituency: +0.71% (0.52% to 0.94%)",
    );
    expect(svgText).not.toMatch(/NaN|undefined/);
    expect(root.querySelector("image").getAttribute("href")).toMatch(/^data:/);
  });
});

describe("ConstituencyMap and the release's area routing", () => {
  const NOT_AVAILABLE = "Results by constituency are not available on this release.";
  const NOT_LOADED = "Results by constituency could not be loaded.";
  const FIGURES = /[+-]£|[+-][\d.]+%|\d+\.\d+%/;
  // How to read the map is in "About this chart", whose closed line names
  // its parts; on a release that routes nothing it describes the measure only.
  const HOW_TO_READ = /How it's calculated/;
  // A fetch that fails, as on a network error, only when it is awaited.
  const NETWORK_FAILURE = {
    then: (_, reject) => reject(new TypeError("network down")),
  };

  // The placeholder may draw the boundaries in grey, with a disabled search
  // box and download menu, but no seat, figure or export from the file.
  const expectNothingFromTheFile = (container) => {
    expect(container.querySelector("path.constituency-path")).toBeNull();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    for (const path of container.querySelectorAll(".map-template-svg path")) {
      expect(path.getAttribute("fill")).toBe(CHART_COLOURS.axis);
    }
    expect(
      screen.getByRole("button", { name: /Download chart/ }),
    ).toBeDisabled();
    const search = screen.queryByLabelText("Search or select a constituency");
    if (search) expect(search).toBeDisabled();
    // Each text node apart, so the title's year and the Options pill's
    // "% of income" are not read as one figure ("2029-30% of income")
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent);
    expect(texts.join(" ")).not.toMatch(FIGURES);
  };

  it.each([
    ["routes them to a local-area release", "local_area"],
    ["routes them to an area-coded national release", "area_coded_national"],
  ])("draws the map when the release %s", async (_, kind) => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ [AREA_ROUTING_URL]: areaRouting("available", kind) }),
    );
    const { container } = await renderMap();
    expect(seat(container, "Z14000001").getAttribute("fill")).toBe(
      CATEGORY_COLOURS.large_gain,
    );
    expect(screen.queryByText(NOT_AVAILABLE)).not.toBeInTheDocument();
    expect(screen.getByText(HOW_TO_READ)).toBeInTheDocument();
  });

  it.each([
    ["the current table", undefined, null],
    ["last year's table", geographyFixture("legacy-constituency-2025.csv"), null],
    ["no table", 404, null],
    // What the module writes for a routing missing a template.
    ["a local-area kind", undefined, "local_area"],
    ["an area-coded national kind", undefined, "area_coded_national"],
  ])(
    "says results by constituency are not available on a release that routes none, with %s",
    async (_, table, kind) => {
      vi.stubGlobal(
        "fetch",
        geographyFetch({
          [AREA_ROUTING_URL]: areaRouting("not_available", kind),
          ...(table === undefined ? {} : { "/data/constituency.csv": table }),
        }),
      );
      const { container } = render(
        <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
      );
      expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument();
      // The notice is the label alone, and the card no longer says how to
      // read a map it does not draw.
      expect(screen.getByRole("status")).toHaveTextContent(
        /^Results by constituency are not available on this release\.(See the results by region\.)?$/,
      );
      expect(
        screen.getByText(
          "Average change in household net income by constituency.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(HOW_TO_READ)).not.toBeInTheDocument();
      // Regions are published only from an enhanced FRS run, which does not
      // read the routing, so the notice still points to them.
      expect(
        await screen.findByRole("link", { name: "See the results by region." }),
      ).toHaveAttribute("href", "#results-by-region");
      expectNothingFromTheFile(container);
    },
  );

  it("says so for one measure as for the package", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ [AREA_ROUTING_URL]: areaRouting("not_available") }),
    );
    render(
      <ConstituencyMap
        selectedPolicies={["rail_fares_freeze"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Results by constituency are not yet published for this measure.",
      ),
    ).not.toBeInTheDocument();
  });

  it("never shows a table's figures while the routing loads", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        [AREA_ROUTING_URL]: gate.then(() => areaRouting("not_available")),
      }),
    );
    const { container } = render(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
    );
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    // Let the table and the boundaries arrive first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    expect(container.querySelector("path.constituency-path")).toBeNull();
    await act(async () => {
      release();
      await gate;
    });
    expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(container.querySelector("path.constituency-path")).toBeNull();
  });

  it.each([
    ["is missing", 404],
    ["answers with an HTTP error", 500],
    [
      "answers with an HTTP error whose body says available",
      { status: 503, body: areaRouting("available") },
    ],
    ["cannot be fetched", NETWORK_FAILURE],
    ["is not JSON", "<!doctype html><p>Service unavailable</p>"],
    ["is not a routing status", '{"area_views": "partly"}'],
    // The module writes available only with a kind the area run serves.
    ["says available with no kind", areaRouting("available", null)],
  ])(
    "says results by constituency could not be loaded, and shows none, when the routing file %s",
    async (_, answer) => {
      // The table and the boundaries load: only the routing fails.
      vi.stubGlobal("fetch", geographyFetch({ [AREA_ROUTING_URL]: answer }));
      const { container } = render(
        <ConstituencyMap selectedPolicies={ALL} selectedYear={2029} policies={POLICIES} />,
      );
      expect(await screen.findByText(NOT_LOADED)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        /^Results by constituency could not be loaded\.(See the results by region\.)?$/,
      );
      expect(screen.queryByText(NOT_AVAILABLE)).not.toBeInTheDocument();
      // As for any file that fails to load, the card still says how to read
      // the map.
      expect(screen.getByText(HOW_TO_READ)).toBeInTheDocument();
      // Let the other files arrive: nothing from them shows.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(screen.getByText(NOT_LOADED)).toBeInTheDocument();
      expectNothingFromTheFile(container);
    },
  );
});

describe("exportMapAsSvg", () => {
  it("keeps the card's published strings as given", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "map-zoom-layer");
    layer.setAttribute("transform", "translate(10,10) scale(2)");
    svg.appendChild(layer);
    await exportMapAsSvg(svg, "map", {
      title: "Title",
      tooltip: {
        title: "Northfield East",
        lines: [
          { kind: "value", text: "+1.12%", direction: "gain" },
          { kind: "interval", text: "90% interval: 0.61% to 1.63%" },
          { kind: "detail", text: "Reported" },
        ],
      },
    });
    const [svgText] = vi.mocked(downloadSvg).mock.calls[0];
    expect(svgText).toContain(">+1.12%<");
    expect(svgText).toContain(">90% interval: 0.61% to 1.63%<");
    expect(svgText).toContain(">Reported<");
    expect(svgText).not.toContain("translate(10,10)");
  });
});
