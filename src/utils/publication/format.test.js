import { describe, expect, it } from "vitest";
import { fiscalYearLabel } from "./format";

describe("fiscalYearLabel", () => {
  it("names the UK fiscal year that starts in April of the year", () => {
    expect(fiscalYearLabel(2027)).toBe("2027-28");
    expect(fiscalYearLabel(2032)).toBe("2032-33");
    // The second year's last two digits, padded across a century.
    expect(fiscalYearLabel(2099)).toBe("2099-00");
    expect(fiscalYearLabel(2000)).toBe("2000-01");
  });
});
