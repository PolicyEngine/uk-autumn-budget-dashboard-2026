import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_COLOURS } from "./chartTheme";

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--c-([a-z-]+):\s*(#[0-9a-fA-F]{3,6})/g)].map(([, name, value]) => [
    name,
    value.toLowerCase(),
  ]),
);

describe("CHART_COLOURS", () => {
  it("mirrors the --c-* tokens in globals.css, one for one", () => {
    expect(Object.keys(tokens).sort()).toEqual(Object.keys(CHART_COLOURS).map(kebab).sort());
    for (const [name, value] of Object.entries(CHART_COLOURS)) {
      expect(tokens[kebab(name)], name).toBe(value.toLowerCase());
    }
  });

  it("gives each meaning one colour", () => {
    expect(CHART_COLOURS.after).toBe(CHART_COLOURS.gain);
    expect(CHART_COLOURS.before).toBe(CHART_COLOURS.noChange);
  });
});
