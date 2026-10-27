/**
 * The Household impact form's defaults, with their sources. Every field has
 * one, so the results show before anything is changed.
 *
 * They are the shared UK household model's (policyengine-household-wizard's
 * uk-household; `UK_DEFAULT_SOURCES` there gives each source in full):
 * - salary: ONS, Annual Survey of Hours and Earnings 2026 provisional, Table
 *   6.7a, the UK median of £34,229 in April 2026, rounded to £34,200. The
 *   form asks for salary in 2026, so the year matches;
 * - rent: ONS, Price Index of Private Rents, average monthly private rent by
 *   region, September 2026 (Northern Ireland: July 2026, its latest),
 *   published 21 October 2026;
 * - spending: ONS, Family Spending in the UK, FYE 2025, Workbook 1, Table
 *   A1, average weekly household spending × 52, rounded to £10 (electricity
 *   £1,040, the API's own default, ELECTRICITY_SPENDING).
 */
import {
  UK_DEFAULT_SALARY,
  UK_DEFAULT_SALARY_NOTE,
  UK_DEFAULT_SPENDING,
  UK_REGIONAL_RENT,
  createTypicalDraft,
  regionalRent,
} from "policyengine-household-wizard/uk-household";
import { answersFromDraft } from "./householdDraft";

/** ASHE 2026 provisional median, all employee jobs, rounded. */
export const DEFAULT_SALARY = UK_DEFAULT_SALARY;
export const SALARY_SOURCE = UK_DEFAULT_SALARY_NOTE;

/** Average monthly private rent by region (ONS PIPR, September 2026). */
export const REGIONAL_RENT = UK_REGIONAL_RENT;

/** The region's average private rent; the UK's (£1,406) for an unknown region. */
export { regionalRent };

/** Average household spending a year (ONS Family Spending, FYE 2025). */
export const DEFAULT_SPENDING = UK_DEFAULT_SPENDING;

// The form's answers, each at a typical value until changed: the shared
// model's typical household (`createTypicalDraft` gives each choice: 30, the
// North West, renting at the region's average rent, no student loan, band
// D, claiming Universal Credit, the full State Pension at State Pension age),
// and the constituency picked (its name, 2024 boundaries), which sets the
// region; null until picked. Not sent: the API reads the region
const { current_age, current_salary, region, ...typical } = answersFromDraft(createTypicalDraft());
export const WIZARD_DEFAULTS = { current_age, current_salary, region, constituency: null, ...typical };
