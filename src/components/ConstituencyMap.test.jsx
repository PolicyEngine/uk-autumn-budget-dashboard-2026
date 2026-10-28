import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ConstituencyMap, { ONE_POLICY_NOTE, legendPlacement } from "./ConstituencyMap";
import { CHART_COLOURS } from "../utils/chartTheme";
import { downloadFile, downloadSvg } from "../utils/downloadFile";
import { exportMapAsSvg } from "../utils/exportMapAsSvg";
import { resetGeographyCache } from "../hooks/useGeographyData";
import {
  NO_DATA_FILL,
  NO_DATA_STROKE,
} from "../utils/geography/palette";
import { SCALE_COLOURS, scaleColour } from "../utils/geography/scale";
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

  it("says under its title where households gain or lose, from the figures the map colours", async () => {
    const { container } = await renderMap();
    expect(container.querySelector(".chart-header .chart-description").textContent).toMatch(
      /^Households (gain|lose) on average in \d+ constituenc/,
    );
  });

  it("draws withheld seats as No data and never colours them", async () => {
    const { container } = await renderMap();
    const withheld = seat(container, "Z14000003");
    // One No data swatch for not published, no row and too uncertain
    // (Vahid, 28 October): blank, outlined, never a colour on the scale
    expect(withheld.getAttribute("fill")).toBe(NO_DATA_FILL);
    expect(withheld.getAttribute("stroke")).toBe(NO_DATA_STROKE);
    expect(withheld.getAttribute("data-state")).toBe("withheld");
    expect(withheld.style.fill).toBe("");
    expect(seat(container, "Z14000006").getAttribute("fill")).toBe(NO_DATA_FILL);
  });

  it("colours seats on the 2025 dashboard's continuous scale, an approximate seat plain like the rest", async () => {
    const { container } = await renderMap();
    const fill = (code) => seat(container, code).getAttribute("fill");
    const opacity = (code) => seat(container, code).getAttribute("fill-opacity");
    // +1.12% is past the scale's +1% end: clamped to its teal
    expect(fill("Z14000001")).toBe(SCALE_COLOURS.gain.toLowerCase());
    expect(opacity("Z14000001")).toBe("1");
    // No texture on any seat (Vahid, 28 October): an approximate seat is
    // its own colour, full strength; its card says it is approximate
    expect(fill("Z14000002")).toBe(scaleColour("0.0068", 0.01));
    expect(opacity("Z14000002")).toBe("1");
    const fills = [...container.querySelectorAll("path.constituency-path")].map((path) => path.getAttribute("fill"));
    expect(fills.some((value) => value.startsWith("url("))).toBe(false);
    // Too uncertain to place on the scale: the No data swatch, not a grey
    // that reads as a size of change
    expect(fill("Z14000004")).toBe(NO_DATA_FILL);
    expect(fill("Z14000005")).toBe(SCALE_COLOURS.loss.toLowerCase());
    expect(fill("Z14000007")).toBe(SCALE_COLOURS.neutral);
    expect(fill("Z14000008")).toBe(scaleColour("0.0004", 0.01));
  });

  it("a hovered seat shows its average and relative change in a floating card", async () => {
    const { container } = await renderMap();
    fireEvent.mouseOver(seat(container, "Z14000001"), { clientX: 40, clientY: 40 });
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText("Northfield East")).toBeInTheDocument();
    expect(tip).toHaveTextContent("+£310");
    expect(tip).toHaveTextContent("+1.12%");
    fireEvent.mouseOut(seat(container, "Z14000001"));
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

  it("draws the legend inside the SVG, with the scale and the statuses", async () => {
    const { container } = await renderMap();
    const legend = container.querySelector("svg > g.map-legend");
    expect(legend).not.toBeNull();
    const text = legend.textContent;
    for (const entry of [
      "\u22121%",
      "0%",
      "+1%",
      "No data: not published, or too few survey households",
    ]) {
      expect(text).toContain(entry);
    }
    expect(text).not.toMatch(/Too uncertain|Little change|hatched/);
    expect(legend.querySelector(`rect[fill="${NO_DATA_FILL}"]`)).not.toBeNull();
    expect(text).not.toMatch(/Approximate|dotted/);
    expect(legend.querySelector('rect[fill="url(#map-legend-gradient)"]')).not.toBeNull();
    // No explanation of deliberate noise, and no dot on any seat: the only
    // circles are inside the (unused) texture definitions.
    expect(text).not.toMatch(/noise/i);
    const circles = [...container.querySelectorAll('svg[role="img"] circle')];
    expect(circles.every((circle) => circle.closest("pattern"))).toBe(true);

    showChangeAs("£ per household");
    await waitFor(() =>
      expect(container.querySelector("svg > g.map-legend").textContent).toContain(
        "+£100",
      ),
    );
  });

  it("puts the key under the map, never over it, and keeps the legend for the file", async () => {
    const { container } = await renderMap();
    const map = container.querySelector('svg[role="img"]');
    // On screen the key is HTML, outside the map's SVG: a gradient from
    // loss to gain labelled at its ends and 0, then one No data chip
    // (Vahid, 28 October: the colour scale plus No data)
    const key = screen.getByRole("group", { name: "Key" });
    expect(map.contains(key)).toBe(false);
    expect(key).toHaveTextContent("Change in household net income, % of income");
    expect(key.querySelector(".map-key-labels").textContent).toBe("\u22121%0%+1%");
    expect(key).not.toHaveTextContent("Loss");
    expect(key).not.toHaveTextContent("Gain");
    expect(key).not.toHaveTextContent("0.1%");
    expect([...key.querySelectorAll("button[data-key]")].map((chip) => chip.textContent)).toEqual(["No data"]);
    // Little change is the scale's 0; approximate is said in About this chart
    expect(key).not.toHaveTextContent("Too uncertain");
    expect(key).not.toHaveTextContent("Little change");
    expect(key).not.toHaveTextContent("Shown by pattern:");
    expect(key).not.toHaveTextContent("Approximate");
    expect(key).not.toHaveTextContent("Not published");
    expect(key).not.toHaveTextContent("Reported");
    // The SVG carries no logo of its own; the card's logo row does
    expect(map.querySelector("image")).toBeNull();
    // The SVG's legend, for the exported file, sits in its corner
    const legend = map.querySelector(":scope > g.map-legend");
    expect(legend.getAttribute("transform")).toBe("translate(12, 12)");
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "SVG Vector image" }));
    await waitFor(() => expect(downloadSvg).toHaveBeenCalledTimes(1));
    const [svgText] = vi.mocked(downloadSvg).mock.calls[0];
    const root = new DOMParser().parseFromString(svgText, "image/svg+xml")
      .documentElement;
    expect(root.querySelector("g.map-legend").getAttribute("transform")).toBe(
      "translate(12, 12)",
    );
    // The file's frame (title, selection, source) is 1200px wide; the map
    // inside it keeps its own 800px drawing
    expect(root.getAttribute("viewBox")).toMatch(/^0 0 1200 /);
    expect(root.querySelector(":scope > svg").getAttribute("viewBox")).toMatch(/^0 0 800 /);
    expect(root.querySelector(":scope > title").textContent).toBe("Constituency impacts, 2029-30");
    // The file's footer is the logo alone: no source line (the CSV keeps it)
    expect(svgText).not.toContain("Source: PolicyEngine UK");
    expect(root.querySelector(":scope > image")).not.toBeNull();
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

  it("shows a reported seat's £ and % change, with no statistics appendix", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000001"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Northfield East");
    expect(within(card).getByRole("button", { name: "Close" })).toBeInTheDocument();
    const values = [...card.querySelectorAll(".seat-card-value")].map((node) => node.textContent);
    // The headline on one line, £ and share of income, labelled with
    // what the map shows (here the package)
    expect(card.querySelector(".seat-card-headline").textContent).toBe("+£310 · +1.12% of income");
    expect(values).toEqual(["+£310", "+1.12% of income"]);
    expect(card.querySelector(".seat-card-label")).toHaveTextContent("All policies");
    expect(card).not.toHaveTextContent("Relative change");
    expect(card.querySelector(".seat-card-value").style.color).not.toBe("");
    // A firm figure needs no note
    expect(card.querySelector(".seat-card-note")).toBeNull();
    expect(card).not.toHaveTextContent("Map category");
    expect(card).not.toHaveTextContent("90% interval");
    // No measure but the package has constituency rows: no By policy rows
    expect(card.querySelector(".seat-card-policies")).toBeNull();
  });

  it("gives an approximate seat one muted line saying so, with its interval", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000002"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Harbour, Mill and Quay");
    expect(card.querySelector(".seat-card-note").textContent).toBe(
      "Approximate: based on fewer than 30 survey households; 90% interval 0.12% to 1.24%",
    );
  });

  it("gives a seat whose interval includes zero its interval, not a verdict", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000004"));
    const card = tooltip(container);
    expect(card.querySelector(".seat-card-note")).toHaveTextContent("90% interval −0.9% to 1.7%");
    // Drawn as No data on the map, its card says why, and keeps its figure
    expect(card.querySelector(".seat-card-note")).toHaveTextContent(/^No data on the map: too uncertain to place on the scale; /);
    expect(card).not.toHaveTextContent("The interval includes zero");
    expect(card).not.toHaveTextContent("Map category");
  });

  it("gives a withheld seat no figure, and its region's figure labelled as such", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000003"));
    const card = tooltip(container);
    expect(within(card).getByRole("heading")).toHaveTextContent("Westmoor");
    const lines = [...card.querySelectorAll("p")].map((line) => line.textContent);
    expect(lines).toEqual([
      "No data: not published, too few survey households",
      "Regional figure for London, not an estimate for this constituency: +0.71% (0.52% to 0.94%)",
    ]);
  });

  it("lists each selected measure's own £ change for the seat, gains first", async () => {
    const extra = [
      "constituency,Z14000001,Northfield East,two_child_limit,2029,average_change,420.0,300.0,540.0,gain,reported,,30+,False,direct",
      "constituency,Z14000001,Northfield East,two_child_limit,2029,relative_change,0.015,0.01,0.02,gain,reported,,30+,False,direct",
      "constituency,Z14000001,Northfield East,fuel_duty_freeze,2029,average_change,-110.0,-150.0,-70.0,loss,reported,,30+,False,direct",
      "constituency,Z14000001,Northfield East,fuel_duty_freeze,2029,relative_change,-0.004,-0.005,-0.003,loss,reported,,30+,False,direct",
      "constituency,Z14000001,Northfield East,rail_fares_freeze,2029,average_change,,,,,withheld,disclosure_control,,False,direct",
      "constituency,Z14000001,Northfield East,rail_fares_freeze,2029,relative_change,,,,,withheld,disclosure_control,,False,direct",
    ];
    const csv = `${geographyFixture("constituency.csv").trimEnd()}\n${extra.join("\n")}\n`;
    vi.stubGlobal("fetch", geographyFetch({ "/data/constituency.csv": csv }));
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000001"));
    const card = tooltip(container);
    // The map shows the package, so its measures follow as "Of which"
    expect(card.querySelector(".seat-card-label")).toHaveTextContent("All policies");
    expect(card.querySelector(".seat-card-policies-heading").textContent).toBe("Of which");
    const rows = [...card.querySelectorAll(".seat-card-policy")].map((row) => [
      row.querySelector(".seat-card-policy-value").textContent,
    ]);
    expect(rows).toEqual([["+£420"], ["−£110"], ["Not published"]]);
    // A gain in teal, a loss in amber, each with a bar to scale
    const [gain, loss, withheld] = card.querySelectorAll(".seat-card-policy");
    expect(gain.querySelector(".seat-card-policy-value").style.color).not.toBe(
      loss.querySelector(".seat-card-policy-value").style.color,
    );
    expect(gain.querySelector(".seat-card-policy-bar > span").style.width).toBe("100%");
    // Not published is short, with its reason in the shared tip (hover,
    // focus or a tap), not the browser's title box
    const withheldValue = withheld.querySelector(".seat-card-withheld");
    expect(withheldValue.getAttribute("title")).toBeNull();
    fireEvent.focus(withheldValue);
    expect(document.getElementById(withheldValue.getAttribute("aria-describedby"))).toHaveTextContent(/confidentiality/);
    fireEvent.blur(withheldValue);
    expect(card.textContent).not.toMatch(/BY POLICY|By provision/);
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
        scaleColour("150", 100),
      ),
    );
    fireEvent.click(seat(container, "Z14000005"));
    expect(tooltip(container)).toHaveTextContent("−£480");
    expect(tooltip(container)).toHaveTextContent("−1.35%");
    expect(tooltip(container)).not.toHaveTextContent("90% interval");
  });

  it("follows the year, keeping withheld seats as No data", async () => {
    const { container, rerender } = await renderMap();
    rerender(
      <ConstituencyMap selectedPolicies={ALL} selectedYear={2030} policies={POLICIES} />,
    );
    await waitFor(() =>
      expect(seat(container, "Z14000001").getAttribute("fill")).toBe(
        scaleColour("0.0021", 0.01),
      ),
    );
    expect(seat(container, "Z14000002").getAttribute("data-state")).toBe("no-data");
    expect(seat(container, "Z14000003").getAttribute("data-state")).toBe("withheld");
    expect(seat(container, "Z14000003").getAttribute("fill")).toBe(NO_DATA_FILL);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("2030-31");
  });

  it("never sums, and says so when no selected policy has constituency results", async () => {
    render(
      <ConstituencyMap
        selectedPolicies={["fuel_duty_freeze", "two_child_limit"]}
        selectedYear={2029}
        policies={POLICIES}
      />,
    );
    // No combined run of these two is published and neither has its own
    // constituency rows, so the card says so, with no Policy option
    expect(
      await screen.findByText("Constituency results for this combination of policies are not published yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Policy:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    expect(screen.queryByRole("radiogroup", { name: "Policy" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(document.querySelector(".map-title-focus")).toHaveTextContent("selected policies");
  });

  it("shows the selection's combined run when every policy is selected, titled as the selection", async () => {
    const { container } = await renderMap();
    // The fixture's rows are the package's (the manifest's combined entry
    // of exactly the selected policies), so the seats are drawn from it
    expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: selected policies$/);
    expect(screen.queryByRole("button", { name: /^Policy:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    expect(screen.queryByRole("radiogroup", { name: "Policy" })).toBeNull();
  });

  it("follows the selection: one policy, then all of them again", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/constituency.csv": (() => {
          const [header, ...rows] = geographyFixture("constituency.csv").trim().split("\n");
          const own = rows.map((row) => row.replace(",autumn_budget_2026_combined,", ",two_child_limit,"));
          return `${[header, ...rows, ...own].join("\n")}\n`;
        })(),
      }),
    );
    const { container, rerender } = await renderMap();
    expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: selected policies$/);
    rerender(<ConstituencyMap selectedPolicies={["two_child_limit"]} selectedYear={2029} policies={POLICIES} />);
    await waitFor(() =>
      expect(container.querySelector(".map-title-focus")).toHaveTextContent("2 child limit repeal"),
    );
    expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8);
    // Two of three: no combined run of that pair, so the card shows the one
    // with its own rows (the Policy option's default), named in the title
    rerender(<ConstituencyMap selectedPolicies={["two_child_limit", "rail_fares_freeze"]} selectedYear={2029} policies={POLICIES} />);
    await waitFor(() =>
      expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: 2 child limit repeal$/),
    );
    expect(screen.queryByText(/combination of policies are not published/)).toBeNull();
    expect(container.querySelectorAll("path.constituency-path[data-state]")).toHaveLength(8);
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
      await screen.findByText("Results for this policy are published by region only."),
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
        "Results by constituency are not yet published for this policy.",
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
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "CSV Data" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [content, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    // Named after the card's title and year
    expect(filename).toBe("constituency-impacts-2029-30.csv");
    expect(mimeType).toBe("text/csv;charset=utf-8");
    const lines = content.slice(1).trim().split("\r\n");
    expect(lines[0]).toMatch(/^# Generated: /);
    expect(lines).toContain("# Reform: autumn_budget_2026_combined");
    expect(lines).toContain("# Year: 2029-30");
    expect(lines).toContain('"# Chart: Constituency impacts, 2029-30"');
    const header = lines.find((line) => !line.startsWith("#") && !line.startsWith('"#'));
    expect(header.split(",")[0]).toBe("area_code");
  });

  it("exports the No data seats, the legend and the selected seat's card", async () => {
    const { container } = await renderMap();
    fireEvent.click(seat(container, "Z14000003"));
    fireEvent.click(screen.getByRole("button", { name: "Download chart: Constituency impacts, 2029-30" }));
    fireEvent.click(screen.getByRole("button", { name: "SVG Vector image" }));
    await waitFor(() => expect(downloadSvg).toHaveBeenCalledTimes(1));
    const [svgText, filename] = vi.mocked(downloadSvg).mock.calls[0];
    expect(filename).toBe("constituency-impacts-2029-30");
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    expect(
      root.querySelector('path[data-code="Z14000003"]').getAttribute("fill"),
    ).toBe(NO_DATA_FILL);
    expect(root.querySelector("g.map-legend").textContent).toContain(
      "No data: not published, or too few survey households",
    );
    // No seat in the file carries a texture either
    const filePaths = [...root.querySelectorAll("path[data-code]")];
    expect(filePaths.length).toBeGreaterThan(0);
    expect(filePaths.some((path) => (path.getAttribute("fill") ?? "").startsWith("url("))).toBe(false);
    expect(root.querySelector("g.map-zoom-layer").hasAttribute("transform")).toBe(
      false,
    );
    // The card wraps long lines into separate text elements.
    const card = [...root.querySelectorAll("g.map-export-card text")]
      .map((line) => line.textContent)
      .join(" ");
    expect(card).toBe(
      "Westmoor No data: not published, too few survey households Regional figure for London, not an estimate " +
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
      SCALE_COLOURS.gain.toLowerCase(),
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
        "Results by constituency are not yet published for this policy.",
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

  describe("the Policy option and the key's place", () => {
    // The fixture's package rows, copied out for two single policies too
    const withSingles = () => {
      const [header, ...rows] = geographyFixture("constituency.csv").trim().split("\n");
      const copy = (id) => rows.map((row) => row.replace(",autumn_budget_2026_combined,", `,${id},`));
      return `${[header, ...rows, ...copy("two_child_limit"), ...copy("rail_fares_freeze")].join("\n")}\n`;
    };
    const setWidth = (width) => {
      window.innerWidth = width;
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
    };
    const initialWidth = window.innerWidth;
    afterEach(() => setWidth(initialWidth));

    it("lists the combined run, then each selected policy with its own results, combined by default", async () => {
      vi.stubGlobal("fetch", geographyFetch({ "/data/constituency.csv": withSingles() }));
      const { container } = await renderMap();
      // The policy is its own pill beside Options (Vahid, 28 October),
      // never folded into the Options summary
      const pill = screen.getByRole("button", { name: "Policy: All selected policies" });
      expect(screen.getByRole("button", { name: /^Options:/ })).toHaveTextContent(/^% of income · Hex map$/);
      expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: selected policies$/);
      fireEvent.click(pill);
      const list = screen.getByRole("listbox", { name: "Policy" });
      expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "All selected policies",
        "2 child limit repeal",
        "Rail fares freeze",
      ]);
      expect(within(list).getByRole("option", { name: "All selected policies" })).toHaveAttribute("aria-selected", "true");
      // Selected is fill and weight, never a tick
      expect(list.textContent).not.toMatch(/\u2713|\u2714/);
      fireEvent.click(within(list).getByRole("option", { name: "2 child limit repeal" }));
      await waitFor(() =>
        expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: 2 child limit repeal$/),
      );
      expect(screen.getByRole("button", { name: "Policy: 2 child limit repeal" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
      expect(screen.queryByRole("radiogroup", { name: "Policy" })).toBeNull();
    });

    it("offers only the selected policies, with All selected policies listed but unavailable until its map is published (AH1)", async () => {
      vi.stubGlobal("fetch", geographyFetch({ "/data/constituency.csv": withSingles() }));
      const { container } = render(
        <ConstituencyMap selectedPolicies={["fuel_duty_freeze", "rail_fares_freeze"]} selectedYear={2029} policies={POLICIES} />,
      );
      await waitFor(() =>
        expect(container.querySelector(".map-title-focus")).toHaveTextContent(/^: Rail fares freeze$/),
      );
      // One paragraph under the title: the figures, then one policy at a time
      const description = container.querySelector(".chart-header .chart-description");
      expect(description.textContent).toMatch(/^Households .*\. Until the map for all selected policies is published, it shows one policy at a time\.$/);
      expect(description.textContent.endsWith(ONE_POLICY_NOTE)).toBe(true);
      expect(container.querySelectorAll(".chart-header .chart-description")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: /^Policy:/ }));
      const list = screen.getByRole("listbox", { name: "Policy" });
      expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["All selected policies", "Rail fares freeze"]);
      expect(within(list).getByRole("option", { name: "All selected policies" })).toHaveAttribute("aria-disabled", "true");
      // Never the singles summed: the map stays on the one policy's own run
      expect(within(list).getByRole("option", { name: "Rail fares freeze" })).toHaveAttribute("aria-selected", "true");
    });

    it("places the key beside the map from 640px, and under it on a phone", async () => {
      expect(legendPlacement(1280)).toBe("side");
      expect(legendPlacement(640)).toBe("side");
      expect(legendPlacement(639)).toBe("below");
      expect(legendPlacement(390)).toBe("below");
      setWidth(1280);
      const { container } = await renderMap();
      const content = container.querySelector(".map-content");
      const key = screen.getByRole("group", { name: "Key" });
      expect(content).toHaveClass("is-legend-side");
      expect(key).toHaveClass("map-key-side");
      // Upright, gain at the top
      expect(key.querySelector(".map-key-gradient").style.background).toContain("to top");
      setWidth(390);
      expect(content).toHaveClass("is-legend-below");
      expect(key).toHaveClass("map-key-below");
      expect(key.querySelector(".map-key-gradient").style.background).toContain("to right");
    });
  });
});
