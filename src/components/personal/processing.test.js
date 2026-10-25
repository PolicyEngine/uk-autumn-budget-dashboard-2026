import { describe, expect, it } from "vitest";
import { progressShare, timeText } from "./SingleYearResults";

describe("the household wait", () => {
  it("says the usual time, with no running count, until 90 seconds", () => {
    expect(timeText(0)).toBe("Usually about 15 seconds");
    expect(timeText(45)).toBe("Usually about 15 seconds");
    expect(timeText(46)).toBe("Taking longer than usual; still working");
    expect(timeText(0, "detail")).toBe("Usually about a minute");
    expect(timeText(150, "detail")).toBe("Usually about a minute");
    expect(timeText(151, "detail")).toBe("Taking longer than usual; still working");
  });

  it("fills its bar over the usual 60 seconds, eased, and holds at 90% after", () => {
    expect(progressShare(0)).toBe(0);
    expect(progressShare(8)).toBeGreaterThan(0.5);
    expect(progressShare(15)).toBeCloseTo(0.9);
    expect(progressShare(60, 60)).toBeCloseTo(0.9);
    expect(progressShare(200)).toBeCloseTo(0.9);
  });
});
