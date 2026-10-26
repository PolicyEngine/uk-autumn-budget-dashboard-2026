import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_VALUE, NEWEST_SHOWN, earliestForecast, forecastVintagesProblem, launchPeriod } from "./load";
import { lastIndex, pctChange, periodIndex, toSeries } from "./transforms";
import {
  DRAW_LIMIT,
  GROWTH_AXIS,
  OUTTURN_KEY,
  UNIT_ORDER,
  brushRange,
  buildView,
  checkSentence,
  drawable,
  formatterFor,
  niceAxis,
  stepDecimals,
} from "./view";

const DATA = JSON.parse(readFileSync("public/data/obr_forecast_vintages.json", "utf8"));
const variable = (id) => DATA.variables.find((v) => v.id === id);
const clone = () => JSON.parse(JSON.stringify(DATA));
const byId = (data, id) => data.variables.find((v) => v.id === id);

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
    // Found by the second review: these passed and then broke the drawing
    ["a check period that is a period", (d) => (byId(d, "rhdi_per_person").level.check.periods[0] = "garbage"), /check/],
    ["the largest gap's period", (d) => (byId(d, "cpi").level.check.largest_gap_period = "2021Q1"), /check/],
    ["decimals of at least 0", (d) => (byId(d, "psnb").level.decimals = -1), /decimals/],
    ["decimals of at most 6", (d) => (byId(d, "psnb").level.decimals = 7), /decimals/],
    ["whole decimals", (d) => (byId(d, "psnb").level.decimals = 1.5), /decimals/],
    ["a launch that is a period", (d) => (byId(d, "rhdi_per_person").level.vintages[0].launch = "2009Q5"), /launch/],
    ["a launch written as the data writes it", (d) => (byId(d, "psnd").level.vintages[0].launch = "2009-99"), /launch/],
    ["a month in the year", (d) => (byId(d, "cpi").level.vintages[0].month = 0), /date/],
    ["an outturn period that is a period", (d) => (byId(d, "cpi").level.outturn.garbage = 1), /outturn/],
    ["a forecast's period that is a period", (d) => (byId(d, "cpi").level.vintages[0].values["2011.0"] = 1), /values/],
    ["each forecast once", (d) => (byId(d, "cpi").level.vintages[1].id = byId(d, "cpi").level.vintages[0].id), /twice/],
    ["a parliament period written as the data writes it", (d) => (d.meta.parliament.start.fiscal = "2024-99"), /parliament/],
    [
      "the calendar parliament a quarterly measure's annual totals need",
      (d) => {
        d.variables = [byId(d, "rhdi_per_person")];
        delete d.meta.parliament.end.calendar;
      },
      /parliament/,
    ],
    // Found by the third review: these passed, then changed a figure or a
    // sentence, or drew nothing
    ["a default unit that is its own unit's name, not a list", (d) => (byId(d, "rhdi_per_person").default_unit = ["level"]), /default unit/],
    ["a default unit it does not inherit", (d) => (byId(d, "rhdi_per_person").default_unit = "toString"), /default unit/],
    ["a default unit that is no prototype", (d) => (byId(d, "rhdi_per_person").default_unit = "__proto__"), /default unit/],
    ["a default unit it offers", (d) => (byId(d, "cpi").default_unit = "level"), /default unit/],
    ["a check's share flag that is true or false", (d) => (byId(d, "real_gdp").level.check.tolerance_is_share = "false"), /check/],
    [
      "a forecast with no gap in its periods",
      (d) => {
        const newest = byId(d, "psnd").level.vintages.at(-1);
        newest.values = { "2024-25": newest.values["2024-25"], "2026-27": newest.values["2026-27"] };
      },
      /values/,
    ],
    ["an outturn with no gap in its periods", (d) => delete byId(d, "real_gdp").level.outturn["2009"], /outturn/],
    [
      "values a sum can hold",
      (d) => {
        const outturn = byId(d, "unemployment").level.outturn;
        Object.keys(outturn).forEach((k, i) => (outturn[k] = i % 2 ? -1e308 : 1e308));
      },
      /outturn/,
    ],
    ["a value no larger than any figure the file holds", (d) => (byId(d, "cpi").level.outturn["2020"] = MAX_VALUE * 2), /outturn/],
    ["an annual rate only for a quarterly measure's £", (d) => (byId(d, "real_gdp").units.level.annualise = true), /annual rate/],
    // Found by the sixth review: a quarter's figure under an axis that
    // names a year
    ["a quarterly measure's £ always at an annual rate", (d) => (byId(d, "rhdi_per_person").units.level.annualise = false), /annual rate/],
    ["a quarterly measure's £ that says it is at an annual rate", (d) => delete byId(d, "rhdi_per_person").units.level.annualise, /annual rate/],
    ["an annual-rate flag that is true or false", (d) => (byId(d, "rhdi_per_person").units.level.annualise = "true"), /transform/],
    ["a % change only in %", (d) => (byId(d, "real_gdp").units.level.transform = "growth"), /transform/],
    ["a check's largest gap within its tolerance", (d) => (byId(d, "real_gdp").level.check.largest_gap = 1.5), /beyond its tolerance/],
    ["a check's largest gap within its share", (d) => (byId(d, "nominal_gdp").level.check.largest_gap = 200), /beyond its tolerance/],
    ["check periods in the outturn", (d) => (byId(d, "real_gdp").level.check.periods[0] = "1900"), /check/],
    ["check periods in order", (d) => byId(d, "real_gdp").level.check.periods.reverse(), /check/],
    ["a forecast named for its month", (d) => (byId(d, "real_gdp").level.vintages[0].label = "July 2010"), /named for its date/],
    ["a launch period by the launch rules", (d) => (byId(d, "real_gdp").level.vintages[0].launch = 2010), /launch rules/],
    ["a forecast that starts at its launch", (d) => delete byId(d, "rhdi_per_person").level.vintages[0].values["2016Q2"], /start at its launch/],
    ["a parliament that ends after it starts", (d) => (d.meta.parliament.end.fiscal = "2023-24"), /parliament/],
    ["a source address on the web", (d) => (d.meta.sources.obr[0].url = "javascript:alert(1)"), /OBR sources/],
    ["a checksum that is one", (d) => (d.meta.sources.ons[0].sha256 = "garbage"), /ONS sources/],
    ["each OBR source once", (d) => (d.meta.sources.obr[1].id = d.meta.sources.obr[0].id), /OBR sources/],
    ["a variable id fit for an address", (d) => (d.variables[0].id = "Real GDP"), /label or frequency/],
    // Found by the field audit and the schema sweep: a kind or a unit's
    // measure that its figures contradict
    ["growth rates marked as growth, by their check", (d) => (byId(d, "real_gdp").level.kind = "level"), /outturn check is incomplete/],
    ["levels marked as levels, by their check", (d) => (byId(d, "employment").level.kind = "growth"), /outturn check is incomplete/],
    [
      "growth rates marked as growth, its check in its units",
      (d) => {
        const m = byId(d, "real_gdp").level;
        m.kind = "level";
        m.check.in = m.unit;
      },
      /do not read as levels/,
    ],
    [
      "levels marked as levels, its check in growth rates",
      (d) => {
        const m = byId(d, "employment").level;
        m.kind = "growth";
        Object.assign(m.check, { in: "% change on a year earlier", tolerance_is_share: false });
      },
      /do not read as growth rates/,
    ],
    ["a measure with its outturn check", (d) => delete byId(d, "employment").level.check, /employment: it has no outturn check/],
    ["an index marked as an index", (d) => (byId(d, "rhdi_per_person").level.kind = "growth"), /do not read as growth rates/],
    ["an index above zero", (d) => (byId(d, "real_gdp").level.kind = "index"), /launch period|do not read as an index/],
    ["a level that starts near the outturn", (d) => (byId(d, "nominal_gdp").level.vintages[0].values["2009-10"] *= 3), /do not read as levels/],
    ["a growth rate under 100%", (d) => (byId(d, "cpi").level.vintages.at(-1).values["2027"] = 150), /do not read as growth rates/],
    ["a % shown as published that reads a measure in %", (d) => (byId(d, "psnb").units.pct.from = "level"), /reads a measure in other units/],
    ["£ that reads no measure in %", (d) => (byId(d, "psnb").units.level.from = "share"), /reads a measure in other units/],
    // Found by the eleventh review: a change on a year earlier taken of a
    // rate, under the rate's own axis (debt's 93.2% of GDP drawn as 0.3%)
    ["a % change of no measure in %", (d) => (byId(d, "psnd").units.pct.transform = "growth"), /reads a measure in other units/],
    ["a % change of no rate", (d) => (byId(d, "unemployment").units.pct.transform = "growth"), /reads a measure in other units/],
    ["a % change of no share", (d) => (byId(d, "psnb").units.pct.transform = "growth"), /taken of no level/],
    // Found by the twelfth review: an index or a % change of a share
    // reads as one of the level under the axis the page gives it
    ["an index of the level", (d) => (byId(d, "receipts").units.index.from = "share"), /index unit is taken of no level/],
    // Found by the fourth review: a check stated in terms its gaps are
    // not in, and a forecast the build would not write
    ["a check in its measure's terms", (d) => (byId(d, "employment").level.check.in = "% change on a year earlier"), /outturn check is incomplete/],
    [
      "a share tolerance only on gaps in the outturn's units",
      (d) => Object.assign(byId(d, "rhdi_per_person").level.check, { tolerance_is_share: true, tolerance: 0.02 }),
      /outturn check is incomplete/,
    ],
    ["a tolerance no finer than a gap is written", (d) => (byId(d, "real_gdp").level.check.tolerance = 0.00001), /outturn check is incomplete/],
    ["a largest gap no finer than it is written", (d) => (byId(d, "real_gdp").level.check.largest_gap = 1e-300), /outturn check is incomplete/],
    // Found by the fifth review: a gap past its tolerance by less than the
    // rounding, which the page would state beside the tolerance
    [
      "a largest gap within its tolerance as both are written",
      (d) => Object.assign(byId(d, "unemployment").level.check, { tolerance: 0.005, largest_gap: 0.0051 }),
      /largest gap is beyond its tolerance/,
    ],
    [
      "a forecast of two periods or more",
      (d) => {
        const newest = byId(d, "unemployment").level.vintages.at(-1);
        newest.values = { 2025: 4.8 };
      },
      /only one value/,
    ],
    // Found by the seventh review: figures far finer than the build writes
    // underflow, carrying an index on to 0 or passing incompatible bases
    [
      "figures no finer than four decimals",
      (d) => {
        const m = byId(d, "rhdi_per_person").level;
        for (const series of [m.outturn, ...m.vintages.map((v) => v.values)]) for (const k of Object.keys(series)) series[k] = 1e-200;
        m.check.largest_gap = 0;
      },
      /no outturn/,
    ],
    [
      "forecasts no finer than four decimals",
      (d) => {
        byId(d, "rhdi_per_person").level.vintages.forEach((v, i) => {
          for (const k of Object.keys(v.values)) v.values[k] = (i % 2 ? 1000 : 1) * Number.MIN_VALUE;
        });
      },
      /has no values/,
    ],
    ["a figure of 0.00005", (d) => (byId(d, "unemployment").level.outturn["2000"] = 0.00005), /no outturn/],
    // Found by the sixth review: launch figures that meet no outturn set
    // no kind, so levels drawn from growth rates passed
    [
      "a launch figure that meets the outturn",
      (d) => {
        const m = byId(d, "real_gdp").level;
        m.outturn = { 1948: m.outturn["1948"], 1949: m.outturn["1949"] };
        m.kind = "level";
        Object.assign(m.check, { in: m.unit, periods: ["1948", "1949"], largest_gap_period: "1948" });
      },
      /no forecast's launch figure meets the outturn/,
    ],
    [
      "a forecast with a figure for its launch period",
      (d) => {
        for (const v of byId(d, "real_gdp").level.vintages) delete v.values[String(v.launch)];
      },
      /no forecast's launch figure meets the outturn/,
    ],
    [
      "an index with one base",
      (d) => {
        const newest = byId(d, "rhdi_per_person").level.vintages.at(-1);
        for (const k of Object.keys(newest.values)) newest.values[k] *= 2;
      },
      /do not read as one index/,
    ],
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
        // Periods cut from its start or its end: one taken from between
        // would leave a gap, which the loader refuses
        const keys = Object.keys(newest.values);
        const count = 1 + ((which >> 1) % (keys.length - 1));
        const cut = which % 2 ? keys.slice(0, count) : keys.slice(-count);
        for (const key of cut) delete newest.values[key];
        if (forecastVintagesProblem(data) !== null) return;
        const view = buildView(data, variable, { unit, annual });
        if (view.unavailable) expect(view.unavailable).toMatch(/March 2026 forecast/);
        else expect(view.newest.label).toBe("March 2026");
      }),
    );
  });

  // Found by the second review: cut after its anchor, the newest forecast
  // was one point, a line with nothing to draw, and the view stayed up
  it("is drawn as a line of at least two points, or the view is unavailable", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VIEWS), fc.nat(), ({ v, unit, annual, showPast }, keep) => {
        const data = clone();
        const variable = data.variables.find((x) => x.id === v.id);
        const measure = variable[variable.units[unit].from];
        const newest = measure.vintages[measure.vintages.length - 1];
        const keys = Object.keys(newest.values);
        // Two values at least, as the build writes a forecast
        newest.values = Object.fromEntries(keys.slice(0, 2 + (keep % (keys.length - 1))).map((k) => [k, newest.values[k]]));
        expect(forecastVintagesProblem(data)).toBeNull();
        const view = buildView(data, variable, { unit, annual, showPast });
        if (view.unavailable) {
          expect(view.unavailable).toMatch(/March 2026 forecast/);
          return;
        }
        const drawn = view.vintages.find((x) => x.newest);
        expect(drawn.label).toBe("March 2026");
        expect(view.rows.filter((row) => row[drawn.key] != null).length).toBeGreaterThanOrEqual(2);
        for (const x of view.vintages) expect(x.values.size).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  // The newest's figures cut back to the latest outturn (Q2 2026), where
  // it is re-anchored: a line of one point
  const cutAfter = (values, last) => Object.fromEntries(Object.entries(values).filter(([k]) => periodIndex(k, "quarterly") <= last));

  it("is unavailable as the newest when it stops at its anchor", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "rhdi_per_person");
    const newest = v.level.vintages.at(-1);
    newest.values = cutAfter(newest.values, periodIndex("2026Q2", "quarterly"));
    expect(forecastVintagesProblem(data)).toBeNull();
    for (const showPast of [true, false]) {
      expect(buildView(data, v, { unit: "level", showPast }).unavailable).toBe(
        "The March 2026 forecast of this measure cannot be drawn in this unit.",
      );
    }
  });

  // Found by the third review: values the file may hold whose index or %
  // change no axis can step over (an index of a tiny base) are not drawn
  it("leaves a view whose values are too large to draw unavailable, never on a 0 to 1 axis", () => {
    // The smallest figure the file holds (0.0001) at the parliament's
    // start, the index's base, where no forecast but the October 2024 one
    // is launched: without it, nothing sets the outturn there against an
    // estimate, so the loader takes the file. A year in 1960-61 then
    // rises from 0.0001 to 2 million, which as an index on that base, or
    // as a % change, is past what can be drawn
    const data = clone();
    const v = data.variables.find((x) => x.id === "rhdi_per_person");
    v.level.vintages = v.level.vintages.filter((x) => x.launch !== "2024Q2");
    Object.assign(v.level.outturn, { "2024Q2": 0.0001, "1960Q1": 0.0001, "1961Q1": 2e6 });
    expect(forecastVintagesProblem(data)).toBeNull();
    for (const unit of ["index", "pct"]) {
      expect(buildView(data, v, { unit }).unavailable).toMatch(/^The (March 2026 forecast|outturn) of this measure cannot be drawn in this unit\.$/);
    }
    // In £ every value is the file's own, so the view is drawn
    expect(buildView(data, v, { unit: "level" }).unavailable).toBeNull();
  });

  it("makes the view unavailable when its figures stop before the latest outturn", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "rhdi_per_person");
    const newest = v.level.vintages.at(-1);
    newest.values = cutAfter(newest.values, periodIndex("2026Q1", "quarterly"));
    expect(forecastVintagesProblem(data)).toBeNull();
    expect(buildView(data, v, { unit: "level" }).unavailable).toBe(
      "The March 2026 forecast of this measure cannot be drawn in this unit.",
    );
  });

  it("is named when it is an earlier one, and the rest are drawn", () => {
    const data = clone();
    const v = data.variables.find((x) => x.id === "real_gdp");
    // No outturn before 2010, so none for 2009, where the two 2010
    // forecasts start
    const launch = v.level.vintages[0].launch;
    const starting = v.level.vintages.filter((x) => x.launch === launch).map((x) => x.label);
    expect(starting).toEqual(["June 2010", "November 2010"]);
    for (const key of Object.keys(v.level.outturn)) if (Number(key) <= launch) delete v.level.outturn[key];
    expect(forecastVintagesProblem(data)).toBeNull();
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
    const only = (values, at) => {
      const key = Object.keys(values).sort().at(at);
      return { [key]: values[key] };
    };
    // One year of outturn (so a check over that year alone), and each
    // forecast's first two years
    v.level.outturn = only(v.level.outturn, -1);
    const [year] = Object.keys(v.level.outturn);
    Object.assign(v.level.check, { periods: [year], largest_gap_period: year });
    for (const vintage of v.level.vintages) {
      vintage.values = Object.fromEntries(Object.entries(vintage.values).slice(0, 2));
    }
    expect(forecastVintagesProblem(data)).toBeNull();
    const view = buildView(data, v, { unit: "pct" });
    expect(view.unavailable).toMatch(/cannot be drawn|too little outturn/);
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
    // Where no axis can be stepped, none: never a 0 to 1 axis in its place
    expect(niceAxis(Number.NaN, 1)).toBeNull();
    expect(niceAxis(2, 1)).toBeNull();
    expect(niceAxis(-1e308, 1e308)).toBeNull();
  });

  it("need as many decimals as the step", () => {
    expect(stepDecimals(50)).toBe(0);
    expect(stepDecimals(2.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
    // Found by the ninth review: a step of 5e-7 was given no decimals, so
    // six ticks read -0, -0, 0, 0, 0, 0
    expect(stepDecimals(5e-7)).toBe(7);
    expect(stepDecimals(2.5e-10)).toBe(11);
  });

  // Found by the tenth review, too: whole pounds took no decimals from
  // the axis, so ticks 0.1 apart read £296,673 four times
  it("write every tick of an axis apart, and none but 0 as 0, at any scale, in every unit the page shows", () => {
    const writers = DATA.variables.flatMap((v) =>
      UNIT_ORDER.filter((unit) => v.units[unit]).map((unit) => ({ where: `${v.id} ${unit}`, write: formatterFor(v, unit, v[v.units[unit].from]) })),
    );
    fc.assert(
      fc.property(fc.constantFrom(...writers), scaled, fc.oneof(scaled, fc.constant(0)), fc.boolean(), ({ where, write }, lo, size, zero) => {
        const { ticks, step } = niceAxis(lo, lo + Math.abs(size), { zero });
        const labels = ticks.map((t) => write(t, stepDecimals(step)));
        expect(new Set(labels).size, `${where}: ${labels}`).toBe(labels.length);
        ticks.forEach((t, i) => expect(/^-?£?0(\.0*)?(bn|m|%)?$/.test(labels[i]), `${where}: ${labels[i]}`).toBe(t === 0));
      }),
      { numRuns: 1000 },
    );
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
    expect(checkSentence(employment, "calendar")).toBe(
      "From 2017 to 2024, the ONS outturn is within 2% of the value of the outturn row of the OBR's database; the largest gap relative to the value is 2,700 people, in 2022.",
    );
    const rhdi = variable("rhdi_per_person").level.check;
    expect(checkSentence(rhdi, "quarterly")).toMatch(/^From Q4 2023 to Q3 2025, .* within 1\.5 percentage points of Table 1\.5 of the March 2026 forecast/);
  });

  // Found by the fourth review: a tolerance of 0.4% was written "0%"
  it("writes no tolerance or gap that is not zero as 0, and every tolerance as a bound", () => {
    const employment = variable("employment").level.check;
    const share = (tolerance) => checkSentence({ ...employment, tolerance }, "calendar").match(/within (.+?)% of the value/)[1];
    expect(share(0.004)).toBe("0.4");
    expect(share(0.0047)).toBe("0.47");
    expect(share(0.00471)).toBe("0.48");
    const gdp = variable("real_gdp").level.check;
    const written = (check) => checkSentence({ ...gdp, ...check }, "calendar").match(/within (.+?) percentage points?.*gap is (.+?) percentage points?/).slice(1);
    expect(written({ tolerance: 0.0123, largest_gap: 0.0001 })).toEqual(["0.013", "0.0001"]);
    const number = (text) => Number(text.replace(/,/g, ""));
    fc.assert(
      fc.property(fc.double({ min: 1e-4, max: 1e6, noNaN: true }), fc.double({ min: 1e-4, max: 1e6, noNaN: true }), (tolerance, gap) => {
        const [bound, said] = written({ tolerance, largest_gap: gap }).map(number);
        // A bound that still bounds (to the twelve figures it is read
        // to), at most a tenth above; a gap to its nearest second figure;
        // neither ever 0
        expect(bound).toBeGreaterThanOrEqual(tolerance * (1 - 1e-12));
        expect(bound).toBeLessThanOrEqual(tolerance * 1.1);
        expect(Math.abs(said - gap)).toBeLessThanOrEqual(gap * 0.05);
        expect(said).toBeGreaterThan(0);
        const pct = number(share(Math.min(tolerance / 1e6, 0.99)));
        expect(pct).toBeGreaterThanOrEqual(Math.min(tolerance / 1e6, 0.99) * 100 * (1 - 1e-12));
      }),
    );
  });

  it("says every measure's check, and nothing where there is none", () => {
    for (const v of DATA.variables) {
      for (const m of [v.level, v.share].filter(Boolean)) expect(checkSentence(m.check, v.frequency)).toMatch(/^From .+, in .+\.$/);
    }
    expect(checkSentence(null, "calendar")).toBeNull();
    expect(checkSentence({ periods: [] }, "calendar")).toBeNull();
  });
});

