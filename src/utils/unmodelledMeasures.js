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
 * Each card's words are short (Vahid, 29 Oct: bullets, not paragraphs):
 * `summary`, the change itself in 15 words at most, and `points`, one
 * bullet of 12 words at most under each of UNMODELLED_POINT_LABELS: what
 * changes for a household or person (labelled "For a household": the
 * picture above it is headed What changes), who it reaches, and why we
 * leave it out. None repeats the summary or Starts.
 *
 * `costings` holds the measure's Table 6.1 rows (£ million, 2026-27 to
 * 2031-32; positive is a gain to the Exchequer, negative a cost), each with
 * an optional `note` shown under the table. A measure with no row has
 * `noCosting` instead, saying what the documents give in its place.
 * `seeAlso` links PolicyEngine's own published work that models the
 * measure, after the reason this dashboard does not.
 */
/**
 * The groups the cards are shown in, by why the dashboard does not model a
 * measure, in order (#297), each with a line under its title; each measure
 * names its `reason`. A card's "Why we leave it out" point keeps its
 * specific reason.
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

/** The labels of every card's points, in order. */
export const UNMODELLED_POINT_LABELS = ["For a household", "Who it reaches", "Why we leave it out"];

export const UNMODELLED_MEASURES = [
  {
    id: "savings-income-tax",
    order: 1,
    reason: "coming-soon",
    name: "Tax on savings interest up 2 points",
    starts: "6 Apr 2027",
    summary: "Raises tax on savings income by 2 points, to 24%, 44% and 49%.",
    points: [
      { label: "For a household", text: "Each £100 of taxable interest pays £2 more tax." },
      { label: "Who it reaches", text: "People with taxable savings interest across the UK." },
      { label: "Why we leave it out", text: "Held back: calibrated on another basis, our taxable interest is too low." },
    ],
    costings: [{ row: 62, values: [15, 125, 555, 520, 555, 590] }],
    sources: [budget("paragraph 6.247")],
  },
  {
    id: "machine-games-duty",
    order: 2,
    reason: "coming-soon",
    name: "Machine Games Duty up from 20% to 25%",
    starts: "1 Apr 2027",
    summary: "Machines with stakes over £1 or prizes over £100 pay 25% duty, up from 20%.",
    points: [
      { label: "For a household", text: "Businesses pay; any household effect comes via stakes, prizes, owners or staff." },
      { label: "Who it reaches", text: "Adult gaming centres and other venues with these machines." },
      { label: "Why we leave it out", text: "Our data hold no household spending on gambling." },
    ],
    costings: [
      {
        row: 56,
        values: [0, 135, 150, 145, 145, 145],
        note: "Row 56 also covers moving the duty to machine suppliers from 1 April 2028: £20m in 2028-29, £15m a year after.",
      },
    ],
    sources: [budget("paragraphs 2.49 and 6.225")],
  },
  {
    id: "cash-isa-limit",
    order: 3,
    reason: "coming-soon",
    name: "Cash ISA limit kept at £20,000",
    starts: "6 Apr 2027",
    summary: "Drops a planned cut in the under-65 cash ISA limit to £12,000; it stays £20,000.",
    points: [
      { label: "For a household", text: "Interest stays tax-free on up to £20,000 a year of new savings." },
      { label: "Who it reaches", text: "Under-65 cash ISA savers; 22% paid in over £12,000 in 2022-23." },
      { label: "Why we leave it out", text: "The model has no ISA payments, so never had the cut." },
    ],
    costings: [{ row: 11, values: [0, -5, -20, -35, -50, -70] }],
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
    order: 4,
    reason: "separately",
    name: "Adjusted Triple Lock for the State Pension",
    starts: "Apr 2030",
    summary: "The State Pension rises by the highest of 2.5%, inflation or an earnings-based rise.",
    points: [
      { label: "For a household", text: "Can rise less than earnings, holding only April 2029's value against them." },
      { label: "Who it reaches", text: "Current and future State Pension recipients." },
      { label: "Why we leave it out", text: "No change to 2031-32: on the OBR's forecast both rules give 2.5%." },
    ],
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. On the OBR's forecast the State Pension rises by 2.5% in both 2030-31 and 2031-32 under either rule, so the change does not affect spending in those years. The government estimates that State Pension spending would be £15 billion a year lower by the late 2030s than under the current Triple Lock; the OBR says the long-term effect depends heavily on how earnings, inflation and the 2.5% floor move relative to each other.",
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
    order: 5,
    reason: "outside",
    name: "Bank surcharge up from 3% to 6% for 15 months",
    starts: "1 Jan 2027",
    summary: "Raises the bank surcharge from 3% to 6% until March 2028.",
    points: [
      { label: "For a household", text: "Taxes banks' profits; helps fund the energy payment and electricity VAT cut." },
      { label: "Who it reaches", text: "Banks that pay the surcharge." },
      { label: "Why we leave it out", text: "We don't trace taxes on company profits through to households." },
    ],
    costings: [{ row: 55, values: [305, 950, 220, 0, 0, 0] }],
    sources: [budget("paragraphs 3.5 and 6.252")],
  },
  {
    id: "pubs-business-rates-relief",
    order: 6,
    reason: "outside",
    name: "Business rates relief for pubs and venues up to 35%",
    starts: "1 Apr 2027",
    summary: "Raises business rates relief for pubs and venues in England from 15% to 35%.",
    points: [
      { label: "For a household", text: "A business gain: over £3,000 a pub on average next year (Budget)." },
      { label: "Who it reaches", text: "Pubs, social clubs and most live music venues in England." },
      { label: "Why we leave it out", text: "The model spreads business rates by shareholdings, with no reliefs." },
    ],
    costings: [{ row: 12, values: [5, -160, -115, -5, -5, -5] }],
    sources: [budget("paragraphs 3.21 and 6.189")],
  },
  {
    id: "online-marketplace-liability",
    order: 7,
    reason: "outside",
    name: "Online marketplaces to collect the tax on UK sellers' sales",
    starts: "1 Oct 2027",
    summary: "Online marketplaces collect the VAT on UK sellers' sales through them.",
    points: [
      { label: "For a household", text: "The VAT rate does not change; only who collects it." },
      { label: "Who it reaches", text: "UK VAT-registered sellers, and those selling £90,000 a year or more there." },
      { label: "Why we leave it out", text: "The model has no measure of VAT that sellers leave unpaid." },
    ],
    costings: [{ row: 46, values: [0, 165, 320, 270, 250, 265] }],
    sources: [budget("paragraphs 2.44 and 6.154")],
  },
  {
    id: "your-first-home",
    order: 8,
    reason: "outside",
    name: "Your First Home equity loan scheme",
    starts: "Apr 2027",
    summary: "A £4.7 billion scheme of equity loans up to 20% for first-time buyers in England.",
    points: [
      { label: "For a household", text: "2.5% deposit; five interest-free years; saves hundreds a month, says the Budget." },
      { label: "Who it reaches", text: "Around 70,000 first-time buyers (government estimate)." },
      { label: "Why we leave it out", text: "A loan is lent, not paid, so household incomes do not change." },
    ],
    costings: [
      {
        row: 37,
        values: [-15, 50, 95, 95, 95, 95],
        note: "Row 37 is the scheme's net income from developer fees; the loans themselves are financial transactions, in Table 6.2.",
      },
    ],
    sources: [budget("paragraphs 5.5 and 6.113")],
  },
  {
    id: "national-living-wage",
    order: 9,
    reason: "data",
    name: "Minimum wage up 3.9%",
    starts: "1 Apr 2027",
    summary: "Raises the hourly National Living Wage from £12.71 to £13.21; younger and apprentice rates too.",
    points: [
      { label: "For a household", text: "£910 a year more full-time, before tax and Universal Credit (Budget)." },
      { label: "Who it reaches", text: "Around 2.3 million workers (government estimate, provisional)." },
      { label: "Why we leave it out", text: "Earnings grow with the OBR's average earnings forecast, not the minimum wage." },
    ],
    costings: [],
    noCosting: "Table 6.1 has no row for it.",
    sources: [budget("paragraphs 3.18 and 6.128")],
  },
  {
    id: "universal-credit-surplus-earnings",
    order: 10,
    reason: "data",
    name: "Universal Credit surplus earnings threshold kept at £2,500",
    starts: "1 Apr 2027",
    summary: "Keeps Universal Credit's surplus earnings threshold at £2,500 to March 2028, rather than £300.",
    points: [
      { label: "For a household", text: "Excess earnings up to £2,500, such as a bonus, aren't carried forward." },
      { label: "Who it reaches", text: "Claimants reclaiming within six months of earnings ending their award." },
      { label: "Why we leave it out", text: "The model works out Universal Credit yearly, not month by month." },
    ],
    costings: [{ row: 8, values: [0, -140, 0, 0, 0, 0] }],
    sources: [budget("paragraph 6.11"), obr("paragraph 3.44")],
  },
  {
    id: "mileage-rates",
    order: 11,
    reason: "data",
    name: "Tax-free mileage rates raised",
    starts: "Apr 2026 / Apr 2027",
    summary: "Makes 55p a mile permanent up to 10,000 business miles; above that, 25p becomes 35p.",
    points: [
      { label: "For a household", text: "Less tax: £120 a year for 6,000 miles, £300 for 15,000 (Treasury)." },
      { label: "Who it reaches", text: "Around 2 million employees and 1 million self-employed (government estimate)." },
      { label: "Why we leave it out", text: "The model has no business mileage." },
    ],
    costings: [{ row: 5, values: [-30, -200, -220, -225, -235, -245] }],
    sources: [budget("paragraphs 3.14 and 6.213")],
  },
  {
    id: "company-car-tax",
    order: 12,
    reason: "data",
    name: "Company car tax up 1 point in 2030-31",
    starts: "6 Apr 2030",
    summary: "Sets every 2030-31 company car tax band 1 point above 2029-30's, up to 40%.",
    points: [
      { label: "For a household", text: "More income tax on the same company car." },
      { label: "Who it reaches", text: "Employees with a company car." },
      { label: "Why we leave it out", text: "The model has no company cars." },
    ],
    costings: [{ row: 86, values: [0, 0, 0, 0, 310, 345] }],
    sources: [budget("paragraph 6.207")],
  },
  {
    id: "business-asset-disposal-relief",
    order: 13,
    reason: "data",
    name: "Business Asset Disposal Relief limit cut to £500,000",
    starts: "6 Apr 2027",
    summary: "Halves the lifetime limit on gains taxed at 18%, from £1 million to £500,000.",
    points: [
      { label: "For a household", text: "Gains above £500,000 are taxed at up to 24% rather than 18%." },
      { label: "Who it reaches", text: "Sellers of qualifying businesses; three-quarters keep relief on their whole gain." },
      { label: "Why we leave it out", text: "No record of relief already used; gains calibrated to 2024-25's high disposals." },
    ],
    costings: [{ row: 60, values: [5, 60, 180, 255, 280, 305] }],
    sources: [
      budget("paragraphs 2.53 and 6.261"),
      { label: "HMRC, Capital Gains Tax rates", href: "https://www.gov.uk/capital-gains-tax/rates" },
    ],
  },
  {
    id: "first-time-buyer-isa",
    order: 14,
    reason: "data",
    name: "First Time Buyer ISA, and a lower Lifetime ISA charge",
    starts: "Oct 2026 / Apr 2029",
    summary: "A 25%-bonus ISA replaces the Lifetime ISA, whose charge over £450,000 falls to 20%.",
    points: [
      { label: "For a household", text: "The bonus adds to the deposit, not income, paid at purchase." },
      { label: "Who it reaches", text: "People saving for a first home, Lifetime ISA holders included." },
      { label: "Why we leave it out", text: "The model has no ISA payments, bonuses or home purchases." },
    ],
    costings: [
      { row: 38, values: [0, 0, 0, 110, 110, 235], note: "Row 38 is the First Time Buyer ISA." },
      { row: 39, values: [-15, -20, -20, -25, -25, -25], note: "Row 39 is the lower Lifetime ISA withdrawal charge." },
    ],
    sources: [budget("paragraphs 5.8, 5.9, 6.239 and 6.240")],
  },
  {
    id: "parental-allowance",
    order: 15,
    reason: "data",
    name: "Parental pay for self-employed fathers, partners and adopters",
    starts: "Apr 2029",
    summary: "Extends parental pay to self-employed fathers, partners, adopters and some irregular workers in Great Britain.",
    points: [
      { label: "For a household", text: "Fathers and partners: two weeks at up to £194 a week (Treasury)." },
      { label: "Who it reaches", text: "Over 150,000 parents a year (government estimate)." },
      { label: "Why we leave it out", text: "Rules not final; paternity pay and Maternity Allowance are taken as reported." },
    ],
    costings: [{ row: 6, values: [0, 0, 0, -70, -70, -70] }],
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
    order: 16,
    reason: "data",
    name: "Gas standing charges to be abolished",
    starts: "End of 2027 or later",
    summary: "The government asks Ofgem to abolish gas standing charges, £108 a year on average.",
    points: [
      { label: "For a household", text: "Before mitigation, about 60% save £45 a year; higher users pay more." },
      { label: "Who it reaches", text: "Around 23 million homes in Great Britain (government estimate)." },
      { label: "Why we leave it out", text: "The model counts energy taxes, not supplier prices; start and mitigation unset." },
    ],
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. Suppliers are to recover the standing charge's costs through gas unit rates instead.",
    sources: [
      budget("paragraphs 3.9 and 6.25"),
      {
        label: "Prime Minister's Office, HM Treasury and Department for Energy Security and Net Zero, release on gas standing charges (28 October 2026)",
        href: "https://www.gov.uk/government/news/chancellor-abolishes-standing-charges-on-gas-bills-to-make-payments-fairer",
      },
    ],
  },
];
