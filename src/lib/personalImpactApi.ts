/** Server-side adapter for the PolicyEngine UK household API.
 *
 * Keep the scenarios in step with personal_impact.py and reforms.py. The API
 * exposes household calculations, while the dashboard needs differences
 * between seven specific baseline and reform scenarios for each model year.
 */

export const POLICY_IDS = [
  "cgt_equalisation",
  "fuel_duty_rise_cancellation",
  "bus_fare_cap",
  "threshold_freeze_extension",
  "dividend_tax_increase_2pp",
  "savings_tax_increase_2pp",
  "property_tax_increase_2pp",
] as const;

type PolicyId = (typeof POLICY_IDS)[number];
type Policy = Record<string, Record<string, number>>;
type PeriodValues = Record<string, number | string | null>;
type Entity = Record<string, PeriodValues | string[]>;
type Situation = {
  people: Record<string, Entity>;
  benunits: Record<string, { members: string[] }>;
  households: Record<string, Entity>;
};

type HouseholdInput = {
  employment_income: number;
  income_growth_rate: number;
  is_married: boolean;
  partner_income: number;
  children_ages: number[];
  property_income: number;
  savings_income: number;
  dividend_income: number;
  pension_contributions_salary_sacrifice: number;
  fuel_spending: number;
  rail_spending: number;
  bus_spending: number;
  capital_gains: number;
  region: string;
  fuel_type: "PETROL" | "DIESEL";
  policy_ids: PolicyId[];
};

type ApiMetadata = {
  status: string;
  result?: {
    version?: string;
    parameters?: Record<string, { values?: Record<string, number> }>;
  };
};

type Job = { year: number; key: string; household: Situation; policy?: Policy };

const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];
const MODEL_VERSION = "2.90.2"; // dashboard uv.lock and verified /uk/metadata
const DEFAULT_API_URL = "https://api.policyengine.org";
const CPI_PATH = "gov.economic_assumptions.indices.obr.cpih";
const FUEL_PATH = "gov.hmrc.fuel_duty.petrol_and_diesel";
const PA_PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount";
const BASIC_THRESHOLD_PATH = "gov.hmrc.income_tax.rates.uk[1].threshold";
const BUS_REGIONS = new Set([
  "NORTH_EAST", "NORTH_WEST", "YORKSHIRE", "EAST_MIDLANDS",
  "WEST_MIDLANDS", "EAST_OF_ENGLAND", "SOUTH_EAST", "SOUTH_WEST",
]);
const REGIONS = new Set([
  ...BUS_REGIONS, "LONDON", "WALES", "SCOTLAND", "NORTHERN_IRELAND",
]);
const POLICY_DETAILS: Record<PolicyId, { name: string; description: string }> = {
  cgt_equalisation: {
    name: "CGT equalisation with income tax",
    description: "Illustrative 20%/40%/45% capital gains rates from 2026, with a retention-rate realisation elasticity of 1.0.",
  },
  fuel_duty_rise_cancellation: {
    name: "Fuel duty rise cancellation",
    description: "Illustrative cancellation of the January 2027 rise, keeping the rate at 52.95p per litre.",
  },
  bus_fare_cap: {
    name: "£2 bus fare cap",
    description: "Illustrative 12.5% fare saving from 2027 in participating English regions outside London, represented as an imputed service benefit.",
  },
  threshold_freeze_extension: {
    name: "Threshold freeze extension",
    description: "Compares frozen income tax thresholds with CPI uprating from 2028.",
  },
  dividend_tax_increase_2pp: {
    name: "Dividend tax increase (+2pp)",
    description: "Compares current-law dividend rates with pre-budget basic and higher rates from 2026.",
  },
  savings_tax_increase_2pp: {
    name: "Savings income tax increase (+2pp)",
    description: "Compares current-law savings rates with pre-budget rates from 2027.",
  },
  property_tax_increase_2pp: {
    name: "Property income tax increase (+2pp)",
    description: "Compares current-law property rates with pre-budget rates from 2027.",
  },
};

export class PersonalImpactError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function inputNumber(data: Record<string, unknown>, name: string, fallback?: number, min = 0, max = Infinity): number {
  const value = data[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new PersonalImpactError(`Enter a valid ${name.replaceAll("_", " ")}.`, 400);
  }
  return value;
}