describe("what a line needs", () => {
  const series = (entries) => new Map(entries);

  it("is two values, one period after another, every one finite and drawable", () => {
    expect(drawable(series([[2020, 1], [2021, 2]]))).toBe(true);
    expect(drawable(series([[2020, 1]]))).toBe(false);
    // Found by the third review: two values with a period missing between
    // are two lone points, drawn as nothing
    expect(drawable(series([[2024, 1], [2026, 2]]))).toBe(false);
    expect(drawable(series([[2020, 1], [2021, 2], [2023, 3]]))).toBe(false);
    expect(drawable(series([[2020, 1], [2021, Number.NaN]]))).toBe(false);
    expect(drawable(series([[2020, 1], [2021, DRAW_LIMIT * 2]]))).toBe(false);
  });

  it("draws every series of every view whole: each of its periods next to another of its own", () => {
    for (const { v, unit, annual, showPast } of VIEWS) {
      const view = buildView(DATA, v, { unit, annual, showPast });
      for (const values of [view.outturn, ...view.vintages.map((x) => x.values)]) {
        expect(drawable(values)).toBe(true);
        // So on the chart's rows, each value has a neighbour in the next row
        const keys = [...values.keys()];
        for (const t of keys) expect(values.has(t - 1) || values.has(t + 1)).toBe(true);
      }
    }
  });

  it("is drawn whole or not at all, and the view says which forecasts are not, whatever is cut from the newest", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VIEWS), fc.nat(), fc.nat(), ({ v, unit, annual, showPast }, from, length) => {
        const data = clone();
        const variable = data.variables.find((x) => x.id === v.id);
        const measure = variable[variable.units[unit].from];
        const newest = measure.vintages.at(-1);
        const keys = Object.keys(newest.values);
        const start = from % keys.length;
        newest.values = Object.fromEntries(keys.slice(start, start + 1 + (length % keys.length)).map((k) => [k, newest.values[k]]));
        if (forecastVintagesProblem(data) !== null) return;
        const view = buildView(data, variable, { unit, annual, showPast });
        if (view.unavailable) return;
        for (const values of [view.outturn, ...view.vintages.map((x) => x.values)]) expect(drawable(values)).toBe(true);
      }),
    );
  });
});

