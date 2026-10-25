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
// A route to /budgets, absolute or relative ("budgets/<id>")
const LINK = /\/budgets(?![\w-])|["'`]budgets\//;

function files(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full, keep);
    return keep(full) ? [full] : [];
  });
}

const isSource = (file) =>
  /\.(js|jsx|ts|tsx|mjs)$/.test(file) &&
  !/\.test\.(js|jsx|ts|tsx)$/.test(file) &&
  !file.startsWith(path.join(SRC, "test") + path.sep) &&
  !OWN.some((dir) => file.startsWith(dir + path.sep));

const linking = (paths) =>
  paths.filter((file) => LINK.test(readFileSync(file, "utf8"))).map((file) => path.relative(ROOT, file));

describe("the past events' pages are not linked yet", () => {
  it("no page, nav, component or static page outside them links to /budgets", () => {
    const sources = files(SRC, isSource);
    expect(sources.length).toBeGreaterThan(50);
    const pages = files(PUBLIC, (file) => /\.html?$/i.test(file));
    expect(linking([...sources, ...pages])).toEqual([]);
  });

  it("the check finds the links the past events' index has", () => {
    // Not vacuous: /budgets lists each event at /budgets/<id>
    expect(linking([path.join(SRC, "app", "budgets", "page.tsx")])).toEqual(["src/app/budgets/page.tsx"]);
  });
});
