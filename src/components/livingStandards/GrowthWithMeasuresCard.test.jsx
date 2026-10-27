import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GrowthWithMeasuresCard, { WITH_MEASURES_TITLE, clearGrowthWithMeasuresCache } from "./GrowthWithMeasuresCard";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";
import { MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { NO_PACKAGE_PUBLISHED, PACKAGE_NOT_IN_FILE } from "../../utils/incomePosition";

const PUBLIC = join(__dirname, "..", "..", "..", "public", "data");
const OUTLOOK = readFileSync(join(PUBLIC, "living_standards_outlook.json"), "utf8");
// A frozen copy of the candidates' file (four of its runs), not public/data's:
// Budget day's --published-package run rewrites that file with the announced
// measures only, which would fail these tests on every publish PR (rehearsal
// of 27 October)
const FILE = readFileSync(join(__dirname, "..", "..", "test", "fixtures", "flat", "income_growth_with_measures.csv"), "utf8");
let GROWTH = FILE;

// The published package as the manifest keys it: two measures and their
// combined run of exactly those two (#228)
const PAIR = ["plan_2_threshold_unfreeze", "threshold_freeze_2031_32"];
const KEY = "combined--plan_2_threshold_unfreeze+threshold_freeze_2031_32";
const catalogue = {
  displayable: PAIR.map((id) => ({ id })),
  combinedId: KEY,
  manifest: { measures: {}, combined: { [KEY]: { measures: PAIR } } },
};
const withCatalogue = ({ children }) => <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;

beforeEach(() => {
  GROWTH = FILE;
  clearGrowthWithMeasuresCache();
  clearOutlookCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).endsWith("living_standards_outlook.json")) return new Response(OUTLOOK, { status: 200 });
      if (String(url).endsWith("income_growth_with_measures.csv")) return new Response(GROWTH, { status: 200 });
      return new Response("", { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Growth across the distribution, with the selected measures", () => {
  it("shows the measures' effect by default, labelled with the measures, with a link to its twin", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32"]} twinLink={<a href="?tab=outlook&sub=living">twin</a>} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    // The header holds only the twin link; "with the measures" is in About
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/with the policies less without them, in percentage points/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "twin" })).toBeTruthy();
    expect(screen.getAllByText(/Difference from current law/).length).toBeGreaterThan(0);
    expect(document.querySelector(".chart-description").textContent).toMatch(/^The policies (barely )?change income growth/);
  });

  it("says so, with no chart, when the measure does not move HBAI income", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["road_fuel_vat_cut"]} twinLink={null} />);
    expect(await screen.findByText(/do not change this income/)).toBeTruthy();
    expect(screen.queryByText(/Difference from current law/)).toBeNull();
  });

  it("stands part of the package for the manifest's package, with a note", async () => {
    // The file's package rows under the manifest's key, as generate
    // --only income_growth --published-package writes them
    GROWTH = FILE.replaceAll("autumn_budget_2026_combined,", `${KEY},`);
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />, { wrapper: ({ children }) => {
      const partial = { ...catalogue, displayable: [...PAIR, "badr_lifetime_limit_cut"].map((id) => ({ id })) };
      return <MeasureCatalogueProvider catalogue={partial}>{children}</MeasureCatalogueProvider>;
    } });
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/this is the whole package/)).toBeTruthy();
  });

  it("shows the manifest's package for the whole selection, with no note", async () => {
    GROWTH = FILE.replaceAll("autumn_budget_2026_combined,", `${KEY},`);
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />, { wrapper: withCatalogue });
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.queryByText(/this is the whole package/)).toBeNull();
    expect(screen.queryByText(PACKAGE_NOT_IN_FILE)).toBeNull();
  });

  it("refuses another package's rows: the registry's nine-measure run is not the manifest's package (issue 228)", async () => {
    // The file as committed: its package rows are autumn_budget_2026_combined
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />, { wrapper: withCatalogue });
    expect(await screen.findByText(PACKAGE_NOT_IN_FILE)).toBeTruthy();
    expect(screen.queryByText(/Difference from current law/)).toBeNull();
  });

  it("refuses when no package is published at all, saying that rather than blaming the file", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />);
    expect(await screen.findByText(NO_PACKAGE_PUBLISHED)).toBeTruthy();
    expect(screen.queryByText(PACKAGE_NOT_IN_FILE)).toBeNull();
  });
});