describe("an index or a % change", () => {
  it("is taken only on values above zero", () => {
    expect([...pctChange(new Map([[2020, -2], [2021, 1], [2022, 2]]), 1)]).toEqual([[2022, 100]]);
    expect([...pctChange(new Map([[2020, 0], [2021, 1]]), 1)]).toEqual([]);
  });

  // Found by the eighth review: real GDP falling 99.9999% a year to 2100
  // drew £ and the index at zero from 2079-80, and the % line stopped at
  // 2080; the level then is 2.94e-327, which no double holds
  it("leaves a forecast carried on past the smallest figure undrawn in every unit, never at zero or cut short", () => {
    const data = clone();
    const v = byId(data, "real_gdp");
    const newest = v.level.vintages.at(-1);
    for (let year = 2026; year <= 2100; year += 1) newest.values[String(year)] = -99.9999;
    expect(forecastVintagesProblem(data)).toBeNull();
    for (const unit of ["level", "index", "pct"]) {
      expect(buildView(data, v, { unit }).unavailable).toBe("The March 2026 forecast of this measure cannot be drawn in this unit.");
    }
  });

  // Found by the ninth review: 1955's quarters add up to 0 to four
  // decimals, but to 1.66e-8 in a double, so with A on, 1956's change on
  // it was drawn as 120,525,976,911.63%
  it("leaves annual totals undrawn where a year's total is lost to rounding", () => {
    const data = clone();
    const v = byId(data, "rhdi_per_person");
    Object.assign(v.level.outturn, {
      "1955Q1": 999999999.9999,
      "1955Q2": -999999999.9998,
      "1955Q3": 0.0001,
      "1955Q4": -0.0002,
      "1956Q1": 5,
      "1956Q2": 5,
      "1956Q3": 5,
      "1956Q4": 5,
    });
    expect(forecastVintagesProblem(data)).toBeNull();
    for (const unit of ["level", "index", "pct"]) {
      for (const showPast of [true, false]) {
        expect(buildView(data, v, { unit, annual: true, showPast }).unavailable).toBe("The outturn of this measure cannot be drawn in this unit.");
      }
    }
  });

  it("leaves a % line that would need a change on a value at or below zero undrawn, never cut short", () => {
    // A forecast drawn as published, with a value below zero before its last
    const data = clone();
    const gdp = byId(data, "nominal_gdp");
    gdp.level.vintages.at(-1).values["2029-30"] = -1;
    expect(forecastVintagesProblem(data)).toBeNull();
    expect(buildView(data, gdp, { unit: "pct" }).unavailable).toBe("The March 2026 forecast of this measure cannot be drawn in this unit.");
    for (const unit of ["level", "index"]) expect(buildView(data, gdp, { unit }).unavailable).toBeNull();
    // The outturn, below zero in its first year, so no change in its second
    const other = clone();
    const employment = byId(other, "employment");
    employment.level.outturn["1971"] = -1;
    expect(forecastVintagesProblem(other)).toBeNull();
    expect(buildView(other, employment, { unit: "pct" }).unavailable).toBe("The outturn of this measure cannot be drawn in this unit.");
    expect(buildView(other, employment, { unit: "level" }).unavailable).toBeNull();
  });

  it("draws a % line to its series' last period or not at all, whatever value at or below zero a series holds", () => {
    const changes = VIEWS.filter(({ v, unit, annual }) => v.units[unit].transform === "growth" && !annual);
    fc.assert(
      fc.property(
        fc.constantFrom(...changes),
        fc.boolean(),
        fc.nat(),
        fc.constantFrom(0, -0.0001, -1, -1000),
        ({ v, unit, showPast }, inOutturn, at, value) => {
          const data = clone();
          const variable = byId(data, v.id);
          const measure = variable[variable.units[unit].from];
          const series = inOutturn ? measure.outturn : measure.vintages.at(-1).values;
          const keys = Object.keys(series);
          series[keys[at % keys.length]] = value;
          if (forecastVintagesProblem(data) !== null) return;
          const view = buildView(data, variable, { unit, showPast });
          if (view.unavailable) return;
          const lastOf = (values) => lastIndex(toSeries(values, variable.frequency));
          expect(lastIndex(view.outturn)).toBe(lastOf(measure.outturn));
          expect(lastIndex(view.vintages.find((x) => x.newest).values)).toBe(lastOf(measure.vintages.at(-1).values));
        },
      ),
      { numRuns: 400 },
    );
  });

  it("leaves an index unavailable where the outturn at the start of the parliament is not above zero", () => {
    for (const value of [0, -5]) {
      const data = clone();
      const v = byId(data, "rhdi_per_person");
      v.level.outturn["2024Q2"] = value;
      expect(forecastVintagesProblem(data)).toBeNull();
      expect(buildView(data, v, { unit: "index" }).unavailable).toBe(
        "There is no outturn above zero at the start of this parliament, so no index can be drawn.",
      );
    }
  });
});

