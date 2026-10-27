import { describe, expect, it } from "vitest";
import { decileSentence, laterDecileNote, laterRevenueNote, revenueSentence } from "./plainSentences";

describe("plain card sentences", () => {
  const rows = (low, high) => [{ netChange: low }, { netChange: 0 }, { netChange: high }];

  it("says what the ends of the decile pair gain or lose", () => {
    expect(decileSentence(rows(184, -312), "absolute")).toBe(
      "On average the lowest-income tenth gains about £180 a year, and the highest-income tenth loses about £310.",
    );
    expect(decileSentence(rows(0.71, 0.01), "relative")).toBe(
      "Taken together, the lowest-income tenth gains 0.7% of its net income, and the highest-income tenth sees almost no change.",
    );
    expect(decileSentence([], "absolute")).toBeNull();
  });

  it("puts the revenue for the selected year in words", () => {
    expect(revenueSentence(4.26, "2027-28")).toBe("In 2027-28, the selected measures raise £4.3 billion for the government.");
    expect(revenueSentence(-0.42, "2027-28")).toBe("In 2027-28, the selected measures cost the government £420 million.");
    expect(revenueSentence(null, "2027-28")).toBeNull();
    // A measure not in force that year changes nothing: not "roughly balance"
    expect(revenueSentence(0, "2027-28")).toBe("In 2027-28, the selected measures change no revenue.");
    expect(revenueSentence(0.02, "2027-28")).toMatch(/roughly balance/);
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
    // -0.18% reads as a 0.2% loss: clear, from almost no change; the low end's fade says nothing
    expect(laterDecileNote({ low: 0.3, high: 0.03 }, [{ yearLabel: "2031-32", low: -0.02, high: -0.18 }], "relative")).toBe(
      "Later years differ: in 2031-32, the highest-income tenth loses.",
    );
  });

  it("says nothing when a measure ends, fades or creeps", () => {
    // A measure ending: a gain falls to almost no change
    expect(laterDecileNote({ low: 0.3, high: 0.2 }, [{ yearLabel: "2031-32", low: 0.3, high: 0.01 }], "relative")).toBeNull();
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: 0, high: 0 }], "absolute")).toBeNull();
    // A fade: 0.10% to 0.04%
    expect(laterDecileNote({ low: 0.1, high: 0.3 }, [{ yearLabel: "2028-29", low: 0.04, high: 0.3 }], "relative")).toBeNull();
    // A creep from about £1 to £6, and to £14 (rounds to £10, under £20)
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 6, high: 30 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 14, high: 30 }], "absolute")).toBeNull();
    // A small gain turning to a loss under the clear threshold
    expect(laterDecileNote({ low: 40, high: 30 }, [{ yearLabel: "2029-30", low: -12, high: 30 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 0.3, high: 0.3 }, [{ yearLabel: "2029-30", low: -0.1, high: 0.3 }], "relative")).toBeNull();
  });

  it("points to a clear effect from almost no change, as with the threshold freeze", () => {
    // Almost nothing in the selected year, both ends clearly lose later
    const freeze = [
      { yearLabel: "2028-29", low: -3, high: -8 },
      { yearLabel: "2029-30", low: -9, high: -14 },
      { yearLabel: "2031-32", low: -25, high: -180 },
    ];
    expect(laterDecileNote({ low: 0, high: -2 }, freeze, "absolute")).toBe(
      "Later years differ: in 2031-32, both the lowest- and highest-income tenths lose.",
    );
    // £15 rounds to £20: clear
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 15, high: 30 }], "absolute")).toBe(
      "Later years differ: in 2029-30, the lowest-income tenth gains.",
    );
    expect(laterDecileNote({ low: 0.02, high: 0.01 }, [{ yearLabel: "2031-32", low: -0.2, high: -0.4 }], "relative")).toBe(
      "Later years differ: in 2031-32, both the lowest- and highest-income tenths lose.",
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
    // From roughly balancing to a clear effect (at least £0.1bn)
    expect(laterRevenueNote(0.02, [{ yearLabel: "2029-30", net: 0.06 }, { yearLabel: "2031-32", net: 3.77 }])).toBe(
      "Later years differ: in 2031-32, the selected measures raise revenue.",
    );
    expect(laterRevenueNote(-0.01, [{ yearLabel: "2031-32", net: -0.1 }])).toBe(
      "Later years differ: in 2031-32, the selected measures cost revenue.",
    );
  });

  it("says nothing when the revenue effect ends, fades or turns by less than £0.1bn", () => {
    // A cost ending
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0.02 }])).toBeNull();
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0 }])).toBeNull();
    // A fade
    expect(laterRevenueNote(1.4, [{ yearLabel: "2031-32", net: 0.3 }])).toBeNull();
    // A small turn, and a creep out of the balance band
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0.08 }])).toBeNull();
    expect(laterRevenueNote(0.01, [{ yearLabel: "2031-32", net: 0.07 }])).toBeNull();
    expect(laterRevenueNote(-8.9, [{ yearLabel: "2028-29", net: -3.8 }])).toBeNull();
    expect(laterRevenueNote(null, [{ yearLabel: "2030-31", net: 3.2 }])).toBeNull();
  });
});
