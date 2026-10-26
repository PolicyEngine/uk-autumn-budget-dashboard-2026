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

  // Every field the page reads: a file without one is refused, so it can
  // never fail as it is drawn
  it.each([
    ["the list of what is left out", (d) => delete d.meta.left_out, /left out/],
    ["an item's reason for being left out", (d) => delete d.meta.left_out[0].why, /left out/],
    ["the gaps", (d) => delete d.meta.gaps, /gaps/],
    ["the OBR sources", (d) => delete d.meta.sources.obr, /OBR sources/],
    ["an ONS source's checksum", (d) => delete d.meta.sources.ons[0].sha256, /ONS sources/],
    ["the House Price Index's page", (d) => delete d.meta.sources.hpi.page, /House Price Index/],
    ["a launch rule", (d) => delete d.meta.launch_rules.fiscal, /launch rules/],
    ["the parliament's end", (d) => delete d.meta.parliament.end.quarterly, /parliament/],
    ["a unit's axis", (d) => delete d.variables[0].units.pct.axis, /incomplete unit/],
    ["a unit's measure", (d) => (d.variables[0].units.pct.from = "rate"), /incomplete unit/],
    ["a measure's sources", (d) => delete d.variables[1].level.outturn_source, /sources/],
    ["a measure's check", (d) => delete d.variables[1].level.check.periods, /check/],
    ["a forecast's name", (d) => delete d.variables[2].level.vintages[3].label, /date/],
    ["the newest forecast", (d) => d.variables[3].level.vintages.pop(), /newest forecast is not/],
    ["the forecasts' order", (d) => d.variables[4].level.vintages.reverse(), /order/],
    ["notes as text", (d) => (d.variables[0].notes = [1]), /notes/],
  ])("is refused without %s", (_, mutate, problem) => {
    const data = clone();
    mutate(data);
    expect(forecastVintagesProblem(data)).toMatch(problem);
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

  it("draws a rate or share as published in %, and only a unit marked as growth as a % change", () => {
    const rates = DATA.variables.filter((v) => v.units.pct && v.units.pct.transform !== "growth");
    expect(rates.map((v) => v.id)).toEqual(expect.arrayContaining(["unemployment", "psnd", "psni", "psnb"]));
    for (const v of rates) {
      const measure = v[v.units.pct.from];
      const view = buildView(DATA, v, { unit: "pct", showPast: true });
      expect([...view.outturn]).toEqual([...toSeries(measure.outturn, v.frequency)]);
      measure.vintages.forEach((published, i) => {
        for (const [t, value] of view.vintages[i].values) expect(value).toBe(toSeries(published.values, v.frequency).get(t));
      });
    }
    // The latest unemployment outturn is the rate itself, not its change
    const unemployment = buildView(DATA, variable("unemployment"), { unit: "pct" });
    expect(unemployment.points.find((p) => p.role === "latest").y).toBe(variable("unemployment").level.outturn["2025"]);
  });

  it("indexes every line to the outturn at the start of the parliament", () => {
    const view = buildView(DATA, variable("real_gdp"), { unit: "index" });
    const start = view.points.find((p) => p.role === "start");
    expect(start.x).toBe(2024);
    expect(start.y).toBeCloseTo(100, 9);
  });
});

