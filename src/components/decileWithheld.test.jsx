import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import WaterfallChart from "./WaterfallChart";
import DistributionalChart from "./DistributionalChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

// A withheld decile is an empty slot: no bar, no net-change dot, a plain
// axis label, and no note, asterisk or "Not published" mark anywhere on the
// card (Vahid, 29 Oct). Drawn with the real Recharts, at a fixed size, as
// jsdom has no layout for ResponsiveContainer to measure.

vi.setConfig({ testTimeout: 30000 });

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const React = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }) =>
      React.cloneElement(React.Children.only(children), { width: 800, height: typeof height === "number" ? height : 400 }),
  };
});
vi.mock("./ChartDownloadMenu", () => ({ default: () => null }));
vi.mock("../utils/chartLogo", () => ({
  PolicyEngineLogo: () => null,
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

// Reduced motion: no animation, so bars are drawn at their full height
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A bar path with no height: it starts and ends on one y. */
const ZERO_HEIGHT = /^M[\d.]+,([\d.]+)H[\d.]+V\1H[\d.]+V\1Z$/;

const CHARTS = [
  ["£ per household", WaterfallChart, "winnersLosers", "avg_change", (decile) => String(decile)],
  ["% of net income", DistributionalChart, "distributional", "value", (decile) => ["1st", "2nd", "3rd"][decile - 1] ?? `${decile}th`],
];

function draw(Chart, source, valueKey, labelOf, withheld) {
  const fixture = measureCatalogueFixture({ held: false });
  const labels = new Set(withheld.map(labelOf));
  const rows = fixture[source].map((row) =>
    row.reform_id === ALPHA && labels.has(row.decile) ? { ...row, [valueKey]: null } : row,
  );
  return render(
    <MeasureCatalogueProvider catalogue={buildMeasureCatalogue(fixture)}>
      <Chart rawData={rows} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />
    </MeasureCatalogueProvider>,
  );
}

/** The x-axis tick labels, left to right. */
const ticks = (container) =>
  [...container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick text")].map((node) => node.textContent);

/** The net dots' titles ("Decile 7: net change …"). */
const dotTitles = (container) => [...container.querySelectorAll("title")].map((node) => node.textContent).filter((text) => /^Decile /.test(text));

describe.each(CHARTS)("withheld deciles in the %s decile chart", (_name, Chart, source, valueKey, labelOf) => {
  it("shows no note, no asterisk and no 'Not published' mark", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [7, 9]);
    expect(container.textContent).not.toMatch(/Not published|confidential|survey respondents|Income deciles 7, 9/i);
    expect(container.textContent).not.toContain("*");
    expect(container.querySelector(".decile-withheld-mark")).toBeNull();
    expect(container.querySelector(".recharts-reference-line line[stroke-dasharray]")).toBeNull();
    expect(ticks(container)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  it("draws no bar and no net dot in a withheld slot, and breaks the net line there", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [7]);
    const titles = dotTitles(container);
    expect(titles).toHaveLength(9);
    expect(titles.some((text) => text.startsWith("Decile 7:"))).toBe(false);
    // Each measure's bars: drawn at every decile but the 7th, whose
    // rectangle (Recharts keeps one per row) has no height
    for (const layer of container.querySelectorAll(".recharts-bar-rectangles")) {
      const flat = [...layer.querySelectorAll("path")].map((node) => ZERO_HEIGHT.test(node.getAttribute("d")));
      expect(flat).toEqual([false, false, false, false, false, false, true, false, false, false]);
    }
    // The net line is drawn in two pieces, never joined across the gap
    const line = container.querySelector(".recharts-line-curve");
    expect(line.getAttribute("d").match(/M/g).length).toBe(2);
  });

  it("shows a short plain empty state when every decile is withheld", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(container.querySelector(".plot-empty")).toHaveTextContent(/^No figures for this selection in 2029-30\.$/);
    expect(container.textContent).not.toMatch(/Not published|confidential/i);
    expect(container.querySelector(".recharts-surface")).toBeNull();
  });
});
