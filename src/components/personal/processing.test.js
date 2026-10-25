import { describe, expect, it } from "vitest";
import { progressShare, timeText } from "./SingleYearResults";

describe("the household wait", () => {
  it("says the usual time, with no running count, until 90 seconds", () => {
    expect(timeText(0)).toBe("Usually around 60 seconds");
    expect(timeText(26)).toBe("Usually around 60 seconds");
    expect(timeText(90)).toBe("Usually around 60 seconds");
    expect(timeText(91)).toBe("Taking longer than usual; still working");
  });

  it("fills its bar over the usual 60 seconds, eased, and holds at 90% after", () => {
    expect(progressShare(0)).toBe(0);
    expect(progressShare(30)).toBeGreaterThan(0.5);
    expect(progressShare(60)).toBeCloseTo(0.9);
    expect(progressShare(200)).toBeCloseTo(0.9);
  });
});
