import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ROUNDING,
  anchorFor,
  annualSums,
  annualise,
  carryForward,
  firstIndex,
  fromIndex,
  lastWholeYear,
  pctChange,
  periodIndex,
  periodKey,
  periodLabel,
  splice,
  toIndex,
  toSeries,
  whole,
} from "./transforms";

const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

const year = fc.integer({ min: 1900, max: 2100 });
const positive = fc.double({ min: 1, max: 1e7, noNaN: true });
const rate = fc.double({ min: -20, max: 20, noNaN: true });

describe("periods", () => {
  it("round-trip between keys and numbers at every frequency", () => {
    fc.assert(
      fc.property(year, fc.integer({ min: 1, max: 4 }), (y, q) => {
        expect(periodKey(periodIndex(`${y}Q${q}`, "quarterly"), "quarterly")).toBe(`${y}Q${q}`);
        const fy = `${y}-${String(y + 1).slice(-2)}`;
        expect(periodKey(periodIndex(fy, "fiscal"), "fiscal")).toBe(fy);
        expect(periodKey(periodIndex(String(y), "calendar"), "calendar")).toBe(String(y));
      }),
    );
  });

  it("number the next period one more, over a year end", () => {
    expect(periodKey(periodIndex("2024Q4", "quarterly") + 1, "quarterly")).toBe("2025Q1");
    expect(periodKey(periodIndex("2024-25", "fiscal") + 1, "fiscal")).toBe("2025-26");
    expect(periodKey(periodIndex("1999-00", "fiscal") + 1, "fiscal")).toBe("2000-01");
  });

  it("are written as on the page", () => {
    expect(periodLabel(periodIndex("1955Q1", "quarterly"), "quarterly")).toBe("Q1 1955");
    expect(periodLabel(2024, "fiscal")).toBe("2024-25");
    expect(periodLabel(2024, "calendar")).toBe("2024");
  });

  it("refuse keys of another frequency", () => {
    expect(() => periodIndex("2024", "quarterly")).toThrow();
    expect(() => periodIndex("2024Q1", "fiscal")).toThrow();
    expect(() => periodIndex("2024-25", "calendar")).toThrow();
  });

  it("leave missing values out, never zero", () => {
    const series = toSeries({ 2024: 1.5, 2025: null, 2026: "2" }, "calendar");
    expect([...series]).toEqual([[2024, 1.5]]);
  });
});

describe("index rebasing", () => {
  it("round-trips: fromIndex(toIndex(s, b), b) is s", () => {
    fc.assert(
      fc.property(fc.array(positive, { minLength: 1, maxLength: 20 }), positive, (values, base) => {
        const series = new Map(values.map((v, i) => [2000 + i, v]));
        const back = fromIndex(toIndex(series, base), base);
        for (const [t, v] of series) expect(close(back.get(t), v)).toBe(true);
      }),
    );
  });

  it("is 100 at the base period", () => {
    fc.assert(
      fc.property(fc.array(positive, { minLength: 1, maxLength: 20 }), fc.nat(), (values, at) => {
        const series = new Map(values.map((v, i) => [2000 + i, v]));
        const t = 2000 + (at % values.length);
        expect(close(toIndex(series, series.get(t)).get(t), 100)).toBe(true);
      }),
    );
  });

  it("draws nothing without a base", () => {
    expect(toIndex(new Map([[2000, 1]]), undefined).size).toBe(0);
    expect(toIndex(new Map([[2000, 1]]), 0).size).toBe(0);
  });
});

describe("% change on a year earlier", () => {
  it("gives back a constant growth rate, quarterly or annual", () => {
    fc.assert(
      fc.property(positive, rate, fc.constantFrom(1, 4), (start, g, lag) => {
        const series = new Map();
        for (let i = 0; i < 24; i += 1) series.set(8000 + i, start * (1 + g / 100) ** (i / lag));
        const change = pctChange(series, lag);
        expect(change.size).toBe(24 - lag);
        for (const v of change.values()) expect(Math.abs(v - g)).toBeLessThan(1e-7);
      }),
    );
  });

  it("is missing where the earlier value is", () => {
    const change = pctChange(new Map([[2000, 100], [2002, 110]]), 1);
    expect(change.size).toBe(0);
  });
});

