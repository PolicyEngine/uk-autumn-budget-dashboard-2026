import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Everything under public/ is served as it is, whether or not a page links
// to it. This repository began as a copy of last year's dashboard, and five
// of last year's chart pages were still served on the 2026 site.
const PUBLIC = path.resolve(__dirname, "../public");
const BUDGET_YEAR = "2026";

function htmlPages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlPages(full);
    return /\.html?$/i.test(entry.name) ? [full] : [];
  });
}

// The years a page names beside the word "Budget", either way round.
export function budgetYears(text) {
  const after = [...text.matchAll(/budget[\s_-]*(20\d\d)/gi)];
  const before = [
    ...text.matchAll(/(20\d\d)[\s_-]*(?:autumn[\s_-]*)?budget/gi),
  ];
  return [...after, ...before].map((match) => match[1]);
}

describe("static pages the site serves", () => {
  it("reads the year beside 'Budget', either way round", () => {
    expect(budgetYears("Combined Autumn Budget 2025")).toEqual(["2025"]);
    expect(budgetYears("the 2025 Autumn Budget and the 2024 budget")).toEqual([
      "2025",
      "2024",
    ]);
    expect(budgetYears("autumn_budget_2026_combined")).toEqual(["2026"]);
    expect(budgetYears("Fiscal year 2026-27")).toEqual([]);
  });

  it("name no Budget but this year's", () => {
    const stale = htmlPages(PUBLIC)
      .map((page) => [
        path.relative(PUBLIC, page),
        budgetYears(readFileSync(page, "utf8")).filter(
          (year) => year !== BUDGET_YEAR,
        ),
      ])
      .filter(([, years]) => years.length > 0);
    expect(stale).toEqual([]);
  });
});