describe("what the file says of itself", () => {
  // Found by the twelfth review: receipts' % unit made a % change of its
  // level (£) kept "% of GDP" as its axis, over its growth: 40.0% read 8.0%
  it("names a % change as one, whatever the file's axis says", () => {
    const data = clone();
    const receipts = byId(data, "receipts");
    Object.assign(receipts.units.pct, { from: "level", transform: "growth" });
    expect(forecastVintagesProblem(data)).toBeNull();
    expect(buildView(data, receipts, { unit: "pct", showPast: true }).axisLabel).toBe(GROWTH_AXIS);
    // As every % change in the committed file says of itself
    const growth = DATA.variables.filter((v) => v.units.pct?.transform === "growth");
    expect(growth.length).toBeGreaterThan(5);
    for (const v of growth) {
      expect(v.units.pct.axis).toBe(GROWTH_AXIS);
      expect(buildView(DATA, v, { unit: "pct", showPast: true }).axisLabel).toBe(GROWTH_AXIS);
    }
  });

  it("names each forecast's launch period by the launch rules", () => {
    for (const v of DATA.variables) {
      for (const name of ["level", "share"].filter((n) => v[n])) {
        for (const x of v[name].vintages) expect(launchPeriod(v.frequency, x.year, x.month)).toBe(periodIndex(x.launch, v.frequency));
      }
    }
    // Two quarters before the quarter of publication; the year before; the
    // last fiscal year complete before publication (a March forecast's
    // own year ends that month)
    expect(launchPeriod("quarterly", 2026, 3)).toBe(periodIndex("2025Q3", "quarterly"));
    expect(launchPeriod("quarterly", 2025, 11)).toBe(periodIndex("2025Q2", "quarterly"));
    expect(launchPeriod("calendar", 2026, 3)).toBe(2025);
    expect(launchPeriod("fiscal", 2026, 3)).toBe(2024);
    expect(launchPeriod("fiscal", 2025, 4)).toBe(2024);
  });

  it("gives the earliest forecast it holds for the page to name", () => {
    expect(earliestForecast(DATA)).toBe("June 2010");
    const data = clone();
    for (const v of data.variables) for (const name of ["level", "share"].filter((n) => v[n])) v[name].vintages.splice(0, 2);
    expect(earliestForecast(data)).toBe("March 2011");
  });

  // Found by the schema sweep: a measure no unit reads is not checked, so
  // it is not read either
  it("names it from the measures a unit reads", () => {
    const data = clone();
    byId(data, "real_gdp").share = {};
    expect(forecastVintagesProblem(data)).toBeNull();
    expect(earliestForecast(data)).toBe("June 2010");
  });

  // Neither its figures nor its check can say which it is: drawn, it
  // moves with the forecast from the outturn, as an index would. Its
  // outturn check, in £ billion, says otherwise, so it passes only with
  // the check's terms changed to an index's (the boundary kindProblem names)
  it("takes a forecast of levels marked as an index, above zero, starting at its launch, with one base and its check's terms changed to match", () => {
    const data = clone();
    const m = byId(data, "nominal_gdp").level;
    m.kind = "index";
    expect(forecastVintagesProblem(data)).toMatch(/outturn check is incomplete/);
    Object.assign(m.check, { in: "% change on a year earlier", tolerance_is_share: false, tolerance: 25 });
    expect(forecastVintagesProblem(data)).toBeNull();
  });
});

