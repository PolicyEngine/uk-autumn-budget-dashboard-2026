import { describe, expect, it } from "vitest";
import { decileSentence, laterDecileNote, laterRevenueNote, revenueSentence } from "./plainSentences";

describe("plain card sentences", () => {
  const rows = (low, high) => [{ netChange: low }, { netChange: 0 }, { netChange: high }];

  it("says what the ends of the decile pair gain or lose", () => {
    expect(decileSentence(rows(184, -312), "absolute")).toBe(
      "On average the lowest-income tenth gains about £180 a year, and the highest-income tenth loses about £310.",
    );
    expect(decileSentence(rows(0.71, 0.01), "relative")).toBe(
      "On average the lowest-income tenth gains 0.7% of its net income, and the highest-income tenth sees almost no change.",
    );
    expect(decileSentence([], "absolute")).toBeNull();
  });

  it("puts the revenue for the selected year in words", () => {
    expect(revenueSentence(4.26, "2027-28")).toBe("In 2027-28, the selected measures raise £4.3 billion for the government.");
    expect(revenueSentence(-0.42, "2027-28")).toBe("In 2027-28, the selected measures cost the government £420 million.");
    expect(revenueSentence(null, "2027-28")).toBeNull();
  });

  it("points to the first later year in which a decile end moves the other way", () => {
    const later = [
      { yearLabel: "2028-29", low: 70, high: 30 },
      { yearLabel: "2029-30", low: 20, high: -46 },
      { yearLabel: "2031-32", low: -5, high: -328 },
    ];
    expect(laterDecileNote({ low: 75, high: 45 }, later, "absolute")).toBe(
      "Later years differ: in 2029-30, the highest-income tenth loses.",
    );
    // Both ends turn the same way
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2031-32", low: -50, high: -328 }], "absolute")).toBe(
      "Later years differ: in 2031-32, both the lowest- and highest-income tenths lose.",
    );
    // Both turn, different ways
    expect(laterDecileNote({ low: -20, high: 45 }, [{ yearLabel: "2030-31", low: 30, high: -60 }], "absolute")).toBe(
      "Later years differ: in 2030-31, the lowest-income tenth gains and the highest-income tenth loses.",
    );
  });

  it("rounds as the decile sentence does, so a rounding wobble is no turn", () => {
    // 0.03% and -0.04% both read as almost no change
    expect(laterDecileNote({ low: 0.3, high: 0.03 }, [{ yearLabel: "2028-29", low: 0.05, high: -0.04 }], "relative")).toBeNull();
    // £4 and -£4 both round to £0
    expect(laterDecileNote({ low: 75, high: 4 }, [{ yearLabel: "2028-29", low: 60, high: -4 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 0.3, high: 0.03 }, [{ yearLabel: "2031-32", low: -0.02, high: -0.18 }], "relative")).toBe(
      "Later years differ: in 2031-32, the lowest-income tenth sees almost no change and the highest-income tenth loses.",
    );
    expect(laterDecileNote({ low: 0.3, high: 0.2 }, [{ yearLabel: "2031-32", low: 0.3, high: 0.01 }], "relative")).toBe(
      "Later years differ: in 2031-32, the highest-income tenth sees almost no change.",
    );
  });

  it("says nothing without a turn, or without the selected year's ends", () => {
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: 10, high: 20 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 75, high: 45 }, [], "absolute")).toBeNull();
    expect(laterDecileNote({ low: null, high: 45 }, [{ yearLabel: "2028-29", low: -10, high: -20 }], "absolute")).toBeNull();
    expect(laterDecileNote(null, [{ yearLabel: "2028-29", low: -10, high: -20 }], "absolute")).toBeNull();
    // A later year without both ends is skipped, not read as a turn
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: null, high: -20 }], "absolute")).toBeNull();
  });

  it("points to the first later year in which the revenue turns", () => {
    const later = [
      { yearLabel: "2028-29", net: -6.9 },
      { yearLabel: "2029-30", net: null },
      { yearLabel: "2030-31", net: 3.2 },
    ];
    expect(laterRevenueNote(-8.9, later)).toBe("Later years differ: in 2030-31, the selected measures raise revenue.");
    expect(laterRevenueNote(4.3, [{ yearLabel: "2031-32", net: -1.2 }])).toBe(
      "Later years differ: in 2031-32, the selected measures cost revenue.",
    );
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0.02 }])).toBe(
      "Later years differ: in 2031-32, the selected measures roughly balance.",
    );
    expect(laterRevenueNote(-8.9, [{ yearLabel: "2028-29", net: -3.8 }])).toBeNull();
    expect(laterRevenueNote(null, later)).toBeNull();
  });
});
