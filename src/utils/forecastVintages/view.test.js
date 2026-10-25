import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { NEWEST_SHOWN, forecastVintagesProblem } from "./load";
import { periodIndex, toSeries } from "./transforms";
import { OUTTURN_KEY, UNIT_ORDER, buildView, checkSentence, formatterFor, niceAxis, stepDecimals } from "./view";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const variable = (id) => DATA.variables.find((v) => v.id === id);
const clone = () => JSON.parse(JSON.stringify(DATA));

// Every view the page can show: each variable in each of its units, with
// and without earlier forecasts, and annual for a quarterly variable
const VIEWS = DATA.variables.flatMap((v) =>
  UNIT_ORDER.filter((unit) => v.units[unit]).flatMap((unit) =>
    (v.frequency === "quarterly" ? [false, true] : [false]).flatMap((annual) =>
      [true, false].map((showPast) => ({ v, unit, annual, showPast })),
    ),
  ),
);

describe("the committed file", () => {
  it("is a valid forecast vintages file the view can show", () => {
    expect(forecastVintagesProblem(DATA)).toBeNull();
  });

  it("is refused when it holds a forecast after the newest shown", () => {
    const data = clone();
    const vintages = data.variables[0].level.vintages;
    vintages.push({ ...vintages[vintages.length - 1], id: "later", year: NEWEST_SHOWN.year, month: NEWEST_SHOWN.month + 1 });
    expect(forecastVintagesProblem(data)).toBe("newer");
  });

  it("is refused when a value is missing, not a number, or a measure has no forecasts", () => {
    const text = clone();
    text.variables[2].level.outturn["2020"] = "1.2";
    expect(forecastVintagesProblem(text)).toMatch(/outturn/);
    const empty = clone();
    empty.variables[0].level.vintages = [];
    expect(forecastVintagesProblem(empty)).toMatch(/no forecasts/);
    const unit = clone();
    unit.variables[0].units = { pounds: unit.variables[0].units.pct };
    expect(forecastVintagesProblem(unit)).toMatch(/units/);
    expect(forecastVintagesProblem(null)).toMatch(/not a/);
  });
});

describe("every view", () => {
  it.each(VIEWS.map((view) => [`${view.v.id} ${view.unit}${view.annual ? " annual" : ""}${view.showPast ? "" : " newest only"}`, view]))(
    "%s draws finite values in period order, each forecast from its anchor",
    (_, { v, unit, annual, showPast }) => {
      const view = buildView(DATA, v, { unit, annual, showPast });
      expect(view.unavailable).toBeNull();
      const xs = view.rows.map((r) => r.x);
      expect(xs).toEqual([...new Set(xs)].sort((a, b) => a - b));
      for (const row of view.rows) {
        for (const [key, value] of Object.entries(row)) if (key !== "x") expect(Number.isFinite(value)).toBe(true);
      }
      expect(view.vintages.length).toBe(showPast ? view.vintages.length : 1);
      expect(view.vintages[view.vintages.length - 1].newest).toBe(true);
      for (const vintage of view.vintages) {
        const first = Math.min(...vintage.values.keys());
        expect(first).toBeGreaterThanOrEqual(vintage.anchor);
        // A forecast carried on from the outturn starts on the outturn line
        const kind = v[v.units[unit].from].kind;
        if (kind !== "level" && unit !== "pct") {
          expect(first).toBe(vintage.anchor);
          expect(vintage.values.get(first)).toBeCloseTo(view.outturn.get(first), 6);
        }
      }
      expect(view.points.map((p) => p.role)).toContain("latest");
    },
  );

  it("starts every past forecast at its own launch period", () => {
    for (const v of DATA.variables) {
      const unit = v.units.level ? "level" : v.default_unit;
      const view = buildView(DATA, v, { unit, showPast: true });
      const measure = v[v.units[unit].from];
      view.vintages.slice(0, -1).forEach((vintage, i) => {
        expect(vintage.anchor).toBe(periodIndex(measure.vintages[i].launch, v.frequency));
      });
    }
  });

  it("gives back each growth forecast as published in %", () => {
    for (const v of DATA.variables.filter((x) => x.level.kind === "growth")) {
      const view = buildView(DATA, v, { unit: "pct", showPast: true });
      v.level.vintages.forEach((published, i) => {
        const shown = view.vintages[i].values;
        const values = toSeries(published.values, v.frequency);
        for (const [t, g] of values) {
          if (t > view.vintages[i].anchor) expect(shown.get(t)).toBeCloseTo(g, 6);
        }
      });
    }
  });

  it("draws a level forecast as published", () => {
    const v = variable("psnb");
    const view = buildView(DATA, v, { unit: "level", showPast: true });
    v.level.vintages.forEach((published, i) => {
      for (const [t, value] of toSeries(published.values, "fiscal")) expect(view.vintages[i].values.get(t)).toBe(value);
    });
  });

  it("indexes every line to the outturn at the start of the parliament", () => {
    const view = buildView(DATA, variable("real_gdp"), { unit: "index" });
    const start = view.points.find((p) => p.role === "start");
    expect(start.x).toBe(2024);
    expect(start.y).toBeCloseTo(100, 9);
  });
});

