import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, waitFor, within } from "@testing-library/react";
import RegionView from "./RegionView";
import { downloadFile } from "../utils/downloadFile";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { EXPORT_COLUMNS } from "../utils/geography/columns";
import { parseCsv } from "../utils/publication/csv";
import {
  AREA_ROUTING_URL,
  areaRouting,
  geographyFetch,
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
  vi.mocked(downloadFile).mockClear();
});

function renderView(props = {}) {
  return render(
    <RegionView
      selectedPolicies={ALL}
      selectedYear={2029}
      policies={POLICIES}
      {...props}
    />,
  );
}

const rowFor = (name) => screen.getByRole("rowheader", { name }).closest("tr");

describe("RegionView", () => {
  it("scrolls the table sideways in its own labelled region, from the keyboard too", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const scroller = screen.getByRole("region", {
      name: "Table of results by region",
    });
    expect(scroller).toContainElement(table);
    expect(scroller).toHaveAttribute("tabindex", "0");
    // The caption wraps to the card rather than scrolling with the table,
    // and still names it.
    const caption = document.getElementById(table.getAttribute("aria-labelledby"));
    expect(scroller).not.toContainElement(caption);
    expect(table).toHaveAccessibleName(caption.textContent);
  });

  it("shows every region with its value, interval, direction, band and tier", async () => {
    renderView();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("rowheader")).toHaveLength(12);
    expect(screen.getByText("All measures (the full package)")).toBeInTheDocument();

    const northEast = within(rowFor("North East"));
    expect(northEast.getByText("+1.23%")).toBeInTheDocument();
    expect(northEast.getByText("0.8% to 1.6%")).toBeInTheDocument();
    expect(northEast.getByText("Gain")).toBeInTheDocument();
    expect(northEast.getByText("30 or more")).toBeInTheDocument();
    expect(northEast.getByText("Reported")).toBeInTheDocument();

    const southWest = within(rowFor("South West"));
    expect(southWest.getByText("+1%")).toBeInTheDocument();

    const westMidlands = within(rowFor("West Midlands"));
    expect(westMidlands.getByText("Approximate")).toBeInTheDocument();
    expect(westMidlands.getByText("The interval includes zero")).toBeInTheDocument();
    expect(westMidlands.getByText("10 to 29")).toBeInTheDocument();

    const eastOfEngland = within(rowFor("East of England"));
    expect(eastOfEngland.getByText("No change")).toBeInTheDocument();
    expect(eastOfEngland.getByText("0%")).toBeInTheDocument();
  });

  it("still shows results by region on a release that routes no results by area", async () => {
    // The area run publishes regions only from an enhanced FRS run, which
    // does not read the routing.
    vi.stubGlobal(
      "fetch",
      geographyFetch({ [AREA_ROUTING_URL]: areaRouting("not_available") }),
    );
    renderView();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(within(rowFor("North East")).getByText("+1.23%")).toBeInTheDocument();
    expect(screen.queryByText(/not available on this release/)).not.toBeInTheDocument();
  });

  it("says a withheld region is not published, and shows no figure for it", async () => {
    renderView();
    await screen.findByRole("table");
    const row = rowFor("Northern Ireland");
    expect(within(row).getAllByText("Not published")).toHaveLength(2);
    expect(row.textContent).not.toMatch(/\d/);
  });

  it("switches to £ per household with the published digits", async () => {
    renderView();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /^Show the change as:/ }));
    fireEvent.click(screen.getByRole("option", { name: /£ per household/ }));
    const london = within(rowFor("London"));
    expect(london.getByText("+£1,234.5")).toBeInTheDocument();
    expect(london.getByText("£1,100 to £1,369")).toBeInTheDocument();
    expect(within(rowFor("Yorkshire and The Humber")).getByText("-£50")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show the change as: £ per household" }),
    ).toBeInTheDocument();
  });

  it("marks a region with no published row as no data, never a value", async () => {
    renderView({ selectedYear: 2030 });
    await screen.findByRole("table");
    const scotland = rowFor("Scotland");
    expect(within(scotland).getByText("No data")).toBeInTheDocument();
    expect(scotland.textContent).not.toMatch(/\d/);
  });

  it("shows one measure's own figures", async () => {
    renderView({ selectedPolicies: ["fuel_duty_freeze"] });
    await screen.findByRole("table");
    expect(screen.getByText("Fuel duty freeze extension")).toBeInTheDocument();
    expect(within(rowFor("London")).getByText("+0.04%")).toBeInTheDocument();
    expect(within(rowFor("East Midlands")).getByText("+0.1%")).toBeInTheDocument();
  });

  it("has no plot column: the table shows each figure and interval as text", async () => {
    renderView();
    await screen.findByRole("table");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Region",
      "Change",
      "90% interval",
      "Direction",
      "Survey households",
      "Status",
    ]);
  });

  it("never sums: several measures but not all shows no figures", async () => {
    const { container } = renderView({
      selectedPolicies: ["fuel_duty_freeze", "two_child_limit"],
    });
    expect(
      await screen.findByText(
        "Results by region are shown for one measure at a time, or for all measures together.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // No figure anywhere: every published figure is signed or zero.
    expect(container.textContent).not.toMatch(/[+-]£|£0|[+-][\d.]+%|\b0%/);
    expect(
      screen.queryByRole("button", { name: /^Download chart: Results by region/ }),
    ).not.toBeInTheDocument();
  });

  it("says a measure with no regional rows is not yet published", async () => {
    renderView({ selectedPolicies: ["two_child_limit"] });
    expect(
      await screen.findByText(
        "Results by region are not yet published for this measure.",
      ),
    ).toBeInTheDocument();
  });

  it("fails closed when the file is missing or malformed", async () => {
    vi.stubGlobal("fetch", geographyFetch({ "/data/regional.csv": 404 }));
    const { unmount } = renderView();
    expect(
      await screen.findByText("Results by region are not yet published."),
    ).toBeInTheDocument();
    unmount();

    resetGeographyCache();
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/regional.csv": "level,area_code\nregion,E12000001\n" }),
    );
    renderView();
    expect(
      await screen.findByText("Results by region are not yet published."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The published file could not be read, so no figures are shown."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("exports the published strings as CSV, with metadata and a byte-order mark", async () => {
    renderView();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /^Download chart: Results by region/ }));
    fireEvent.click(screen.getByRole("button", { name: "CSV Data" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [content, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe("results-by-region-autumn_budget_2026_combined-2029.csv");
    expect(mimeType).toBe("text/csv;charset=utf-8");
    expect(content.startsWith("﻿# Generated: ")).toBe(true);

    const records = parseCsv(content.slice(1));
    const metadata = records.filter((cells) => cells[0].startsWith("#"));
    const [header, ...rows] = records.filter(
      (cells) => !cells[0].startsWith("#"),
    );
    expect(metadata.map((cells) => cells.join(","))).toEqual(
      expect.arrayContaining([
        "# Year: 2029-30",
        "# Reform: autumn_budget_2026_combined",
        expect.stringMatching(
          /^# Measures: All measures \(the full package\): 2 child limit repeal; Fuel duty freeze extension; Rail fares freeze$/,
        ),
      ]),
    );
    expect(header).toEqual([...EXPORT_COLUMNS]);
    expect(rows).toHaveLength(24);
    const london = rows.find(
      (cells) => cells[0] === "E12000007" && cells[4] === "average_change",
    );
    expect(london.slice(5, 9)).toEqual(["1234.5", "1100.0", "1369.0", "gain"]);
    const northernIreland = rows.find(
      (cells) => cells[0] === "N92000002" && cells[4] === "relative_change",
    );
    expect(northernIreland.slice(5)).toEqual([
      "",
      "",
      "",
      "",
      "withheld",
      "disclosure_control",
      "",
    ]);
  });

  it("exports the same rows as text", async () => {
    renderView({ selectedPolicies: ["fuel_duty_freeze"] });
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /^Download chart: Results by region/ }));
    fireEvent.click(screen.getByRole("button", { name: "TXT Plain text" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const [content, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe("results-by-region-fuel_duty_freeze-2029.txt");
    expect(mimeType).toBe("text/plain;charset=utf-8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("Results by region: UK Autumn Budget 2026 dashboard");
    expect(lines).toContain("Measure: Fuel duty freeze extension");
    expect(lines).toContain("Year: 2029-30");
    expect(lines.find((line) => line.startsWith("area_code"))).toMatch(
      /^area_code\s+area_name\s+reform\s+year\s+outcome\s+value\s+lo\s+hi\s+direction\s+tier\s+reason\s+support_band$/,
    );
    const east = lines.find(
      (line) => line.startsWith("E12000004") && line.includes("relative_change"),
    );
    expect(east).toMatch(/0\.0010\s+0\.0007\s+0\.0013\s+gain\s+reported/);
  });
});
