import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { describeRow, formatFigure, formatInterval } from "./format";

describe("formatFigure", () => {
  it("shows £ figures with a sign, separators and only published digits", () => {
    expect(formatFigure("average_change", "120.0")).toBe("+£120");
    expect(formatFigure("average_change", "-1234.5")).toBe("−£1,234.5");
    expect(formatFigure("average_change", "1234567")).toBe("+£1,234,567");
    expect(formatFigure("average_change", "12.5")).toBe("+£12.5");
    expect(formatFigure("average_change", "0")).toBe("£0");
    expect(formatFigure("average_change", "-0.0")).toBe("£0");
    expect(formatFigure("average_change", "1.2e+03")).toBe("+£1,200");
  });

  it("moves a ratio's decimal point two places for a percentage", () => {
    expect(formatFigure("relative_change", "0.0123")).toBe("+1.23%");
    expect(formatFigure("relative_change", "0.01")).toBe("+1%");
    expect(formatFigure("relative_change", "0.0010")).toBe("+0.1%");
    expect(formatFigure("relative_change", "-0.005")).toBe("−0.5%");
    expect(formatFigure("relative_change", "0.07")).toBe("+7%");
    expect(formatFigure("relative_change", "5e-05")).toBe("+0.005%");
    expect(formatFigure("relative_change", "0")).toBe("0%");
  });

  it("drops the plus sign on request, never the minus", () => {
    expect(formatFigure("average_change", "30", { signed: false })).toBe("£30");
    expect(formatFigure("average_change", "-30", { signed: false })).toBe("−£30");
    expect(formatFigure("relative_change", "0.012", { signed: false })).toBe("1.2%");
  });

  it("never shows more significant digits than were published", () => {
    const published = fc
      .tuple(
        fc.integer({ min: -99999, max: 99999 }),
        fc.integer({ min: 0, max: 6 }),
      )
      .map(([units, places]) => (units / 10 ** places).toFixed(places));
    const digits = (text) => text.replace(/\D/g, "").replace(/^0+/, "").replace(/0+$/, "");
    fc.assert(
      fc.property(published, (text) => {
        for (const outcome of ["average_change", "relative_change"]) {
          const shown = formatFigure(outcome, text);
          expect(digits(shown)).toBe(digits(text));
        }
      }),
    );
  });

  it("rejects what is not a published figure", () => {
    expect(() => formatFigure("average_change", "")).toThrow();
    expect(() => formatFigure("poverty", "1")).toThrow();
  });
});

describe("formatInterval", () => {
  it("joins the bounds with 'to'", () => {
    expect(formatInterval("average_change", "10.0", "30.0")).toBe("£10 to £30");
    expect(formatInterval("average_change", "-200.0", "380.0")).toBe(
      "−£200 to £380",
    );
    expect(formatInterval("relative_change", "0.005", "0.012")).toBe(
      "0.5% to 1.2%",
    );
  });
});

describe("describeRow", () => {
  const row = {
    outcome: "relative_change",
    value: "0.0068",
    lo: "0.0012",
    hi: "0.0124",
    direction: "gain",
    tier: "approximate",
    supportBand: "10–29",
  };

  it("describes a published row in words", () => {
    expect(describeRow(row)).toEqual({
      tier: "Approximate",
      tierDescription:
        "Approximate: few survey households, so the interval understates the uncertainty",
      value: "+0.68%",
      interval: "0.12% to 1.24%",
      direction: "Gain",
      supportBand: "10 to 29 survey households",
    });
  });

  it("gives a withheld row no figure and no reason beyond confidentiality", () => {
    const described = describeRow({
      ...row,
      value: "",
      lo: "",
      hi: "",
      direction: "",
      supportBand: "",
      tier: "withheld",
    });
    expect(described.value).toBeNull();
    expect(described.interval).toBeNull();
    expect(described.supportBand).toBeNull();
    expect(described.tierDescription).toBe(
      "Not published, to protect survey respondents' confidentiality.",
    );
  });
});
