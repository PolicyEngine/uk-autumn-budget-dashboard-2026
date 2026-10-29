// "Where you sit" reads the package's UK distribution only under the
// manifest's combined key, and never fetches the root tenth tables (#228).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function catalogue({ withheld = false } = {}) {
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
      [KEY]: {
        winners_losers: winners(KEY, 1000).map((row) => withheld && ["1", "all"].includes(row.decile) ? { ...row, avg_change: null } : row),
        distributional_impact: relative(KEY, 0.5).map((row) => withheld && row.decile === "1st" ? { ...row, value: null } : row),
      },
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

async function renderChart(options) {
  // A fresh module each time: useDataFile keeps each file for the page
  const { default: IncomePositionChart } = await import("./IncomePositionChart");
  const { MeasureCatalogueProvider: Provider } = await import("../../utils/measureCatalogue");
  return render(
    <Provider catalogue={catalogue(options)}>
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
    expect(await screen.findByText(/Where your income sits, \d/)).toBeTruthy();
    expect(screen.queryByText(NOT_PUBLISHED)).toBeNull();
    expect(screen.queryByText(/not available for this year/)).toBeNull();
    const fetched = fetch.mock.calls.map(([url]) => String(url).split("/").pop());
    expect(fetched).not.toContain("winners_losers.csv");
    expect(fetched).not.toContain("distributional_impact.csv");
  });
  it("compares with the combined run's tenths, never the policies' figures added up", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    await renderChart();
    await screen.findByText(/Where your income sits, \d/);
    const alt = document.querySelector('[role="img"][aria-label^="Average change by tenth"]').getAttribute("aria-label");
    // The combined run's 0.50% in each tenth; alpha's 1% plus beta's 1% would be 2%
    expect(alt).toMatch(/1: \+0\.50%/);
    expect(alt).not.toMatch(/2\.00%/);
  });

  it("leaves a withheld tenth an empty slot, with a plain tick and no note, and the withheld UK average blank", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    const { container } = await renderChart({ withheld: true });
    await screen.findByText(/Where your income sits, \d/);
    const alt = container.querySelector('[role="img"][aria-label^="Average change by tenth"]').getAttribute("aria-label");
    // The withheld tenth is left out of the description, never given a value
    expect(alt).not.toMatch(/(^|[:,] )1: /);
    expect(alt).toContain("2: +0.50%");
    expect(container.textContent).not.toMatch(/Not published|confidential|survey respondents/i);
    const firstTick = [...container.querySelectorAll(".position-gains text")].find((text) => text.textContent === "1");
    expect(firstTick).toBeTruthy();
    expect(firstTick.querySelector("title")).toBeNull();
    expect(firstTick.parentElement.querySelectorAll("rect")).toHaveLength(0);
    expect([...container.querySelectorAll(".position-gains text")].some((text) => text.textContent.includes("*"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Options: By income tenth/ }));
    fireEvent.click(screen.getByRole("radio", { name: "You, your tenth and the UK average" }));
    const ukRow = screen.getByText("Average UK household").closest(".position-compare-row");
    expect(ukRow.querySelector(".position-compare-value strong").textContent).toBe("");
    expect(ukRow.querySelector(".position-compare-bar")).toBeNull();
    expect(ukRow.textContent).not.toMatch(/Not published|confidential/i);
  });

  it("keys the Spread view under the plot: your tenth's band, the curve, you and the median lines", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    const { container } = await renderChart();
    await screen.findByText(/Where your income sits, \d/);
    const legend = container.querySelector(".position-card .chart-legend");
    expect(legend).toBeTruthy();
    const labels = [...legend.querySelectorAll(".series-toggle-label")].map((node) => node.textContent);
    expect(labels).toEqual([
      "Your income tenth",
      "Share of people at each income",
      "You",
      "Median and its half/double",
    ]);
  });

  it("keys the tenths card too, and each key item is a button that shows or hides its part", async () => {
    served = { "income_distribution.csv": distribution(KEY), "income_mobility.csv": "" };
    const { container } = await renderChart();
    await screen.findByText(/Where your income sits, \d/);
    const [whereKey, gainsKey] = container.querySelectorAll(".position-card .chart-legend");
    const chips = [...gainsKey.querySelectorAll("button.series-toggle-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["Your income tenth", "Change for each tenth", "You"]);
    expect(chips.every((chip) => chip.getAttribute("aria-pressed") === "true")).toBe(true);

    // You off: the marker's label goes; on again: it comes back
    const gains = () => container.querySelector("svg.position-gains");
    expect(gains().textContent).toMatch(/You/);
    fireEvent.click(chips[2]);
    expect(chips[2].getAttribute("aria-pressed")).toBe("false");
    expect(gains().textContent).not.toMatch(/You/);
    fireEvent.click(chips[2]);
    expect(gains().textContent).toMatch(/You/);

    // The bars off: no bars drawn
    const bars = () => gains().querySelectorAll("rect[rx]").length;
    expect(bars()).toBe(10);
    fireEvent.click(chips[1]);
    expect(bars()).toBe(0);

    // The curve off on the left card
    const where = () => container.querySelector("svg.position-where");
    expect(where().querySelectorAll("path").length).toBe(2);
    fireEvent.click(whereKey.querySelectorAll("button.series-toggle-chip")[1]);
    expect(where().querySelectorAll("path").length).toBe(0);
  });
});

describe("changeFromLine: the policies behind your change (HH4)", () => {
  it("names the two largest, mostly when there are more", async () => {
    const { changeFromLine } = await import("./IncomePositionChart");
    expect(
      changeFromLine([
        { id: "a", label: "Employer NI threshold", rounded: 343 },
        { id: "b", label: "Student loan threshold unfrozen", rounded: 248 },
        { id: "c", label: "Threshold freeze", rounded: -73 },
      ]),
    ).toBe("Largest effects: Employer NI threshold (+£343) and Student loan threshold unfrozen (+£248).");
    expect(changeFromLine([{ id: "a", label: "Fuel duty frozen", rounded: 53 }])).toBe("Largest effect: Fuel duty frozen (+£53).");
    expect(changeFromLine(null)).toBeNull();
  });
});
