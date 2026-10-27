import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ObrPriceCategoriesCard, { OBR_PRICE_CATEGORIES_TITLE, obrPriceSourceText } from "./ObrPriceCategoriesCard";
import {
  categoryRows,
  clearObrPriceCategoriesCache,
  isObrPriceCategories,
  obrPriceCategoriesSentence,
} from "../../utils/livingStandards/obrPriceCategories";

// A short file of the shape tools/extract-obr-price-categories.mjs writes
// (public/data/obr_price_categories.json), with Table 1.19's values
const series = (key, label, values) => ({ key, label, values: values.map(([year, value]) => ({ year, value })) });
const FILE = {
  schema: "uk-budget-dashboard/obr-price-categories/v1",
  source: {
    publisher: "Office for Budget Responsibility",
    release: "Economic and fiscal outlook, March 2026",
    release_date: "2026-03-03",
    table: "Table 1.19",
    table_title: "CPI category inflation",
    workbook: "Economic and fiscal outlook, March 2026: detailed forecast tables, economy",
    url: "https://obr.uk/download/march-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/",
  },
  vintage: "OBR March 2026 forecast (before the Autumn Budget 2026)",
  series: [
    series("food", "Food, beverages and tobacco", [["2026-27", 3.06], ["2027-28", 2.3754]]),
    series("utilities", "Utilities", [["2026-27", -7.9683], ["2027-28", -1.0295]]),
    series("fuels", "Fuels", [["2026-27", 2.2945], ["2027-28", 4.8167]]),
    series("other_tradables", "Other tradables", [["2026-27", 1.1574], ["2027-28", 0.9019]]),
    series("other_non_tradables", "Other non-tradables", [["2026-27", 3.0106], ["2027-28", 2.6136]]),
  ],
};
const NAMES = { food: "food, beverages and tobacco", utilities: "utilities", fuels: "fuels", other_tradables: "other tradables", other_non_tradables: "other non-tradables" };

const serve = (status, body) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body ? JSON.stringify(body) : "", { status })));

beforeEach(() => {
  clearObrPriceCategoriesCache();
  serve(200, FILE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Prices by spending category", () => {
  it("reads the file as published, one row per fiscal year", () => {
    expect(isObrPriceCategories(FILE)).toBe(true);
    expect(isObrPriceCategories({ ...FILE, schema: "other" })).toBe(false);
    const rows = categoryRows(FILE);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027]);
    expect(rows[1]).toEqual({ year: 2027, food: 2.3754, utilities: -1.0295, fuels: 4.8167, other_tradables: 0.9019, other_non_tradables: 2.6136 });
  });

  it("names the first year's fastest and slowest category in one sentence", () => {
    expect(obrPriceCategoriesSentence(categoryRows(FILE), NAMES)).toBe(
      "In 2026-27 the OBR expects food, beverages and tobacco prices to rise 3.1% and utilities prices to fall 8.0%.",
    );
  });

  it("shows the title, the sentence and a chip per category", async () => {
    render(<ObrPriceCategoriesCard />);
    expect(await screen.findByText(/^In 2026-27 the OBR expects/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: OBR_PRICE_CATEGORIES_TITLE })).toBeTruthy();
    for (const name of ["Food, beverages and tobacco", "Utilities", "Fuels", "Other tradables", "Other non-tradables"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(obrPriceSourceText(FILE.source)).toBe("OBR, Economic and fiscal outlook, March 2026, Table 1.19 (CPI category inflation)");
  });

  it("draws a table of fiscal years in the table view", async () => {
    render(<ObrPriceCategoriesCard view="table" onViewChange={() => {}} />);
    expect(await screen.findByRole("cell", { name: "2027-28" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "-8.0%" })).toBeTruthy();
  });

  it("says the forecast is not yet available before the file is published", async () => {
    serve(404);
    render(<ObrPriceCategoriesCard />);
    expect(await screen.findByText("The OBR forecast of prices by spending category is not yet available.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a file it cannot read", async () => {
    serve(200, { schema: "other" });
    render(<ObrPriceCategoriesCard />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/not an OBR price categories file/);
  });

});
