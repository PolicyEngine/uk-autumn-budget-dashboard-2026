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

describe("sweepAxis", () => {
  it("ends at the sweep's last point, with round ticks inside it", async () => {
    const { sweepAxis } = await import("./chartTheme");
    expect(sweepAxis(225000)).toEqual({ domain: [0, 225000], ticks: [0, 50000, 100000, 150000, 200000] });
    expect(sweepAxis(150000)).toEqual({ domain: [0, 150000], ticks: [0, 50000, 100000, 150000] });
  });
});

describe("POLICY_RAMPS", () => {
  const ramps = Object.fromEntries(
    [...css.matchAll(/--ramp-([a-z]+)-(\d+):\s*(#[0-9a-fA-F]{6})/g)].map(([, group, step, value]) => [
      `${group}-${step}`,
      value.toLowerCase(),
    ]),
  );

  it("mirrors the --ramp-* tokens in globals.css, one for one", async () => {
    const { POLICY_RAMPS } = await import("./chartTheme");
    const fromJs = Object.fromEntries(
      Object.entries(POLICY_RAMPS).flatMap(([group, colours]) =>
        colours.map((colour, index) => [`${group}-${index + 1}`, colour.toLowerCase()]),
      ),
    );
    expect(ramps).toEqual(fromJs);
  });

  it("runs darkest to lightest", async () => {
    const { POLICY_RAMPS } = await import("./chartTheme");
    const luminance = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const colours of Object.values(POLICY_RAMPS)) {
      const levels = colours.map(luminance);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
  });
});

describe("orderBySize", () => {
  it("orders by mean absolute value over the published points, largest first", async () => {
    const { orderBySize } = await import("./chartTheme");
    const points = [
      { a: -1, b: 0, c: 3 },
      { a: -1, b: 4, c: -3 },
      { unpublished: true, a: 100 },
    ];
    expect(orderBySize(["a", "b", "c"], points)).toEqual(["c", "b", "a"]);
    // Ties keep the order given
    expect(orderBySize(["x", "y"], [{ x: 1, y: -1 }])).toEqual(["x", "y"]);
  });
});

describe("symmetricAxis", () => {
  it("is ±the largest absolute value, rounded up to a round step", async () => {
    const { symmetricAxis } = await import("./chartTheme");
    expect(symmetricAxis([-7.7, 4.6])).toEqual({ domain: [-10, 10], ticks: [-10, -5, 0, 5, 10] });
    expect(symmetricAxis([0.3, -0.12])).toEqual({
      domain: [-0.4, 0.4],
      ticks: [-0.4, -0.2, 0, 0.2, 0.4],
    });
  });

  it("puts 0 in the middle tick", async () => {
    const { symmetricAxis } = await import("./chartTheme");
    for (const values of [[-3, 1], [2, -950], [0.004, -0.001]]) {
      const { domain, ticks } = symmetricAxis(values);
      expect(domain[0]).toBe(-domain[1]);
      expect(ticks[(ticks.length - 1) / 2]).toBe(0);
      expect(domain[1]).toBeGreaterThanOrEqual(Math.max(...values.map(Math.abs)));
    }
  });
});

describe("divergingAxis", () => {
  it("is symmetric when values fall on both sides of 0", async () => {
    const { divergingAxis, symmetricAxis } = await import("./chartTheme");
    expect(divergingAxis([-7.7, 4.6])).toEqual(symmetricAxis([-7.7, 4.6]));
  });

  it("runs from 0 when every value has one sign", async () => {
    const { divergingAxis, zeroBasedAxis } = await import("./chartTheme");
    expect(divergingAxis([-7.7, -1, 0])).toEqual(zeroBasedAxis([-7.7, -1, 0]));
    expect(divergingAxis([2, 5])).toEqual(zeroBasedAxis([2, 5]));
  });
});
