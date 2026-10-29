import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import WaterfallChart from "./WaterfallChart";
import DistributionalChart from "./DistributionalChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { SegmentTooltip } from "./ChartTooltip";
import { decileCsv } from "../utils/chartCsv";
import { NET_GAP_DASH, netGapBridges } from "../utils/decileWithholding";
import { ALPHA, BETA, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

// A decile where one selected policy is withheld (and so the package's
// net): every other policy's own bar is still drawn, the withheld one's is
// not, and there is no net dot; the net line is dashed across the gap
// between the two published dots either side, and no total of the bars
// shown is given anywhere. No note, asterisk or "Not published" mark on the
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

function draw(Chart, source, valueKey, labelOf, withheld, members = [ALPHA]) {
  const fixture = measureCatalogueFixture({ held: false });
  const labels = new Set(withheld.map(labelOf));
  const rows = fixture[source].map((row) =>
    members.includes(row.reform_id) && labels.has(row.decile) ? { ...row, [valueKey]: null } : row,
  );
  const catalogue = buildMeasureCatalogue(fixture);
  return {
    catalogue,
    ...render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <Chart rawData={rows} selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} />
      </MeasureCatalogueProvider>,
    ),
  };
}

/** Each measure's bar layer, by its fill, as zero-height flags per decile. */
const flatByLayer = (container) =>
  [...container.querySelectorAll(".recharts-bar")].map((bar) =>
    [...bar.querySelectorAll(".recharts-bar-rectangles path")].map((node) => ZERO_HEIGHT.test(node.getAttribute("d"))),
  );

/** The dashed bridges' paths. */
const bridges = (container) => [...container.querySelectorAll(".net-gap-bridge path.recharts-line-curve")];

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

  it("draws the published policy's bar but not the withheld one's, and no net dot, in a withheld slot", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [7]);
    const titles = dotTitles(container);
    expect(titles).toHaveLength(9);
    expect(titles.some((text) => text.startsWith("Decile 7:"))).toBe(false);
    // Two measures, two layers: the withheld one (alpha) has no height at the
    // 7th decile only; the other (beta) is drawn at every decile
    const layers = flatByLayer(container);
    expect(layers).toHaveLength(2);
    expect(layers).toContainEqual([false, false, false, false, false, false, true, false, false, false]);
    expect(layers).toContainEqual(Array(10).fill(false));
    // The solid net line stops either side of the gap
    const line = container.querySelector(".recharts-line:not(.net-gap-bridge) .recharts-line-curve");
    expect(line.getAttribute("d").match(/M/g).length).toBe(2);
  });

  it("dashes the net line across a withheld decile between two published ones, and never off an end", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [7]);
    const [bridge, ...rest] = bridges(container);
    expect(rest).toHaveLength(0);
    expect(bridge.getAttribute("stroke-dasharray")).toBe(NET_GAP_DASH);
    // One straight segment, from the 6th decile's dot to the 8th's
    expect(bridge.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
    cleanup();
    // A withheld 10th decile has no published dot after it: no dashes
    const end = draw(Chart, source, valueKey, labelOf, [10]);
    expect(bridges(end.container)).toHaveLength(0);
  });

  it("gives no total of the bars shown in a withheld decile, in the tooltip or the CSV", () => {
    const { catalogue } = draw(Chart, source, valueKey, labelOf, [7]);
    cleanup();
    const beta = catalogue.byId.get(BETA);
    const row = { decile: labelOf(7), [beta.seriesKey]: -50, [catalogue.byId.get(ALPHA).seriesKey]: null, netChange: null, withheld: true };
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <SegmentTooltip
          active
          activeKey={beta.seriesKey}
          payload={[{ dataKey: beta.seriesKey, value: -50, payload: row, name: beta.label }]}
          labelOf={() => "Income decile 7"}
          format={(value) => `£${value}`}
          netKey="netChange"
          netLabel="Net change"
        />
      </MeasureCatalogueProvider>,
    );
    expect(container.textContent).toContain("£50");
    expect(container.textContent).not.toMatch(/Net change/);
    // The CSV: beta's own published value, alpha's and the net blank
    const csv = decileCsv([row], [catalogue.byId.get(ALPHA), beta], { kind: "absolute", year: YEAR });
    expect(csv.trim().split("\r\n").at(-1)).toBe("7,,-50,");
    // No bridge or other series ever carries a value at the withheld decile
    const { data } = netGapBridges([{ netChange: 1 }, { ...row }, { netChange: 2 }]);
    expect(Object.entries(data[1]).filter(([k, v]) => k.startsWith("netChange") && v !== null)).toEqual([]);
  });

  it("shows a short plain empty state when every policy is withheld in every decile", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [ALPHA, BETA]);
    expect(container.querySelector(".plot-empty")).toHaveTextContent(/^No figures for this selection in 2029-30\.$/);
    expect(container.textContent).not.toMatch(/Not published|confidential/i);
    expect(container.querySelector(".recharts-surface")).toBeNull();
  });

  it("still draws the published policy when one policy is withheld in every decile", () => {
    const { container } = draw(Chart, source, valueKey, labelOf, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(container.querySelector(".plot-empty")).toBeNull();
    expect(dotTitles(container)).toHaveLength(0);
    expect(flatByLayer(container)).toContainEqual(Array(10).fill(false));
  });
});
