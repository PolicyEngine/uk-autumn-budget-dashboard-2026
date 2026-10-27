import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vahid, 27 October: a year a selected policy has an effect in is shown as
// a year (2026-27 in the charts, tables and year pill), never as a side note
// such as "In 2026-27, before the years shown, ...". Every page source file
// is checked.
const SRC = join(__dirname);
const pageFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : pageFiles(path);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

describe("no out-of-range year notes", () => {
  it("no page source says 'before the years shown'", () => {
    const files = pageFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((path) => /before the years shown/i.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
