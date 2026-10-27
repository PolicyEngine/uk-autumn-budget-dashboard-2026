// "Where you sit" reads the package's UK distribution only under the
// manifest's combined key, and never fetches the root tenth tables (#228).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildMeasureCatalogue } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { PACKAGE_NOT_IN_FILE } from "../../utils/incomePosition";

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
      alpha: { winners_losers: winners("alpha", 40) },
      beta: { winners_losers: winners("beta", 33) },
      [KEY]: { winners_losers: winners(KEY, 1000) },
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

  it("refuses a distribution file whose package is another package, saying so", async () => {
    served = { "income_distribution.csv": distribution("autumn_budget_2026_combined"), "income_mobility.csv": "" };
    await renderChart();
    expect(await screen.findByText(PACKAGE_NOT_IN_FILE)).toBeTruthy();
  });

  it("reads the package's curves under the manifest's key, and never fetches the root tenth tables", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    await renderChart();
    expect(await screen.findByText("Your place (percentile)")).toBeTruthy();
    expect(screen.queryByText(PACKAGE_NOT_IN_FILE)).toBeNull();
    expect(screen.queryByText(/not available for this year/)).toBeNull();
    const fetched = fetch.mock.calls.map(([url]) => String(url).split("/").pop());
    expect(fetched).not.toContain("winners_losers.csv");
    expect(fetched).not.toContain("distributional_impact.csv");
  });
});
