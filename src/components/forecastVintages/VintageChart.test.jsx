/**
 * The chart's layout helpers: where the labelled points' text goes, the x
 * ticks, the y axis and the legend. Properties over arbitrary points and
 * rows; the chart itself is rendered in ForecastVintagesTab.test.jsx.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { legendItems, pointLabels, xTicks, yAxisFor } from "./VintageChart";
import { buildView } from "../../utils/forecastVintages/view";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const variable = (id) => DATA.variables.find((v) => v.id === id);
const format = (v) => `£${Math.round(v).toLocaleString("en-GB")}`;
const ROLES = ["start", "latest", "end"];

// Three points at arbitrary places in a 600 x 300 plot
const pointsArb = fc
  .tuple(...ROLES.map(() => fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 300 }) })))
  .map((ps) => ps.map((p, i) => ({ role: ROLES[i], x: p.x, y: 1000 + p.y })));
const place = { px: (x) => x, py: (y) => 300 - (y - 1000) };

describe("the labelled points' text", () => {
  it("keeps one label per point, in order, and no two on one side and level overlap", () => {
    fc.assert(
      fc.property(pointsArb, fc.boolean(), (points, narrow) => {
        const labels = pointLabels(points, { ...place, format, narrow });
        expect(labels.map((l) => l.role)).toEqual(ROLES);
        for (const [i, a] of labels.entries()) {
          expect(a.level).toBeGreaterThanOrEqual(0);
          expect(a.lift).toBe(a.level * 34);
          for (const b of labels.slice(i + 1)) {
            if (a.above === b.above && a.level === b.level) {
              expect(a.span[1] <= b.span[0] || b.span[1] <= a.span[0]).toBe(true);
            }
          }
        }
      }),
    );
  });

  it("keeps each label on its own side, unlifted, where it is clear of the others", () => {
    const points = [
      { role: "start", x: 100, y: 1100 },
      { role: "latest", x: 300, y: 1150 },
      { role: "end", x: 550, y: 1200 },
    ];
    const labels = pointLabels(points, { ...place, format });
    expect(labels.map((l) => [l.role, l.above, l.lift])).toEqual([
      ["start", false, 0],
      ["latest", true, 0],
      ["end", true, 0],
    ]);
  });

  it("lifts a label clear of its neighbour when both sides are taken", () => {
    // The whole history: three points within a few pixels
    const points = [
      { role: "start", x: 560, y: 1200 },
      { role: "latest", x: 575, y: 1204 },
      { role: "end", x: 600, y: 1206 },
    ];
    const labels = pointLabels(points, { ...place, format });
    const end = labels.find((l) => l.role === "end");
    expect(end.lift).toBeGreaterThan(0);
  });

  it("moves a label off a neighbouring dot it would cover", () => {
    // Borrowing: the latest dot just right of and below the start's
    const points = [
      { role: "start", x: 400, y: 1150 },
      { role: "latest", x: 420, y: 1130 },
      { role: "end", x: 590, y: 1050 },
    ];
    const labels = pointLabels(points, { ...place, format });
    expect(labels.find((l) => l.role === "start").above).toBe(true);
  });

  it("keeps each label's own side where the plot is not laid out yet", () => {
    const points = ROLES.map((role) => ({ role, x: 0, y: 0 }));
    const labels = pointLabels(points, { format });
    expect(labels.map((l) => [l.above, l.lift])).toEqual([
      [false, 0],
      [true, 0],
      [true, 0],
    ]);
  });
});

describe("the axes", () => {
  it("tick the start of whole years inside the rows, at most nine", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1950 * 4, max: 2030 * 4 }),
        fc.integer({ min: 1, max: 320 }),
        fc.constantFrom("quarterly", "calendar"),
        (start, length, frequency) => {
          const from = frequency === "quarterly" ? start : Math.floor(start / 4);
          const rows = Array.from({ length }, (_, i) => ({ x: from + i }));
          const ticks = xTicks(rows, frequency);
          expect(ticks.length).toBeLessThanOrEqual(9);
          for (const t of ticks) {
            expect(t).toBeGreaterThanOrEqual(rows[0].x);
            expect(t).toBeLessThanOrEqual(rows[rows.length - 1].x);
            if (frequency === "quarterly") expect(t % 4).toBe(0);
          }
        },
      ),
    );
    expect(xTicks([], "calendar")).toEqual([]);
  });

  it("keep headroom above the data when asked, and 0 in a % view", () => {
    const view = buildView(DATA, variable("rhdi_per_person"), { unit: "level" });
    const values = view.rows.flatMap((r) => Object.entries(r).filter(([k]) => k !== "x").map(([, v]) => v));
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const fitted = yAxisFor(view, view.rows);
    const roomy = yAxisFor(view, view.rows, { headroom: 0.3 });
    expect(fitted.domain[1]).toBeGreaterThanOrEqual(hi);
    expect(roomy.domain[1]).toBeGreaterThanOrEqual(hi + 0.3 * (hi - lo));
    expect(fitted.domain[0]).toBeLessThanOrEqual(lo);
    const pct = buildView(DATA, variable("cpi"), { unit: "pct" });
    expect(yAxisFor(pct, pct.rows).ticks).toContain(0);
    expect(yAxisFor(view, [])).toBeNull();
  });
});

describe("the legend", () => {
  it("names the outturn, the newest forecast and, when shown, the earlier ones", () => {
    const view = buildView(DATA, variable("cpi"), { unit: "pct" });
    expect(legendItems(view, true).map((i) => i.label)).toEqual(["Outturn", "March 2026 forecast", "Earlier forecasts"]);
    expect(legendItems(view, false).map((i) => i.label)).toEqual(["Outturn", "March 2026 forecast"]);
    // Each line differs in pattern as well as colour
    expect(new Set(legendItems(view, true).map((i) => i.dash)).size).toBe(3);
  });
});
