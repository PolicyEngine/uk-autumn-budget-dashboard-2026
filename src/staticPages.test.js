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

// Entities a page might put between "Budget" and a year: punctuation,
// spaces of every width, and invisible joiners (which join, so they
// decode to nothing).
const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  colon: ":",
  comma: ",",
  dash: "\u2010",
  emsp: "\u2003",
  emsp13: "\u2004",
  emsp14: "\u2005",
  ensp: "\u2002",
  gt: ">",
  hairsp: "\u200a",
  horbar: "\u2015",
  hyphen: "\u2010",
  lt: "<",
  mdash: "\u2014",
  mediumspace: "\u205f",
  minus: "\u2212",
  nbsp: "\u00a0",
  ndash: "\u2013",
  nobreak: "",
  numsp: "\u2007",
  period: ".",
  puncsp: "\u2008",
  quot: '"',
  shy: "",
  thinsp: "\u2009",
  thinspace: "\u2009",
  zwj: "",
  zwnj: "",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    const hex = body[1] === "x" || body[1] === "X";
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// Content a browser never shows, and citations: a <cite> names a source
// (last year's Budget, say) on purpose, so mark a historical reference
// with one.
const HIDDEN = ["script", "style", "noscript", "template", "cite"];

// Elements that start a new line when rendered. Any other tag sits inside
// a line, so removing it must not split a word or a number in two.
const BLOCK =
  /^(address|article|aside|blockquote|br|button|caption|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|label|legend|li|main|nav|ol|option|p|pre|section|summary|table|tbody|td|tfoot|th|thead|title|tr|ul)$/i;

// Attributes whose values a reader or assistive technology is shown.
// Links and sources (href, src) are not text.
const DESCRIPTIVE = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "content",
  "label",
  "placeholder",
  "title",
  "value",
]);

// What a page shows or declares: its text as rendered (inline markup
// removed without a gap, block markup as a line break), and its
// descriptive attribute values, with entities decoded.
export function pageText(html) {
  let shown = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of HIDDEN) {
    shown = shown.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"),
      " ",
    );
  }
  const attributes = [];
  const text = shown.replace(
    /<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi,
    (tag, name, rest) => {
      for (const match of rest.matchAll(
        /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
      )) {
        if (DESCRIPTIVE.has(match[1].toLowerCase())) {
          attributes.push(match[2] ?? match[3]);
        }
      }
      return BLOCK.test(name) ? " " : "";
    },
  );
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

  it("joins what inline markup splits and decodes every space", () => {
    // Review round 2 of #26: replacing every tag with a space split
    // 20<span>25</span>, and &thinsp; was not decoded.
    for (const html of [
      "<h1>Autumn Budget 20<span>25</span></h1>",
      "<h1>Autumn Budget&thinsp;2025</h1>",
      "<h1>Autumn Budget&ensp;2025</h1>",
      "<h1>Autumn Budget&#8239;2025</h1>",
      "<h1>Autumn Budget <b>20</b><i>25</i></h1>",
      "<h1>Autumn Budget 20&shy;25</h1>",
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2025"]);
    }
    // Block markup still separates: these are two numbers, not one.
    expect(budgetYears(pageText("<p>Budget 20</p><p>25</p>"))).toEqual([]);
  });

  it("reads neither what is never shown nor where links point", () => {
    // Review round 2 of #26: script contents and every attribute, links
    // included, could fail a page whose visible heading names only 2026.
    for (const html of [
      '<h1>Autumn Budget 2026</h1><script type="application/json">{"source":"Autumn Budget 2025"}</script>',
      "<h1>Autumn Budget 2026</h1><style>/* Autumn Budget 2025 */</style>",
      '<h1>Autumn Budget 2026</h1><a href="/reports/autumn-budget-2025.pdf">OBR source</a>',
      '<h1>Autumn Budget 2026</h1><img src="budget-2025.png" alt="Chart">',
      "<h1>Autumn Budget 2026</h1><!-- Autumn Budget 2025 -->",
      "<h1>Autumn Budget 2026</h1><p>Source: <cite>OBR, Autumn Budget 2025</cite></p>",
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2026"]);
    }
    // A historical reference not marked as a citation still counts.
    expect(
      budgetYears(pageText("<p>Source: OBR, Autumn Budget 2025</p>")),
    ).toEqual(["2025"]);
    expect(budgetYears(pageText("<h1>Autumn Budget 2026-27</h1>"))).toEqual([
      "2026",
    ]);
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
