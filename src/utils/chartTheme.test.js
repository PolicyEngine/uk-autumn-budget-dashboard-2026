import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BAR_GAP, BAR_RADIUS, CHART_COLOURS, barShape, emptyMeasuresNote, roundedRectPath } from "./chartTheme";

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
    // The OBR's ring is the same grey as "before"; the zero line is the text ink
    expect(CHART_COLOURS.obr).toBe(CHART_COLOURS.before);
    expect(CHART_COLOURS.zeroLine).toBe(CHART_COLOURS.text);
  });

  it("bands every second policy row in the neutral --pe-gray-50, fainter than the hover band and the gridlines", () => {
    const gray50 = css.match(/--pe-gray-50:\s*(#[0-9a-fA-F]{6})/)[1].toLowerCase();
    expect(CHART_COLOURS.rowBand.toLowerCase()).toBe(gray50);
    const level = (hex) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(level(CHART_COLOURS.rowBand)).toBeGreaterThan(level(CHART_COLOURS.hover));
    expect(level(CHART_COLOURS.rowBand)).toBeGreaterThan(level(CHART_COLOURS.grid));
  });

  it("rounds a row band as --row-radius", async () => {
    const { ROW_RADIUS } = await import("./chartTheme");
    expect(css).toMatch(new RegExp(`--row-radius:\\s*${ROW_RADIUS}px;`));
  });

  it("draws outturn as before and the projection as after (docs/COLOURS.md)", async () => {
    const { OUTTURN_COLOUR, PROJECTION_COLOUR } = await import("./livingStandards/baseline");
    expect(OUTTURN_COLOUR).toBe(CHART_COLOURS.before);
    expect(PROJECTION_COLOUR).toBe(CHART_COLOURS.after);
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

  it("mirrors the --ramp-* tokens in globals.css, one for one (POLICY_RAMPS and MAGNITUDE_RAMPS)", async () => {
    const { POLICY_RAMPS, MAGNITUDE_RAMPS } = await import("./chartTheme");
    const fromJs = Object.fromEntries(
      Object.entries({ ...POLICY_RAMPS, ...MAGNITUDE_RAMPS }).flatMap(([group, colours]) =>
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

  it("keeps the lightest cost step visible on a white card (the 2025 dashboard's teal 300: a floor of 1.45:1, named in the legend and tooltip)", async () => {
    const { POLICY_RAMPS } = await import("./chartTheme");
    const linear = (channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16)));
      return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
    };
    expect(contrast(POLICY_RAMPS.cost.at(-1))).toBeGreaterThanOrEqual(1.45);
  });
});

describe("MAGNITUDE_RAMPS and magnitudeColours", () => {
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const relative = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (hex) => 1.05 / (relative(hex) + 0.05);

  it("runs darkest to lightest, every step at least 2.5:1 on white (each row prints its value)", async () => {
    const { MAGNITUDE_RAMPS } = await import("./chartTheme");
    for (const ramp of Object.values(MAGNITUDE_RAMPS)) {
      const levels = ramp.map(relative);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      for (const colour of ramp) expect(contrast(colour), colour).toBeGreaterThanOrEqual(2.4);
    }
  });

  it("colours by direction and shades by size: the largest darkest, ties alike, zero grey", async () => {
    const { MAGNITUDE_RAMPS, magnitudeColours, CHART_COLOURS: C } = await import("./chartTheme");
    const colours = magnitudeColours([5, -1, 2, 0, null, 2]);
    expect(colours[0]).toBe(MAGNITUDE_RAMPS.gain[0]);
    expect(colours[1]).toBe(MAGNITUDE_RAMPS.loss.at(-1));
    expect(colours[2]).toBe(colours[5]);
    expect(relative(colours[2])).toBeGreaterThan(relative(colours[0]));
    expect(colours[3]).toBe(C.noChange);
    expect(colours[4]).toBe(C.noChange);
  });

  it("takes the gain ramp for a fall where a fall is better", async () => {
    const { MAGNITUDE_RAMPS, magnitudeColours } = await import("./chartTheme");
    expect(magnitudeColours([-0.3, 0.1], { better: (v) => v < 0 })).toEqual([MAGNITUDE_RAMPS.gain[0], MAGNITUDE_RAMPS.loss.at(-1)]);
  });

  it("gives one value the darkest step", async () => {
    const { MAGNITUDE_RAMPS, magnitudeColours } = await import("./chartTheme");
    expect(magnitudeColours([-4])).toEqual([MAGNITUDE_RAMPS.loss[0]]);
  });
});

describe("SERIES_COLOURS", () => {
  it("mirrors the --series-* tokens in globals.css, one for one", async () => {
    const { SERIES_COLOURS } = await import("./chartTheme");
    const fromCss = [...css.matchAll(/--series-(\d+):\s*(#[0-9a-fA-F]{6})/g)].map(([, step, value]) => [
      Number(step),
      value.toLowerCase(),
    ]);
    expect(fromCss).toEqual(SERIES_COLOURS.map((colour, index) => [index + 1, colour.toLowerCase()]));
  });
});

describe("INCOME_RAMP", () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it("mirrors the --income-ramp-* tokens in globals.css, one for one", async () => {
    const { INCOME_RAMP } = await import("./chartTheme");
    const fromCss = [...css.matchAll(/--income-ramp-(\d+):\s*(#[0-9a-fA-F]{6})/g)].map(([, step, value]) => [
      Number(step),
      value.toLowerCase(),
    ]);
    expect(fromCss).toEqual(INCOME_RAMP.map((colour, index) => [index + 1, colour.toLowerCase()]));
  });

  it("diverges: each arm lightens towards the grey midpoint", async () => {
    const { INCOME_RAMP } = await import("./chartTheme");
    const mid = (INCOME_RAMP.length - 1) / 2;
    const low = INCOME_RAMP.slice(0, mid + 1).map(luminance);
    const high = INCOME_RAMP.slice(mid).map(luminance).reverse();
    expect(low).toEqual([...low].sort((a, b) => a - b));
    expect(high).toEqual([...high].sort((a, b) => a - b));
  });

  it("samples the ramp end to end for any number of groups", async () => {
    const { INCOME_RAMP, incomeGroupColours } = await import("./chartTheme");
    for (const n of [5, 10, 20]) {
      const colours = incomeGroupColours(n);
      expect(colours).toHaveLength(n);
      expect(colours[0]).toBe(INCOME_RAMP[0]);
      expect(colours[n - 1]).toBe(INCOME_RAMP[INCOME_RAMP.length - 1]);
    }
    // An odd count puts the middle group on the grey midpoint
    expect(incomeGroupColours(5)[2]).toBe(INCOME_RAMP[3]);
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
  it("fits each side, never forced symmetric, when values fall on both sides of 0", async () => {
    const { divergingAxis } = await import("./chartTheme");
    expect(divergingAxis([-0.46, 0.13])).toEqual({ domain: [-0.5, 0.15], ticks: [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1] });
    expect(divergingAxis([-7.7, 4.6])).toEqual({ domain: [-10, 5], ticks: [-10, -7.5, -5, -2.5, 0, 2.5, 5] });
    // A symmetric input stays symmetric (the salary sweep's change axis)
    const { domain } = divergingAxis([-120, 120]);
    expect(domain[0]).toBe(-domain[1]);
  });

  it("runs from 0 when every value has one sign", async () => {
    const { divergingAxis, zeroBasedAxis } = await import("./chartTheme");
    expect(divergingAxis([-7.7, -1, 0])).toEqual(zeroBasedAxis([-7.7, -1, 0]));
    expect(divergingAxis([2, 5])).toEqual(zeroBasedAxis([2, 5]));
  });
});

describe("barShape: one bar style", () => {
  const corners = (d) => (d.match(/A/g) || []).length;
  const draw = (keys, props, options) => barShape(keys, options)(props).props;

  it("rounds only a stack's outer end and leaves a gap at each inner join", () => {
    const payload = { a: 2, b: 3 };
    // Upright bars: a sits on zero, b on top of it
    const inner = draw(["a", "b"], { x: 0, y: 60, width: 20, height: 40, payload, dataKey: "a", fill: CHART_COLOURS.gain });
    const outer = draw(["a", "b"], { x: 0, y: 0, width: 20, height: 60, payload, dataKey: "b", fill: CHART_COLOURS.gain });
    expect(corners(inner.d)).toBe(0);
    expect(inner.d.startsWith(`M0,${60 + BAR_GAP}`)).toBe(true);
    expect(corners(outer.d)).toBe(2);
  });

  it("rounds both ends of a 100% bar running across", () => {
    const payload = { a: 50, b: 50 };
    const options = { layout: "vertical", roundBase: true };
    const first = draw(["a", "b"], { x: 0, y: 0, width: 50, height: 12, payload, dataKey: "a" }, options);
    const last = draw(["a", "b"], { x: 50, y: 0, width: 50, height: 12, payload, dataKey: "b" }, options);
    expect(corners(first.d)).toBe(2);
    expect(corners(last.d)).toBe(2);
  });

  it("treats negatives on their own side of zero", () => {
    const payload = { a: -2, b: 3 };
    const neg = draw(["a", "b"], { x: 0, y: 50, width: 20, height: 20, payload, dataKey: "a" });
    expect(corners(neg.d)).toBe(2);
  });

  it("caps the radius at half the bar's thickness", () => {
    expect(roundedRectPath(0, 0, 100, 4, [BAR_RADIUS, BAR_RADIUS, BAR_RADIUS, BAR_RADIUS])).toContain("A2,2");
  });
});

describe("emptyMeasuresNote", () => {
  const yearLabel = "2031-32";
  it("says no policy changes incomes only when every selected policy has no effect", () => {
    expect(emptyMeasuresNote({ noEffect: [{ id: "a" }], selectedPolicies: ["a"], yearLabel })).toBe(
      "None of the selected policies changes household incomes in 2031-32.",
    );
  });

  it("says results are unavailable, never 'no change', when a selected policy is held back or has no row (an empty list is not no effect)", () => {
    expect(emptyMeasuresNote({ noEffect: [], selectedPolicies: ["a"], yearLabel })).toBe(
      "Results are unavailable for the selected policies in 2031-32.",
    );
    expect(emptyMeasuresNote({ noEffect: [{ id: "a" }], selectedPolicies: ["a", "b"], yearLabel })).toBe(
      "Results are unavailable for the selected policies in 2031-32.",
    );
  });
});
