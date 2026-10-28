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
      "The Budget puts the rise for a full-time worker on the National Living Wage at £910 a year before tax, for the same hours. How much of that reaches net income depends on income tax, National Insurance and, for families on Universal Credit, the award, which falls as earnings rise.",
    costings: [],
    noCosting: "Table 6.1 has no row for it.",
    notModelled:
      "The model's earnings come from survey data grown in line with the OBR's forecast for average earnings, so a rise in the minimum wage on its own does not change them.",
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
      "Earnings more than £2,500 above the level at which an award stops are carried into the new claim, where they can reduce its first payments. With the threshold at £2,500 rather than £300, earnings between £300 and £2,500 above that level, such as from a one-off bonus, are not carried forward.",
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
      "A self-employed father, partner or adopter could receive pay for the weeks after a birth or adoption. For fathers and partners the Treasury describes two weeks of support, currently worth up to £194 a week. The detailed eligibility rules are still to be published.",
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
      "It lowers income tax for people who drive their own vehicle for work. The Treasury's examples, for a basic rate taxpayer in 2027-28: £120 a year less tax for 6,000 business miles, and up to £300 less for 15,000 miles.",
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
      "It changes a household's gas bill, not its income. The fixed charge moves into the price of each unit of gas, so, before any mitigation, bills fall for households that use little gas and rise for those that use a lot. The Treasury estimates that around 60% of account-holding households would pay about £45 a year less on average; it gives no figure for the rest.",
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. Suppliers are to recover the standing charge's costs through gas unit rates instead.",
    notModelled:
      "The model counts taxes on energy bills, such as VAT, and payments towards them, but not how suppliers set their prices, and this change moves part of the gas price from a fixed charge into unit rates. The start date and the mitigation are not yet set.",
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
      "The bonus adds to a buyer's deposit rather than to their income. In the new ISA it is paid on the account's value when the savings are withdrawn for the purchase, rather than on each contribution as in the Lifetime ISA.",
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
      "The pension rises each April by at least the higher of 2.5% and inflation. If those rises take it above its April 2029 value relative to earnings, it then rises by less than earnings in years when earnings grow faster, until it is back at that value.",
    costings: [],
    noCosting:
      "Table 6.1 has no row for it. On the OBR's forecast the State Pension rises by 2.5% in both 2030-31 and 2031-32 under either rule, so the change does not affect spending in those years. The government estimates that State Pension spending would be £15 billion a year lower by the late 2030s than under the current Triple Lock; the OBR says the long-term effect depends heavily on how earnings, inflation and the 2.5% floor move relative to each other.",
    notModelled:
      "On the OBR's forecast, which the dashboard's figures follow, it gives the same State Pension as the current Triple Lock in every year this dashboard covers, to 2031-32, so the model shows no change.",
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
      "An employee with a company car pays income tax on its taxable value, a percentage of its list price set by its emissions. A 1 percentage point rise in that percentage raises the tax on the same car.",
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
      "A person whose qualifying gains over their lifetime pass £500,000 pays the main Capital Gains Tax rates on the part above it, rather than the relief's 18%: 18% within the basic rate band and 24% above it.",
    costings: [{ row: 60, values: [5, 60, 180, 255, 280, 305] }],
    notModelled:
      "The model applies the lifetime limit to a single year's gains, with no record of relief used in earlier years, and its capital gains are calibrated to 2024-25, when disposals were unusually high ahead of a rise in the relief's rate.",
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
      "The duty is charged on the businesses that run the machines, not on players. Any effect on households would come through the stakes and prizes those venues offer, or through the incomes of their owners and staff.",
    costings: [{ row: 56, values: [0, 135, 150, 145, 145, 145] }],
    notModelled: "The data this dashboard uses hold no household spending on gambling.",
    sources: [budget("paragraphs 2.49 and 6.225")],
  },
];

/**
 * What the list leaves out, in one line after it. Set to null to drop it.
 */
export const OTHER_MEASURES_NOTE =
  "Table 6.1 also lists measures this section leaves out: tariff suspensions on food and heating oil, which change duties paid by importers; an equity loan scheme for first-time buyers, which lends rather than pays; and changes to other taxes on businesses, among them business rates reliefs and a temporary rise in the Bank Corporation Tax Surcharge. Machine Games Duty is listed because the model counts it against households' spending on gambling.";
