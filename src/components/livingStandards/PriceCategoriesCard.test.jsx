import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PriceCategoriesCard, { PRICE_CATEGORIES_TITLE, endsNote, priceSourceText } from "./PriceCategoriesCard";
import { clearPriceCategoriesCache, monthLabel } from "../../utils/livingStandards/priceCategories";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";

// The published file: its shape and every series the card names
const FILE = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "public", "data", "price_categories.json"), "utf8"));
const OUTLOOK = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"), "utf8"));
const KEYS = ["cpi", "energy", "food", "rents", "water", "rail", "services", "earnings"];

beforeEach(() => {
  clearPriceCategoriesCache();
  clearOutlookCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).endsWith("price_categories.json") ? new Response(JSON.stringify(FILE), { status: 200 }) : new Response("", { status: 404 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Prices by spending category card", () => {
  it("the published file carries the eight ONS series from July 2021", () => {
    expect(FILE.base_month).toBe("2021-07");
    expect(FILE.series.map((s) => s.key).sort()).toEqual([...KEYS].sort());
    expect(Object.fromEntries(FILE.series.map((s) => [s.key, s.cdid]))).toEqual({
      cpi: "D7BT",
      energy: "D7CH",
      food: "D7BU",
      rents: "D7CE",
      water: "D7DR",
      rail: "D7EF",
      services: "D7F5",
      earnings: "KAB9",
    });
    for (const s of FILE.series) {
      expect(s.source_url).toMatch(/^https:\/\/www\.ons\.gov\.uk\/.+\/timeseries\//);
      expect(s.release_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.values[0].month).toBe("2021-01");
    }
  });

  it("shows the title with its period, the data-built sentence and a chip per line", async () => {
    render(<PriceCategoriesCard />);
    expect(await screen.findByText(/^Since July 2021, energy prices are up /)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: PRICE_CATEGORIES_TITLE })).toBeTruthy();
    expect(PRICE_CATEGORIES_TITLE).toBe("Prices by category since 2021");
    for (const name of ["Energy", "Water", "Food", "Services", "Rents", "Rail fares", "All prices (CPI)", "Earnings"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("starts at July 2021, where every line is 0%", async () => {
    render(<PriceCategoriesCard view="table" onViewChange={() => {}} />);
    await screen.findByText(/^Since /);
    const first = document.querySelector(".ls-table tbody tr");
    expect(first.cells[0].textContent).toBe("Jul 2021");
    expect([...first.cells].slice(1).every((c) => c.textContent === "0.0%")).toBe(true);
  });

  it("starts with the two benchmarks, energy and food on; the other categories a chip away", async () => {
    render(<PriceCategoriesCard view="table" onViewChange={() => {}} />);
    await screen.findByText(/^Since /);
    const heads = () => [...document.querySelectorAll(".ls-table thead th")].map((th) => th.textContent);
    expect(heads()).toEqual(["Month", "All prices (CPI)", "Earnings", "Energy", "Food"]);
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    expect(heads()).toContain("Water");
  });

  it("About this chart says it is history, not the forecast, and lists each ONS series by CDID", async () => {
    render(<PriceCategoriesCard />);
    await screen.findByText(/^Since /);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(screen.getByText(/history to the latest ONS release, not the OBR forecast/)).toBeTruthy();
    for (const cdid of ["D7BT", "D7CH", "D7BU", "D7CE", "D7DR", "D7EF", "D7F5", "KAB9"]) {
      expect(screen.getByText(new RegExp(`\\(${cdid}, (MM23|LMS)\\)`))).toBeTruthy();
    }
  });

  it("names the source datasets and CDIDs for the downloads", () => {
    expect(priceSourceText(FILE.series)).toMatch(/^ONS, Consumer price inflation \(MM23: .*D7BT.*\); ONS, Labour market statistics \(LMS: KAB9\)/);
  });

  it("says where series end only when they end in different months", () => {
    const latest = (s) => monthLabel(s.values.at(-1).month);
    const s = (key, month) => ({ key, values: [{ month }] });
    expect(endsNote([s("cpi", "2026-09"), s("food", "2026-09")], latest)).toBeNull();
    expect(endsNote([s("cpi", "2026-09"), s("earnings", "2026-08")], latest)).toBe("The price indices run to September 2026; earnings to August 2026.");
  });

  it("keeps its place with a status line when the file cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    render(<PriceCategoriesCard />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load the ONS price data/);
    expect(screen.getByRole("heading", { level: 3, name: PRICE_CATEGORIES_TITLE })).toBeTruthy();
  });

  it("carries CPI and earnings on with the OBR forecast, marked, while the categories stop at the ONS month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).endsWith("price_categories.json")
          ? new Response(JSON.stringify(FILE), { status: 200 })
          : String(url).endsWith("living_standards_outlook.json")
            ? new Response(JSON.stringify(OUTLOOK), { status: 200 })
            : new Response("", { status: 404 }),
      ),
    );
    render(<PriceCategoriesCard view="table" onViewChange={() => {}} />);
    await screen.findByText(/^Since July 2021/);
    const last = await screen.findByText("Dec 2030");
    const cells = [...last.closest("tr").cells].map((c) => c.textContent);
    // All prices (CPI), Earnings, Energy, Food
    expect(cells[1]).toMatch(/^\d+\.\d% forecast$/);
    expect(cells[2]).toMatch(/^\d+\.\d% forecast$/);
    expect(cells.slice(3)).toEqual(["–", "–"]);
    // The last ONS CPI month is outturn, unmarked; the sentence is outturn only
    const sep = [...screen.getByText("Sep 2026").closest("tr").cells].map((c) => c.textContent);
    expect(sep[1]).toMatch(/^\d+\.\d%$/);
    expect(sep[2]).toMatch(/forecast$/);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(screen.getByText(/no official forecast for the categories/)).toBeTruthy();
    expect(screen.getByText(/\(1 \+ g\)\^\(1\/12\)/)).toBeTruthy();
  });
});
