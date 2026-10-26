import { describe, expect, it } from "vitest";
import { decileSentence, revenueSentence } from "./plainSentences";

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
});