// Found by the twelfth review: the brush's ends could meet on one period,
// which draws no line and leaves the labels no plot to be laid out across
describe("the brush's range", () => {
  const range = (count) =>
    fc.tuple(fc.nat({ max: count - 1 }), fc.nat({ max: count - 1 })).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  it("keeps two rows or more, and what the brush asks for where it can", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 300 }).chain((count) => fc.tuple(fc.constant(count), fc.nat({ max: count - 1 }), fc.nat({ max: count - 1 }), fc.option(range(count)))),
        ([count, start, end, before]) => {
          const [lo, hi] = brushRange([start, end], before, count);
          expect(Number.isInteger(lo) && Number.isInteger(hi)).toBe(true);
          expect(0 <= lo && lo < hi && hi <= count - 1).toBe(true);
          if (start !== end) expect([lo, hi]).toEqual([Math.min(start, end), Math.max(start, end)]);
          else {
            // Two rows, one of them where the ends met
            expect(hi - lo).toBe(1);
            expect(lo === start || hi === start).toBe(true);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("stops the end that moved a row short of the other", () => {
    // The end dragged back onto the start; the start dragged on to the end
    expect(brushRange([10, 10], [10, 20], 40)).toEqual([10, 11]);
    expect(brushRange([20, 20], [10, 20], 40)).toEqual([19, 20]);
    // At the first and last rows
    expect(brushRange([0, 0], [0, 5], 40)).toEqual([0, 1]);
    expect(brushRange([0, 0], [3, 5], 40)).toEqual([0, 1]);
    expect(brushRange([39, 39], [30, 39], 40)).toEqual([38, 39]);
    expect(brushRange([39, 39], [39, 39], 40)).toEqual([38, 39]);
    expect(brushRange([5, 5], null, 40)).toEqual([4, 5]);
  });
});
