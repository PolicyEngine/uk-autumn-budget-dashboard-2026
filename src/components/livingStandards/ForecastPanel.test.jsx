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

// The props each card gives its line chart, to check what it asks it to draw
const chartProps = vi.hoisted(() => []);
vi.mock("./LsCharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    LsLineChart: (props) => {
      chartProps.push(props);
      return actual.LsLineChart(props);
    },
  };
});

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
  if (data.forecast.post_published) await screen.findByRole("heading", { name: "OBR March 2026 and October 2026 economic forecasts" });
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
    // Its chips are the key: one per line, all on, and no legend repeating them
    const chips = within(within(prices).getByRole("group", { name: "Lines: show or hide" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["CPI", "CPIH", "CPI after housing costs", "RPI"]);
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "true")).toBe(true);
    // The chips are the key, under the plot: no legend repeats the names
    expect(prices.querySelector(".chart-legend .series-toggle")).not.toBeNull();
    expect(prices.querySelector(".chart-legend .grouped-legend-groups")).toBeNull();
    expect(prices).not.toHaveTextContent("Budget forecast");
    // "About this chart" opens on what each measure is, under the one Definitions heading
    expect(prices).toHaveTextContent("Definitions · Caveats · Sources");
    expect(card(/^Earnings and other income$/)).not.toHaveTextContent("Definitions · Caveats · Sources");
    // A chip hides its line; the last one on stays on
    fireEvent.click(chips[3]);
    expect(chips[3]).toHaveAttribute("aria-pressed", "false");
    for (const chip of chips.slice(1, 3)) fireEvent.click(chip);
    fireEvent.click(chips[0]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chips[3]);
    for (const name of [/^Earnings and other income$/, /^House prices and rents$/, /^Mortgage interest payments$/]) {
      expect(card(name)).toBeTruthy();
    }
    // No sentence repeats its series' name as a verb ("growth growing")
    expect(document.body.textContent).not.toMatch(/growth growing|has [a-z]PI/);
    // How the forecast feeds the figures is in Methodology, one link away
    expect(screen.getByRole("link", { name: "How these feed our figures →" })).toHaveAttribute(
      "href",
      "?tab=methodology#method-forecast-feed",
    );
    expect(screen.queryByText(/What this means for the Budget figures/)).toBeNull();
    // The tile shows one value and no change
    expect(screen.getAllByText(pct(cpiPre())).length).toBeGreaterThan(0);
    expect(screen.queryByText(/pp$/)).toBeNull();
  });

  it("keys each many-line card by its chips alone: no end labels, no legend", async () => {
    chartProps.length = 0;
    await renderForecast(unpublishedOutlook());
    const many = chartProps.filter((p) => p.series.length > 1);
    // Inflation measures, Earnings and other income, House prices and rents
    expect(many.length).toBeGreaterThanOrEqual(3);
    for (const props of many) {
      expect(props.endLabels ?? false).toBe(false);
      expect(props.legend).toBe(false);
      expect(props.keyContent).toBeTruthy();
      expect(props.series.every((s) => s.endLabel === undefined)).toBe(true);
    }
    expect(document.querySelector(".ls-end-labels")).toBeNull();
  });

  it("switches every card to a table of the series by year", async () => {
    await renderForecast(unpublishedOutlook());
    const prices = card(/^Inflation measures$/);
    // An icon switch in the header, left of Download; no Options pill
    expect(within(prices).queryByRole("button", { name: /^Options:/ })).toBeNull();
    const toggle = within(prices).getByRole("radiogroup", { name: "Show Inflation measures as" });
    expect(toggle.closest(".chart-header-actions").lastElementChild).toHaveClass("chart-download");
    fireEvent.click(within(toggle).getByRole("radio", { name: "Show as table" }));
    const table = await within(card(/^Inflation measures$/)).findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "CPIH" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + REAL.forecast.sections[0].series[0].pre.length);
  });
});

describe("Forecast changes once the Budget forecast is published", () => {
  it("draws October by default, both on choosing them (March faded, October full), and says the Budget figures use October", async () => {
    chartProps.length = 0;
    await renderForecast(publishedOutlook());
    expect(screen.getByText(/Calendar-year growth in the OBR's/)).toHaveTextContent(
      "Calendar-year growth in the OBR's March 2026 (opens in a new tab) and October 2026 (opens in a new tab) forecasts. Budget figures use October.",
    );
    expect(screen.getByRole("link", { name: /^October 2026 ?\(opens in a new tab\)$/ })).toHaveAttribute("target", "_blank");
    const prices = card(/^Inflation measures$/);
    // Which forecasts are drawn is the card's Options pill, October alone
    // by default; no Show forecasts chips
    const pill = within(prices).getByRole("button", { name: "Options: October 2026 forecast" });
    expect(within(prices).queryByRole("group", { name: "Forecasts: show or hide" })).toBeNull();
    expect(prices).not.toHaveTextContent(/Show forecasts/);
    const cpiLines = () => chartProps.filter((p) => p.series.some((s) => s.series === "cpi")).at(-1).series.filter((s) => s.series === "cpi");
    expect(cpiLines().map((s) => s.forecast)).toEqual(["post"]);
    // Both: March faded, October full, and the pill says so
    fireEvent.click(pill);
    const choices = screen.getByRole("radiogroup", { name: "Forecasts" });
    expect(within(choices).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Both", "March 2026", "October 2026"]);
    fireEvent.click(within(choices).getByRole("radio", { name: "Both" }));
    expect(within(prices).getByRole("button", { name: "Options: March and October 2026" })).toBeInTheDocument();
    const cpi = cpiLines();
    expect(cpi.map((s) => s.name)).toEqual(["CPI, March 2026 forecast", "CPI, October 2026 forecast"]);
    expect(cpi[0].opacity).toBeLessThan(1);
    expect(cpi[1].opacity ?? 1).toBe(1);
    // The tile shows October and names March
    expect(screen.getAllByText(pct(cpiPre() + 0.003)).length).toBeGreaterThan(0);
    expect(screen.getByText(`annual growth, 2027 (March: ${pct(cpiPre())})`)).toBeInTheDocument();
  });

  it("keeps the March line alone, and says why, for a series October does not carry yet", async () => {
    const data = publishedOutlook();
    for (const section of data.forecast.sections) {
      for (const series of section.series) if (series.key === "cpih") series.post = null;
    }
    chartProps.length = 0;
    await renderForecast(data);
    // On the default, October alone: CPIH still draws its March line
    const lines = chartProps.find((p) => p.series.some((s) => s.series === "cpi")).series;
    expect(lines.filter((s) => s.series === "cpih").map((s) => s.forecast)).toEqual(["pre"]);
    expect(lines.find((s) => s.series === "cpih").opacity ?? 1).toBe(1);
    const prices = card(/^Inflation measures$/);
    fireEvent.click(within(prices).getByRole("button", { name: /About this chart/ }));
    expect(prices).toHaveTextContent(/CPIH: not in the October 2026 forecast's summary table yet/);
  });

  it("keeps the independent baseline available beside the forecasts", async () => {
    await renderForecast(publishedOutlook());
    fireEvent.click(screen.getByRole("tab", { name: "Living standards" }));
    expect(await screen.findByRole("heading", { name: "Living standards under current law" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Poverty" }));
    expect(await screen.findByRole("heading", { name: "Poverty under current law" })).toBeInTheDocument();
  });
});
