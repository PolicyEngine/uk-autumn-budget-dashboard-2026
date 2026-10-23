import { describe, expect, it } from "vitest";
import { curveFor, parseCurve } from "./useIncomeCurve";
import { COMBINED_REFORM_ID } from "../utils/policyConfig";

const HEADER =
  "reform_id,reform_name,year,household,x_variable,income,baseline_net_income,reform_net_income";

const CSV = [
  HEADER,
  `${COMBINED_REFORM_ID},Autumn Budget 2026 (combined),2029,single_renter,employment_income,0.0,1000.0,900.0`,
  `${COMBINED_REFORM_ID},Autumn Budget 2026 (combined),2029,single_renter,employment_income,500.0,1400.0,1300.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,0.0,1100.0,1050.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,500.0,1500.0,1450.0`,
  `b,Measure B,2029,single_renter,employment_income,0.0,1000.0,980.0`,
  `b,Measure B,2029,single_renter,employment_income,500.0,1400.0,1380.0`,
  `a,"Measure A, with a comma",2029,pensioner_couple,private_pension_income,0.0,5000.0,4000.0`,
  `a,"Measure A, with a comma",2030,single_renter,employment_income,0.0,7000.0,6000.0`,
].join("\n");

describe("the example households' curves", () => {
  it("parse every column, a quoted measure name included", () => {
    const rows = parseCurve(CSV);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toEqual({
      reformId: "a",
      year: 2029,
      household: "single_renter",
      income: 0,
      baseline: 1100,
      reformNet: 1050,
    });
  });

  it("sum the selected measures' changes on the combined package's baseline", () => {
    const curve = curveFor(parseCurve(CSV), {
      household: "single_renter",
      year: 2029,
      policies: ["a", "b"],
    });
    expect(curve).toEqual([
      { income: 0, baseline: 1000, difference: -70, reform: 930 },
      { income: 500, baseline: 1400, difference: -70, reform: 1330 },
    ]);
  });

  it("keep households and years apart", () => {
    const rows = parseCurve(CSV);
    const pensioners = curveFor(rows, { household: "pensioner_couple", year: 2029, policies: ["a"] });
    expect(pensioners).toEqual([{ income: 0, baseline: 5000, difference: -1000, reform: 4000 }]);
    expect(curveFor(rows, { household: "lone_parent", year: 2029, policies: ["a"] })).toEqual([]);
  });
});
