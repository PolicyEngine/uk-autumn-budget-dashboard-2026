// "Where you sit" reads the package's UK distribution only under the
// manifest's combined key, and never fetches the root tenth tables (#228).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { buildMeasureCatalogue } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { selectionNotPublished } from "../../utils/geography/selection";

const NOT_PUBLISHED = selectionNotPublished("Income distribution");

const PAIR = ["alpha", "beta"];
const KEY = "combined--alpha+beta";
const YEARS = [2026, 2027, 2028];
const manifestFixture = fixtureJson("manifest.json");

function winners(id, first) {
  return [
    ...Array.from({ length: 10 }, (_, i) => ({ reform_id: id, reform_name: id, year: 2027, decile: String(i + 1), avg_change: first + i })),
    { reform_id: id, reform_name: id, year: 2027, decile: "all", avg_change: first },
  ];
}

const DECILES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const relative = (id, value) => DECILES.map((decile) => ({ reform_id: id, reform_name: id, year: 2027, decile, value }));

function catalogue() {
  const entry = manifestFixture.measures.alpha;
  const measures = Object.fromEntries(PAIR.map((id) => [id, { ...entry, name: id, status: "provisional", years: YEARS, unsupported_years: [] }]));
  return buildMeasureCatalogue({
    manifest: {
      ...manifestFixture,
      measures,
      combined: {
        [KEY]: {
          ...manifestFixture.combined[KEY],
          status: "provisional",
          years: YEARS,
          unsupported_years: [],
          member_outputs_sha256: Object.fromEntries(PAIR.map((id) => [id, measures[id].outputs_sha256])),
        },
      },
    },
    tablesByKey: {
      alpha: { winners_losers: winners("alpha", 40), distributional_impact: relative("alpha", 1) },
      beta: { winners_losers: winners("beta", 33), distributional_impact: relative("beta", 1) },
      [KEY]: { winners_losers: winners(KEY, 1000), distributional_impact: relative(KEY, 0.5) },
    },
  });
}

function distribution(reformId) {
  const lines = ["reform_id,reform_name,year,side,percentile,equivalised_net_income"];
  for (const side of ["baseline", "reform"]) {
    for (let p = 1; p <= 99; p += 1) lines.push(`${reformId},x,2027,${side},${p},${p * 1000}`);
  }
  return lines.join("\n");
}

let served;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const name = String(url).split("/").pop();
      return name in served ? new Response(served[name], { status: 200 }) : new Response("", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function renderChart() {
  // A fresh module each time: useDataFile keeps each file for the page
  const { default: IncomePositionChart } = await import("./IncomePositionChart");
  const { MeasureCatalogueProvider: Provider } = await import("../../utils/measureCatalogue");
  return render(
    <Provider catalogue={catalogue()}>
      <IncomePositionChart net={{ before: 20000, after: 20100 }} household={{ has_partner: false, children: [] }} year={2027} policies={PAIR} yearLabel="2027-28" />
    </Provider>,
  );
}

describe("Where you sit, for the published package (issue 228)", () => {
  it("the test catalogue publishes the pair's combined run under its key", () => {
    expect(catalogue().combinedId).toBe(KEY);
  });

  it("refuses a distribution file whose package is another package: no section, no empty card", async () => {
    served = { "income_distribution.csv": distribution("autumn_budget_2026_combined"), "income_mobility.csv": "" };
    const { container } = await renderChart();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // The Your place tile says why, in one line (ResultTilesTenth.test)
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector(".card")).toBeNull();
    expect(screen.queryByText("Where you sit")).toBeNull();
    expect(screen.queryByText(NOT_PUBLISHED)).toBeNull();
  });

  it("gives the distribution its own Where you sit heading when it is there", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    await renderChart();
    expect(await screen.findByRole("heading", { level: 2, name: "Where you sit" })).toBeTruthy();
  });

  it("reads the package's curves under the manifest's key, and never fetches the root tenth tables", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    await renderChart();
    expect(await screen.findByText(/Your place in the distribution/)).toBeTruthy();
    expect(screen.queryByText(NOT_PUBLISHED)).toBeNull();
    expect(screen.queryByText(/not available for this year/)).toBeNull();
    const fetched = fetch.mock.calls.map(([url]) => String(url).split("/").pop());
    expect(fetched).not.toContain("winners_losers.csv");
    expect(fetched).not.toContain("distributional_impact.csv");
  });
  it("compares with the combined run's tenths, never the policies' figures added up", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    await renderChart();
    await screen.findByText(/Your place in the distribution/);
    const alt = document.querySelector('[role="img"][aria-label^="Average change by tenth"]').getAttribute("aria-label");
    // The combined run's 0.50% in each tenth; alpha's 1% plus beta's 1% would be 2%
    expect(alt).toMatch(/1: \+0\.50%/);
    expect(alt).not.toMatch(/2\.00%/);
  });

  it("keys the Spread view under the plot: your tenth's band, the curve, you and the median lines", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    const { container } = await renderChart();
    await screen.findByText(/Your place in the distribution/);
    const legend = container.querySelector(".position-card .chart-legend");
    expect(legend).toBeTruthy();
    const labels = [...legend.querySelectorAll(".grouped-legend-label")].map((node) => node.textContent);
    expect(labels).toEqual([
      expect.stringMatching(/^Your income tenth \(.+ tenth\)$/),
      "Share of people at each income",
      "You",
      "Median and its half/double",
    ]);
  });
});
