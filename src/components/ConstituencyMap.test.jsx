import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";
import { downloadSvg } from "../utils/downloadFile";
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

    fireEvent.click(screen.getByRole("button", { name: "£ per household" }));
    await waitFor(() =>
      expect(container.querySelector("svg > g.map-legend").textContent).toContain(
        "Large gain: £100 or more",
      ),
    );
  });

  it("keeps the legend and logo in the corners of what is shown", async () => {
    const observed = new Map();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback) {
          this.callback = callback;
        }
        observe(target) {
          observed.set(target, this.callback);
        }
        disconnect() {}
      },
    );
    const { container } = await renderMap();
    const map = container.querySelector('svg[role="img"]');
    const legend = map.querySelector(":scope > g.map-legend");
    const logo = map.querySelector(":scope > image.map-logo");
    expect(legend.getAttribute("transform")).toBe("translate(12, 12)");

    // Twice as wide as it is tall: 200 units show on either side of the
    // drawing area, so the legend moves left and the logo right.
    act(() => observed.get(map)([{ contentRect: { width: 1200, height: 600 } }]));
    expect(legend.getAttribute("transform")).toBe("translate(-188, 12)");
    expect(logo.getAttribute("x")).toBe("912");
    expect(logo.getAttribute("y")).toBe("575");

    // The file shows the drawing area alone, with the legend in its corner.
    fireEvent.click(screen.getByRole("button", { name: "Download map as SVG" }));
    await waitFor(() => expect(downloadSvg).toHaveBeenCalledTimes(1));
    const [svgText] = vi.mocked(downloadSvg).mock.calls[0];
    const root = new DOMParser().parseFromString(svgText, "image/svg+xml")
      .documentElement;
    expect(root.querySelector("g.map-legend").getAttribute("transform")).toBe(
      "translate(12, 12)",
    );
  });

  it("describes approximate seats as dotted, as the legend draws them", async () => {
    await renderMap();
    expect(
      screen.getByText(/Dotted constituencies rest on few survey households/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Lighter constituencies/)).toBeNull();
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
    fireEvent.change(screen.getByLabelText("Search constituency"), {
      target: { value: "harbour" },
    });
    const result = screen.getByRole("button", { name: /Harbour, Mill and Quay/ });
    expect(result).toHaveTextContent("+0.68% (approximate)");
    fireEvent.click(result);
    expect(within(tooltip(container)).getByRole("heading")).toHaveTextContent(
      "Harbour, Mill and Quay",
    );
    fireEvent.change(screen.getByLabelText("Search constituency"), {
      target: { value: "west" },
    });
    expect(screen.getByRole("button", { name: /Westmoor/ })).toHaveTextContent(
      "Not published",
    );
  });

  it("switches to £ per household with the published digits", async () => {
    const { container } = await renderMap();
    fireEvent.click(screen.getByRole("button", { name: "£ per household" }));
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
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("2030-31");
  });

  it("never sums: several measures but not all draws no map and no figures", async () => {
    const { container } = render(
      <ConstituencyMap
        selectedPolicies={["fuel_duty_freeze", "two_child_limit"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    expect(
      await screen.findByText(
        "Results by constituency are shown for one measure at a time, or for all measures together.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("svg path")).toBeNull();
    expect(container.textContent).not.toMatch(/[+-]£|[+-][\d.]+%/);
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
    expect(container.querySelector("svg path")).toBeNull();
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

  it("exports the hatch, the legend and the selected seat's card", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000003"));
    fireEvent.click(screen.getByRole("button", { name: "Download map as SVG" }));
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
  const HOW_TO_READ = /Select a constituency, or search for one/;
  // A fetch that fails, as on a network error, only when it is awaited.
  const NETWORK_FAILURE = {
    then: (_, reject) => reject(new TypeError("network down")),
  };

  const expectNothingFromTheFile = (container) => {
    expect(container.querySelector("svg path")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download map as SVG" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search constituency")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(FIGURES);
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
          "The average change in household net income in each constituency.",
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
    expect(container.querySelector("svg path")).toBeNull();
    await act(async () => {
      release();
      await gate;
    });
    expect(await screen.findByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(container.querySelector("svg path")).toBeNull();
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
