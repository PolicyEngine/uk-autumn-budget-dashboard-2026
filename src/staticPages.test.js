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
import { JSDOM } from "jsdom";
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

// A page is read as a browser parses it (jsdom), so every HTML entity is
// decoded and nesting is real; only what rendering would show is kept.

// Elements whose content is never shown, and citations: a <cite> names a
// source (last year's Budget, say) on purpose, so mark a historical
// reference with one.
const HIDDEN = new Set(["script", "style", "noscript", "template", "cite"]);

// Elements a browser lays out as their own box by default (block, list
// item, table parts). Any other element sits inside a line, so its text
// joins its neighbours' without a gap: 20<span>25</span> reads 2025.
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "ul",
]);

// Input types whose value is shown as text in the control.
const SHOWN_VALUE = new Set([
  "button",
  "email",
  "reset",
  "search",
  "submit",
  "tel",
  "text",
  "url",
]);

// Metadata a page declares as its own words, not as a resource address.
const DESCRIPTIVE_META = new Set([
  "description",
  "og:description",
  "og:site_name",
  "og:title",
  "title",
  "twitter:description",
  "twitter:title",
]);

function hidden(element) {
  return (
    HIDDEN.has(element.localName) ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    (element.localName === "input" &&
      (element.getAttribute("type") || "text").toLowerCase() === "hidden")
  );
}

// The attribute values a reader or assistive technology is shown.
function shownAttributes(element) {
  const values = [];
  for (const name of ["title", "aria-label", "aria-description"]) {
    if (element.hasAttribute(name)) values.push(element.getAttribute(name));
  }
  const tag = element.localName;
  if (["img", "area"].includes(tag) && element.hasAttribute("alt")) {
    values.push(element.getAttribute("alt"));
  }
  if (["option", "optgroup", "track"].includes(tag)) {
    values.push(element.getAttribute("label") || "");
  }
  if (tag === "input" || tag === "textarea") {
    values.push(element.getAttribute("placeholder") || "");
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (tag === "input" && SHOWN_VALUE.has(type)) {
      values.push(element.getAttribute("value") || "");
    }
  }
  if (tag === "meta") {
    const key = (
      element.getAttribute("name") ||
      element.getAttribute("property") ||
      ""
    ).toLowerCase();
    if (DESCRIPTIVE_META.has(key)) {
      values.push(element.getAttribute("content") || "");
    }
  }
  return values.filter(Boolean);
}

function walk(node, text, attributes) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      text.push(child.data);
    } else if (child.nodeType === 1 && !hidden(child)) {
      attributes.push(...shownAttributes(child));
      const block = BLOCK.has(child.localName);
      if (block) text.push(" ");
      walk(child, text, attributes);
      if (block) text.push(" ");
    }
  }
}

// Text as compared: compatibility forms folded (fullwidth digits, every
// width of space), invisible characters (soft hyphens, zero-width
// joiners, byte-order marks) removed, as they render as nothing.
function normalised(text) {
  return text
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "");
}

// What a page shows: its rendered text, and its shown attribute values.
export function pageText(html) {
  const { document } = new JSDOM(html).window;
  const text = [];
  const attributes = [];
  walk(document.documentElement, text, attributes);
  return normalised([text.join(""), ...attributes].join(" "));
}

// Years a page's stylesheets write as generated content (::before and
// ::after). A Budget year must be in the page's own text, where these
// checks read it, so any year here is refused.
export function generatedYears(html) {
  const { document } = new JSDOM(html).window;
  const years = [];
  for (const style of document.querySelectorAll("style")) {
    for (const match of style.textContent.matchAll(
      /content\s*:\s*(["'])((?:(?!\1).)*)\1/g,
    )) {
      years.push(...(normalised(match[2]).match(/20[0-9]{2}/g) || []));
    }
  }
  return years;
}

// The years a text names beside the word "Budget", either way round, with
// spaces, punctuation or a minus sign between.
export function budgetYears(text) {
  const between = String.raw`[\s\p{P}\u2212]*`;
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
    .map((page) => {
      const html = readFileSync(page, "utf8");
      return [
        path.relative(root, page),
        [
          ...budgetYears(pageText(html)).filter((year) => year !== BUDGET_YEAR),
          ...generatedYears(html),
        ],
      ];
    })
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

  it("reads a page as a browser parses it", () => {
    // Review round 3 of #26: entities outside a hand-made table, inline
    // elements treated as blocks, and nested templates.
    for (const html of [
      "<h1>Autumn Budget&emsp13;2025</h1>",
      "<h1>Autumn Budget&ThickSpace;2025</h1>",
      "<h1>Autumn Budget 20&#173;25</h1>",
      "<h1>Autumn Budget&Tab;2025</h1>",
      "<h1>Autumn Budget&minus;2025</h1>",
      "<h1>Autumn Budget 20<label>25</label></h1>",
      "<h1>Autumn Budget \uff12\uff10\uff12\uff15</h1>",
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2025"]);
    }
    for (const html of [
      '<h1>Autumn Budget 2026</h1><input type="hidden" value="Autumn Budget 2025">',
      '<h1>Autumn Budget 2026</h1><input type="hidden" title="Autumn Budget 2025">',
      '<h1>Autumn Budget 2026</h1><meta property="og:image" content="/images/autumn-budget-2025.png">',
      "<h1>Autumn Budget 2026</h1><template><template>Internal</template>Autumn Budget 2025</template>",
      "<h1>Autumn Budget 2026</h1><p hidden>Autumn Budget 2025</p>",
      '<h1>Autumn Budget 2026</h1><span aria-hidden="true">Autumn Budget 2025</span>',
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2026"]);
    }
    // Shown attribute values still count.
    for (const html of [
      '<input type="submit" value="Autumn Budget 2025">',
      '<meta property="og:title" content="Autumn Budget 2025">',
      '<img src="x.png" alt="Autumn Budget 2025">',
    ]) {
      expect(budgetYears(pageText(html)), html).toEqual(["2025"]);
    }
  });

  it("refuses a year written by a stylesheet", () => {
    // Review round 3 of #26: generated content (::before, ::after) shows
    // text that is in no element, so a Budget year must not come from it.
    const html =
      '<style>h1::after { content: " 2025"; }</style><h1>Autumn Budget</h1>';
    expect(generatedYears(html)).toEqual(["2025"]);
    expect(generatedYears("<style>/* Autumn Budget 2025 */</style>")).toEqual(
      [],
    );
    const root = mkdtempSync(path.join(tmpdir(), "static-pages-"));
    writeFileSync(path.join(root, "styled.html"), html);
    expect(staleBudgetPages(root)).toEqual([["styled.html", ["2025"]]]);
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
