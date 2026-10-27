/**
 * The forecast vintages chart in the page, under the page's stylesheets:
 * every text it draws is drawn at the size its layout measured, in pixels
 * the chart sets, so neither a stylesheet nor the browser's text size can
 * make a label wider than the room made for it. Review rounds 23 to 25: the
 * brush's labels were set in 0.75rem, so with the browser's text at 24px
 * they were 18px, wider than the room made for 12px.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postcss from "postcss";
import { cloneElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../App";
import { FONT_SIZE as UNIT_SIZE } from "../../utils/ChartUnitLabel";
import { TICK_STYLE } from "../../utils/chartTheme";
import { buildView } from "../../utils/forecastVintages/view";
import { BRUSH_TEXT_SIZE, CAPTION_SIZE, chartLayout, labelGeometry } from "./VintageChart";

// jsdom lays nothing out, so ResponsiveContainer would draw nothing: give
// the chart a fixed size
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 900, height: 440 }}>{cloneElement(children, { width: 900, height: 440 })}</div>
    ),
  };
});

const VINTAGES = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
const DATA = JSON.parse(VINTAGES);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A package's stylesheet, where its exports put it. */
function packageStylesheet(spec) {
  const [, name, sub] = spec.match(/^((?:@[^/]+\/)?[^/]+)\/?(.*)$/);
  const root = join("node_modules", name);
  const target = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports[sub ? `./${sub}` : "."];
  return join(root, typeof target === "string" ? target : target.style);
}

/** An imported stylesheet's file: under src for the "@/" alias (tsconfig's paths), else a package's. */
function importedStylesheet(spec) {
  return spec.startsWith("@/") ? join("src", spec.slice(2)) : packageStylesheet(spec);
}

/**
 * Every stylesheet in src, and every package stylesheet the page's code or
 * those stylesheets import, but the two the build generates: Tailwind's
 * utilities and Next's font faces.
 */
