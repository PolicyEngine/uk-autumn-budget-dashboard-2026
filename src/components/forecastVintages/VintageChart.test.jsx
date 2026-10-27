/**
 * The chart's layout helpers: where the labelled points' text goes, the x
 * ticks, the y axis and the legend. Properties over arbitrary points and
 * rows, and every committed view laid out; the chart itself is rendered in
 * ForecastVintagesView.test.jsx.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { Brush, Customized, Line, LineChart, XAxis, YAxis } from "recharts";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import VintageChart, {
  BRUSH_TEXT_GAP,
  BRUSH_TEXT_SIZE,
  MARGIN,
  TRAVELLER_WIDTH,
  boxesMeet,
  brushBox,
  chartLayout,
  labelBoxes,
  labelGeometry,
  legendItems,
  pointLabels,
  textWidth,
  unitLabelBox,
  xTicks,
  yAxisFor,
} from "./VintageChart";
import { OUTTURN_KEY, UNIT_ORDER, brushRange, buildView, pointsIn, stepDecimals } from "../../utils/forecastVintages/view";
import { forecastVintagesProblem } from "../../utils/forecastVintages/load";
import { periodIndex } from "../../utils/forecastVintages/transforms";

afterEach(cleanup);

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const variable = (id) => DATA.variables.find((v) => v.id === id);
const format = (v) => `£${Math.round(v).toLocaleString("en-GB")}`;
const ROLES = ["start", "latest", "end"];

// Three points at arbitrary places in a 600 x 300 plot
const pointsArb = fc
  .tuple(...ROLES.map(() => fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 300 }) })))
  .map((ps) => ps.map((p, i) => ({ role: ROLES[i], x: p.x, y: 1000 + p.y })));
const place = { px: (x) => x, py: (y) => 300 - (y - 1000) };

// Found by the second review: on a phone, the whole history's decades
// were 21px apart and their labels about 30px wide
const TICK_GAP = 4;
const labelOf = (frequency) => (x) =>
  frequency === "quarterly" ? String(Math.floor(x / 4)) : frequency === "fiscal" ? `${x}-${String(x + 1).slice(-2)}` : String(x);
const spacingProblems = (ticks, rows, plotWidth, label, edge) => {
  const px = (x) => ((x - rows[0].x) / (rows[rows.length - 1].x - rows[0].x)) * plotWidth;
  const width = (x) => textWidth(label(x), 12);
  const found = [];
  ticks.forEach((t, i) => {
    if (px(t) - width(t) / 2 < -edge.left || px(t) + width(t) / 2 > plotWidth + edge.right) found.push(`${label(t)} past the edge`);
    const next = ticks[i + 1];
    if (next != null && px(next) - width(next) / 2 - (px(t) + width(t) / 2) < TICK_GAP) found.push(`${label(t)} and ${label(next)} too close`);
  });
  return found;
};

// The brush's two labels where Recharts draws them for handles at rows
// `lo` and `hi` (Brush's renderText): handle i at x + i (width - handle) /
// (n - 1), the start label ending BRUSH_TEXT_GAP left of its handle and
// the end label starting BRUSH_TEXT_GAP right of its handle's right side
function brushLabels(view, brush, lo, hi) {
  const at = (i) => brush.x + (i * (brush.width - TRAVELLER_WIDTH)) / (view.rows.length - 1);
  const start = view.label(view.rows[lo].x);
  const end = view.label(view.rows[hi].x);
  const startRight = at(lo) - BRUSH_TEXT_GAP;
  const endLeft = at(hi) + TRAVELLER_WIDTH + BRUSH_TEXT_GAP;
  return [
    { text: start, left: startRight - textWidth(start, BRUSH_TEXT_SIZE), right: startRight },
    { text: end, left: endLeft, right: endLeft + textWidth(end, BRUSH_TEXT_SIZE) },
  ];
}

// Where the chart draws each labelled point's dot, from its layout
function dotsOf(layout, rows) {
  const [bottom, top] = layout.axis.domain;
  const px = (x) => ((x - rows[0].x) / (rows[rows.length - 1].x - rows[0].x)) * layout.plotWidth;
  const py = (y) => ((top - y) / (top - bottom)) * layout.plotHeight;
  return layout.labels.map((l) => {
    const x = px(l.x);
    const y = py(l.y);
    return { role: l.role, x, box: { left: x - 6, right: x + 6, top: y - 6, bottom: y + 6 } };
  });
}

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

  it("keeps every label's text off an obstacle, wherever it is", () => {
    // A box the size of a unit label, anywhere over or in the plot
    const obstacleArb = fc
      .record({ left: fc.integer({ min: -60, max: 600 }), top: fc.integer({ min: -60, max: 300 }), width: fc.integer({ min: 1, max: 200 }) })
      .map(({ left, top, width }) => ({ left, right: left + width, top, bottom: top + 13 }));
    fc.assert(
      fc.property(pointsArb, obstacleArb, fc.boolean(), (points, obstacle, narrow) => {
        const labels = pointLabels(points, { ...place, format, narrow, obstacles: [obstacle] });
        for (const l of labels) for (const t of l.boxes.text) expect(boxesMeet(t, obstacle), `${l.role} on the obstacle`).toBe(false);
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
    // Lifted, or beside its line rather than centred on it
    const end = labels.find((l) => l.role === "end");
    expect(end.lift > 0 || end.anchor !== "middle").toBe(true);
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
    const dots = points.map((p) => {
      const [x, y] = [place.px(p.x), place.py(p.y)];
      return { role: p.role, box: { left: x - 6, right: x + 6, top: y - 6, bottom: y + 6 } };
    });
    expect(collisions(labels, dots)).toEqual([]);
    expect(labels.every((l) => l.conflicts === 0)).toBe(true);
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

  it("sets a value smaller only where no anchor keeps it between the plot's sides", () => {
    const points = [{ role: "latest", x: 50, y: 1100 }];
    const bounds = { left: 0, right: 100, top: -50, bottom: 400 };
    const long = () => "£1,000,000,000.000000bn";
    const [wide] = pointLabels(points, { ...place, format: long, bounds });
    expect(wide.valueSize).toBeGreaterThan(0);
    expect(wide.valueSize).toBeLessThan(labelGeometry({ above: true }).valueSize);
    for (const t of wide.boxes.text) expect(t.left >= 0 && t.right <= 100).toBe(true);
    const [fits] = pointLabels(points, { ...place, format, bounds });
    expect(fits.valueSize).toBeNull();
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

  // The rows a card can show: the recent window, the whole history, and
  // what the brush can pick, windows of 6, 12, 24 and 48 periods along it
  // (each with a labelled point in it)
  const windowsOf = (view) => {
    const n = view.rows.length;
    const ranges = [
      [view.windowStart, n - 1],
      [0, n - 1],
    ];
    for (const length of [6, 12, 24, 48]) {
      for (let s = 0; s + length <= n; s += Math.max(1, Math.floor(length / 3))) ranges.push([s, s + length - 1]);
    }
    return ranges
      .map(([lo, hi]) => ({ lo, hi, rows: view.rows.slice(lo, hi + 1) }))
      .filter(({ rows }) => rows.length > 1 && pointsIn(view.points, rows).length > 0);
  };
  // Dots this close across share a column, where a label's leader line or
  // text cannot always keep off the other dot: only the whole history on a
  // phone puts them there
  const CROWDED = 16;

  it("lays the labels out on the axis drawn, clear of each other, the other dots and the plot's edges, every value at full size", () => {
    const problems = [];
    let laidOut = 0;
    let brushed = 0;
    for (const { v, unit, annual, showPast, view } of VIEWS) {
      for (const { lo, hi, rows } of windowsOf(view)) {
        brushed += 1;
        for (const canvas of CANVASES) {
          const layout = chartLayout(view, rows, canvas);
          const [bottom, top] = layout.axis.domain;
          const dots = dotsOf(layout, rows);
          const where = `${v.id} ${unit}${annual ? " A" : ""}${showPast ? "" : " no F"} rows ${lo}-${hi} at ${canvas.canvasWidth}px`;
          // Text never on text, and no label on another dot unless the two
          // dots are within CROWDED pixels across
          for (const l of layout.labels) {
            const own = dots.find((d) => d.role === l.role);
            const apart = dots.filter((d) => Math.abs(d.x - own.x) >= CROWDED);
            for (const c of collisions([l], apart)) problems.push(`${where}: ${c}`);
          }
          for (const c of collisions(layout.labels)) problems.push(`${where}: ${c}`);
          const unitLabel = unitLabelBox(view.axisLabel, layout.yWidth);
          for (const l of layout.labels) if (l.boxes.text.some((t) => boxesMeet(t, unitLabel))) problems.push(`${where}: ${l.role} on the unit label`);
          for (const l of layout.labels) if (l.conflicts > 1) problems.push(`${where}: ${l.role} has ${l.conflicts} conflicts`);
          // The brush under the plot, and its labels on the chart (found by
          // the browser sweep for review round 23)
          const { brush } = layout;
          const plotLeft = MARGIN.left + layout.yWidth;
          if (brush.x < plotLeft || brush.x + brush.width > plotLeft + layout.plotWidth) problems.push(`${where}: brush not under the plot`);
          for (const t of brushLabels(view, brush, lo, hi)) {
            if (t.left < 0 || t.right > canvas.canvasWidth) problems.push(`${where}: brush label ${t.text} off the chart`);
          }
          for (const l of layout.labels) {
            for (const t of l.boxes.text) {
              const b = layout.bounds;
              if (t.left < b.left || t.right > b.right || t.top < b.top || t.bottom > b.bottom) {
                problems.push(`${where}: ${l.role} leaves the plot`);
              }
            }
            if (l.valueSize !== null) problems.push(`${where}: ${l.role} set smaller`);
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
    expect(brushed).toBeGreaterThan(5 * VIEWS.length);
  });

  it("spaces every committed view's years on every card", () => {
    const problems = [];
    for (const { v, unit, annual, showPast, view } of VIEWS) {
      const label = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
      for (const rows of [view.rows.slice(view.windowStart), view.rows]) {
        for (const canvas of CANVASES) {
          const layout = chartLayout(view, rows, canvas);
          const edge = { left: layout.yWidth, right: MARGIN.right };
          const ticks = xTicks(rows, view.frequency, { plotWidth: layout.plotWidth, label, edge });
          if (ticks.length < 2) problems.push(`${v.id} ${unit}${annual ? " A" : ""} ${rows.length} rows at ${canvas.canvasWidth}px: ${ticks.length} ticks`);
          for (const p of spacingProblems(ticks, rows, layout.plotWidth, label, edge)) {
            problems.push(`${v.id} ${unit}${annual ? " A" : ""}${showPast ? "" : " no F"} ${rows.length} rows at ${canvas.canvasWidth}px: ${p}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // Found by the twelfth review: spending as an index, F off, brushed to
  // 2024-25 alone on a phone: no plot to lay the labels out across, so the
  // start caption fell under the plot's foot, behind the brush
  it("lays out no single period: the brush keeps two, and their labels in the plot", () => {
    const view = buildView(DATA, variable("spending"), { unit: "index", showPast: false });
    const n = view.rows.length;
    const k = view.rows.findIndex((r) => view.label(r.x) === "2024-25");
    expect(k).toBeGreaterThan(0);
    expect(chartLayout(view, view.rows.slice(k, k + 1), { canvasWidth: 254, narrow: true })).toBeNull();
    // The end dragged back onto the start, and the start on to the end
    for (const before of [[k, n - 1], [0, k]]) {
      const [lo, hi] = brushRange([k, k], before, n);
      expect(hi - lo).toBe(1);
      const layout = chartLayout(view, view.rows.slice(lo, hi + 1), { canvasWidth: 254, narrow: true });
      expect(layout.labels.length).toBeGreaterThan(0);
      for (const l of layout.labels) {
        for (const t of l.boxes.text) {
          const b = layout.bounds;
          expect(t.left >= b.left && t.right <= b.right && t.top >= b.top && t.bottom <= b.bottom, `${l.role} from ${before}`).toBe(true);
        }
      }
    }
  });

  // Found by the eleventh review: real GDP's figures written to six
  // decimals, in £ with F off, brushed to 2028-30 on a 320px phone: the
  // end label started at its line and ran past the card, where centred on
  // its line it fitted
  it("centres a label on its line where only that keeps it on the card", () => {
    const data = JSON.parse(JSON.stringify(DATA));
    const v = data.variables.find((x) => x.id === "real_gdp");
    v.level.decimals = 6;
    expect(forecastVintagesProblem(data)).toBeNull();
    const view = buildView(data, v, { unit: "level", showPast: false });
    const rows = view.rows.filter((r) => r.x >= 2028 && r.x <= 2030);
    const layout = chartLayout(view, rows, { canvasWidth: 254, narrow: true });
    const end = layout.labels.find((l) => l.role === "end");
    expect(end.value).toBe("£3,114.673023bn");
    expect(end.anchor).toBe("middle");
    expect(end.valueSize).toBeNull();
    for (const t of end.boxes.text) expect(t.left >= layout.bounds.left && t.right <= layout.bounds.right).toBe(true);
  });

  // Whatever decimals the figures are written to (the loader takes 0 to
  // 6), at any card width and brush (two rows or more, as brushRange
  // keeps it), every label's text stays between the plot's sides, and a
  // value is set smaller only where no anchor would keep it there at full
  // size. The examples, run first every time, lay labels out: the eleventh
  // review's case, and real GDP's whole history on a desktop card
  it("keeps every label between the plot's sides, at full size wherever an anchor can", () => {
    const shown = DATA.variables.flatMap((v) => UNIT_ORDER.filter((u) => v.units[u]).map((unit) => ({ id: v.id, unit })));
    const files = new Map();
    const fileWith = (decimals) => {
      if (!files.has(decimals)) {
        const data = JSON.parse(JSON.stringify(DATA));
        for (const v of data.variables) for (const m of [v.level, v.share]) if (m) m.decimals = decimals;
        expect(forecastVintagesProblem(data)).toBeNull();
        files.set(decimals, data);
      }
      return files.get(decimals);
    };
    const gdp = buildView(DATA, variable("real_gdp"), { unit: "level", showPast: false });
    const from2028 = gdp.rows.findIndex((r) => r.x === 2028);
    // Rows from the first to the last: 2 + (n - 2)
    const allRows = buildView(DATA, variable("real_gdp"), { unit: "level", showPast: true }).rows.length - 2;
    let laidOut = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...shown),
        fc.integer({ min: 0, max: 6 }),
        fc.boolean(),
        fc.integer({ min: 254, max: 1400 }),
        fc.boolean(),
        fc.nat(),
        fc.nat(),
        ({ id, unit }, decimals, showPast, canvasWidth, narrow, a, b) => {
          const data = fileWith(decimals);
          const view = buildView(data, data.variables.find((v) => v.id === id), { unit, showPast });
          if (view.unavailable) return;
          const n = view.rows.length;
          const lo = a % (n - 1);
          const rows = view.rows.slice(lo, lo + 2 + (b % (n - 1 - lo)));
          const layout = chartLayout(view, rows, { canvasWidth, narrow });
          const { bounds } = layout;
          const size = labelGeometry({ above: true, narrow }).valueSize;
          for (const l of layout.labels) {
            for (const t of l.boxes.text) expect(t.left >= bounds.left && t.right <= bounds.right, `${id} ${unit} ${l.role} ${l.value}`).toBe(true);
            const x = l.boxes.line.left + 0.5;
            const widest = Math.max(bounds.right - x, x - bounds.left, 2 * Math.min(x - bounds.left, bounds.right - x));
            expect(l.valueSize === null, `${id} ${unit} ${l.role} ${l.value}`).toBe(textWidth(l.value, size, true) <= widest);
            laidOut += 1;
          }
        },
      ),
      {
        numRuns: 400,
        examples: [
          [{ id: "real_gdp", unit: "level" }, 6, false, 254, true, from2028, 1],
          [{ id: "real_gdp", unit: "level" }, 1, true, 926, false, 0, allRows],
        ],
      },
    );
    // Whatever the seed: the examples alone lay out four labels or more
    expect(laidOut).toBeGreaterThanOrEqual(4);
  });

  it("keeps employment's latest label off the start dot in %, brushed to 2017 to 2028 on a phone", () => {
    // Found by the second review: two dots 42px apart, the latest caption
    // on the start dot, with one conflict and no room made
    const view = buildView(DATA, variable("employment"), { unit: "pct", showPast: true });
    const rows = view.rows.slice(45, 57);
    expect([view.label(rows[0].x), view.label(rows[rows.length - 1].x)]).toEqual(["2017", "2028"]);
    const layout = chartLayout(view, rows, { canvasWidth: 254, narrow: true });
    expect(layout.labels.map((l) => l.role)).toEqual(["start", "latest"]);
    expect(collisions(layout.labels, dotsOf(layout, rows))).toEqual([]);
    expect(layout.labels.every((l) => l.conflicts === 0)).toBe(true);
  });

  // Found by the ninth review: income per head's forecasts at 1e9, the
  // newest falling to 0.0001 from 2029, as an index brushed to 2029 on:
  // a step of 5e-7, its six ticks written -0, -0, 0, 0, 0, 0
  it("writes every y tick apart, however fine the step", () => {
    const data = JSON.parse(JSON.stringify(DATA));
    const v = data.variables.find((x) => x.id === "rhdi_per_person");
    for (const vintage of v.level.vintages) for (const k of Object.keys(vintage.values)) vintage.values[k] = 1e9;
    const newest = v.level.vintages.at(-1);
    for (const k of Object.keys(newest.values)) if (periodIndex(k, "quarterly") >= periodIndex("2029Q1", "quarterly")) newest.values[k] = 0.0001;
    expect(forecastVintagesProblem(data)).toBeNull();
    const view = buildView(data, v, { unit: "index", showPast: false });
    const rows = view.rows.filter((r) => r.x >= periodIndex("2029Q1", "quarterly"));
    const { axis } = chartLayout(view, rows, { canvasWidth: 926 });
    expect(axis.step).toBeLessThan(1e-6);
    const labels = axis.ticks.map((t) => view.format(t, stepDecimals(axis.step)));
    expect(new Set(labels).size).toBe(labels.length);
    axis.ticks.forEach((t, i) => expect(/^-?0(\.0*)?$/.test(labels[i])).toBe(t === 0));
  });

  // Found by the tenth review: house prices' newest forecast for 2030 at
  // 0.0001 (growth), brushed to 2029-30 in £: ticks 0.1 apart, all
  // written £296,673
  it("writes every y tick apart in whole pounds too", () => {
    const data = JSON.parse(JSON.stringify(DATA));
    const v = data.variables.find((x) => x.id === "house_prices");
    v.level.vintages.at(-1).values["2030"] = 0.0001;
    expect(forecastVintagesProblem(data)).toBeNull();
    const view = buildView(data, v, { unit: "level", showPast: false });
    const rows = view.rows.filter((r) => r.x >= 2029 && r.x <= 2030);
    const { axis } = chartLayout(view, rows, { canvasWidth: 926 });
    expect(axis.step).toBeLessThan(1);
    const labels = axis.ticks.map((t) => view.format(t, stepDecimals(axis.step)));
    expect(new Set(labels).size).toBe(labels.length);
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

describe("the unit label's room", () => {
  // Found after ChartUnitLabel moved the label from 12px to 25px over the
  // plot: the room the labels kept clear for it had stayed at 12px
  it("is where Recharts and ChartUnitLabel draw the label, on the chart's margin", () => {
    const view = buildView(DATA, variable("real_gdp"), { unit: "level" });
    const yWidth = 52;
    // The plot's top left, as Recharts lays it out
    const Plot = ({ offset }) => <rect className="plot-probe" x={offset.left} y={offset.top} width={1} height={1} />;
    const { container } = render(
      <LineChart width={900} height={440} margin={MARGIN} data={view.rows}>
        <XAxis dataKey="x" />
        <YAxis width={yWidth} />
        <Line dataKey={OUTTURN_KEY} />
        <Customized component={<Plot />} />
        <Customized component={<ChartUnitLabel text={view.axisLabel} horizontal />} />
      </LineChart>,
    );
    const text = container.querySelector(".chart-unit-label");
    const plot = container.querySelector(".plot-probe");
    const x = Number(text.getAttribute("x")) - Number(plot.getAttribute("x"));
    const baseline = Number(text.getAttribute("y")) - Number(plot.getAttribute("y"));
    const size = Number(text.getAttribute("font-size"));
    const box = unitLabelBox(view.axisLabel, yWidth);
    expect(box.left).toBe(x);
    expect(box.right - box.left).toBeCloseTo(textWidth(view.axisLabel, size));
    // The glyphs over the baseline, and descenders under it
    expect(box.top).toBeLessThanOrEqual(baseline - 0.8 * size);
    expect(box.bottom).toBeGreaterThanOrEqual(baseline + 2);
    expect(box.bottom).toBeLessThanOrEqual(baseline + 4);
    // And inside the chart, under its top
    expect(box.top).toBeGreaterThanOrEqual(-MARGIN.top);
  });
});

describe("the brush's room", () => {
  // Found by the browser sweep after review round 22: the start label ran
  // off the chart's left with the whole history on a narrow y axis, at
  // every width, and the end label off its right on a 320px phone
  it("is where Recharts draws the brush's labels, wherever its handles are", () => {
    const view = buildView(DATA, variable("receipts"), { unit: "index" });
    const layout = chartLayout(view, view.rows, { canvasWidth: 254, narrow: true });
    const n = view.rows.length;
    for (const [lo, hi] of [[0, n - 1], [Math.floor(n / 3), Math.floor(n / 2)]]) {
      cleanup();
      const { container } = render(
        <LineChart width={254} height={340} margin={MARGIN} data={view.rows}>
          <XAxis dataKey="x" />
          <YAxis width={layout.yWidth} />
          <Line dataKey={OUTTURN_KEY} />
          <Brush
            dataKey="x"
            x={layout.brush.x}
            width={layout.brush.width}
            startIndex={lo}
            endIndex={hi}
            travellerWidth={TRAVELLER_WIDTH}
            alwaysShowText
            tickFormatter={(x) => view.label(x)}
          />
        </LineChart>,
      );
      const [start, end] = container.querySelectorAll(".recharts-brush-texts text");
      const [startModel, endModel] = brushLabels(view, layout.brush, lo, hi);
      expect([start.textContent, start.getAttribute("text-anchor")]).toEqual([startModel.text, "end"]);
      expect(Number(start.getAttribute("x"))).toBeCloseTo(startModel.right);
      expect([end.textContent, end.getAttribute("text-anchor")]).toEqual([endModel.text, "start"]);
      expect(Number(end.getAttribute("x"))).toBeCloseTo(endModel.left);
      expect(startModel.left).toBeGreaterThanOrEqual(0);
      expect(endModel.right).toBeLessThanOrEqual(254);
    }
  });

  it("starts at the plot's left where its start label fits there, and is none until the canvas is measured", () => {
    const view = buildView(DATA, variable("real_gdp"), { unit: "level" });
    const layout = chartLayout(view, view.rows, { canvasWidth: 926 });
    expect(layout.brush.x).toBe(MARGIN.left + layout.yWidth);
    expect(layout.brush.width).toBeLessThan(layout.plotWidth);
    expect(brushBox(view, { canvasWidth: 0, yWidth: 52, plotWidth: -80 })).toBeNull();
  });

  // Review round 23: the labels were set in 0.75rem, so with the browser's
  // text at 24px they were 18px, wider than the room made for 12px
  it("sets its labels in the pixels its room is measured in, whatever the page's text size", () => {
    const css = readFileSync("src/components/forecastVintages/ForecastVintages.css", "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const rules = [...css.matchAll(/([^{}]*recharts-brush[^{}]*)\{([^}]*)\}/g)];
    expect(rules.map(([, selector]) => selector.trim())).toEqual([".fv-plot .recharts-brush-texts"]);
    expect([...rules[0][2].matchAll(/font(?:-size)?:\s*([^;]+);/g)].map(([, value]) => value)).toEqual([
      "var(--fv-brush-text)",
    ]);
    const view = buildView(DATA, variable("receipts"), { unit: "level" });
    const { container } = render(
      <VintageChart view={view} showPast range={[0, view.rows.length - 1]} onRange={() => {}} chartKey="receipts" />,
    );
    expect(container.querySelector(".fv-plot").style.getPropertyValue("--fv-brush-text")).toBe(`${BRUSH_TEXT_SIZE}px`);
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

  it("space the years so their labels never meet, at any plot width", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1950 * 4, max: 2030 * 4 }),
        fc.integer({ min: 2, max: 320 }),
        fc.constantFrom("quarterly", "calendar", "fiscal"),
        fc.integer({ min: 120, max: 1000 }),
        (start, length, frequency, plotWidth) => {
          const from = frequency === "quarterly" ? start : Math.floor(start / 4);
          const rows = Array.from({ length }, (_, i) => ({ x: from + i }));
          const label = labelOf(frequency);
          const edge = { left: 40, right: 24 };
          const ticks = xTicks(rows, frequency, { plotWidth, label, edge });
          expect(ticks.length).toBeLessThanOrEqual(9);
          expect(spacingProblems(ticks, rows, plotWidth, label, edge)).toEqual([]);
        },
      ),
    );
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

  // Found by the field audit: spreading every value into Math.min ran out
  // of stack past about 300,000 points
  it("find the lowest and highest values however many points there are", () => {
    const view = buildView(DATA, variable("employment"), { unit: "level" });
    const rows = Array.from({ length: 2_000_000 }, (_, i) => ({ x: i, [OUTTURN_KEY]: 30 + (i % 7) }));
    const axis = yAxisFor(view, rows);
    expect(axis.domain[0]).toBeLessThanOrEqual(30);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(36);
  });
});

describe("a range with no axis", () => {
  // Values the loader would refuse (it holds every figure to 1e9), so
  // this is the chart's own guard: an axis that cannot be stepped is
  // said to be undrawable, never swapped for a 0 to 1 axis
  const huge = () => {
    const view = buildView(DATA, variable("unemployment"), { unit: "pct" });
    const rows = view.rows.map((r, i) => ({ ...r, [OUTTURN_KEY]: i % 2 ? 1e308 : -1e308 }));
    return { ...view, rows };
  };

  it("has no layout", () => {
    const view = huge();
    expect(yAxisFor(view, view.rows)).toBeNull();
    expect(chartLayout(view, view.rows, { canvasWidth: 900 })).toBeNull();
    expect(chartLayout(view, view.rows, { canvasWidth: 0 })).toBeNull();
  });

  it("says this range cannot be drawn, and draws no chart", () => {
    const view = huge();
    const { container } = render(
      <VintageChart view={view} showPast range={[0, view.rows.length - 1]} onRange={() => {}} chartKey="huge" />,
    );
    expect(screen.getByText("This range of the chart cannot be drawn.")).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeNull();
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
