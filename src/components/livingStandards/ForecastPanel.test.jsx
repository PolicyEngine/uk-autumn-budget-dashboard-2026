/**
 * The Forecast changes sub-tab before and after the Budget forecast is
 * published (forecast.post_published), from the real outlook file set to
 * each state, so both hold whichever state the committed file is in: the
 * Budget-day obr-forecast import publishes it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const REAL = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"), "utf8"),
);

const POST_LABEL = "OBR October 2026 (Autumn Budget)";
const POST_RELEASE = "OBR Economic and fiscal outlook, October 2026: detailed forecast tables, economy";
// build_outlook's post_label (src/uk_budget_data/living_standards/build.py)
const UNPUBLISHED_LABEL = "Budget forecast";

/**
 * The real file, unpublished, as uk-budget-data living-standards writes it
 * with no Budget forecast loaded: build_outlook's post_label, then
 * apply_post(outlook, None) (src/uk_budget_data/living_standards/forecast.py):
 * post_published false, post_source null, and every series' post a copy of
 * its pre, with no post_source.
 */
function unpublishedOutlook(base = REAL) {
  const data = structuredClone(base);
  const f = data.forecast;
  f.post_published = false;
  f.post_label = UNPUBLISHED_LABEL;
  f.post_source = null;
  for (const section of f.sections) {
    for (const series of section.series) {
      series.post = series.pre.map((p) => ({ ...p }));
      delete series.post_source;
    }
  }
  return data;
}

/** The real file, published: CPI 2027 up 0.3 points, RPI 2027 unchanged, earnings 2027 down 0.04 points. */
function publishedOutlook(base = REAL) {
  const data = structuredClone(base);
  const f = data.forecast;
  f.post_published = true;
  f.post_label = POST_LABEL;
  f.post_source = { release: POST_RELEASE, url: "https://obr.uk/efo/", file: "efo.xlsx", file_sha256: "0".repeat(64) };
  const shift = { cpi: 0.003, rpi: 0, earnings: -0.0004 };
  for (const section of f.sections) {
    for (const series of section.series) {
      series.post = series.pre.map((p) => ({
        year: p.year,
        value: p.year === "2027" && series.key in shift ? p.value + shift[series.key] : p.value + 0.001,
      }));
      series.post_source = `${POST_RELEASE}, ${series.label}`;
    }
  }
  return data;
}

async function renderForecast(data, props = {}) {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
  window.history.replaceState({}, "", "/?tab=living&sub=forecast");
  const { default: LivingStandardsTab } = await import("./LivingStandardsTab");
  render(<LivingStandardsTab {...props} />);
  if (data.forecast.post_published) await screen.findByText("Budget-day forecast is unavailable until verified");
  else await screen.findByRole("heading", { name: "OBR March 2026 economic forecast" });
}

const card = (name) => screen.getByRole("heading", { level: 3, name }).closest(".ls-card");
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const cpiPre = () => REAL.forecast.sections[0].series.find((s) => s.key === "cpi").pre[0].value;

// Warm Vite's real chart dependency tree separately from the assertions.
// renderForecast still resets modules per case to isolate the outlook cache.
beforeAll(async () => {
  await import("./LivingStandardsTab");
}, 90_000);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the fixtures", () => {
  it("do not depend on the committed file's forecast state", () => {
    expect(unpublishedOutlook(publishedOutlook())).toStrictEqual(unpublishedOutlook());
    expect(publishedOutlook(unpublishedOutlook())).toStrictEqual(publishedOutlook());
  });

  // Until the Budget-day import publishes the committed file, the unpublished
  // fixture is that file, as the pipeline wrote it.
  it.skipIf(REAL.forecast.post_published)("unpublished is the committed file while it is unpublished", () => {
    expect(unpublishedOutlook()).toStrictEqual(REAL);
  });
});

describe("Forecast changes with one forecast", () => {
  it("draws the one forecast, named from the sources config, and nothing about a later one", async () => {
    await renderForecast(unpublishedOutlook());
    expect(screen.getByText(/Calendar-year growth behind the baseline, from the/)).toBeInTheDocument();
    // Named for the forecast, not the sub-tab's label again
    expect(screen.queryByRole("heading", { level: 2, name: "Forecast changes" })).toBeNull();
    expect(screen.queryByText(/28 October|pre-Budget/)).toBeNull();
    // One comparable card per group: the four price measures on one chart
    const prices = card(/^Inflation measures$/);
    const legend = prices.querySelector(".chart-legend");
    for (const name of ["CPI", "CPIH", "CPI after housing costs", "RPI"]) expect(legend).toHaveTextContent(name);
    expect(legend).not.toHaveTextContent("Budget forecast");
    for (const name of [/^Earnings and other income$/, /^House prices and rents$/, /^Mortgage interest payments$/]) {
      expect(card(name)).toBeTruthy();
    }
    // No sentence repeats its series' name as a verb ("growth growing")
    expect(document.body.textContent).not.toMatch(/growth growing|has [a-z]PI/);
    // The tile shows one value and no change
    expect(screen.getAllByText(pct(cpiPre())).length).toBeGreaterThan(0);
    expect(screen.queryByText(/pp$/)).toBeNull();
  });

  it("switches every card to a table of the series by year", async () => {
    await renderForecast(unpublishedOutlook());
    const prices = card(/^Inflation measures$/);
    fireEvent.click(within(prices).getByRole("button", { name: "Options: Chart" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Table" }));
    const table = await within(card(/^Inflation measures$/)).findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "CPIH" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + REAL.forecast.sections[0].series[0].pre.length);
  });
});

describe("Forecast changes once the Budget forecast is published", () => {
  it("holds the Budget-day extract until it has a verified publication route", async () => {
    await renderForecast(publishedOutlook());
    expect(screen.getByText("Budget-day forecast is unavailable until verified")).toBeInTheDocument();
    expect(document.querySelector(".ls-card")).toBeNull();
    expect(screen.queryByText(`${pct(cpiPre())} → ${pct(cpiPre() + 0.003)}`)).toBeNull();
    expect(screen.queryByText("+0.3pp")).toBeNull();
    expect(screen.queryByRole("button", { name: /Chart or table/ })).toBeNull();
  });

  it("keeps the independent baseline available beside the held forecast", async () => {
    // The held forecast's notice, then the Living standards and Poverty
    // sub-tabs, which read only the independent outlook
    await renderForecast(publishedOutlook());
    expect(screen.getByText("Budget-day forecast is unavailable until verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Living standards" }));
    expect(await screen.findByRole("heading", { name: "Living standards under current law" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    expect(await screen.findByRole("heading", { name: "Poverty under current law" })).toBeInTheDocument();
  });
});
