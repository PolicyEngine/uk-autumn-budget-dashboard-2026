/**
 * The Autumn Budget 2026 measures this dashboard does not model, shown
 * collapsed at the foot of the Policies tab
 * (components/policies/UnmodelledMeasures.jsx). They are the coverage
 * ledger's `ledger` calls (G1 in docs/budget-day-runbook.md): a measure the
 * dashboard comes to model leaves this list, and one moved to the ledger
 * joins it, so a change at G1 is an edit here only.
 *
 * Every figure is the government's own: the Budget document (HC 726, 28
 * October 2026), its Table 6.1 costings, the OBR's Economic and fiscal
 * outlook, HMRC or a government release. None is a PolicyEngine estimate,
 * and none is drawn from survey data of ours. Paragraph numbers are the
 * Budget document's own: they are printed in its PDF, not in the HTML
 * version.
 */

const BUDGET_URL = "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html";

export const BUDGET_DOCUMENT = {
  label: "HM Treasury, Budget 2026 (HC 726)",
  url: BUDGET_URL,
};

/** Table 6.1, "Budget 2026 policy decisions (£ million)": its years, in order. */
export const COSTING_YEARS = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31", "2031-32"];

export const TABLE_6_1_URL = `${BUDGET_URL}#table-61-budget-2026-policy-decisions--million12`;

const budget = (paragraphs) => ({ label: `Budget 2026, ${paragraphs}`, href: BUDGET_URL });

/**
 * The OBR's detailed forecast tables (policy), Table 1.1: its breakdown of
 * each measure's costing, which it certifies, by tax. The EFO page offers
 * them only as one zip file.
 */
export const OBR_POLICY_TABLE = {
  label: "OBR, Economic and fiscal outlook – October 2026, detailed forecast tables, Table 1.1",
  href: "https://obr.uk/download/october-2026-economic-and-fiscal-outlook-detailed-forecast-tables-zip-file/",
};

const obr = (part) => ({
  label: `OBR, Economic and fiscal outlook – October 2026, ${part}`,
  href: "https://obr.uk/download/economic-and-fiscal-outlook-october-2026/",
});

/**
 * One entry per measure, in the order shown (`order`, 1 up): group by group
 * (`reason`, UNMODELLED_REASONS: why the dashboard does not model it), and
 * within a group, cards of a like shape side by side, so the two in a row
 * are close in height.
 *
 * `costings` holds the measure's Table 6.1 rows (£ million, 2026-27 to
 * 2031-32; positive is a gain to the Exchequer, negative a cost), each with
 * an optional `note` shown under the table. A measure with no row has
 * `noCosting` instead, saying what the documents give in its place.
 * `heldBack`, a short muted line, marks a measure the model covers but this
 * release holds back.
 * `certified`, where given, is the OBR's breakdown of the costing by tax
 * (OBR_POLICY_TABLE, its `measure` number): the card shows it first, as the
 * government's costing certified by the OBR, with Table 6.1 as context.
 * `seeAlso` links PolicyEngine's own published work that models the
 * measure, after the reason this dashboard does not.
 */
/**
 * The groups the cards are shown in, by why the dashboard does not model a
 * measure, in order (#297), each with a line under its title; each measure
 * names its `reason`. A card's own `notModelled` keeps its specific reason.
 */
export const UNMODELLED_REASONS = [
  { id: "coming-soon", label: "Coming soon", why: "We can model these and are adding them." },
  { id: "separately", label: "Modelled separately", why: "These have no effect in our years; we model them in separate analyses." },
  {
    id: "outside",
    label: "Outside a household model",
    why: "Taxes on firms, reliefs on business premises, a change in who collects a tax and loans don't change household incomes the way this dashboard measures them.",
  },
  { id: "data", label: "Not in our data yet", why: "These need something our data or engine lacks, or rules not yet published." },
];

