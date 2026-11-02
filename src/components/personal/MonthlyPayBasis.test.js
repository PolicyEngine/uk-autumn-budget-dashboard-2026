import { describe, expect, it } from "vitest";
import { assumptionItems } from "./SingleYearResults";

// The result card's "Based on" says where the year's pay came from: in
// 2027-28, with monthly pay entered, the twelve months' total, in place of
// the salary grown to the year (#356).

const result = (overrides = {}) => ({
  salaryUsed: 22500,
  partnerSalaryUsed: null,
  salaryYear: 2026,
  salaryFromMonths: false,
  notModelled: [],
  dependants: [],
  dependantsNote: null,
  councilTax: null,
  area: null,
  ...overrides,
});
const payItem = (data) => assumptionItems(data, "2027-28").find((item) => item.id === "salary");

describe("the year's pay in the result's Based on", () => {
  it("names the months' total as the pay, in place of the salary grown", () => {
    expect(payItem(result({ salaryFromMonths: true }))).toEqual({
      id: "salary",
      label: "Pay in 2027-28",
      value: "£22,500",
      detail: "the 12 months you entered, in place of your salary grown from 2026",
    });
  });

  it("keeps the salary grown with OBR earnings without months", () => {
    expect(payItem(result({ salaryUsed: 18432 }))).toEqual({
      id: "salary",
      label: "Salary in 2027-28",
      value: "£18,432",
      detail: "grown from 2026 with OBR earnings",
    });
  });
});
