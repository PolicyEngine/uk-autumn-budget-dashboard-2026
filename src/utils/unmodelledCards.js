/**
 * How each Budget measure the dashboard does not model is laid out as a
 * Policies card (components/policies/UnmodelledMeasures.jsx): its category
 * chip, its months on the card's timeline, when it ends, and, where the
 * entry's own text gives the values before and after, the "What changes"
 * tiles. The words and figures are María's entries
 * (utils/unmodelledMeasures.js), from the Budget documents; nothing here
 * adds a fact they do not state. Each value below names the entry's text it
 * comes from.
 *
 * Fields, all optional:
 * - category: { label, icon } for the card's chip (TitleIcon names);
 * - inForce / steps / stepsLabel / ends / duration: as in policyDetails.js,
 *   only where the entry states the dates;
 * - parameters: a "What changes" entry ({ display, rows }) as
 *   policy_parameters.json shapes one, always "table": the before and
 *   after tiles only, with no plot. The cards show no timeline either:
 *   Starts and Ends say when.
 */

const yearly = (from, to, before, after, beforeStart = before) =>
  Array.from({ length: 2031 - 2026 + 1 }, (_, i) => 2026 + i)
    .filter((year) => year >= from - 1 && year <= to)
    .map((year) => ({
      key: String(year),
      label: `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
      year,
      before: year < from ? beforeStart : before,
      after: year < from ? beforeStart : after,
    }));

const row = (label, unit, unitWords, points, primary = true) => ({ label, unit, unit_words: unitWords, primary, points });

export const UNMODELLED_CARDS = {
  // "rises from £12.71 to £13.21 an hour" from 1 April 2027: one year's
  // rates, so tiles only
  "national-living-wage": {
    category: { label: "Pay", icon: "banknote" },
    inForce: { from: "2027-04" },
    parameters: {
      display: "table",
      rows: [row("National Living Wage", "gbp_pence", "£ an hour", [{ key: "2027", label: "2027-28", year: 2027, before: 12.71, after: 13.21 }])],
    },
  },
  // "stays at £2,500 for a further year, to the end of March 2028, rather
  // than falling to £300 as legislated"
  "universal-credit-surplus-earnings": {
    category: { label: "Benefits", icon: "piggy" },
    inForce: { from: "2027-04", to: "2028-03" },
    ends: "March 2028",
    duration: "One year",
    parameters: {
      display: "table",
      rows: [row("Surplus earnings threshold", "gbp", "£", [{ key: "2027", label: "2027-28", year: 2027, before: 300, after: 2500 }])],
    },
  },
  "parental-allowance": {
    category: { label: "Benefits", icon: "piggy" },
    inForce: { from: "2029-04" },
  },
  // First 10,000 miles 55p from 6 April 2026; above 10,000 miles "rises from
  // 25p to 35p a mile from 6 April 2027"
  "mileage-rates": {
    category: { label: "Income tax", icon: "wallet" },
    inForce: { from: "2026-04" },
    steps: [{ month: "2027-04", label: "35p above 10,000 miles" }],
    stepsLabel: "35p above 10,000 miles",
    parameters: {
      display: "table",
      rows: [row("Tax-free rate above 10,000 business miles", "pence", "pence a mile", yearly(2027, 2031, 25, 35))],
    },
  },
  // "capped at £2 for one year from 1 January 2027. Until then most single
  // fares there are capped at £3": the cap after the year is not stated, so
  // tiles only
  "bus-fare-cap": {
    category: { label: "Transport", icon: "compass" },
    inForce: { from: "2027-01", to: "2027-12" },
    ends: "December 2027",
    duration: "One year",
    parameters: {
      display: "table",
      rows: [row("Single bus fare cap", "gbp", "£ a fare", [{ key: "2027", label: "From 1 January 2027", year: 2026, before: 3, after: 2 }])],
    },
  },
  // No start date set ("by the end of 2027, or as soon as possible after")
  "gas-standing-charges": {
    category: { label: "Energy", icon: "flame" },
  },
  // Rates "2 percentage points" above current law's (Budget 2025's 22%);
  // the basic rate as the tiles, from policy_parameters.json's 2027-28 row
  "savings-income-tax": {
    category: { label: "Income tax", icon: "wallet" },
    inForce: { from: "2027-04" },
    parameters: {
      display: "table",
      rows: [row("Savings basic rate", "percent", null, [{ key: "2027", label: "2027-28", year: 2027, before: 0.22, after: 0.24 }])],
    },
  },
  // The cut "to £12,000 for savers under 65 from 6 April 2027 does not go
  // ahead: the limit stays at £20,000"
  "cash-isa-limit": {
    category: { label: "Savings", icon: "coins" },
    inForce: { from: "2027-04" },
    parameters: {
      display: "table",
      rows: [row("Cash ISA limit, savers under 65", "gbp", "£ a year", yearly(2027, 2031, 12000, 20000, 20000))],
    },
  },
  // The charge "20% ... rather than 25%" from 29 October 2026; the new ISA
  // from 6 April 2029
  "first-time-buyer-isa": {
    category: { label: "Savings", icon: "coins" },
    inForce: { from: "2026-10" },
    steps: [{ month: "2029-04", label: "First Time Buyer ISA opens" }],
    stepsLabel: "First Time Buyer ISA opens",
    parameters: {
      display: "table",
      rows: [row("Lifetime ISA withdrawal charge on homes above £450,000", "percent", null, [
        { key: "2026-04-06", label: "6 April 2026", year: 2026, before: 0.25, after: 0.25 },
        { key: "2026-10-29", label: "29 October 2026", year: 2026, before: 0.25, after: 0.2 },
      ])],
    },
  },
  "adjusted-triple-lock": {
    category: { label: "Pensions", icon: "armchair" },
    inForce: { from: "2030-04" },
  },
  // 2030-31's percentages "1 percentage point above those for 2029-30":
  // one year's, so tiles only
  "company-car-tax": {
    category: { label: "Income tax", icon: "wallet" },
    inForce: { from: "2030-04" },
    parameters: {
      display: "table",
      rows: [
        row("Zero-emission cars", "percent", null, [{ key: "2030", label: "2030-31", year: 2030, before: 0.09, after: 0.1 }]),
        row("Cars emitting 1 to 50g CO2/km", "percent", null, [{ key: "2030", label: "2030-31", year: 2030, before: 0.19, after: 0.2 }], false),
      ],
    },
  },
  // "falls from £1 million to £500,000" from 6 April 2027
  "business-asset-disposal-relief": {
    category: { label: "Capital gains tax", icon: "trend" },
    inForce: { from: "2027-04" },
    parameters: {
      display: "table",
      rows: [row("Lifetime limit", "gbp", "£ of gains", yearly(2027, 2031, 1000000, 500000))],
    },
  },
  // "rises from 20% to 25%" from 1 April 2027; suppliers liable from 1 April 2028
  "machine-games-duty": {
    category: { label: "Business", icon: "building" },
    inForce: { from: "2027-04" },
    steps: [{ month: "2028-04", label: "Suppliers liable" }],
    stepsLabel: "Suppliers liable",
    parameters: {
      display: "table",
      rows: [row("Duty on higher-stake machines", "percent", null, yearly(2027, 2031, 0.2, 0.25))],
    },
  },
  "online-marketplace-liability": {
    category: { label: "VAT", icon: "receipt" },
    inForce: { from: "2027-10" },
  },
  // "from 15% to 35% from 1 April 2027"; how long it lasts is not stated,
  // so tiles only
  "pubs-business-rates-relief": {
    category: { label: "Business rates", icon: "building" },
    inForce: { from: "2027-04" },
    parameters: {
      display: "table",
      rows: [row("Business rates relief for pubs", "percent", null, [{ key: "2027", label: "2027-28", year: 2027, before: 0.15, after: 0.35 }])],
    },
  },
  "your-first-home": {
    category: { label: "Property", icon: "house" },
    inForce: { from: "2027-04" },
  },
  // "6% for 15 months, from 1 January 2027 to 31 March 2028, returning to 3%
  // from 1 April 2028"
  "bank-surcharge": {
    category: { label: "Business", icon: "building" },
    inForce: { from: "2027-01", to: "2028-03" },
    ends: "March 2028",
    duration: "15 months",
    parameters: {
      display: "table",
      rows: [row("Bank Corporation Tax Surcharge", "percent", null, [
        { key: "2027-01-01/2028-03-31", label: "January 2027 to March 2028", year: 2026, before: 0.03, after: 0.06 },
      ])],
    },
  },
};
