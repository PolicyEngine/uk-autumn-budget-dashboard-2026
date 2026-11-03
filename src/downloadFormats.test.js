/**
 * Every card's Download offers the same formats: CSV, PNG and SVG
 * (tabsSmoke.test.jsx opens each menu on every tab). A card drawn in HTML
 * (a dumbbell, tiles, a table) gets its images redrawn from the page
 * (exportDomAsSvg), so no card leaves them out for being HTML, and no
 * menu offers a format the others do not.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chartDownloads } from "./utils/chartDownloads";

const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("download formats", () => {
  it("offers CSV, PNG and SVG for a published chart", () => {
    const formats = chartDownloads({ chartRef: { current: null }, name: "x", csv: () => "a\n1" });
    expect(Object.keys(formats)).toEqual(["csv", "png", "svg"]);
  });

  it("has no card that turns its images off or offers another format", () => {
    const offenders = [];
    for (const path of sources(join(SRC, "components"))) {
      const text = readFileSync(path, "utf8");
      if (/\bimage:\s*false\b/.test(text)) offenders.push(`${relative(SRC, path)}: image: false`);
      if (/\btxt:\s*\(/.test(text)) offenders.push(`${relative(SRC, path)}: a TXT download`);
    }
    expect(offenders).toEqual([]);
  });
});
