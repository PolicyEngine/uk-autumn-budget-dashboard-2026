import { describe, expect, it } from "vitest";
import { progressShare, timeText } from "./SingleYearResults";

describe("the household wait", () => {
  it("says the usual time, then from 20 seconds that it is still working (a cold start), then from 60 that it is slow", () => {
    expect(timeText(0)).toBe("Usually 15–30 seconds");
    expect(timeText(20)).toBe("Usually 15–30 seconds");
    expect(timeText(21)).toBe("Still working: this can take up to a minute the first time");
    expect(timeText(60)).toBe("Still working: this can take up to a minute the first time");
    expect(timeText(61)).toBe("Taking longer than usual; still working");
    expect(timeText(0, "detail")).toBe("Usually 15–30 seconds");
    expect(timeText(61, "detail")).toBe("Taking longer than usual; still working");
  });

  it("fills its bar over the usual 30 seconds, eased, and holds at 90% after", () => {
    expect(progressShare(0)).toBe(0);
    expect(progressShare(15)).toBeGreaterThan(0.5);
    expect(progressShare(30)).toBeCloseTo(0.9);
    expect(progressShare(200)).toBeCloseTo(0.9);
  });
});
