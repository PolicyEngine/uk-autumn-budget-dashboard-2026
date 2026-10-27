import { afterEach, describe, expect, it } from "vitest";
import { CHART_VIEWS_MARKER, chartChunkFiles, chartChunkScript } from "./chartChunk";
import * as chartViews from "../components/chartViews";

// As Turbopack writes a page chunk's dynamic-import loaders
const PAGE = '39835,t=>{t.v(s=>Promise.all(["static/chunks/text.js"].map(s=>t.l(s))).then(()=>s(74583)))},' +
  '94956,t=>{t.v(s=>Promise.all(["static/chunks/0fkq5d-x2_sh~.js","static/chunks/big.js","static/chunks/0676wy2yxm_jd.css"].map(s=>t.l(s))).then(()=>s(1)))}';
const CHUNKS = {
  "page.js": PAGE,
  "text.js": "methodology",
  "big.js": `recharts ${JSON.stringify(CHART_VIEWS_MARKER)}`,
  "0fkq5d-x2_sh~.js": "chart views",
};
const FILES = ["static/chunks/0fkq5d-x2_sh~.js", "static/chunks/big.js", "static/chunks/0676wy2yxm_jd.css"];

describe("the chart chunk's files", () => {
  it("are the loader list that names the chunk carrying the marker", () => {
    expect(chartChunkFiles(CHUNKS)).toEqual(FILES);
  });

  it("are none when the marker is missing or ambiguous", () => {
    expect(chartChunkFiles({ ...CHUNKS, "big.js": "recharts" })).toEqual([]);
    expect(chartChunkFiles({ ...CHUNKS, "text.js": CHART_VIEWS_MARKER })).toEqual([]);
  });

  it("are none when no list, or two different lists, name the chunk", () => {
    expect(chartChunkFiles({ ...CHUNKS, "page.js": "" })).toEqual([]);
    expect(chartChunkFiles({ ...CHUNKS, "other.js": '["static/chunks/big.js"]' })).toEqual([]);
  });

  it("is a marker the chart views module carries", () => {
    expect(chartViews.CHART_VIEWS_MARKER).toBe(CHART_VIEWS_MARKER);
  });
});

describe("the head's chart chunk preload", () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="preload"], script[src]').forEach((node) => node.remove());
    document.documentElement.removeAttribute("data-deep-link");
    document.documentElement.removeAttribute("data-boot-view");
  });

  function run(view, { deepLink = true, query = "?dpl=abc" } = {}) {
    const page = document.createElement("script");
    page.setAttribute("src", `/base/_next/static/chunks/page.js${query}`);
    document.head.appendChild(page);
    if (deepLink) document.documentElement.setAttribute("data-deep-link", "");
    document.documentElement.setAttribute("data-boot-view", view);
    new Function(chartChunkScript("/base", FILES))();
    return [...document.head.querySelectorAll('link[rel="preload"]')].map((link) => [link.getAttribute("href"), link.getAttribute("as")]);
  }

  it.each(["outlook:living", "outlook:poverty", "outlook:forecast", "dashboard:all", "dashboard:finances", "household"])(
    "preloads every file for a link to %s, with the page's deployment query",
    (view) => {
      expect(run(view)).toEqual([
        ["/base/_next/static/chunks/0fkq5d-x2_sh~.js?dpl=abc", "script"],
        ["/base/_next/static/chunks/big.js?dpl=abc", "script"],
        ["/base/_next/static/chunks/0676wy2yxm_jd.css?dpl=abc", "style"],
      ]);
    },
  );

  it("adds no query when the page's scripts carry none", () => {
    expect(run("outlook:living", { query: "" })[0][0]).toBe("/base/_next/static/chunks/0fkq5d-x2_sh~.js");
  });

  it.each(["policies", "methodology"])("preloads nothing for a link to %s", (view) => {
    expect(run(view)).toEqual([]);
  });

  it("preloads nothing for the landing page", () => {
    expect(run("dashboard:finances", { deepLink: false })).toEqual([]);
  });

  it("is no script at all when the build's files were not found", () => {
    expect(chartChunkScript("/base", [])).toBe("");
  });
});