describe("a forecast that cannot be drawn", () => {
  // Any one period taken out of a measure's newest forecast
  const cutArb = fc.record({
    view: fc.constantFrom(...VIEWS.filter((x) => x.showPast)),
    which: fc.nat(),
  });

  it("is never replaced by an older one as the newest", () => {
    fc.assert(
      fc.property(cutArb, ({ view: { v, unit, annual }, which }) => {
        const data = clone();
        const variable = data.variables.find((x) => x.id === v.id);
        const measure = variable[variable.units[unit].from];
        const newest = measure.vintages[measure.vintages.length - 1];
        const keys = Object.keys(newest.values);
        delete newest.values[keys[which % keys.length]];
        const view = buildView(data, variable, { unit, annual });
        if (view.unavailable) expect(view.unavailable).toMatch(/March 2026 forecast/);
        else expect(view.newest.label).toBe("March 2026");
      }),
    );
  });

  it("makes the view unavailable when it is the newest", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "rhdi_per_person");
    delete v.level.vintages.at(-1).values["2026Q2"];
    expect(forecastVintagesProblem(data)).toBeNull();
    expect(buildView(data, v, { unit: "level" }).unavailable).toBe(
      "The March 2026 forecast of this measure cannot be drawn in this unit.",
    );
  });

  it("is named when it is an earlier one, and the rest are drawn", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "real_gdp");
    // No outturn for 2009, where the two 2010 forecasts start
    const launch = v.level.vintages[0].launch;
    const starting = v.level.vintages.filter((x) => x.launch === launch).map((x) => x.label);
    expect(starting).toEqual(["June 2010", "November 2010"]);
    delete v.level.outturn[launch];
    for (const unit of ["level", "index", "pct"]) {
      const view = buildView(data, v, { unit });
      expect(view.unavailable).toBeNull();
      expect(view.undrawn).toEqual(starting);
      expect(view.vintages.map((x) => x.label)).toEqual(v.level.vintages.slice(2).map((x) => x.label));
    }
  });

  it("leaves a view with nothing to draw in its unit unavailable, never an empty chart", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "employment");
    const last = (values) => {
      const key = Object.keys(values).sort().at(-1);
      return { [key]: values[key] };
    };
    v.level.outturn = last(v.level.outturn);
    for (const vintage of v.level.vintages) vintage.values = last(vintage.values);
    expect(forecastVintagesProblem(data)).toBeNull();
    const view = buildView(data, v, { unit: "pct" });
    expect(view.unavailable).toMatch(/cannot be drawn|no outturn/);
    expect(view.rows).toBeUndefined();
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
  // Any finite value at any scale: a mantissa times a power of ten
  const scaled = fc
    .tuple(fc.double({ min: -10, max: 10, noNaN: true }), fc.integer({ min: -12, max: 12 }))
    .map(([m, e]) => m * 10 ** e);

  it("cover the data with about five round steps, and 0 when asked, at any scale", () => {
    fc.assert(
      fc.property(scaled, fc.oneof(scaled, fc.constant(0)), fc.boolean(), (lo, size, zero) => {
        const hi = lo + Math.abs(size);
        const { domain, ticks, step } = niceAxis(lo, hi, { zero });
        expect(domain[0]).toBeLessThanOrEqual(zero ? Math.min(0, lo) : lo);
        expect(domain[1]).toBeGreaterThanOrEqual(zero ? Math.max(0, hi) : hi);
        expect(ticks.length).toBeGreaterThanOrEqual(2);
        expect(ticks.length).toBeLessThanOrEqual(10);
        for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
        if (zero) expect(ticks).toContain(0);
        expect([1, 2, 2.5, 5, 10].some((m) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - m) < 1e-9)).toBe(true);
      }),
    );
  });

  it("end on a span too small for rounding to nine decimals", () => {
    // Once looped for ever: the last tick rounded back onto itself
    expect(niceAxis(0, 1.1e-9).ticks).toEqual([0, 2.5e-10, 5e-10, 7.5e-10, 1e-9, 1.25e-9]);
    expect(niceAxis(Number.NaN, 1).domain).toEqual([0, 1]);
    expect(niceAxis(2, 1).domain).toEqual([0, 1]);
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
    // A sign goes before the pound sign, as the % values' does before them
    expect(formatterFor(variable("current_budget"), "level", variable("current_budget").level)(-23.61)).toBe("-£23.6bn");
    expect(formatterFor(variable("rhdi_per_person"), "level", variable("rhdi_per_person").level)(-1234.4)).toBe("-£1,234");
    expect(formatterFor(variable("current_budget"), "pct", variable("current_budget").share)(-1.24)).toBe("-1.2%");
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