describe("a whole line", () => {
  it("is the series where it has every period from first to last, otherwise none", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 30 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }), (keys, a, b) => {
        const series = new Map([...keys].sort((x, y) => x - y).map((t) => [t, t / 2]));
        const [first, last] = [Math.min(a, b), Math.max(a, b)];
        const every = Array.from({ length: last - first + 1 }, (_, i) => first + i).every((t) => series.has(t));
        expect(whole(series, first, last)).toEqual(every ? series : new Map());
      }),
    );
    expect(whole(new Map([[1, 1]]), null, 1)).toEqual(new Map());
  });
});

describe("annualising", () => {
  it("times four, and a year's total is four times its quarters' mean", () => {
    fc.assert(
      fc.property(fc.array(positive, { minLength: 4, maxLength: 4 }), year, (quarters, y) => {
        const series = new Map(quarters.map((v, q) => [y * 4 + q, v]));
        const x4 = annualise(series);
        for (const [t, v] of series) expect(x4.get(t)).toBe(v * 4);
        const mean = [...x4.values()].reduce((a, b) => a + b, 0) / 4;
        expect(close(annualSums(series).get(y), mean)).toBe(true);
      }),
    );
  });

  it("totals complete years only", () => {
    const series = new Map([
      [2024 * 4 + 1, 1],
      [2024 * 4 + 2, 1],
      [2024 * 4 + 3, 1],
      [2025 * 4, 1],
      [2025 * 4 + 1, 1],
      [2025 * 4 + 2, 1],
      [2025 * 4 + 3, 1],
    ]);
    expect([...annualSums(series)]).toEqual([[2025, 4]]);
  });

  it("knows the last whole year before a quarter", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1950 * 4, max: 2100 * 4 }), (quarter) => {
        const y = lastWholeYear(quarter);
        expect(y * 4 + 3).toBeLessThanOrEqual(quarter);
        expect((y + 1) * 4 + 3).toBeGreaterThan(quarter);
      }),
    );
  });
});

