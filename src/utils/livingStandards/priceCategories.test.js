import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeRows,
  clearPriceCategoriesCache,
  forecastRates,
  isPriceCategories,
  latestChanges,
  loadPriceCategories,
  monthLabel,
  monthShort,
  priceCategoriesSentence,
  withForecast,
  yearTicks,
} from "./priceCategories";

const series = (key, cdid, dataset, values) => ({ key, cdid, dataset, title: key, values });
const months = (from, levels) => levels.map((value, i) => {
  const [y, m] = from.split("-").map(Number);
  const n = y * 12 + (m - 1) + i;
  return { month: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`, value };
});

// June 2021 to January 2022; earnings stop a month early
const FILE = {
  schema: "uk-budget-dashboard/price-categories/v1",
  base_month: "2021-07",
  series: [
    series("cpi", "D7BT", "MM23", months("2021-06", [99, 100, 101, 102, 103, 104, 105, 110])),
    series("energy", "D7CH", "MM23", months("2021-06", [49, 50, 55, 60, 65, 70, 75, 83.5])),
    series("food", "D7BU", "MM23", months("2021-06", [200, 200, 202, 204, 206, 208, 210, 240])),
    series("earnings", "KAB9", "LMS", months("2021-06", [600, 600, 606, 612, 618, 624, 630])),
  ],
};

describe("prices by spending category: data", () => {
  it("computes each month's change since the base month, null where a series has no value", () => {
    const rows = changeRows(FILE);
    expect(rows.map((r) => r.month)).toEqual(["2021-06", "2021-07", "2021-08", "2021-09", "2021-10", "2021-11", "2021-12", "2022-01"]);
    const july = rows.find((r) => r.month === "2021-07");
    expect([july.cpi, july.energy, july.food, july.earnings]).toEqual([0, 0, 0, 0]);
    expect(rows[0].cpi).toBeCloseTo(-1, 10);
    expect(rows.at(-1).energy).toBeCloseTo(67, 10);
    expect(rows.at(-1).earnings).toBeNull();
  });

  it("finds each series' latest month and change", () => {
    const l = latestChanges(changeRows(FILE), ["cpi", "earnings"]);
    expect(l.cpi.month).toBe("2022-01");
    expect(l.cpi.change).toBeCloseTo(10, 10);
    expect(l.earnings.month).toBe("2021-12");
    expect(l.earnings.change).toBeCloseTo(5, 10);
  });

  it("builds the sentence from the latest values, naming the earnings month when it differs", () => {
    expect(priceCategoriesSentence(changeRows(FILE), FILE.base_month)).toBe(
      "Since July 2021, energy prices are up 67.0% and food 20.0%, against 10.0% for CPI and 5.0% for earnings (to December 2021).",
    );
  });

  it("names only the earnings month when it ends earlier in the prices' year, and drops it when the months match", () => {
    // Trim a month off the price series (ending December 2021) and, for the
    // first case, two off earnings (ending November 2021)
    const trim = (earningsCut) => ({
      ...FILE,
      series: FILE.series.map((s) => ({ ...s, values: s.values.slice(0, s.key === "earnings" ? earningsCut : -1) })),
    });
    expect(priceCategoriesSentence(changeRows(trim(-1)), FILE.base_month)).toMatch(/ for earnings \(to November\)\.$/);
    expect(priceCategoriesSentence(changeRows(trim(undefined)), FILE.base_month)).toMatch(/ for earnings\.$/);
  });

  it("labels months and puts one axis tick on each January", () => {
    expect(monthLabel("2021-07")).toBe("July 2021");
    expect(monthShort("2026-09")).toBe("Sep 2026");
    expect(yearTicks(changeRows(FILE))).toEqual(["2022-01"]);
  });

  it("accepts only the price categories shape", () => {
    expect(isPriceCategories(FILE)).toBe(true);
    expect(isPriceCategories({ forecast: {} })).toBe(false);
    expect(isPriceCategories({ ...FILE, base_month: "2020-01" })).toBe(false);
  });
});

describe("prices by spending category: OBR forecast", () => {
  // Monthly growth of exactly 1% a month, as an annual rate
  const ONE_PC = 1.01 ** 12 - 1;
  const OUTLOOK = {
    forecast: {
      sections: [
        { series: [{ key: "cpi", pre: [{ year: "2023", value: ONE_PC }, { year: "2024", value: 0 }] }, { key: "rpi", pre: [{ year: "2023", value: 0.5 }] }] },
        { series: [{ key: "earnings", pre: [{ year: "2023", value: 0 }, { year: "2024", value: 0 }] }] },
      ],
    },
  };

  it("reads the OBR growth for CPI and earnings only, by calendar year", () => {
    const r = forecastRates(OUTLOOK);
    expect(Object.keys(r)).toEqual(["cpi", "earnings"]);
    expect(r.cpi.map((g) => g.year)).toEqual([2023, 2024]);
    expect(forecastRates(null)).toBeNull();
    expect(forecastRates({ forecast: { sections: [] } })).toBeNull();
  });

  it("chains each forecast from its last ONS month to the end of the last forecast year, joined to the outturn", () => {
    const rows = withForecast(changeRows(FILE), FILE, forecastRates(OUTLOOK));
    expect(rows.at(-1).month).toBe("2024-12");
    // CPI ends January 2022 at 10% (110 on 100): the forecast starts there
    const jan = rows.find((r) => r.month === "2022-01");
    expect(jan.cpi_forecast).toBeCloseTo(10, 10);
    expect(jan.forecast).not.toContain("cpi");
    // Months before 2023 take the first forecast year's rate (1% a month)
    const feb = rows.find((r) => r.month === "2022-02");
    expect(feb.cpi_forecast).toBeCloseTo(11.1, 10);
    expect(feb.cpi).toBeNull();
    expect(feb.energy).toBeNull();
    expect(feb.forecast).toEqual(["cpi", "earnings"]);
    // 23 months at 1% to December 2023, then flat through 2024
    expect(rows.find((r) => r.month === "2023-12").cpi_forecast).toBeCloseTo((110 * 1.01 ** 23) / 100 * 100 - 100, 8);
    expect(rows.at(-1).cpi_forecast).toBeCloseTo(rows.find((r) => r.month === "2023-12").cpi_forecast, 10);
    // Earnings end December 2021 at 5% and stay flat; January 2022 is a
    // forecast for earnings but outturn for CPI
    const dec = rows.find((r) => r.month === "2021-12");
    expect(dec.earnings_forecast).toBeCloseTo(5, 10);
    expect(jan.earnings_forecast).toBeCloseTo(5, 10);
    expect(rows.find((r) => r.month === "2021-12").forecast).toEqual([]);
    expect(jan.forecast).toEqual(["earnings"]);
    // Months before either line's forecast keep null forecast columns
    expect(rows[0].cpi_forecast).toBeNull();
  });

  it("leaves the outturn sentence unchanged by the forecast", () => {
    expect(priceCategoriesSentence(changeRows(FILE), FILE.base_month)).toMatch(/10\.0% for CPI and 5\.0% for earnings \(to December 2021\)\.$/);
  });
});

describe("prices by spending category: loader", () => {
  beforeEach(() => clearPriceCategoriesCache());
  afterEach(() => vi.unstubAllGlobals());

  it("loads the file once per page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FILE), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([loadPriceCategories(), loadPriceCategories()]);
    expect(a.error).toBeNull();
    expect(a.data.series).toHaveLength(4);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/data\/price_categories\.json$/);
  });

  it("returns an error, never a throw, for a missing or wrongly shaped file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await loadPriceCategories()).error).toMatch(/HTTP 404/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ forecast: {} }), { status: 200 })));
    expect((await loadPriceCategories()).error).toMatch(/not a price categories file/);
  });
});
