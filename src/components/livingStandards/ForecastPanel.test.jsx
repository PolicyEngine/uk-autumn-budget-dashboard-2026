/**
 * The Forecast changes sub-tab before and after the Budget forecast is
 * published (forecast.post_published), from the real outlook file with a
 * made-up post-Budget forecast.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const REAL = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"), "utf8"),
);

const POST_LABEL = "OBR October 2026 (Autumn Budget)";
const POST_RELEASE = "OBR Economic and fiscal outlook, October 2026: detailed forecast tables, economy";

/** The real file, published: CPI 2027 up 0.3 points, RPI 2027 unchanged, earnings 2027 down 0.04 points. */
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
  if (data.forecast.post_published) await screen.findByText("Budget-day forecast is unavailable until verified");
  else await screen.findByRole("heading", { name: "Forecast changes" });
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
    const cpi = card(/^CPI inflation, 2027 to 2030$/);
    const legend = cpi.querySelector(".chart-legend");
    expect(legend).toHaveTextContent("OBR March 2026 (pre-Budget)");
    expect(legend).not.toHaveTextContent("Budget forecast");
    // The tile shows one value and no change
    expect(screen.getByText(pct(cpiPre()))).toBeInTheDocument();
    expect(screen.queryByText(/pp$/)).toBeNull();
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

  it("keeps navigation back to the independent baseline available", async () => {
    await renderForecast(publishedOutlook());
    fireEvent.click(screen.getByRole("tab", { name: "Baseline outlook" }));
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Poverty" })).toBeInTheDocument();
    expect(screen.queryByText("Budget-day forecast is unavailable until verified")).toBeNull();
  });
});
