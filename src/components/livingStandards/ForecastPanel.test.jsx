/**
 * The Forecast changes sub-tab before and after the Budget forecast is
 * published (forecast.post_published), from the real outlook file set to
 * each state, so both hold whichever state the committed file is in: the
 * Budget-day obr-forecast import publishes it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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

async function renderForecast(data) {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
  window.history.replaceState({}, "", "/?tab=living&sub=forecast");
  const { default: LivingStandardsTab } = await import("./LivingStandardsTab");
  render(<LivingStandardsTab />);
  await screen.findByRole("heading", { name: "Forecast changes" });
}

const card = (name) => screen.getByRole("heading", { level: 3, name }).closest(".ls-card");
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const cpiPre = () => REAL.forecast.sections[0].series.find((s) => s.key === "cpi").pre[0].value;

afterEach(() => {
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
    expect(screen.getByText(/The OBR forecast behind the baseline: calendar-year growth, from the/)).toBeInTheDocument();
    expect(screen.queryByText(/28 October|pre-Budget/)).toBeNull();
    const cpi = card(/^CPI inflation$/);
    const legend = cpi.querySelector(".chart-legend");
    expect(legend).toHaveTextContent("OBR, March 2026");
    expect(legend).not.toHaveTextContent("Budget forecast");
    // The tile shows one value and no change
    expect(screen.getByText(pct(cpiPre()))).toBeInTheDocument();
    expect(screen.queryByText(/pp$/)).toBeNull();
  });
});

describe("Forecast changes once the Budget forecast is published", () => {
  it("draws both forecasts, shows both values and the change, and drops the 'will add' line", async () => {
    await renderForecast(publishedOutlook());
    expect(screen.queryByText(/once the OBR publishes/)).toBeNull();
    // The basis and both releases, once, in the section's intro
    const intro = screen.getByText(/compares the OBR March 2026 forecast with the OBR October 2026 forecast/);
    expect(intro).toHaveTextContent(POST_RELEASE);
    expect(intro).toHaveTextContent(/earlier forecast: OBR/);

    // Every chart: pre-Budget grey and dashed, the Budget forecast teal and solid
    const cards = document.querySelectorAll(".ls-card");
    expect(cards.length).toBe(10);
    for (const c of cards) {
      const text = c.querySelector(".chart-legend").textContent;
      expect(c.querySelectorAll(".grouped-legend .grouped-legend-swatch-line")).toHaveLength(2);
      expect(text).toMatch(/March 2026/);
      expect(text).toMatch(/October 2026/);
    }
    const legendText = card(/^CPI inflation$/).querySelector(".chart-legend").textContent;
    expect(legendText).toContain("OBR, March 2026");
    expect(legendText).toContain("OBR, October 2026");

    // Tiles: "March 2026 2.3% → October 2026 2.6%" and "+0.3pp"; a change that
    // rounds to zero reads "no change"
    expect(
      screen.getByText((_, el) => el?.classList?.contains("forecast-tile-compare") && el.textContent.includes(`${pct(cpiPre())} → October 2026 ${pct(cpiPre() + 0.003)}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+0\.3pp/)).toBeInTheDocument();
    expect(screen.getAllByText("no change").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/[−-]0\.0pp/)).toBeNull();
  });

  it("shows pre, post and difference columns as tables", async () => {
    await renderForecast(publishedOutlook());
    fireEvent.click(screen.getByRole("button", { name: /Chart or table/ }));
    fireEvent.click(screen.getByRole("option", { name: "Tables" }));
    const cpi = card(/^CPI inflation$/);
    const headers = within(cpi).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Year", "OBR, March 2026", "OBR, October 2026", "Difference"]);
    const first = within(cpi).getAllByRole("row")[1];
    expect(first).toHaveTextContent(`2027${pct(cpiPre())}${pct(cpiPre() + 0.003)}+0.3pp`);
  });
});