describe("carrying a forecast on from the outturn", () => {
  const outturnFrom = (values, start) => new Map(values.map((v, i) => [start + i, v]));

  it("starts every forecast at its anchor, on the outturn", () => {
    fc.assert(
      fc.property(
        fc.array(positive, { minLength: 6, maxLength: 12 }),
        fc.array(rate, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        (history, growth, at) => {
          const outturn = outturnFrom(history, 2000);
          const anchor = 2000 + (at % history.length);
          const forecast = new Map(growth.map((g, i) => [anchor + 1 + i, g]));
          const levels = carryForward("growth", forecast, outturn, anchor);
          expect(firstIndex(levels)).toBe(anchor);
          expect(levels.get(anchor)).toBe(outturn.get(anchor));
          expect(levels.size).toBe(growth.length + 1);
        },
      ),
    );
  });

  it("gives back the published growth: % change of the carried levels", () => {
    fc.assert(
      fc.property(fc.array(positive, { minLength: 3, maxLength: 8 }), fc.array(rate, { minLength: 1, maxLength: 8 }), (history, growth) => {
        const outturn = outturnFrom(history, 2000);
        const anchor = 2000 + history.length - 1;
        const forecast = new Map(growth.map((g, i) => [anchor + 1 + i, g]));
        const levels = carryForward("growth", forecast, outturn, anchor);
        const change = pctChange(splice(outturn, levels, anchor), 1);
        for (const [t, g] of forecast) expect(Math.abs(change.get(t) - g)).toBeLessThan(1e-7);
      }),
    );
  });

  it("keeps an index's ratios, from the outturn at the anchor", () => {
    fc.assert(
      fc.property(positive, fc.array(positive, { minLength: 2, maxLength: 12 }), (base, index) => {
        const anchor = 8000;
        const outturn = new Map([[anchor, base]]);
        const forecast = new Map(index.map((v, i) => [anchor + i, v]));
        const levels = carryForward("index", forecast, outturn, anchor);
        expect(levels.get(anchor)).toBe(base);
        for (const [t, v] of forecast) expect(close(levels.get(t) / base, v / index[0])).toBe(true);
        expect(levels.size).toBe(index.length);
      }),
    );
  });

  it("draws a level as published from its anchor", () => {
    const forecast = new Map([[2023, 1], [2024, 2], [2025, 3]]);
    expect([...carryForward("level", forecast, new Map(), 2024)]).toEqual([[2024, 2], [2025, 3]]);
  });

  it("cannot start without the outturn at the anchor", () => {
    const forecast = new Map([[2025, 2]]);
    expect(carryForward("growth", forecast, new Map([[2023, 1]]), 2024)).toBeNull();
    expect(carryForward("index", new Map([[2024, 100]]), new Map(), 2024)).toBeNull();
    expect(() => carryForward("other", forecast, new Map(), 2024)).toThrow();
  });

  it("starts a past forecast at its launch and the newest at the latest outturn it reaches", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8000, max: 8100 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 30 }),
        fc.constantFrom("growth", "index", "level"),
        (launch, ahead, length, kind) => {
          const outturnEnd = launch + ahead;
          const forecastEnd = launch + length;
          expect(anchorFor({ kind, launch, newest: false, outturnEnd, forecastEnd })).toBe(launch);
          const newest = anchorFor({ kind, launch, newest: true, outturnEnd, forecastEnd });
          expect(newest).toBeGreaterThanOrEqual(launch);
          expect(newest).toBeLessThanOrEqual(Math.max(launch, forecastEnd));
          if (kind === "level") expect(newest).toBe(launch);
          else expect(newest).toBe(Math.max(launch, Math.min(outturnEnd, forecastEnd)));
        },
      ),
    );
  });

  // Found by the eighth review: real GDP falling 99.9999% a year to 2100
  // was carried on to zero from 2080 (the level is 2.94e-327), and its %
  // line stopped there
  it("carries no level below the file's smallest figure: a forecast compounded that far is not carried on", () => {
    const outturn = new Map([[2025, 2940.195]]);
    const forecast = new Map(Array.from({ length: 75 }, (_, i) => [2026 + i, -99.9999]));
    expect(carryForward("growth", forecast, outturn, 2025)).toBeNull();
    // A level of zero stays zero, as it is
    expect([...carryForward("growth", new Map([[2026, -50]]), new Map([[2025, 0]]), 2025)]).toEqual([[2025, 0], [2026, 0]]);
  });

  it("carries a level on, whatever growth the file may hold, only while it stays at or above the smallest figure", () => {
    // Figures as the file holds them: four decimals, 0.0001 to 1e9 in size;
    // growth over -100% and under 100%
    const figure = fc.integer({ min: 1, max: 1e13 }).chain((n) => fc.constantFrom(n / 1e4, -n / 1e4));
    const growth = fc.oneof(
      fc.integer({ min: -999999, max: 999999 }).map((n) => n / 1e4),
      fc.constantFrom(-99.9999, -99, -90, -50),
    );
    fc.assert(
      fc.property(
        fc.array(figure, { minLength: 4, maxLength: 4 }),
        fc.array(growth, { minLength: 1, maxLength: 200 }),
        fc.constantFrom(1, 4),
        (history, rates, lag) => {
          const anchor = 8000;
          const outturn = new Map(history.map((v, i) => [anchor - 3 + i, v]));
          const forecast = new Map(rates.map((g, i) => [anchor + 1 + i, g]));
          const levels = carryForward("growth", forecast, outturn, anchor, { lag });
          // The same chain in logs, which cannot underflow
          const logs = new Map([...outturn].map(([t, v]) => [t, Math.log(Math.abs(v))]));
          for (const [t, g] of forecast) logs.set(t, logs.get(t - lag) + Math.log1p(g / 100));
          const lowest = Math.min(...[...forecast.keys()].map((t) => logs.get(t)));
          if (Math.abs(lowest - Math.log(ROUNDING)) < 1e-9) return;
          if (lowest < Math.log(ROUNDING)) {
            expect(levels).toBeNull();
            return;
          }
          expect(levels.size).toBe(rates.length + 1);
          for (const [t, g] of forecast) {
            expect(Math.abs(levels.get(t))).toBeGreaterThanOrEqual(ROUNDING);
            const prior = t - lag > anchor ? levels.get(t - lag) : outturn.get(t - lag);
            expect(close(levels.get(t) / prior, 1 + g / 100, 1e-12)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("splices the outturn to the anchor and the forecast after it", () => {
    const outturn = new Map([[2020, 1], [2021, 2], [2022, 3]]);
    const levels = new Map([[2021, 20], [2022, 30], [2023, 40]]);
    expect([...splice(outturn, levels, 2021)]).toEqual([[2020, 1], [2021, 2], [2022, 30], [2023, 40]]);
  });
});
