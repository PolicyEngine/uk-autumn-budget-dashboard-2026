import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Recharts' text-measuring span", () => {
  it("is hidden, so its last measured text never reaches a copy of the page or a screen reader", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"), "utf8");
    const rule = css.match(/#recharts_measurement_span\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/visibility:\s*hidden/);
  });
});