export function parseHouseholdInput(raw: unknown): HouseholdInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PersonalImpactError("Enter household details before calculating.", 400);
  }
  const data = raw as Record<string, unknown>;
  const ages = data.children_ages ?? [];
  if (!Array.isArray(ages) || ages.length > 10 || ages.some((age) => !Number.isInteger(age) || age < 0 || age > 25)) {
    throw new PersonalImpactError("Enter up to ten child ages between 0 and 25.", 400);
  }
  const region = data.region ?? "LONDON";
  if (typeof region !== "string" || !REGIONS.has(region)) {
    throw new PersonalImpactError("Select a valid UK region.", 400);
  }
  const fuelType = data.fuel_type ?? "PETROL";
  if (fuelType !== "PETROL" && fuelType !== "DIESEL") {
    throw new PersonalImpactError("Select petrol or diesel.", 400);
  }
  const isMarried = data.is_married ?? false;
  if (typeof isMarried !== "boolean") {
    throw new PersonalImpactError("Enter a valid household composition.", 400);
  }
  const requested = data.policy_ids ?? POLICY_IDS;
  if (!Array.isArray(requested) || requested.length === 0 ||
      requested.some((id) => typeof id !== "string" || !POLICY_IDS.includes(id as PolicyId)) ||
      new Set(requested).size !== requested.length) {
    throw new PersonalImpactError("Select one or more unique featured policies.", 400);
  }
  const selected = POLICY_IDS.filter((id) => requested.includes(id));
  return {
    employment_income: inputNumber(data, "employment_income"),
    income_growth_rate: inputNumber(data, "income_growth_rate", 0, -0.5, 0.5),
    is_married: isMarried,
    partner_income: inputNumber(data, "partner_income", 0),
    children_ages: ages as number[],
    property_income: inputNumber(data, "property_income", 0),
    savings_income: inputNumber(data, "savings_income", 0),
    dividend_income: inputNumber(data, "dividend_income", 0),
    pension_contributions_salary_sacrifice: inputNumber(data, "pension_contributions_salary_sacrifice", 0),
    fuel_spending: inputNumber(data, "fuel_spending", 0),
    rail_spending: inputNumber(data, "rail_spending", 0),
    bus_spending: inputNumber(data, "bus_spending", 0),
    capital_gains: inputNumber(data, "capital_gains", 0),
    region,
    fuel_type: fuelType,
    policy_ids: selected,
  };
}

function buildSituation(input: HouseholdInput, year: number): Situation {
  const period = String(year);
  const elapsed = year - 2025;
  const growth = (1 + input.income_growth_rate) ** elapsed;
  const adult: Entity = {
    age: { [period]: 35 + elapsed },
    employment_income: { [period]: input.employment_income * growth },
    savings_interest_income: { [period]: input.savings_income },
    property_income: { [period]: input.property_income },
    dividend_income: { [period]: input.dividend_income },
    capital_gains_before_response: { [period]: input.capital_gains },
  };
  if (input.pension_contributions_salary_sacrifice > 0) {
    adult.pension_contributions_via_salary_sacrifice = {
      [period]: input.pension_contributions_salary_sacrifice,
    };
  }
  const people: Record<string, Entity> = { person_0: adult };
  const members = ["person_0"];
  if (input.is_married) {
    people.person_1 = {
      age: { [period]: 33 + elapsed },
      employment_income: { [period]: input.partner_income * growth },
    };
    members.push("person_1");
  }
  input.children_ages.forEach((age, index) => {
    if (age + elapsed < 25) {
      const id = `child_${index + 1}`;
      people[id] = {
        age: { [period]: age + elapsed },
        employment_income: { [period]: 0 },
      };
      members.push(id);
    }
  });
  return {
    people,
    benunits: { benunit_0: { members } },
    households: {
      household_0: {
        members,
        region: { [period]: input.region },
        petrol_spending: { [period]: input.fuel_type === "PETROL" ? input.fuel_spending : 0 },
        diesel_spending: { [period]: input.fuel_type === "DIESEL" ? input.fuel_spending : 0 },
        bus_fare_spending: { [period]: input.bus_spending },
        household_net_income: { [period]: null },
      },
    },
  };
}

function yearRange(year: number): string {
  return `${year}-01-01.${year}-12-31`;
}

function annualPolicy(year: number, changes: Record<string, number>): Policy {
  return Object.fromEntries(
    Object.entries(changes).map(([path, value]) => [path, { [yearRange(year)]: value }]),
  );
}

