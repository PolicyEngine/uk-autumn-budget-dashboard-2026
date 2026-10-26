import { describe, expect, it } from "vitest";
import { parseRevenue } from "./useMeasureRevenue";

describe("parseRevenue", () => {
  it("reads a measure whose quoted name holds a comma", () => {
    const csv = [
      "reform_id,reform_name,year,value",
      'employer_ni_secondary_threshold_raised,"Employer NI threshold raised by £1,000",2027,-3.62',
      'sp_extended,"State Pension income tax protection, extended",2028,-1.8',
      "badr_lifetime_limit_cut,Business Asset Disposal Relief restricted,2027,0.36",
    ].join("\n");
    expect(parseRevenue(csv)).toEqual({
      employer_ni_secondary_threshold_raised: { 2027: -3.62 },
      sp_extended: { 2028: -1.8 },
      badr_lifetime_limit_cut: { 2027: 0.36 },
    });
  });
});
