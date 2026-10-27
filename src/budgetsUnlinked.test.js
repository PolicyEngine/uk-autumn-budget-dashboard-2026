import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The past events' pages (/budgets, /budgets/<id>) ship before their
// figures, so until the figures land nothing else links to them: no nav
// entry, no intro link, no static page (coordinator, 25 October 2026).
// Remove this test in the change that publishes past-event figures and
// adds the link.
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const PUBLIC = path.join(ROOT, "public");
// The past events' own pages and components may link to one another
const OWN = [path.join(SRC, "app", "budgets"), path.join(SRC, "components", "historical")];
// A page under public/ is served at its path under the site's base path
// (next.config.ts); any origin will do to resolve its links
const SITE = "https://site.test/uk/autumn-budget-2026/";

// In code: a route to /budgets anywhere ("/budgets", `${base}/budgets/<id>`)
const ABSOLUTE = /\/budgets(?![\w-])/;
// ...or a string that is a relative route to it ("budgets", "./budgets?x",
// "../budgets#y", `budgets/${id}`), though not prose that names budgets
const RELATIVE = /["'`](?:[^"'`\n]*\/)?budgets(?:[/?#][^"'`\n]*)?["'`]/;

// In a static page, besides: every URL an attribute or a meta refresh
// names, quoted or not, resolved as a browser resolves it, against the
// page's address or its <base href>
const ATTRIBUTE_VALUE = String.raw`\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))`;
const URL_ATTRIBUTE = new RegExp(String.raw`\b(?:href|src|action|formaction|data|poster|ping|cite|background)${ATTRIBUTE_VALUE}`, "gi");
const BASE_HREF = new RegExp(String.raw`<base\b[^>]*?\bhref${ATTRIBUTE_VALUE}`, "i");
const REFRESH = /<meta\b[^>]*?http-equiv\s*=\s*["']?refresh[^>]*>/gi;
const REFRESH_URL = /\burl\s*=\s*["']?([^"'\s;>]+)/i;

const valueOf = (match) => match[1] ?? match[2] ?? match[3] ?? "";

// Character references, as a browser decodes them in an attribute
const decodeEntities = (text) => text
  .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);?/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
  .replace(/&(?:sol|slash);/gi, "/")
  .replace(/&amp;/gi, "&");

const segment = (part) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** Whether code links to the past events' pages. */
function codeLinks(text) {
  return ABSOLUTE.test(text) || RELATIVE.test(text);
}

/** Whether a static page, at `page` under public/, links to the past events' pages. */
function pageLinks(text, page) {
  if (codeLinks(text)) return true;
  const address = new URL(page, SITE);
  const baseHref = BASE_HREF.exec(text);
  let base = address;
  try {
    if (baseHref) base = new URL(decodeEntities(valueOf(baseHref)), address);
  } catch {
    // An invalid <base href> is ignored, as a browser ignores it
  }
  const urls = [
    ...[...text.matchAll(URL_ATTRIBUTE)].map(valueOf),
    ...[...text.matchAll(REFRESH)].map((tag) => REFRESH_URL.exec(tag[0])?.[1]).filter(Boolean),
    ...(baseHref ? [valueOf(baseHref)] : []),
  ];
  return urls.some((url) => {
    try {
      return new URL(decodeEntities(url).trim(), base).pathname.split("/").map(segment).includes("budgets");
    } catch {
      return false;
    }
  });
}

function files(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full, keep);
    return keep(full) ? [full] : [];
  });
}

const CODE = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const PAGE = /\.(html?|svg|xml)$/i;

const isSource = (file) =>
  CODE.test(file) &&
  !/\.test\.(js|jsx|ts|tsx)$/.test(file) &&
  !file.startsWith(path.join(SRC, "test") + path.sep) &&
  !OWN.some((dir) => file.startsWith(dir + path.sep));

const linking = (paths) =>
  paths
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      if (!PAGE.test(file)) return codeLinks(text);
      return pageLinks(text, path.relative(PUBLIC, file).split(path.sep).join("/"));
    })
    .map((file) => path.relative(ROOT, file));

describe("the past events' pages are not linked yet", () => {
  it("no page, nav, component, script or static page outside them links to /budgets", () => {
    const sources = files(SRC, isSource);
    expect(sources.length).toBeGreaterThan(50);
    const served = files(PUBLIC, (file) => PAGE.test(file) || CODE.test(file));
    expect(linking([...sources, ...served])).toEqual([]);
  });

  it("the check finds the links the past events' index has", () => {
    // Not vacuous: /budgets lists each event at /budgets/<id>
    expect(linking([path.join(SRC, "app", "budgets", "page.tsx")])).toEqual(["src/app/budgets/page.tsx"]);
  });

  it.each([
    'href="/budgets"',
    "<Link href={`${base}/budgets/${id}`}>",
    'href="budgets"',
    "router.push('./budgets?from=nav')",
    'const index = "../budgets#list";',
    "`budgets/${release.id}`",
    "redirect(\"/uk/autumn-budget-2026/budgets/\")",
  ])("finds a link to them in code: %s", (text) => {
    expect(codeLinks(text)).toBe(true);
  });

  it.each([
    "// Past budgets are not linked yet",
    '"Past budgets are on their own pages"',
    'params.set("budget", id)',
    '"?budget=uk-autumn-budget-2025"',
    'href="/budgets-archive"',
    'href="budget"',
  ])("does not mistake other text in code for one: %s", (text) => {
    expect(codeLinks(text)).toBe(false);
  });

  it.each([
    // Round 3's probe: relative to the base path, and every form of it
    ['<base href="/uk/autumn-budget-2026/"><a href="budgets">Past events</a>', "example.html"],
    ["<a href=budgets/>Past events</a>", "example.html"],
    ["<a href=budgets>Past events</a>", "example.html"],
    ["<a href='budgets?from=static'>", "example.html"],
    ["<a href=budgets#list>", "example.html"],
    ['<base href="budgets/"><a href=".">Past events</a>', "example.html"],
    ["<a href=../budgets>", "notes/index.html"],
    ["<a href=.././budgets/uk-autumn-budget-2025>", "notes/old/page.htm"],
    ['<meta http-equiv="refresh" content="0; url=budgets">', "example.html"],
    ["<a href=&#98;udgets>", "example.html"],
    ["<a href=%62udgets>", "example.html"],
    ['<svg><a href="budgets"><text>Past events</text></a></svg>', "logo.svg"],
  ])("finds a link to them in a static page: %s", (text, page) => {
    expect(pageLinks(text, page)).toBe(true);
  });

  it.each([
    ["<p>Past budgets are not linked yet.</p>", "example.html"],
    ['<a href="budget">This Budget</a>', "example.html"],
    ['<a href="?budget=uk-autumn-budget-2025">', "example.html"],
    ["<a href=budgets-archive/>", "example.html"],
    ['<a href="data/manifest.json">', "example.html"],
  ])("does not mistake other links in a static page for one: %s", (text, page) => {
    expect(pageLinks(text, page)).toBe(false);
  });
});