function fuelBaselinePolicy(year: number): Policy {
  if (year === 2027) {
    return { [FUEL_PATH]: {
      "2027-01-01.2027-02-28": 0.5595,
      "2027-03-01.2027-12-31": 0.5795,
    } };
  }
  return annualPolicy(year, { [FUEL_PATH]: year === 2026 ? 0.5295 : 0.5795 });
}

function cgtPolicy(year: number): Policy {
  return annualPolicy(year, {
    "gov.hmrc.cgt.basic_rate": 0.20,
    "gov.hmrc.cgt.higher_rate": 0.40,
    "gov.hmrc.cgt.additional_rate": 0.45,
    "gov.simulation.capital_gains_responses.elasticity": 1.0,
  });
}

function oldRatePolicy(year: number, source: "savings" | "property"): Policy {
  const base = `gov.hmrc.income_tax.rates.${source}`;
  return annualPolicy(year, {
    [`${base}.basic`]: 0.20,
    [`${base}.higher`]: 0.40,
    [`${base}.additional`]: 0.45,
  });
}

function cpih(metadata: ApiMetadata, year: number): number {
  const value = metadata.result?.parameters?.[CPI_PATH]?.values?.[`${year}-01-01`];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PersonalImpactError("The UK model's inflation assumptions are unavailable.", 503);
  }
  return value;
}

function relevant(id: PolicyId, input: HouseholdInput, year: number): boolean {
  switch (id) {
    case "cgt_equalisation": return year >= 2026 && input.capital_gains > 0;
    case "fuel_duty_rise_cancellation": return year >= 2027 && input.fuel_spending > 0;
    case "bus_fare_cap": return year >= 2027 && input.bus_spending > 0 && BUS_REGIONS.has(input.region);
    case "threshold_freeze_extension": return year >= 2028 && [
      input.employment_income, input.partner_income, input.property_income,
      input.savings_income, input.dividend_income, input.capital_gains,
    ].some((value) => value > 0);
    case "dividend_tax_increase_2pp": return year >= 2026 && input.dividend_income > 0;
    case "savings_tax_increase_2pp": return year >= 2027 && input.savings_income > 0;
    case "property_tax_increase_2pp": return year >= 2027 && input.property_income > 0;
  }
}

function jobsForYear(input: HouseholdInput, metadata: ApiMetadata, year: number): Job[] {
  const household = buildSituation(input, year);
  const jobs: Job[] = [{ year, key: "current", household }];
  for (const id of input.policy_ids) {
    if (!relevant(id, input, year)) continue;
    if (id === "cgt_equalisation") {
      jobs.push({ year, key: `${id}:reform`, household, policy: cgtPolicy(year) });
    } else if (id === "fuel_duty_rise_cancellation") {
      jobs.push({ year, key: `${id}:baseline`, household, policy: fuelBaselinePolicy(year) });
      jobs.push({ year, key: `${id}:reform`, household,
        policy: annualPolicy(year, { [FUEL_PATH]: 0.5295 }) });
    } else if (id === "bus_fare_cap") {
      const saving = input.bus_spending * 0.125;
      const reformedHousehold = structuredClone(household);
      reformedHousehold.households.household_0.bus_fare_spending = { [year]: input.bus_spending - saving };
      reformedHousehold.households.household_0.bus_subsidy_spending = { [year]: saving };
      jobs.push({ year, key: `${id}:reform`, household: reformedHousehold });
    } else if (id === "threshold_freeze_extension") {
      const ratio = cpih(metadata, year) / cpih(metadata, 2027);
      jobs.push({ year, key: `${id}:baseline`, household, policy: annualPolicy(year, {
        [PA_PATH]: Math.round(12570 * ratio),
        [BASIC_THRESHOLD_PATH]: Math.round(37700 * ratio),
      }) });
    } else if (id === "dividend_tax_increase_2pp") {
      jobs.push({ year, key: `${id}:baseline`, household, policy: annualPolicy(year, {
        "gov.hmrc.income_tax.rates.dividends[0].rate": 0.0875,
        "gov.hmrc.income_tax.rates.dividends[1].rate": 0.3375,
      }) });
    } else if (id === "savings_tax_increase_2pp" || id === "property_tax_increase_2pp") {
      jobs.push({ year, key: `${id}:baseline`, household,
        policy: oldRatePolicy(year, id === "savings_tax_increase_2pp" ? "savings" : "property") });
    }
  }
  return jobs;
}