export const UNMODELLED_MEASURES = [
  {
    id: "bus-fare-cap",
    order: 1,
    reason: "coming-soon",
    name: "Single bus fares capped at £2 outside London",
    starts: "1 Jan 2027",
    changes:
      "Single fares on participating buses in England outside London are capped at £2; most are capped at £3 until then.",
    reaches: "Bus passengers in England outside London, on participating services.",
    household:
      "The same journeys cost less; household income does not change.",
    costings: [
      {
        row: 4,
        values: [-50, -180, 65, 170, 0, 0],
        note: "The row's title adds that the cap is funded by reprioritising Department for Energy Security and Net Zero budgets.",
      },
    ],
    notModelled:
      "The model prices bus journeys, but a lower fare does not change household income, which is what this dashboard measures; we plan to show the saving after Budget day.",
    sources: [
      budget("paragraphs 2.8 and 3.3"),
      {
        label: "Prime Minister's Office, HM Treasury and Department for Transport, release on the £2 bus fare cap (22 July 2026)",
        href: "https://www.gov.uk/government/news/cheaper-travel-for-millions-with-a-third-off-fares",
      },
    ],
  },
  {
    id: "savings-income-tax",
    order: 2,
    reason: "coming-soon",
    name: "Tax on savings interest up 2 points",
    starts: "6 Apr 2027",
    changes:
      "Income tax rates on savings income rise by 2 points across the UK, to 24%, 44% and 49%.",
    reaches: "People with taxable savings interest across the UK.",
    household: "People with taxable savings interest pay 2 points more on it.",
    costings: [{ row: 62, values: [15, 125, 555, 520, 555, 590] }],
    // The government's costing as the OBR certifies it, by tax (OBR_POLICY_TABLE,
    // measure 62, £ million; its total is Table 6.1's row 62 to the nearest £5m)
    certified: {
      measure: 62,
      heads: [
        { head: "Income tax", values: [0, 63, 483, 443, 475, 510] },
        { head: "Onshore corporation tax", values: [13, 63, 74, 78, 80, 81] },
      ],
    },
    notModelled:
      "The model covers it, but it is held back from this release: we calibrated savings interest to HMRC's figures on a different basis, so our taxable interest is too low.",
    heldBack:
      "Held back: we calibrated savings interest to HMRC's figures on a different basis, so our taxable interest is too low. We're correcting it for the next data update.",
    sources: [budget("paragraph 6.247")],
  },
  {
    id: "machine-games-duty",
    order: 3,
    reason: "coming-soon",
    name: "Machine Games Duty up from 20% to 25%",
    starts: "1 Apr 2027",
    changes:
      "The duty on machine games with stakes over £1 or prizes over £100 rises from 20% to 25%.",
    reaches: "Venues with higher-stake machines, commonly adult gaming centres (Budget).",
    household:
      "Charged on businesses running the machines; any effect reaches households through stakes and prizes, or as owners and staff.",
    costings: [{ row: 56, values: [0, 135, 150, 145, 145, 145] }],
    notModelled: "Our data hold no household spending on gambling, so the model can't pass the duty through to households.",
    sources: [budget("paragraphs 2.49 and 6.225")],
  },
  {
    id: "cash-isa-limit",
    order: 4,
    reason: "coming-soon",
    name: "Cash ISA limit kept at £20,000",
    starts: "6 Apr 2027",
    changes:
      "A planned cut in the cash ISA limit to £12,000 for under-65s does not go ahead; it stays at £20,000.",
    reaches:
      "Under-65 cash ISA savers; 22% paid in over £12,000 in 2022-23.",
    household:
      "Interest in a cash ISA stays free of income tax on up to £20,000 a year of new savings.",
    costings: [{ row: 11, values: [0, -5, -20, -35, -50, -70] }],
    notModelled:
      "The model has no payments into ISAs or limits on them, so the planned cut was never in its current law and keeping £20,000 changes nothing in it.",
    sources: [
      budget("paragraphs 2.52 and 6.248"),
      {
        label: "HMRC, tax information and impact note on the cash ISA limit (17 September 2026)",
        href: "https://www.gov.uk/government/publications/reduction-in-the-cash-individual-savings-account-isa-limit",
      },
    ],
  },
  {
    id: "adjusted-triple-lock",
    order: 5,
    reason: "separately",
    name: "Adjusted Triple Lock for the State Pension",
    starts: "Apr 2030",
    changes:
      "The State Pension rises by the highest of 2.5%, inflation, or the rise keeping its April 2029 value against earnings.",
    reaches: "Current and future State Pension recipients, from April 2030.",
    household:
      "The pension still rises by at least 2.5% or inflation; it can rise by less than earnings from 2030.",
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. On the OBR's forecast the State Pension rises by 2.5% in both 2030-31 and 2031-32 under either rule, so the change does not affect spending in those years. The government estimates that State Pension spending would be £15 billion a year lower by the late 2030s than under the current Triple Lock; the OBR says the long-term effect depends heavily on how earnings, inflation and the 2.5% floor move relative to each other.",
    notModelled:
      "No change in our years: on the OBR's forecast the model gives the same State Pension as the current Triple Lock in every year to 2031-32.",
    seeAlso: {
      before: 'PolicyEngine models it to 2039-40 in a separate analysis, "',
      label: "The Burnham plan vs the triple lock",
      href: "https://www.policyengine.org/uk/triple-lock",
      after: '" (16 October 2026).',
    },
    sources: [budget("paragraphs 1.29 and 5.23"), obr("paragraphs 3.49 and 3.50")],
  },
  {
    id: "bank-surcharge",
    order: 6,
    reason: "outside",
    name: "Bank surcharge up from 3% to 6% for 15 months",
    starts: "1 Jan 2027",
    changes:
      "The bank surcharge rises from 3% to 6% until March 2028, helping fund the energy payment and electricity VAT cut.",
    reaches: "Banks that pay the surcharge.",
    household: "The surcharge is a tax on banks' profits, not on households.",
    costings: [{ row: 55, values: [305, 950, 220, 0, 0, 0] }],
    notModelled:
      "This dashboard measures household incomes, and does not trace taxes on company profits through to them.",
    sources: [budget("paragraphs 3.5 and 6.252")],
  },
  {
    id: "pubs-business-rates-relief",
    order: 7,
    reason: "outside",
    name: "Business rates relief for pubs and venues up to 35%",
    starts: "1 Apr 2027",
    changes:
      "Business rates relief for pubs, social clubs and most live music venues in England rises from 15% to 35%.",
    reaches: "Pubs, social clubs and most live music venues in England.",
    household:
      "Paid by businesses, not households; the Budget puts the relief at over £3,000 per pub on average next year.",
    costings: [{ row: 12, values: [5, -160, -115, -5, -5, -5] }],
    notModelled:
      "The model attributes business rates to households through shareholdings, as a share of total receipts, with no reliefs, so a relief for pubs changes nothing in it.",
    sources: [budget("paragraphs 3.21 and 6.189")],
  },
  {
    id: "online-marketplace-liability",
    order: 8,
    reason: "outside",
    name: "Online marketplaces to collect the tax on UK sellers' sales",
    starts: "1 Oct 2027",
    changes:
      "Online marketplaces collect VAT on sales by UK VAT-registered sellers, and those selling £90,000 a year or more there.",
    reaches: "UK businesses selling through online marketplaces above the VAT or £90,000 threshold.",
    household:
      "The VAT rate does not change: the marketplace collects the VAT these sellers owe.",
    costings: [{ row: 46, values: [0, 165, 320, 270, 250, 265] }],
    notModelled:
      "The model charges VAT on households' spending, scaled to total receipts, with no measure of VAT sellers leave unpaid, so collecting it changes nothing in the model.",
    sources: [budget("paragraphs 2.44 and 6.154")],
  },
  {
    id: "your-first-home",
    order: 9,
    reason: "outside",
    name: "Your First Home equity loan scheme",
    starts: "Apr 2027",
    changes:
      "A £4.7 billion scheme gives first-time buyers in England equity loans of up to 20%, with a 2.5% deposit.",
    reaches: "Around 70,000 first-time buyers (government estimate).",
    household:
      "A smaller deposit and a loan interest-free for five years; the Budget says the typical buyer saves hundreds a month.",
    costings: [
      {
        row: 37,
        values: [-15, 50, 95, 95, 95, 95],
        note: "Row 37 is the scheme's net income from developer fees; the loans themselves are financial transactions, in Table 6.2.",
      },
    ],
    notModelled: "The model has no home purchases or loans, and a loan is lent rather than paid, so household incomes do not change.",
    sources: [budget("paragraphs 5.5 and 6.113")],
  },
  {
    id: "national-living-wage",
    order: 10,
    reason: "data",
    name: "Minimum wage up 3.9%",
    starts: "1 Apr 2027",
    changes:
      "The National Living Wage rises from £12.71 to £13.21 an hour; younger and apprentice rates rise too.",
    reaches: "Around 2.3 million workers (government estimate, provisional).",
    household:
      "£910 a year more before tax for a full-time worker on it (Budget); less after tax and Universal Credit.",
    costings: [],
    noCosting: "Table 6.1 has no row for it.",
    notModelled:
      "The model's earnings grow with the OBR's average earnings forecast, so a minimum wage rise on its own does not change them.",
    sources: [budget("paragraphs 3.18 and 6.128")],
  },
  {
    id: "universal-credit-surplus-earnings",
    order: 11,
    reason: "data",
    name: "Universal Credit surplus earnings threshold kept at £2,500",
    starts: "1 Apr 2027",
    changes:
      "The Universal Credit surplus earnings threshold stays at £2,500 to March 2028, rather than falling to £300.",
    reaches:
      "Universal Credit claimants who reclaim within six months of a high-pay month.",
    household:
      "Earnings up to £2,500 above where an award stops, such as a bonus, are not carried into a new claim.",
    costings: [{ row: 8, values: [0, -140, 0, 0, 0, 0] }],
    notModelled:
      "The model works out Universal Credit over a whole year rather than month by month, so it has no surplus earnings rule.",
    sources: [budget("paragraph 6.11"), obr("Box 5.1")],
  },
  {
    id: "mileage-rates",
    order: 12,
    reason: "data",
    name: "Tax-free mileage rates raised",
    starts: "Apr 2026 / Apr 2027",
    changes:
      "The tax-free 55p a mile for the first 10,000 business miles is made permanent; above that, 25p rises to 35p.",
    reaches: "Around 2 million employees and 1 million self-employed people (government estimate).",
    household:
      "Less income tax for those driving for work: £120 a year for 6,000 miles, £300 for 15,000 (Treasury).",
    costings: [{ row: 5, values: [-30, -200, -220, -225, -235, -245] }],
    notModelled: "The model has no business mileage.",
    sources: [budget("paragraphs 3.14 and 6.213")],
  },
  {
    id: "company-car-tax",
    order: 13,
    reason: "data",
    name: "Company car tax up 1 point in 2030-31",
    starts: "6 Apr 2030",
    changes:
      "Company car tax percentages for 2030-31 are 1 point above 2029-30's in every band, up to 40%.",
    reaches: "Employees with a company car.",
    household:
      "More income tax on the same company car, from April 2030.",
    costings: [{ row: 86, values: [0, 0, 0, 0, 310, 345] }],
    notModelled: "The model has no company cars.",
    sources: [budget("paragraph 6.207")],
  },
  {
    id: "business-asset-disposal-relief",
    order: 14,
    reason: "data",
    name: "Business Asset Disposal Relief limit cut to £500,000",
    starts: "6 Apr 2027",
    changes:
      "The lifetime limit on gains taxed at Business Asset Disposal Relief's 18% falls from £1 million to £500,000.",
    reaches:
      "Sellers of qualifying businesses; three-quarters keep relief on their whole gain.",
    household:
      "Gains above £500,000 are taxed at up to 24% rather than 18%.",
    costings: [{ row: 60, values: [5, 60, 180, 255, 280, 305] }],
    notModelled:
      "The model has no record of relief used in earlier years, and its gains are calibrated to 2024-25, when disposals were unusually high.",
    sources: [
      budget("paragraphs 2.53 and 6.261"),
      { label: "HMRC, Capital Gains Tax rates", href: "https://www.gov.uk/capital-gains-tax/rates" },
    ],
  },
  {
    id: "first-time-buyer-isa",
    order: 15,
    reason: "data",
    name: "First Time Buyer ISA, and a lower Lifetime ISA charge",
    starts: "Oct 2026 / Apr 2029",
    changes:
      "A 25%-bonus First Time Buyer ISA replaces the Lifetime ISA in 2029; its charge over £450,000 falls to 20%.",
    reaches:
      "People saving for a first home, including existing Lifetime ISA holders.",
    household:
      "The bonus adds to a buyer's deposit, not their income, and is paid when the savings buy the home.",
    costings: [
      { row: 38, values: [0, 0, 0, 110, 110, 235], note: "Row 38 is the First Time Buyer ISA." },
      { row: 39, values: [-15, -20, -20, -25, -25, -25], note: "Row 39 is the lower Lifetime ISA withdrawal charge." },
    ],
    notModelled: "The model has no payments into ISAs, bonuses or home purchases.",
    sources: [budget("paragraphs 5.8, 5.9, 6.239 and 6.240")],
  },
  {
    id: "parental-allowance",
    order: 16,
    reason: "data",
    name: "Parental pay for self-employed fathers, partners and adopters",
    starts: "Apr 2029",
    changes:
      "Parental pay is extended to eligible self-employed fathers, partners and adopters in Great Britain, and some with irregular work.",
    reaches: "Over 150,000 parents a year (government estimate).",
    household:
      "A self-employed father or partner could get two weeks' pay after a birth, now up to £194 a week (Treasury).",
    costings: [{ row: 6, values: [0, 0, 0, -70, -70, -70] }],
    notModelled:
      "The eligibility rules are not yet published, and the model takes paternity pay and Maternity Allowance as reported in its data rather than working out who qualifies.",
    sources: [
      budget("paragraphs 3.20 and 6.12"),
      {
        label: "HM Treasury, release on parental pay and other measures (26 October 2026)",
        href: "https://www.gov.uk/government/news/everyday-fixes-to-make-life-easier-for-millions-of-britons",
      },
    ],
  },
  {
    id: "gas-standing-charges",
    order: 17,
    reason: "data",
    name: "Gas standing charges to be abolished",
    starts: "End of 2027 or later",
    changes:
      "The government has asked Ofgem to abolish gas standing charges in Great Britain, £108 a year on average.",
    reaches: "Around 23 million homes (government estimate).",
    household:
      "Before mitigation, bills fall for light users, rise for heavy ones; about 60% of households pay £45 less a year.",
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. Suppliers are to recover the standing charge's costs through gas unit rates instead.",
    notModelled:
      "The model counts taxes on energy bills, not how suppliers set prices, and the start date and mitigation are not yet set.",
    sources: [
      budget("paragraphs 3.9 and 6.25"),
      {
        label: "Prime Minister's Office, HM Treasury and Department for Energy Security and Net Zero, release on gas standing charges (28 October 2026)",
        href: "https://www.gov.uk/government/news/chancellor-abolishes-standing-charges-on-gas-bills-to-make-payments-fairer",
      },
    ],
  },
];
