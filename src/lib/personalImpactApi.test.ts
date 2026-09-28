import { expect, it, vi } from "vitest";
import { calculatePersonalImpact, PersonalImpactError } from "./personalImpactApi";

const metadata = {
  status: "ok",
  result: {
    version: "2.90.2",
    parameters: {
      "gov.economic_assumptions.indices.obr.cpih": {
        values: {
          "2027-01-01": 1.19961,
          "2028-01-01": 1.22408,
          "2029-01-01": 1.24966,
          "2030-01-01": 1.27615,
        },
      },
    },
  },
};

function reply(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

it("builds all seven baseline/reform comparisons and preserves the chart response", async () => {
  const calls: Array<{ year: string; household: Record<string, unknown>; policy?: Record<string, unknown> }> = [];
  const api = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/uk/metadata")) return reply(metadata);
    const request = JSON.parse(String(options?.body));
    const household = request.household.households.household_0;
    const year = Object.keys(household.household_net_income)[0];
    calls.push({ year, household, policy: request.policy });
    let income = 1000;
    if (request.policy?.["gov.hmrc.cgt.basic_rate"]) income = 900;
    if (request.policy?.["gov.hmrc.fuel_duty.petrol_and_diesel"]?.[`${year}-01-01.${year}-12-31`] === 0.5295) income = 1050;
    if (household.bus_subsidy_spending) income = 1125;
    if (request.policy?.["gov.hmrc.income_tax.allowances.personal_allowance.amount"]) income = 1200;
    if (request.policy?.["gov.hmrc.income_tax.rates.dividends[0].rate"]) income = 1100;
    if (request.policy?.["gov.hmrc.income_tax.rates.savings.basic"]) income = 1030;
    if (request.policy?.["gov.hmrc.income_tax.rates.property.basic"]) income = 1040;
    return reply({ result: { households: { household_0: { household_net_income: { [year]: income } } } } });
  });
  const result = await calculatePersonalImpact({
    employment_income: 50000,
    capital_gains: 20000,
    fuel_spending: 3000,
    bus_spending: 1000,
    dividend_income: 1000,
    savings_income: 1000,
    property_income: 1000,
    region: "NORTH_EAST",
    children_ages: [23],
  }, api as typeof fetch);

  expect(result.totals.by_year).toEqual({ 2025: 0, 2026: -200, 2027: -95, 2028: -295, 2029: -295, 2030: -295 });
  expect(result.totals.cumulative).toBe(-1180);
  expect(result.policies.bus_fare_cap.years[2027].net_income_change).toBe(125);
  expect(result.policies.threshold_freeze_extension.years[2028].net_income_change).toBe(-200);
  expect(result.years[2025].baseline.household_net_income).toBe(1000);
  expect(calls.find((call) => call.year === "2027" && call.household.bus_subsidy_spending)?.household.bus_fare_spending)
    .toEqual({ 2027: 875 });
  expect(calls.find((call) => call.year === "2027" && call.policy?.["gov.hmrc.fuel_duty.petrol_and_diesel"])
    ?.policy?.["gov.hmrc.fuel_duty.petrol_and_diesel"]).toEqual({
      "2027-01-01.2027-02-28": 0.5595,
      "2027-03-01.2027-12-31": 0.5795,
    });
  const current2027 = calls.find((call) => call.year === "2027" && !call.policy && !call.household.bus_subsidy_spending);
  expect(Object.keys(current2027?.household ?? {})).toContain("region");
  expect(calls.some((call) => call.year === "2027" && call.household.bus_subsidy_spending)).toBe(true);
});

it("rejects invalid selections before sending household data", async () => {
  const api = vi.fn();
  await expect(calculatePersonalImpact({ employment_income: 50000, policy_ids: ["unknown"] }, api))
    .rejects.toMatchObject({ status: 400 });
  expect(api).not.toHaveBeenCalled();
});

it("stops when the public API model no longer matches the dashboard", async () => {
  const api = vi.fn(async () => reply({ status: "ok", result: { ...metadata.result, version: "2.88.18" } }));
  await expect(calculatePersonalImpact({ employment_income: 50000 }, api as typeof fetch))
    .rejects.toMatchObject({ status: 503, message: expect.stringContaining("model has changed") });
  expect(api).toHaveBeenCalledTimes(1);
});

it("reports an upstream calculation failure without treating it as a zero impact", async () => {
  const api = vi.fn(async (url: string) => url.endsWith("/uk/metadata") ? reply(metadata) : reply({ status: "error" }, 500));
  await expect(calculatePersonalImpact({ employment_income: 50000 }, api as typeof fetch))
    .rejects.toBeInstanceOf(PersonalImpactError);
});
