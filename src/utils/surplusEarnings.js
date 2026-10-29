/**
 * The Universal Credit surplus earnings threshold measure in the Household
 * calculator (#356): Budget 2026 keeps the threshold at £2,500, rather than
 * £300, for claims from April 2027 to March 2028 (Table 6.1 row 8). It
 * reaches only a household whose pay changes from month to month, so it
 * needs monthly pay, which no national figure has: the calculator asks a
 * household on Universal Credit for it, and the household API works it out
 * month by month (src/uk_budget_data/uc_surplus_earnings.py).
 *
 * The request's months (`monthly_employment_income`,
 * `partner_monthly_employment_income`) are sent only once the box is
 * ticked, so every other household's request, and its cached and
 * precomputed answers, are unchanged. The answer's `surplus_earnings` block
 * is read here into the page's shape.
 */

export const SURPLUS_EARNINGS_ID = "universal_credit_surplus_earnings";
/** As the result card names it after the count ("with 7 policies and …"). */
export const SURPLUS_EARNINGS_PHRASE = "the Universal Credit surplus earnings threshold";
export const MONTHS_IN_YEAR = 12;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A month key ("2027-09") as the page names it: "September 2027", "Sep". */
export function monthName(key) {
  const [year, month] = String(key).split("-").map(Number);
  const name = MONTH_NAMES[month - 1] ?? String(key);
  return { key: String(key), label: `${name} ${year}`, short: name.slice(0, 3) };
}

/** The twelve months of the policy year starting in April `year`. */
export function policyYearMonths(year) {
  return Array.from({ length: MONTHS_IN_YEAR }, (_, index) => {
    const month = ((index + 3) % 12) + 1;
    const calendarYear = Number(year) + Math.floor((index + 3) / 12);
    return monthName(`${calendarYear}-${String(month).padStart(2, "0")}`);
  });
}

/**
 * Whether the form asks whether monthly pay varies: only for a household
 * that would claim Universal Credit, in Great Britain. The rule reaches
 * only a Universal Credit award, and the Budget measure only Great
 * Britain; every other figure is yearly, so for anyone else the months
 * would change nothing.
 */
export const asksMonthlyPay = (inputs) => Boolean(inputs?.claims_universal_credit) && inputs?.region !== "NORTHERN_IRELAND";

/** Whether the request carries monthly pay: asked, and the box ticked. */
export const sendsMonthlyPay = (inputs) => asksMonthlyPay(inputs) && Boolean(inputs?.monthly_income_varies);

const amount = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * Twelve months of pay, £ a month: each month as entered, else the yearly
 * salary spread evenly (to the penny), which is what the boxes are
 * prefilled with.
 */
export function monthlyPay(entered, yearly) {
  const even = Math.round(((amount(yearly) ?? 0) / MONTHS_IN_YEAR) * 100) / 100;
  return Array.from({ length: MONTHS_IN_YEAR }, (_, index) => amount(entered?.[index]) ?? even);
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function side(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    universalCredit: num(raw.universal_credit),
    status: String(raw.status ?? ""),
    claim: typeof raw.claim === "number" ? raw.claim : null,
    surplusCounted: num(raw.surplus_counted),
    surplusCarried: num(raw.surplus_carried),
  };
}

/**
 * The answer's `surplus_earnings` block in the page's shape, or null when
 * the answer has none (no monthly pay asked, or an API from before it).
 * `status` is "affected" or "not_affected"; a household the measure cannot
 * reach has its `reason` and `note`, £0 and no months.
 */
export function normaliseSurplusEarnings(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id ?? SURPLUS_EARNINGS_ID),
    name: raw.name ?? null,
    status: raw.status === "affected" ? "affected" : "not_affected",
    reason: raw.reason ?? null,
    note: raw.note ?? null,
    method: raw.method ?? null,
    change: num(raw.change),
    ownChange: numOrNull(raw.own_change),
    thresholds: { currentLaw: num(raw.thresholds?.current_law), budget: num(raw.thresholds?.budget) },
    total: raw.total ? { currentLaw: num(raw.total.current_law), budget: num(raw.total.budget) } : null,
    months: Array.isArray(raw.months)
      ? raw.months.map((month) => ({
          ...monthName(month.month),
          pay: num(month.employment_income),
          partnerPay: numOrNull(month.partner_employment_income),
          earnedIncome: num(month.total_earned_income),
          nilThreshold: num(month.nil_uc_threshold),
          withoutSurplus: num(month.universal_credit_without_surplus),
          currentLaw: side(month.current_law),
          budget: side(month.budget),
        }))
      : null,
  };
}

/** Whether the result includes the measure (its change, £0 or not). */
export const surplusIncluded = (surplus) => surplus !== null && surplus !== undefined;
