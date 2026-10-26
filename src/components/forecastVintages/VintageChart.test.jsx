/**
 * The chart's layout helpers: where the labelled points' text goes, the x
 * ticks, the y axis and the legend. Properties over arbitrary points and
 * rows; the chart itself is rendered in ForecastVintagesTab.test.jsx.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  boxesMeet,
  chartLayout,
  labelBoxes,
  labelGeometry,
  legendItems,
  pointLabels,
  xTicks,
  yAxisFor,
} from "./VintageChart";
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

// Every pair of labels' text boxes, and every label's text and line
// against the other labels' dots
function collisions(labels, dots = []) {
  const found = [];
  for (const [i, a] of labels.entries()) {
    for (const b of labels.slice(i + 1)) {
      for (const t of a.boxes.text) for (const u of b.boxes.text) if (boxesMeet(t, u)) found.push(`${a.role} text on ${b.role} text`);
    }
    for (const d of dots) {
      if (d.role === a.role) continue;
      for (const t of [...a.boxes.text, a.boxes.line]) if (boxesMeet(t, d.box)) found.push(`${a.role} on the ${d.role} dot`);
    }
  }
  return found;
}

describe("the labelled points' text", () => {
  it("keeps one label per point, in order, with no two labels' text overlapping at any level or side", () => {
    fc.assert(
      fc.property(pointsArb, fc.boolean(), (points, narrow) => {
        const labels = pointLabels(points, { ...place, format, narrow });
        expect(labels.map((l) => l.role)).toEqual(ROLES);
        for (const l of labels) {
          expect(l.level).toBeGreaterThanOrEqual(0);
          expect(l.lift).toBe(l.level * 34);
        }
        expect(collisions(labels)).toEqual([]);
      }),
    );
  });

  it("draws each label where it was laid out", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.nat({ max: 200 }), (above, narrow, lift) => {
        const g = labelGeometry({ above, lift, narrow });
        const boxes = labelBoxes({ x: 0, y: 0, above, lift, anchor: "middle", value: "£1", caption: "end", narrow });
        // The value's baseline, its caption's under it, and the line from the dot
        expect(boxes.text[0].top).toBeLessThan(g.valueY);
        expect(boxes.text[1].top).toBeLessThan(g.captionY);
        expect(g.captionY).toBeGreaterThan(g.valueY);
        expect(boxes.line.top).toBe(Math.min(g.lineStart, g.lineEnd));
        // Out from the dot, on its side, the further for a lift
        for (const t of boxes.text) expect(above ? t.bottom < 0 : t.top > 0).toBe(true);
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
    expect(labels.find((l) => l.role === "end").lift).toBeGreaterThan(0);
    expect(collisions(labels)).toEqual([]);
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

  it("anchors text at the plot's side rather than past it", () => {
    const points = [
      { role: "start", x: 0, y: 1100 },
      { role: "latest", x: 600, y: 1150 },
    ];
    const bounds = { left: 0, right: 610, top: -50, bottom: 400 };
    const labels = pointLabels(points, { ...place, format, bounds });
    expect(labels.map((l) => l.anchor)).toEqual(["start", "end"]);
    for (const l of labels) for (const t of l.boxes.text) expect(t.left >= 0 && t.right <= 610).toBe(true);
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

describe("the chart's layout", () => {
  // Every measure, unit and option, over the recent window and the whole
  // history, on a desktop card and a phone
  const VIEWS = DATA.variables.flatMap((v) =>
    Object.keys(v.units).flatMap((unit) =>
      [false, true].flatMap((annual) =>
        annual && v.frequency !== "quarterly"
          ? []
          : [true, false].map((showPast) => ({ v, unit, annual, showPast, view: buildView(DATA, v, { unit, annual, showPast }) })),
      ),
    ),
  );
  // A desktop card, then cards on a tablet and on 375px and 320px phones
  const CANVASES = [
    { canvasWidth: 926, narrow: false },
    { canvasWidth: 600, narrow: true },
    { canvasWidth: 309, narrow: true },
    { canvasWidth: 254, narrow: true },
  ];

  it("lays the labels out on the axis drawn, clear of each other, the other dots and the plot's edges", () => {
    const problems = [];
    let laidOut = 0;
    for (const { v, unit, annual, showPast, view } of VIEWS) {
      for (const rows of [view.rows.slice(view.windowStart), view.rows]) {
        for (const canvas of CANVASES) {
          const layout = chartLayout(view, rows, canvas);
          const [bottom, top] = layout.axis.domain;
          const px = (x) => ((x - rows[0].x) / (rows[rows.length - 1].x - rows[0].x)) * layout.plotWidth;
          const py = (y) => ((top - y) / (top - bottom)) * layout.plotHeight;
          const dots = layout.labels.map((l) => {
            const x = px(l.x);
            const y = py(l.y);
            return { role: l.role, box: { left: x - 6, right: x + 6, top: y - 6, bottom: y + 6 } };
          });
          const where = `${v.id} ${unit}${annual ? " A" : ""}${showPast ? "" : " no F"} ${rows.length} rows at ${canvas.canvasWidth}px`;
          // Text never on text. On a phone with the whole history the three
          // dots can sit within 20px, where every place has one conflict:
          // there a label may touch another dot, but no more than that
          const found = collisions(layout.labels, canvas.narrow && canvas.canvasWidth < 600 ? [] : dots);
          for (const c of found) problems.push(`${where}: ${c}`);
          for (const l of layout.labels) if (l.conflicts > 1) problems.push(`${where}: ${l.role} has ${l.conflicts} conflicts`);
          for (const l of layout.labels) {
            for (const t of l.boxes.text) {
              const b = layout.bounds;
              if (t.left < b.left || t.right > b.right || t.top < b.top || t.bottom > b.bottom) {
                problems.push(`${where}: ${l.role} leaves the plot`);
              }
            }
            laidOut += 1;
          }
          // Every value covers the rows' data, room or not
          const values = rows.flatMap((r) => Object.entries(r).filter(([k]) => k !== "x").map(([, y]) => y));
          if (Math.min(...values) < bottom || Math.max(...values) > top) problems.push(`${where}: data off the axis`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(laidOut).toBeGreaterThan(VIEWS.length);
  });

  it("keeps CPI's latest and end labels apart in % with the whole history on a phone", () => {
    // Found by the review: the latest value and the end caption 5px apart
    const view = buildView(DATA, variable("cpi"), { unit: "pct", showPast: true });
    const layout = chartLayout(view, view.rows, { canvasWidth: 350, narrow: true });
    expect(collisions(layout.labels)).toEqual([]);
  });

  it("makes no room where every label fits", () => {
    const view = buildView(DATA, variable("rhdi_per_person"), { unit: "level" });
    const layout = chartLayout(view, view.rows.slice(view.windowStart), { canvasWidth: 900 });
    expect(layout.room).toEqual({ headroom: 0, footroom: 0 });
    expect(layout.labels.map((l) => [l.role, l.above, l.lift])).toEqual([
      ["start", false, 0],
      ["latest", true, 0],
      ["end", true, 0],
    ]);
  });

  it("leaves the labels unplaced until the canvas is measured", () => {
    const view = buildView(DATA, variable("rhdi_per_person"), { unit: "level" });
    const layout = chartLayout(view, view.rows, { canvasWidth: 0 });
    expect(layout.labels.every((l) => l.boxes === null)).toBe(true);
    expect(layout.room).toEqual({ headroom: 0, footroom: 0 });
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