async function withConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

function apiBase(): string {
  return (process.env.POLICYENGINE_UK_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

async function getMetadata(fetchImpl: typeof fetch): Promise<ApiMetadata> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/uk/metadata`, {
      cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PersonalImpactError("The PolicyEngine UK API is unavailable. Please retry.", 503);
  }
  if (!response.ok) throw new PersonalImpactError("The PolicyEngine UK model metadata is unavailable.", 503);
  const metadata = await response.json() as ApiMetadata;
  if (metadata.result?.version !== MODEL_VERSION) {
    throw new PersonalImpactError("The PolicyEngine UK model has changed; household estimates need review before use.", 503);
  }
  return metadata;
}

async function calculateJob(job: Job, fetchImpl: typeof fetch): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/uk/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ household: job.household, ...(job.policy ? { policy: job.policy } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new PersonalImpactError("The PolicyEngine UK API could not complete the calculation. Please retry.", 503);
  }
  if (!response.ok) {
    throw new PersonalImpactError("The PolicyEngine UK API could not calculate this household.", 502);
  }
  const data = await response.json() as {
    result?: { households?: { household_0?: { household_net_income?: Record<string, number> } } };
  };
  const income = data.result?.households?.household_0?.household_net_income?.[String(job.year)];
  if (typeof income !== "number" || !Number.isFinite(income)) {
    throw new PersonalImpactError("The PolicyEngine UK API returned an incomplete household result.", 502);
  }
  return income;
}

export async function calculatePersonalImpact(raw: unknown, fetchImpl: typeof fetch = fetch) {
  const input = parseHouseholdInput(raw);
  const metadata = await getMetadata(fetchImpl);
  const jobs = YEARS.flatMap((year) => jobsForYear(input, metadata, year));
  const values = await withConcurrency(jobs, 4, (job) => calculateJob(job, fetchImpl));
  const income = new Map(jobs.map((job, index) => [`${job.year}:${job.key}`, values[index]]));
  const get = (year: number, key: string) => {
    const value = income.get(`${year}:${key}`);
    if (value === undefined) throw new PersonalImpactError("A household result is missing.", 502);
    return value;
  };
  const results: {
    household_input: Omit<HouseholdInput, "policy_ids">;
    years: Record<number, { baseline: { household_net_income: number }; policies: Record<string, { net_income_change: number }> }>;
    policies: Record<string, {
      name: string; description: string; years: Record<number, {
        baseline_net_income: number; reformed_net_income: number; net_income_change: number;
        baseline_metrics: { household_net_income: number }; reformed_metrics: { household_net_income: number };
      }>; total_impact: number;
    }>;
    totals: { by_year: Record<number, number>; cumulative: number };
  } = {
    household_input: Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "policy_ids"),
    ) as Omit<HouseholdInput, "policy_ids">,
    years: {}, policies: {}, totals: { by_year: {}, cumulative: 0 },
  };
  for (const id of input.policy_ids) {
    results.policies[id] = { ...POLICY_DETAILS[id], years: {}, total_impact: 0 };
  }
  for (const year of YEARS) {
    const current = get(year, "current");
    results.years[year] = { baseline: { household_net_income: current }, policies: {} };
    let yearTotal = 0;
    for (const id of input.policy_ids) {
      let baseline = current;
      let reformed = current;
      if (relevant(id, input, year)) {
        if (id === "cgt_equalisation" || id === "bus_fare_cap") {
          reformed = get(year, `${id}:reform`);
        } else if (id === "fuel_duty_rise_cancellation") {
          baseline = get(year, `${id}:baseline`);
          reformed = get(year, `${id}:reform`);
        } else {
          baseline = get(year, `${id}:baseline`);
        }
      }
      const change = reformed - baseline;
      results.policies[id].years[year] = {
        baseline_net_income: baseline,
        reformed_net_income: reformed,
        net_income_change: change,
        baseline_metrics: { household_net_income: baseline },
        reformed_metrics: { household_net_income: reformed },
      };
      results.policies[id].total_impact += change;
      results.years[year].policies[id] = { net_income_change: change };
      yearTotal += change;
    }
    results.totals.by_year[year] = yearTotal;
    results.totals.cumulative += yearTotal;
  }
  return results;
}
