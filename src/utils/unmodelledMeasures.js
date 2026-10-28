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
 * One entry per measure, in the order shown: pay and benefits, then bills
 * and travel, savings, pensions and other taxes.
 *
 * `costings` holds the measure's Table 6.1 rows (£ million, 2026-27 to
 * 2031-32; positive is a gain to the Exchequer, negative a cost), each with
 * an optional `note` shown under the table. A measure with no row has
 * `noCosting` instead, saying what the documents give in its place.
 * `seeAlso` links PolicyEngine's own published work that models the
 * measure, after the reason this dashboard does not.
 */
export const UNMODELLED_MEASURES = [
  {
    id: "national-living-wage",
    name: "National Living Wage and National Minimum Wage up 3.9%",
    starts: "1 April 2027",
    changes:
      "The National Living Wage rises from £12.71 to £13.21 an hour. The rate for 18 to 20-year-olds rises to £11.27, the rate for 16 and 17-year-olds and eligible apprentices to £8.31, and the accommodation offset to £11.53 a day. Employers pay the new rates.",
    reaches: "Around 2.3 million workers, a provisional government estimate.",
    household:
      "£910 a year more before tax for a full-time worker on the National Living Wage (Budget); less after tax and, on Universal Credit, a lower award.",
    costings: [],
    noCosting: "Table 6.1 has no row for it.",
    notModelled:
      "The model's earnings grow with the OBR's average earnings forecast, so a minimum wage rise on its own does not change them.",
    sources: [budget("paragraphs 3.18 and 6.128")],
  },
  {
    id: "universal-credit-surplus-earnings",
    name: "Universal Credit surplus earnings threshold kept at £2,500",
    starts: "1 April 2027, for one year",
    changes:
      "The surplus earnings threshold for Universal Credit claimants in Great Britain stays at £2,500 for a further year, to the end of March 2028, rather than falling to £300 as legislated.",
    reaches:
      "Universal Credit claimants whose pay in a month is high enough to end their award, and who claim again within six months.",
    household:
      "Earnings up to £2,500 above the level at which an award stops, such as a one-off bonus, are not carried into a new claim to reduce its first payments.",
    costings: [{ row: 8, values: [0, -140, 0, 0, 0, 0] }],
    notModelled:
      "The model works out Universal Credit over a whole year rather than month by month, so it has no surplus earnings rule.",
    sources: [budget("paragraph 6.11"), obr("Box 5.1")],
  },
  {
    id: "parental-allowance",
    name: "Parental Allowance for fathers, partners and adopters",
    starts: "April 2029",
    changes:
      "Parental pay is extended to eligible self-employed fathers, partners and adopters in Great Britain, who cannot claim it today. It also covers people who do not qualify for statutory paternity or adoption pay because they started work recently, are recently unemployed or have a broken or irregular pattern of work, if they have enough work and earnings history.",
    reaches: "Over 150,000 parents a year, on the government's estimate.",
    household:
      "A self-employed father or partner could receive two weeks of pay after a birth, currently worth up to £194 a week, on the Treasury's description.",
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
    id: "mileage-rates",
    name: "Tax-free mileage rates raised",
    starts: "6 April 2026 and 6 April 2027",
    changes:
      "For employees and self-employed people who use their own car or van for work, the tax-free rate for the first 10,000 business miles is 55p a mile, up from 45p: a temporary rate from 6 April 2026, now made permanent. Above 10,000 miles it rises from 25p to 35p a mile from 6 April 2027.",
    reaches: "Around 2 million employees and 1 million self-employed people, on the government's estimate.",
    household:
      "Less income tax for people driving their own vehicle for work: £120 a year for 6,000 business miles, up to £300 for 15,000 (Treasury, basic rate, 2027-28).",
    costings: [{ row: 5, values: [-30, -200, -220, -225, -235, -245] }],
    notModelled: "The model has no business mileage.",
    sources: [budget("paragraphs 3.14 and 6.213")],
  },
  {
    id: "bus-fare-cap",
    name: "Single bus fares capped at £2 in England outside London",
    starts: "1 January 2027, for one year",
    changes:
      "Single fares on participating bus services in England outside London are capped at £2 for one year from 1 January 2027. Until then most single fares there are capped at £3.",
    reaches: "Bus passengers in England outside London, on participating services.",
    household:
      "For a household that pays single fares above £2 on participating services, the same journeys cost less; its income does not change.",
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
    id: "gas-standing-charges",
    name: "Gas standing charges to be abolished",
    starts: "By the end of 2027, or as soon as possible after",
    changes:
      "The government has asked Ofgem to abolish standing charges on domestic gas bills in Great Britain. The Budget puts the standing charge at £108 a year on average for a typical billpayer. Suppliers are to recover the costs through gas unit rates instead, and the government will set out targeted mitigation. Electricity standing charges are to be reformed, with details in 2027.",
    reaches: "Around 23 million homes, on the government's estimate.",
    household:
      "Bills fall for low gas users and rise for high ones, before mitigation. The Treasury puts around 60% of account-holding households at about £45 a year less.",
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
  {
    id: "cash-isa-limit",
    name: "Cash ISA limit kept at £20,000",
    starts: "6 April 2027",
    changes:
      "A planned cut in the annual cash ISA limit, to £12,000 for savers under 65 from 6 April 2027, does not go ahead: the limit stays at £20,000 for everyone.",
    reaches:
      "Savers under 65 who would pay more than £12,000 a year into cash ISAs. On HMRC's figures, 22% of cash ISA subscribers under 65 paid in more than £12,000 in 2022-23.",
    household:
      "Interest in a cash ISA is free of income tax. Savers under 65 can keep paying up to £20,000 a year into one, rather than £12,000.",
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
    id: "first-time-buyer-isa",
    name: "First Time Buyer ISA, and a lower Lifetime ISA withdrawal charge",
    starts: "29 October 2026 (charge) and 6 April 2029 (new ISA)",
    changes:
      "From 6 April 2029 a First Time Buyer ISA replaces the Lifetime ISA for new savers. It takes up to £4,000 a year and pays a 25% government bonus, capped at £20,000, when the savings go towards a first home worth up to £450,000; it has no upper age limit. From 29 October 2026, Lifetime ISA holders buying a first home above the £450,000 cap pay a 20% withdrawal charge rather than 25%.",
    reaches:
      "People saving for a first home. Existing Lifetime ISA holders can keep paying into and using their accounts, with the lower charge on homes above £450,000.",
    household:
      "The bonus adds to a buyer's deposit, not their income, and is paid when the savings are withdrawn for the purchase.",
    costings: [
      { row: 38, values: [0, 0, 0, 110, 110, 235], note: "Row 38 is the First Time Buyer ISA." },
      { row: 39, values: [-15, -20, -20, -25, -25, -25], note: "Row 39 is the lower Lifetime ISA withdrawal charge." },
    ],
    notModelled: "The model has no payments into ISAs, bonuses or home purchases.",
    sources: [budget("paragraphs 5.8, 5.9, 6.239 and 6.240")],
  },
  {
    id: "adjusted-triple-lock",
    name: "Adjusted Triple Lock for the State Pension",
    starts: "April 2030",
    changes:
      "The State Pension rises each year by the highest of 2.5%, inflation, or the increase needed to keep its value relative to earnings at the level reached in April 2029. Until then it rises by the highest of 2.5%, inflation or earnings growth.",
    reaches: "Current and future State Pension recipients, from April 2030.",
    household:
      "The pension rises each April by at least the higher of 2.5% and inflation, and by less than earnings when it is above its April 2029 value relative to earnings.",
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. On the OBR's forecast the State Pension rises by 2.5% in both 2030-31 and 2031-32 under either rule, so the change does not affect spending in those years. The government estimates that State Pension spending would be £15 billion a year lower by the late 2030s than under the current Triple Lock; the OBR says the long-term effect depends heavily on how earnings, inflation and the 2.5% floor move relative to each other.",
    notModelled:
      "On the OBR's forecast it gives the same State Pension as the current Triple Lock in every year to 2031-32, so the model shows no change.",
    seeAlso: {
      before: 'PolicyEngine models it to 2039-40 in a separate analysis, "',
      label: "The Burnham plan vs the triple lock",
      href: "https://www.policyengine.org/uk/triple-lock",
      after: '" (16 October 2026).',
    },
    sources: [budget("paragraphs 1.29 and 5.23"), obr("paragraphs 3.49 and 3.50")],
  },
  {
    id: "company-car-tax",
    name: "Company car tax rates up 1 percentage point in 2030-31",
    starts: "6 April 2030",
    changes:
      "The appropriate percentages for company cars in 2030-31 are 1 percentage point above those for 2029-30 in every band: 10% rather than 9% for zero-emission cars and 20% rather than 19% for cars emitting 1 to 50g CO2/km, up to a maximum of 40%.",
    reaches: "Employees with a company car.",
    household:
      "An employee pays more income tax on the same company car: the share of its list price that is taxed rises by 1 percentage point.",
    costings: [{ row: 86, values: [0, 0, 0, 0, 310, 345] }],
    notModelled: "The model has no company cars.",
    sources: [budget("paragraph 6.207")],
  },
  {
    id: "business-asset-disposal-relief",
    name: "Business Asset Disposal Relief lifetime limit cut to £500,000",
    starts: "6 April 2027",
    changes:
      "The lifetime limit on gains that qualify for Business Asset Disposal Relief, which charges Capital Gains Tax at 18% on qualifying disposals, falls from £1 million to £500,000.",
    reaches:
      "People selling all or part of a qualifying business. The government says three-quarters of claimants will receive the relief on their entire gain; for the others, gains above £500,000 are taxed at the main rates.",
    household:
      "Lifetime qualifying gains above £500,000 pay the main Capital Gains Tax rates (18% or 24%) rather than the relief's 18%.",
    costings: [{ row: 60, values: [5, 60, 180, 255, 280, 305] }],
    notModelled:
      "The model has no record of relief used in earlier years, and its gains are calibrated to 2024-25, when disposals were unusually high.",
    sources: [
      budget("paragraphs 2.53 and 6.261"),
      { label: "HMRC, Capital Gains Tax rates", href: "https://www.gov.uk/capital-gains-tax/rates" },
    ],
  },
  {
    id: "machine-games-duty",
    name: "Machine Games Duty up from 20% to 25% on higher-stake machines",
    starts: "1 April 2027",
    changes:
      "The duty on machine games with stakes over £1 or prizes over £100 rises from 20% to 25%. From 1 April 2028, machine suppliers become liable for the duty on machines they own under profit-sharing arrangements.",
    reaches: "Venues with higher-stake machines, which the Budget says are commonly found in adult gaming centres.",
    household:
      "The duty is charged on the businesses that run the machines, not on players.",
    costings: [{ row: 56, values: [0, 135, 150, 145, 145, 145] }],
    notModelled: "The data this dashboard uses hold no household spending on gambling.",
    sources: [budget("paragraphs 2.49 and 6.225")],
  },
  {
    id: "online-marketplace-liability",
    name: "Online marketplaces to collect the tax on UK sellers' sales",
    starts: "1 October 2027",
    changes:
      "Online marketplaces become responsible for collecting VAT on sales by UK VAT-registered businesses, and by any other UK business with sales of at least £90,000 a year on the platform. The rules do not apply to personal sales, second-hand goods or sales between businesses.",
    reaches: "UK businesses selling through online marketplaces that are VAT-registered or sell at least £90,000 a year on a platform.",
    household:
      "The VAT rate does not change: the marketplace collects the VAT these sellers owe. Personal sales and second-hand goods are outside the rules.",
    costings: [{ row: 46, values: [0, 165, 320, 270, 250, 265] }],
    notModelled:
      "The model charges VAT on households' spending as if sellers pay it in full, so collecting unpaid VAT changes nothing in it.",
    sources: [budget("paragraphs 2.44 and 6.154")],
  },
  {
    id: "pubs-business-rates-relief",
    name: "Business rates relief for pubs, social clubs and live music venues up to 35%",
    starts: "1 April 2027",
    changes:
      "Business rates relief for pubs, social clubs and live music venues in England rises by 20 percentage points, from 15% to 35%. Live music venues with a rateable value of £1 million or more keep the 15% relief.",
    reaches: "Pubs, social clubs and all but the very largest live music venues in England.",
    household:
      "Business rates are paid by businesses on their property, not by households. The Budget puts the relief at an average of over £3,000 per pub next year.",
    costings: [{ row: 12, values: [5, -160, -115, -5, -5, -5] }],
    notModelled:
      "This dashboard measures household incomes, and does not trace taxes on business property through to them.",
    sources: [budget("paragraphs 3.21 and 6.189")],
  },
  {
    id: "your-first-home",
    name: "Your First Home equity loan scheme",
    starts: "April 2027",
    changes:
      "A new £4.7 billion scheme gives first-time buyers in England government equity loans of up to 20%, with a deposit of 2.5% (15% at most) and a five-year interest-free period. Income caps are £110,000 a household outside London and £140,000 inside it. Price caps follow local median prices, with £650,000 in inner London and £500,000 in outer London.",
    reaches: "Around 70,000 first-time buyers, on the government's estimate.",
    household:
      "A smaller deposit and a government loan of up to 20%, interest-free for five years: hundreds of pounds a month for the typical buyer, the Budget says.",
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
    id: "bank-surcharge",
    name: "Bank Corporation Tax Surcharge up from 3% to 6% for 15 months",
    starts: "1 January 2027, for 15 months",
    changes:
      "The surcharge on banks' profits rises from 3% to 6% from 1 January 2027 to 31 March 2028, and returns to 3% from 1 April 2028. It helps fund the £100 energy payment to households and the zero rate of VAT on household electricity.",
    reaches: "Banks that pay the surcharge.",
    household: "The surcharge is a tax on banks' profits, not on households.",
    costings: [{ row: 55, values: [305, 950, 220, 0, 0, 0] }],
    notModelled:
      "This dashboard measures household incomes, and does not trace taxes on company profits through to them.",
    sources: [budget("paragraphs 3.5 and 6.252")],
  },
];
