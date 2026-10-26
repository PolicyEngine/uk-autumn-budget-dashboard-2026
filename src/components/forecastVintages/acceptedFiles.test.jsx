/**
 * A forecasts file the loader accepts can always be drawn
 * (utils/forecastVintages/load.js promises it). Each case changes one field
 * of the committed file to something it should not hold; the loader must
 * refuse the file, or else every view of it builds, with its notes,
 * sentences, label layout, ticks, CSV and legend, and the view mounts
 * without falling back to "cannot be drawn".
 */
import { readFileSync } from "node:fs";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { cleanup, render, screen } from "@testing-library/react";
import ForecastVintagesView, { cardNotes, pointsSentence, startsSentence, vintageCsv } from "./ForecastVintagesView";
import { chartLayout, legendItems, xTicks } from "./VintageChart";
import { forecastVintagesProblem, resetForecastVintages } from "../../utils/forecastVintages/load";
import { UNIT_ORDER, buildView, pointsIn, stepDecimals } from "../../utils/forecastVintages/view";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 900, height: 440 }}>{cloneElement(children, { width: 900, height: 440 })}</div>
    ),
  };
});

const TEXT = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
const DATA = JSON.parse(TEXT);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Every field of the file: each object's keys, the first and last item of
// a list, and of a series ({period: value}) its first and last periods and
// one it does not have
function fieldPaths(value, path = [], out = []) {
  out.push(path);
  if (Array.isArray(value)) {
    const items = value.length > 1 ? [0, value.length - 1] : value.length ? [0] : [];
    for (const i of items) fieldPaths(value[i], [...path, i], out);
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const series = ["outturn", "values"].includes(path[path.length - 1]);
    for (const key of series ? [keys[0], keys[keys.length - 1], "garbage"] : keys) {
      fieldPaths(value[key], [...path, key], out);
    }
  }
  return out;
}

const DELETE = Symbol("delete");
// What a field should not hold: nothing, the wrong type, text that is no
// period, periods that do not exist, numbers out of range or too large
const BAD = [
  DELETE,
  null,
  "",
  "garbage",
  "2024Q5",
  "2024-99",
  "2024.0",
  -1,
  0,
  1.5,
  7,
  13,
  1e308,
  -1e308,
  true,
  [],
  {},
  ["garbage"],
  { garbage: 1 },
];

function changed(path, value) {
  const data = structuredClone(DATA);
  if (!path.length) return value === DELETE ? undefined : value;
  const parent = path.slice(0, -1).reduce((o, k) => o?.[k], data);
  if (parent == null || typeof parent !== "object") return data;
  const key = path[path.length - 1];
  if (value !== DELETE) parent[key] = value;
  else if (Array.isArray(parent)) parent.splice(key, 1);
  else delete parent[key];
  return data;
}

const CANVASES = [
  { canvasWidth: 926, narrow: false },
  { canvasWidth: 254, narrow: true },
];

/** Builds everything the page draws for `variables`; throws where it cannot. */
function drawEverything(data, variables) {
  for (const v of variables) {
    for (const unit of UNIT_ORDER.filter((u) => v.units[u])) {
      for (const annual of v.frequency === "quarterly" ? [false, true] : [false]) {
        for (const showPast of [true, false]) {
          const view = buildView(data, v, { unit, annual, showPast });
          if (view.unavailable) continue;
          const newest = view.vintages[view.vintages.length - 1];
          cardNotes(v, view, { showPast });
          startsSentence(data.meta.launch_rules, v.frequency, annual, {
            reanchored: newest.reanchored,
            earlier: view.vintages.length > 1,
          });
          legendItems(view, showPast);
          vintageCsv({ title: v.label, units: view.axisLabel, view, rows: view.rows });
          const tickLabel = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
          for (const rows of [view.rows.slice(view.windowStart), view.rows]) {
            pointsSentence(view, pointsIn(view.points, rows));
            for (const canvas of CANVASES) {
              const layout = chartLayout(view, rows, canvas);
              for (const tick of layout.axis.ticks) view.format(tick, stepDecimals(layout.axis.step));
              const ticks = xTicks(rows, view.frequency, { plotWidth: layout.plotWidth, label: tickLabel });
              ticks.forEach(tickLabel);
            }
          }
        }
      }
    }
  }
}

const PATHS = fieldPaths(DATA);
// The variables a change to `path` can reach: its own, or all of them
const reached = (data, path) =>
  path[0] === "variables" && typeof path[1] === "number" && path.length > 2
    ? [data.variables[path[1]]].filter(Boolean)
    : data.variables;

describe("a forecasts file the loader accepts", () => {
  it("covers every kind of field", () => {
    const leaves = PATHS.map((p) => p[p.length - 1]);
    for (const field of ["periods", "largest_gap_period", "decimals", "launch", "month", "start", "end", "garbage"]) {
      expect(leaves).toContain(field);
    }
  });

  it("can always be drawn, whatever one field holds", () => {
    let accepted = 0;
    fc.assert(
      fc.property(fc.constantFrom(...PATHS), fc.constantFrom(...BAD), (path, value) => {
        const data = changed(path, value);
        if (forecastVintagesProblem(data) !== null) return;
        accepted += 1;
        drawEverything(data, reached(data, path));
      }),
      { numRuns: 400 },
    );
    // Some changes leave a file the page draws (a label that is other
    // text, say), so the drawing is exercised too
    expect(accepted).toBeGreaterThan(0);
  }, 120000);

  it("mounts without falling back to 'cannot be drawn', whatever one field holds", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...PATHS), fc.constantFrom(...BAD), async (path, value) => {
        const data = changed(path, value);
        if (forecastVintagesProblem(data) !== null) return;
        const shown = reached(data, path)[0];
        resetForecastVintages();
        window.history.replaceState({}, "", `/?tab=forecasts&variable=${encodeURIComponent(shown.id)}`);
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
        render(<ForecastVintagesView />);
        await screen.findByRole("heading", { name: "OBR forecasts beside the outturn" });
        expect(screen.queryByText(/cannot be drawn: /)).toBeNull();
        cleanup();
        vi.unstubAllGlobals();
      }),
      { numRuns: 60 },
    );
  }, 120000);
});