function stylesheets() {
  const files = readdirSync("src", { recursive: true });
  const queue = [
    ...files.filter((file) => file.endsWith(".css")).map((file) => join("src", file)),
    ...files
      .filter((file) => /\.[jt]sx?$/.test(file) && !/\.test\./.test(file))
      .flatMap((file) =>
        [...readFileSync(join("src", file), "utf8").matchAll(/^import\s+["']([^."'][^"']*\.css)["']/gm)].map(
          ([, spec]) => importedStylesheet(spec),
        ),
      ),
  ];
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    postcss.parse(readFileSync(file, "utf8")).walkAtRules("import", (rule) => {
      const spec = rule.params.replace(/url\(|\)/g, "").replace(/["']/g, "").trim().split(/\s/)[0];
      if (spec !== "tailwindcss") queue.push(spec.startsWith(".") ? join(dirname(file), spec) : importedStylesheet(spec));
    });
  }
  return [...seen];
}

// What sets a run of text's width, besides its glyphs
const TYPE = /^(font(-[a-z-]+)?|letter-spacing|word-spacing|text-transform)$/i;
// The page's font, both Inter first, whose glyph widths the layout measures in
const PAGE_FONT = ["var(--pe-font-family)", "var(--font-sans)"];

/** A rule's selectors, with a nested rule's put inside its parent's. */
function selectorsOf(rule) {
  let outer = rule.parent;
  while (outer && outer.type !== "rule" && outer.type !== "root") outer = outer.parent;
  if (!outer || outer.type === "root") return rule.selectors;
  return selectorsOf(outer).flatMap((parent) =>
    rule.selectors.map((s) => (s.includes("&") ? s.replaceAll("&", parent) : `${parent} ${s}`)),
  );
}

/**
 * Every declaration in the stylesheets that sets type, with the selectors
 * of the rule it is in (an @utility's is its class); those a keyframe sets;
 * and every one of --fv-brush-text.
 */
function typeDeclarations(files) {
  const rules = [];
  const keyframes = [];
  const brushSizes = [];
  for (const file of files) {
    postcss.parse(readFileSync(file, "utf8"), { from: file }).walkDecls((decl) => {
      if (decl.prop === "--fv-brush-text") brushSizes.push(file);
      if (!TYPE.test(decl.prop)) return;
      let holder = decl.parent;
      while (holder.type === "atrule" && holder.name !== "utility") holder = holder.parent;
      // A font face names a family; it sets no text's type
      if (holder.type === "root") return;
      const entry = { file, prop: decl.prop.toLowerCase(), value: decl.value };
      if (holder.type === "atrule") rules.push({ ...entry, selectors: [`.${holder.params.trim()}`] });
      else if (/keyframes$/i.test(holder.parent?.name ?? "")) keyframes.push(entry);
      else rules.push({ ...entry, selectors: selectorsOf(holder) });
    });
  }
  return { rules, keyframes, brushSizes };
}

const STATE = /:(hover|focus-visible|focus-within|focus|active|visited|target)(?![\w-])/g;
const PSEUDO_ELEMENT = /::[\w-]+(\([^)]*\))?/;

/**
 * Whether a selector could ever pick an element: as written, so a rule for
 * :not(:hover) counts, and with every state met, so one for :hover does. A
 * pseudo-element is not an element: a selector ending in one picks none,
 * and one in a list is left out of it.
 */
function picks(el, selector, unreadable) {
  if (new RegExp(`${PSEUDO_ELEMENT.source}\\s*$`).test(selector)) return false;
  const inList = new RegExp(`\\s*,\\s*${PSEUDO_ELEMENT.source}|${PSEUDO_ELEMENT.source}\\s*,\\s*`, "g");
  let read = false;
  for (const form of [selector, selector.replace(STATE, ":is(*)")]) {
    try {
      if (el.matches(form.replace(inList, ""))) return true;
      read = true;
    } catch {
      // read the other form, or report it below
    }
  }
  if (!read) unreadable.add(selector);
  return false;
}

// A page that imports its stylesheet as "@/components/…" (tsconfig's alias
// for src) would otherwise be looked for as a package, "@/…", and fail
it("reads a stylesheet imported through the @/ alias from src", () => {
  const file = importedStylesheet("@/app/globals.css");
  expect(file).toBe(join("src", "app", "globals.css"));
  expect(readFileSync(file, "utf8")).toMatch(/:root/);
});

it("draws every text in the pixels its layout measured, under every stylesheet the page loads", async () => {
  const files = stylesheets();
  expect(files).toEqual(
    expect.arrayContaining(
      [
        "@policyengine/ui-kit/styles.css",
        "@policyengine/ui-kit/theme.css",
        "@policyengine/ui-kit/legacy/tokens.css",
        "tw-animate-css",
      ].map(packageStylesheet),
    ),
  );
  const { rules, keyframes, brushSizes } = typeDeclarations(files);
  expect(rules.length).toBeGreaterThan(500);
  // No stylesheet sizes the brush's labels but through their one rule, and
  // no animation changes type
  expect({ keyframes, brushSizes }).toEqual({ keyframes: [], brushSizes: [] });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith("obr_forecast_vintages.json")) return new Response(VINTAGES, { status: 200 });
      if (path.endsWith("living_standards_outlook.json")) return new Response("", { status: 404 });
      if (path.endsWith("manifest.json")) return new Response(null, { status: 404 });
      return new Response("reform_id,year,value\n", { status: 200 });
    }),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (!this.classList.contains("ls-plot-canvas")) return measure.call(this);
    return { x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 440, width: 900, height: 440 };
  });
  window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=receipts");
  const { container } = render(<App />);
  await screen.findByRole("heading", { level: 3, name: "Public sector current receipts" });
  fireEvent.click(within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { name: "Index" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Chart options" })).getByRole("button", { name: "Full history" }));

  const plot = container.querySelector(".fv-plot");
  const svg = plot.querySelector("svg.recharts-surface");
  const brush = svg.querySelector(".recharts-brush-texts");
  const unreadable = new Set();
  const rulesFor = (el) => rules.filter((r) => r.selectors.some((s) => picks(el, s, unreadable)));
  const inlineType = (el) =>
    Array.from({ length: el.style.length }, (_, i) => el.style.item(i)).filter((prop) => TYPE.test(prop));

  // The brush's labels: the chart sets their size on the plot, and nothing
  // under it sets it again
  expect(plot.style.getPropertyValue("--fv-brush-text")).toBe(`${BRUSH_TEXT_SIZE}px`);
  expect([...plot.querySelectorAll("*")].filter((el) => el.style.getPropertyValue("--fv-brush-text"))).toEqual([]);

  // Inside the chart, no rule sets type but the brush's labels' one, no
  // inline style sets any, and attributes set only sizes and weights, in
  // pixels
  const inside = [svg, ...svg.querySelectorAll("*")];
  expect(inside.flatMap((el) => rulesFor(el).map((r) => [el.getAttribute("class"), r.selectors, r.prop, r.value]))).toEqual([
    ["recharts-layer recharts-brush-texts", [".fv-plot .recharts-brush-texts"], "font-size", "var(--fv-brush-text)"],
  ]);
  expect(inside.flatMap(inlineType)).toEqual([]);
  expect(
    inside.flatMap((el) =>
      [...el.attributes]
        .filter((a) => TYPE.test(a.name) && !(["font-size", "font-weight"].includes(a.name) && /^\d+(\.\d+)?$/.test(a.value)))
        .map((a) => `${el.tagName} ${a.name}=${a.value}`),
    ),
  ).toEqual([]);

  // Above it, the page sets only its font, and sizes that only the brush's
  // labels, with no size of their own, would take, and their rule replaces
  const above = [];
  for (let el = svg.parentElement; el; el = el.parentElement) above.push(el);
  expect(
    above.flatMap((el) =>
      rulesFor(el)
        .filter((r) => r.prop !== "font-size" && !(r.prop === "font-family" && PAGE_FONT.includes(r.value)))
        .map((r) => [el.tagName, r.selectors, r.prop, r.value]),
    ),
  ).toEqual([]);
  expect(above.flatMap(inlineType)).toEqual([]);
  expect([...svg.querySelectorAll("text")].filter((t) => !t.getAttribute("font-size"))).toEqual([
    ...brush.querySelectorAll("text"),
  ]);

  // and each text is drawn at the size it was laid out at
  const view = buildView(DATA, DATA.variables.find((v) => v.id === "receipts"), { unit: "index" });
  const { labels } = chartLayout(view, view.rows, { canvasWidth: 900 });
  expect(labels).toHaveLength(3);
  for (const label of labels) {
    const [value, caption] = svg.querySelectorAll(`.fv-point-label[data-role="${label.role}"] text`);
    expect([value.textContent, value.getAttribute("font-size"), caption.getAttribute("font-size")]).toEqual([
      label.value,
      String(label.valueSize ?? labelGeometry({ above: label.above, lift: label.lift }).valueSize),
      String(CAPTION_SIZE),
    ]);
  }
  const ticks = [...svg.querySelectorAll(".recharts-cartesian-axis-tick text")];
  expect(ticks.length).toBeGreaterThan(3);
  expect(new Set(ticks.map((t) => t.getAttribute("font-size")))).toEqual(new Set([String(TICK_STYLE.fontSize)]));
  // ChartUnitLabel sets the unit label smaller only where it would not fit
  expect(Number(svg.querySelector("text.chart-unit-label").getAttribute("font-size"))).toBeLessThanOrEqual(UNIT_SIZE);
  expect(brush.querySelectorAll("text")).toHaveLength(2);
  expect([...unreadable]).toEqual([]);
});
