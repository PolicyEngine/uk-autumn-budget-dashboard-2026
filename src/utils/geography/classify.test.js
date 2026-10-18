import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_BREAKS,
  TOO_UNCERTAIN,
  categoryIndex,
  categoryRanges,
  classifyRow,
} from "./classify";

const row = (outcome, value, lo, hi, tier = "reported") => ({
  outcome,
  value,
  lo,
  hi,
  tier,
});

const category = (outcome, text) => CATEGORIES[categoryIndex(outcome, text)];

describe("category breaks", () => {
  it("are fixed in advance, in each outcome's published units", () => {
    expect(CATEGORY_BREAKS).toEqual({
      relative_change: { small: "0.001", large: "0.01" },
      average_change: { small: "10", large: "100" },
    });
    expect(Object.isFrozen(CATEGORY_BREAKS)).toBe(true);
  });

  it("put each figure in one category, exactly at the breaks", () => {
    expect(category("relative_change", "0.000999")).toBe("little_change");
    expect(category("relative_change", "-0.000999")).toBe("little_change");
    expect(category("relative_change", "0.001")).toBe("small_gain");
    expect(category("relative_change", "-0.001")).toBe("small_loss");
    expect(category("relative_change", "0.0099")).toBe("small_gain");
    expect(category("relative_change", "0.01")).toBe("large_gain");
    expect(category("relative_change", "-0.01")).toBe("large_loss");
    expect(category("average_change", "9.9")).toBe("little_change");
    expect(category("average_change", "10.0")).toBe("small_gain");
    expect(category("average_change", "-100")).toBe("large_loss");
    expect(category("average_change", "0")).toBe("little_change");
  });

  it("describe their ranges from the breaks", () => {
    expect(categoryRanges("relative_change")).toMatchObject({
      little_change: "under 0.1% either way",
      small_gain: "0.1% to 1%",
      large_loss: "1% or more",
    });
    expect(categoryRanges("average_change")).toMatchObject({
      little_change: "under £10 either way",
      small_loss: "£10 to £100",
      large_gain: "£100 or more",
    });
  });
});

describe("classifyRow", () => {
  it("uses the value's category when the interval stays in one category", () => {
    expect(classifyRow(row("relative_change", "0.004", "0.002", "0.006"))).toBe(
      "small_gain",
    );
  });

  it("uses the value's category when the interval spans two adjacent ones", () => {
    // 0.008 is a small gain, 0.016 a large one; the value 0.0123 is large.
    expect(
      classifyRow(row("relative_change", "0.0123", "0.008", "0.016")),
    ).toBe("large_gain");
    expect(classifyRow(row("average_change", "6", "-4", "16"))).toBe(
      "little_change",
    );
  });

  it("is too uncertain when the interval spans more than two categories", () => {
    expect(classifyRow(row("average_change", "20", "-10", "50"))).toBe(
      TOO_UNCERTAIN,
    );
    expect(
      classifyRow(row("relative_change", "0.004", "-0.009", "0.017")),
    ).toBe(TOO_UNCERTAIN);
  });

  it("classifies an approximate row by the same rule", () => {
    expect(
      classifyRow(
        row("relative_change", "0.0068", "0.0012", "0.0124", "approximate"),
      ),
    ).toBe("small_gain");
  });

  it("gives a zero cell little change", () => {
    expect(classifyRow(row("average_change", "0", "0", "0"))).toBe(
      "little_change",
    );
  });

  it("gives a withheld row no category", () => {
    expect(classifyRow(row("relative_change", "", "", "", "withheld"))).toBe(
      null,
    );
    expect(classifyRow(null)).toBe(null);
  });
});