describe("real household disposable income per head", () => {
  const v = variable("rhdi_per_person");

  it("matches the chart it is modelled on: £25,820 start, £26,308 latest, £26,628 end", () => {
    const view = buildView(DATA, v, { unit: "level" });
    const at = Object.fromEntries(view.points.map((p) => [p.role, [view.label(p.x), Math.round(p.y)]]));
    expect(at).toEqual({ start: ["Q2 2024", 25820], latest: ["Q2 2026", 26308], end: ["Q2 2029", 26628] });
    expect(view.format(25820)).toBe("£25,820");
  });

  it("carries the newest forecast on from the latest outturn, and past ones from their launch", () => {
    const view = buildView(DATA, v, { unit: "level" });
    const newest = view.vintages[view.vintages.length - 1];
    expect(view.label(newest.anchor)).toBe("Q2 2026");
    expect(view.label(view.vintages[0].anchor)).toBe("Q2 2016");
  });

  it("totals calendar years, from the last whole year each forecast had", () => {
    const quarterly = buildView(DATA, v, { unit: "level" });
    const annual = buildView(DATA, v, { unit: "level", annual: true });
    expect(annual.frequency).toBe("calendar");
    const y2024 = [0, 1, 2, 3].reduce((sum, q) => sum + quarterly.outturn.get(2024 * 4 + q) / 4, 0);
    expect(annual.outturn.get(2024)).toBeCloseTo(y2024, 6);
    expect(annual.points.find((p) => p.role === "start").x).toBe(2024);
    expect(annual.vintages[annual.vintages.length - 1].anchor).toBe(2025);
  });
});

describe("axes and formats", () => {
  it("cover the data with about five round steps, and 0 when asked", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), fc.boolean(), (lo, span, zero) => {
        const hi = lo + span;
        const { domain, ticks, step } = niceAxis(lo, hi, { zero });
        expect(domain[0]).toBeLessThanOrEqual(zero ? Math.min(0, lo) : lo);
        expect(domain[1]).toBeGreaterThanOrEqual(zero ? Math.max(0, hi) : hi);
        expect(ticks.length).toBeGreaterThanOrEqual(2);
        expect(ticks.length).toBeLessThanOrEqual(12);
        if (zero) expect(ticks).toContain(0);
        expect([1, 2, 2.5, 5, 10].some((m) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - m) < 1e-9)).toBe(true);
      }),
    );
  });

  it("need as many decimals as the step", () => {
    expect(stepDecimals(50)).toBe(0);
    expect(stepDecimals(2.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
  });

  it("write each unit as the page does", () => {
    expect(formatterFor(variable("psnb"), "level", variable("psnb").level)(137.24)).toBe("£137.2bn");
    expect(formatterFor(variable("nominal_gdp"), "level", variable("nominal_gdp").level)(2950.4)).toBe("£2,950bn");
    expect(formatterFor(variable("employment"), "level", variable("employment").level)(33.456)).toBe("33.46m");
    expect(formatterFor(variable("house_prices"), "level", variable("house_prices").level)(272146.4)).toBe("£272,146");
    expect(formatterFor(variable("cpi"), "pct", variable("cpi").level)(2.345)).toBe("2.3%");
    expect(formatterFor(variable("cpi"), "index", variable("cpi").level)(101.25)).toBe("101.3");
  });

  it("keep the outturn under its own key", () => {
    const view = buildView(DATA, variable("cpi"), { unit: "pct" });
    expect(view.rows.some((r) => OUTTURN_KEY in r)).toBe(true);
  });
});

describe("the outturn check, in words", () => {
  it("states the periods, the tolerance and the largest gap of each kind of check", () => {
    const gdp = variable("real_gdp").level.check;
    expect(checkSentence(gdp, "calendar")).toBe(
      `From ${gdp.periods[0]} to ${gdp.periods[gdp.periods.length - 1]}, the ONS outturn's % change on a year earlier is within 1 percentage point of the outturn row of the OBR's database; the largest gap is 0.29 percentage points, in 2017.`,
    );
    const psnb = variable("psnb").level.check;
    expect(checkSentence(psnb, "fiscal")).toMatch(
      /^From 2017-18 to 2024-25, the ONS outturn is within 5% of the value of the outturn row of the OBR's database; the largest gap relative to the value is £2\.13 billion, in 2017-18\.$/,
    );
    const employment = variable("employment").level.check;
    expect(checkSentence(employment, "calendar")).toMatch(/is within 2% of the value .* million people, in \d{4}\.$/);
    const rhdi = variable("rhdi_per_person").level.check;
    expect(checkSentence(rhdi, "quarterly")).toMatch(/^From Q4 2023 to Q3 2025, .* within 1\.5 percentage points of Table 1\.5 of the March 2026 forecast/);
  });

  it("says every measure's check, and nothing where there is none", () => {
    for (const v of DATA.variables) {
      for (const m of [v.level, v.share].filter(Boolean)) expect(checkSentence(m.check, v.frequency)).toMatch(/^From .+, in .+\.$/);
    }
    expect(checkSentence(null, "calendar")).toBeNull();
    expect(checkSentence({ periods: [] }, "calendar")).toBeNull();
  });
});
