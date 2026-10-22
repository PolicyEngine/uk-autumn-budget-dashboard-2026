// The lifecycle (lifetime) calculator is removed for this Budget: no
// source file, style or environment example refers to it. Read as text,
// as shellStickyNav.test.jsx reads App.jsx.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(SRC);
const SOURCE = /\.(js|jsx|ts|tsx|css)$/;
const FORBIDDEN = [
  "LifecycleCalculator",
  "lifecycleSelection",
  "lifecycleCsv",
  "LIFECYCLE_",
  "NEXT_PUBLIC_LIFECYCLE_API_URL",
  "lifecycle-calculator",
  "lifecycle-chart",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) && path !== fileURLToPath(import.meta.url)
      ? [path]
      : [];
  });
}

describe("the lifecycle calculator", () => {
  it("is gone from every source file and the environment example", () => {
    const files = [...sourceFiles(SRC), join(REPO, ".env.example")];
    const found = files.flatMap((path) => {
      const text = readFileSync(path, "utf-8");
      return FORBIDDEN.filter((word) => text.includes(word)).map(
        (word) => `${relative(REPO, path)}: ${word}`,
      );
    });
    expect(found).toEqual([]);
    expect(files.map((path) => basename(path))).not.toContain("noLifecycle.test.js");
  });
});
