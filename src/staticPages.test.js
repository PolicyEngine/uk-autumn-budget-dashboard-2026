import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Everything under public/ is served as it is, whether or not a page links
// to it. This repository began as a copy of last year's dashboard, and five
// of last year's chart pages were still served on the 2026 site.
const PUBLIC = path.resolve(__dirname, "../public");
const BUDGET_YEAR = "2026";

// Last year's chart pages, written with their figures baked in by the
// ungated generator (scripts/generate_combined_charts.py writes the first
// four). revenue.html names no year, so only its path can catch it.
const LEGACY_PAGES = [
  "combined_reforms/constituency_map.html",
  "combined_reforms/distributional.html",
  "combined_reforms/poverty_inequality.html",
  "combined_reforms/revenue.html",
  "combined_reforms/winners_losers.html",
];

function htmlPages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlPages(full);
    return /\.html?$/i.test(entry.name) ? [full] : [];
  });
}

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    const hex = body[1] === "x" || body[1] === "X";
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// What a page shows or declares: its text with the markup between words
// taken out, and its attribute values (titles, meta descriptions, labels),
// with entities decoded.
export function pageText(html) {
  const attributes = [...html.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
    (match) => match[1] ?? match[2],
  );
  const text = html.replace(/<[^>]*>/g, " ");
  return decodeEntities([text, ...attributes].join(" "));
}

// The years a text names beside the word "Budget", either way round, with
// spaces or punctuation between.
export function budgetYears(text) {
  const between = String.raw`[\s\p{P}]*`;
  const after = new RegExp(`budget${between}(20[0-9]{2})(?![0-9])`, "giu");
  const before = new RegExp(
    `(?<![0-9])(20[0-9]{2})${between}(?:autumn${between})?budget`,
    "giu",
  );
  return [...text.matchAll(after), ...text.matchAll(before)].map(
    (match) => match[1],
  );
}

// Each HTML page under root that names a Budget other than this year's,
// with the years it names.
export function staleBudgetPages(root) {
  return htmlPages(root)
    .map((page) => [
      path.relative(root, page),
      budgetYears(pageText(readFileSync(page, "utf8"))).filter(
        (year) => year !== BUDGET_YEAR,
      ),
    ])
    .filter(([, years]) => years.length > 0);
}

describe("static pages the site serves", () => {
  it("reads the year beside 'Budget', either way round", () => {
    expect(budgetYears("Combined Autumn Budget 2025")).toEqual(["2025"]);
    expect(budgetYears("the 2025 Autumn Budget and the 2024 budget")).toEqual([
      "2025",
      "2024",
    ]);
    expect(budgetYears("autumn_budget_2026_combined")).toEqual(["2026"]);
    expect(budgetYears("Autumn Budget: 2025")).toEqual(["2025"]);
    expect(budgetYears("Autumn Budget – 2025")).toEqual(["2025"]);
    expect(budgetYears("Fiscal year 2026-27")).toEqual([]);
    expect(budgetYears("Budget 20251")).toEqual([]);
  });

  it("reads a page's text, not its markup", () => {
    // Review of #26: each of these shows "Autumn Budget 2025" in a browser
    // and escaped a match on the raw HTML.
    for (const html of [
      "<h1>Autumn Budget&nbsp;2025</h1>",
      "<h1>Autumn Budget&#160;2025</h1>",
      "<h1>Autumn Budget&#xA0;2025</h1>",
      "<h1>Autumn Budget <span>2025</span></h1>",
      "<h1>Autumn <b>Budget</b>:<br/>2025</h1>",
      '<meta name="description" content="Autumn Budget 2025">',
      "<div aria-label='The 2025 Autumn Budget'></div>",
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2025"]);
    }
    expect(
      budgetYears(
        pageText("<p>Spending in 2025&ndash;26, before the Budget</p>"),
      ),
    ).toEqual([]);
  });

  it("finds a stale page anywhere under a folder, by what it shows", () => {
    const root = mkdtempSync(path.join(tmpdir(), "static-pages-"));
    mkdirSync(path.join(root, "charts"));
    writeFileSync(
      path.join(root, "charts", "old.html"),
      "<title>Autumn Budget&nbsp;2025</title>",
    );
    writeFileSync(
      path.join(root, "current.htm"),
      "<h1>Autumn Budget <span>2026</span></h1>",
    );
    writeFileSync(path.join(root, "notes.txt"), "Autumn Budget 2024");
    expect(staleBudgetPages(root)).toEqual([
      [path.join("charts", "old.html"), ["2025"]],
    ]);
  });

  it("name no Budget but this year's", () => {
    expect(staleBudgetPages(PUBLIC)).toEqual([]);
  });

  it("serve none of last year's generated chart pages", () => {
    const served = LEGACY_PAGES.filter((page) =>
      existsSync(path.join(PUBLIC, page)),
    );
    expect(served).toEqual([]);
  });
});
