import { expect, it, vi } from "vitest";
import { calculatePersonalImpact, LEGACY_POLICY_IDS, PersonalImpactError } from "./personalImpactApi";

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
    policy_ids: [...LEGACY_POLICY_IDS],
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

it("calculates all five featured mock measures with their actual household inputs", async () => {
  const calls: Array<{ year: string; household: Record<string, unknown>; policy?: Record<string, Record<string, number>> }> = [];
  const api = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/uk/metadata")) return reply(metadata);
    const request = JSON.parse(String(options?.body));
    const household = request.household.households.household_0;
    const year = Object.keys(household.household_net_income)[0];
    calls.push({ year, household, policy: request.policy });
    const getRate = (path: string) => request.policy?.[path]?.[`${year}-01-01.${year}-12-31`];
    let income = 1000;
    if (getRate("gov.hmrc.child_benefit.amount.eldest") === 30) income = 1197.6;
    if (getRate("gov.hmrc.national_insurance.class_1.thresholds.primary_threshold") === 250) income = 1034.4;
    if (getRate("gov.hmrc.council_tax.high_value_surcharge.amount[1].threshold") === 1_500_000) income = -1500;
    return reply({ result: { households: { household_0: { household_net_income: { [year]: income } } } } });
  });
  const result = await calculatePersonalImpact({
    employment_income: 30_000,
    children_ages: [7],
    self_employment_income: 25_000,
    fuel_litres: 1000,
    domestic_energy_bill: 2100,
    home_value_2026: 1_600_000,
    region: "LONDON",
  }, api as typeof fetch);

  expect(Object.keys(result.policies)).toEqual([
    "mock_fuel_duty_freeze", "mock_energy_vat_zero_rate", "mock_child_benefit_increase",
    "mock_nics_threshold_rise", "mock_hvcts_extension",
  ]);
  expect(result.policies.mock_fuel_duty_freeze.years[2027].net_income_change).toBeCloseTo(39.35, 2);
  expect(result.policies.mock_energy_vat_zero_rate.years[2027].net_income_change).toBe(75);
  expect(result.policies.mock_energy_vat_zero_rate.years[2028].net_income_change).toBe(25);
  expect(result.policies.mock_child_benefit_increase.years[2027].net_income_change).toBeCloseTo(197.6);
  expect(result.policies.mock_nics_threshold_rise.years[2027].net_income_change).toBeCloseTo(34.4);
  expect(result.policies.mock_hvcts_extension.years[2028].net_income_change).toBe(-2500);
  expect(calls.find((call) => call.year === "2028")?.household.main_residence_value)
    .toEqual({ 2028: 1_600_000 * 1.0643028381409017 });
  expect(calls.some((call) => call.year === "2027" && call.policy?.["gov.hmrc.child_benefit.amount.eldest"])).toBe(true);
  expect(calls.some((call) => call.year === "2030" && call.policy?.["gov.hmrc.national_insurance.class_4.thresholds.lower_profits_limit"]?.["2030-01-01.2030-12-31"] === 12_570)).toBe(true);
});

it("calculates the NIC threshold change when grown earnings cross the threshold", async () => {
  const calls: Array<{ year: string; employment: number; policy?: Record<string, Record<string, number>> }> = [];
  const api = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/uk/metadata")) return reply(metadata);
    const request = JSON.parse(String(options?.body));
    const year = Object.keys(request.household.households.household_0.household_net_income)[0];
    calls.push({
      year,
      employment: request.household.people.person_0.employment_income[year],
      policy: request.policy,
    });
    const rate = request.policy?.["gov.hmrc.national_insurance.class_1.thresholds.primary_threshold"]?.[`${year}-01-01.${year}-12-31`];
    const income = rate === 250 ? 1034.4 : 1000;
    return reply({ result: { households: { household_0: { household_net_income: { [year]: income } } } } });
  });
  const result = await calculatePersonalImpact({
    employment_income: 12_000,
    income_growth_rate: 0.05,
    policy_ids: ["mock_nics_threshold_rise"],
  }, api as typeof fetch);

  expect(calls.find((call) => call.year === "2027")?.employment).toBeCloseTo(13_230);
  expect(calls.some((call) => call.year === "2027" && call.policy?.["gov.hmrc.national_insurance.class_1.thresholds.primary_threshold"]?.["2027-01-01.2027-12-31"] === 250)).toBe(true);
  expect(result.policies.mock_nics_threshold_rise.years[2027].net_income_change).toBeCloseTo(34.4);
});

it("does not charge the mock high-value surcharge to tenants", async () => {
  const calls: Array<{ year: string; homeValue: number; policy?: Record<string, Record<string, number>> }> = [];
  const api = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/uk/metadata")) return reply(metadata);
    const request = JSON.parse(String(options?.body));
    const year = Object.keys(request.household.households.household_0.household_net_income)[0];
    calls.push({
      year,
      homeValue: request.household.households.household_0.main_residence_value[year],
      policy: request.policy,
    });
    const income = request.policy?.["gov.hmrc.council_tax.high_value_surcharge.amount[1].threshold"] ? -1500 : 1000;
    return reply({ result: { households: { household_0: { household_net_income: { [year]: income } } } } });
  });
  const result = await calculatePersonalImpact({
    employment_income: 30_000,
    region: "LONDON",
    tenure_type: "RENT_PRIVATELY",
    home_value_2026: 1_600_000,
    policy_ids: ["mock_hvcts_extension"],
  }, api as typeof fetch);

  expect(calls.find((call) => call.year === "2028")?.homeValue).toBe(0);
  expect(calls.some((call) => call.year === "2028" && call.policy?.["gov.hmrc.council_tax.high_value_surcharge.amount[1].threshold"])).toBe(false);
  expect(result.policies.mock_hvcts_extension.years[2028].net_income_change).toBe(0);
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
