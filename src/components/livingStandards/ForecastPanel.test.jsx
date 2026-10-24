/**
 * The Forecast changes sub-tab before and after the Budget forecast is
 * published (forecast.post_published), from the real outlook file with a
 * made-up post-Budget forecast.
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

/** The real file, published: CPI 2026 up 0.3 points, RPI 2026 unchanged, earnings 2026 down 0.04 points. */
function publishedOutlook() {
  const data = structuredClone(REAL);
  const f = data.forecast;
  f.post_published = true;
  f.post_label = POST_LABEL;
  f.post_source = { release: POST_RELEASE, url: "https://obr.uk/efo/", file: "efo.xlsx", file_sha256: "0".repeat(64) };
  const shift = { cpi: 0.003, rpi: 0, earnings: -0.0004 };
  for (const section of f.sections) {
    for (const series of section.series) {
      series.post = series.pre.map((p) => ({
        year: p.year,
        value: p.year === "2026" && series.key in shift ? p.value + shift[series.key] : p.value + 0.001,
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

describe("Forecast changes before the Budget forecast", () => {
  it("draws the pre-Budget line only and says the Budget forecast is to come", async () => {
    await renderForecast(REAL);
    expect(screen.getByText(/will add the Autumn Budget 2026 forecast once the OBR publishes it/)).toBeInTheDocument();
    const cpi = card(/^CPI inflation, 2026 to 2030$/);
    const legend = cpi.querySelector(".chart-legend");
    expect(legend).toHaveTextContent("OBR March 2026 (pre-Budget)");
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
    expect(
      screen.getByText(/compares the OBR March 2026 forecast with the OBR October 2026 forecast/),
    ).toBeInTheDocument();

    // Every chart: pre-Budget grey and dashed, the Budget forecast teal and solid
    const cards = document.querySelectorAll(".ls-card");
    expect(cards.length).toBe(10);
    for (const c of cards) {
      const text = c.querySelector(".chart-legend").textContent;
      expect(c.querySelectorAll(".grouped-legend-groups .grouped-legend-swatch-line")).toHaveLength(2);
      expect(text).toMatch(/pre-Budget/);
      expect(text).toMatch(/October 2026/);
    }
    const legendText = card(/^CPI inflation, 2026 to 2030$/).querySelector(".chart-legend").textContent;
    expect(legendText).toContain("OBR March 2026 (pre-Budget)");
    expect(legendText).toContain(POST_LABEL);

    // Tiles: "2.3% → 2.6%" and "+0.3pp"; a change that rounds to zero reads "no change"
    expect(screen.getByText(`${pct(cpiPre())} → ${pct(cpiPre() + 0.003)}`)).toBeInTheDocument();
    expect(screen.getByText("+0.3pp")).toBeInTheDocument();
    expect(screen.getAllByText("no change").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/[−-]0\.0pp/)).toBeNull();

    // The source names both releases, inside About this chart
    const cpi = card(/^CPI inflation, 2026 to 2030$/);
    fireEvent.click(within(cpi).getByRole("button", { name: "About this chart" }));
    const source = cpi.querySelector(".disclosure-content .ls-source");
    expect(source).toHaveTextContent(POST_RELEASE);
    expect(source).toHaveTextContent(/pre-Budget: OBR/);
  });

  it("shows pre, post and difference columns as tables", async () => {
    await renderForecast(publishedOutlook());
    fireEvent.click(screen.getByRole("button", { name: /Chart or table/ }));
    fireEvent.click(screen.getByRole("option", { name: "Tables" }));
    const cpi = card(/^CPI inflation, 2026 to 2030$/);
    const headers = within(cpi).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Year", "OBR March 2026 (pre-Budget)", POST_LABEL, "Difference"]);
    const first = within(cpi).getAllByRole("row")[1];
    expect(first).toHaveTextContent(`2026${pct(cpiPre())}${pct(cpiPre() + 0.003)}+0.3pp`);
  });
});
