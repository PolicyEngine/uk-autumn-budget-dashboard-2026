/**
 * One small picture of what each Budget measure the dashboard does not
 * model changes, drawn on its Policies card under "What changes"
 * (components/policies/UnmodelledVisual.jsx). Each entry names a `kind` (the
 * drawing) and the values it draws, and says the same in `alt`, the text
 * a screen reader hears in its place.
 *
 * Every figure is the entry's own (utils/unmodelledMeasures.js: its words,
 * or its card's values in utils/unmodelledCards.js) or a sum of them,
 * listed in `derived` with how it is worked out.
 * UnmodelledVisual.test.jsx checks each number drawn against those.
 *
 * Tones: "gain" (teal) where households or the people it reaches gain,
 * "loss" (amber) where they pay more; what stays as it was is grey.
 */

export const UNMODELLED_VISUALS = {
  // "capped at £2; most are capped at £3 until then", from 1 Jan 2027 to Dec 2027
  "bus-fare-cap": {
    kind: "columns",
    caption: "Single bus fare cap",
    columns: [
      { label: "Until 1 Jan 2027", value: 3, text: "£3" },
      { label: "1 Jan to Dec 2027", value: 2, text: "£2", tone: "gain" },
    ],
    alt: "Single bus fare cap: £3 until 1 January 2027, then £2 from 1 January to December 2027.",
  },
  // "rise by 2 points across the UK, to 24%, 44% and 49%"
  "savings-income-tax": {
    kind: "bars",
    caption: "Income tax rates on savings income",
    max: 55,
    rows: [
      { label: "Basic rate", base: 22, value: 24, text: "22% → 24%" },
      { label: "Higher rate", base: 42, value: 44, text: "42% → 44%" },
      { label: "Additional rate", base: 47, value: 49, text: "47% → 49%" },
    ],
    tone: "loss",
    key: { base: "Until 6 Apr 2027", add: "2 points more" },
    derived: { "22, 42, 47": "each rate 2 points below its new 24%, 44% and 49% (paragraph 6.247)" },
    alt: "Income tax rates on savings income rise by 2 points from 6 April 2027: basic rate 22% to 24%, higher rate 42% to 44%, additional rate 47% to 49%.",
  },
  // "rises from 20% to 25%"
  "machine-games-duty": {
    kind: "bars",
    caption: "Machine Games Duty rate, higher-stake machines",
    max: 32,
    rows: [
      { label: "Until 1 Apr 2027", value: 20, text: "20%", plain: true },
      { label: "From 1 Apr 2027", base: 20, value: 25, text: "25%" },
    ],
    tone: "loss",
    alt: "Machine Games Duty on higher-stake machines: 20% until 1 April 2027, 25% from then.",
  },
  // "A planned cut ... to £12,000 for under-65s does not go ahead; it stays at £20,000"
  "cash-isa-limit": {
    kind: "bars",
    caption: "Cash ISA limit for under-65s, a year",
    max: 24000,
    rows: [
      { label: "Planned", value: 12000, text: "£12,000", plain: true, dashed: true, ghost: { to: 20000, text: "cut not made" } },
      { label: "Kept", value: 20000, text: "£20,000", tone: "gain" },
    ],
    alt: "Cash ISA limit for under-65s: a cut to £12,000 a year was planned; it is not made, and the limit stays at £20,000.",
  },
  // "the highest of 2.5%, inflation, or the rise keeping its April 2029 value against earnings"
  "adjusted-triple-lock": {
    kind: "highest",
    caption: "Each year's State Pension rise, from April 2030",
    inputs: [
      { label: "2.5%" },
      { label: "Inflation" },
      { label: "Its April 2029 value against earnings", was: "Was: earnings growth", tone: "loss" },
    ],
    result: "The highest of the three",
    alt: "From April 2030 the State Pension rises by the highest of three: 2.5%, inflation, or the rise keeping its April 2029 value against earnings, which replaces earnings growth.",
  },
  // "rises from 3% to 6% until March 2028"; "Bank surcharge up from 3% to 6% for 15 months"
  "bank-surcharge": {
    kind: "timeline",
    caption: "Bank surcharge rate",
    from: { label: "Jan 2027" },
    to: { label: "Mar 2028" },
    before: 3,
    after: 6,
    span: "15 months",
    tone: "loss",
    alt: "Bank surcharge rate: 3% before January 2027, 6% from January 2027 to March 2028 (15 months), then 3% again.",
  },
  // "from 15% to 35%"
  "pubs-business-rates-relief": {
    kind: "bill",
    caption: "A pub's business rates bill",
    rows: [
      { label: "Until 1 Apr 2027", relief: 15 },
      { label: "From 1 Apr 2027", relief: 35, tone: "gain" },
    ],
    alt: "Business rates relief for pubs and venues: 15% of the bill until 1 April 2027, 35% from then; the rest of the bill is paid.",
  },
  // "Online marketplaces collect VAT on sales by UK VAT-registered sellers ..."
  "online-marketplace-liability": {
    kind: "flow",
    caption: "Who pays HMRC the VAT on a seller's sales",
    lanes: [
      { label: "Until 1 Oct 2027", steps: ["Seller", "HMRC"] },
      { label: "From 1 Oct 2027", steps: ["Seller", "Online marketplace", "HMRC"], tone: "gain" },
    ],
    alt: "VAT on these sellers' sales: until 1 October 2027 the seller pays it to HMRC; from then the online marketplace collects it and pays it to HMRC.",
  },
  // "equity loans of up to 20%, with a 2.5% deposit"
  "your-first-home": {
    kind: "stack",
    caption: "A first home's price",
    parts: [
      { label: "2.5% deposit", share: 2.5, tone: "deep" },
      { label: "Up to 20% equity loan", share: 20, tone: "gain" },
      { label: "The rest: a mortgage", share: null },
    ],
    alt: "A first home's price under Your First Home: a 2.5% deposit, an equity loan of up to 20%, and the rest a mortgage.",
  },
  // "rises from £12.71 to £13.21 an hour"; "Minimum wage up 3.9%"
  "national-living-wage": {
    kind: "bars",
    caption: "National Living Wage, an hour",
    max: 15,
    rows: [
      { label: "Until 1 Apr 2027", value: 12.71, text: "£12.71", plain: true },
      { label: "From 1 Apr 2027", base: 12.71, value: 13.21, text: "£13.21 (+3.9%)" },
    ],
    tone: "gain",
    alt: "National Living Wage: £12.71 an hour until 1 April 2027, £13.21 from then, up 3.9%.",
  },
  // "stays at £2,500 to March 2028, rather than falling to £300"
  "universal-credit-surplus-earnings": {
    kind: "bars",
    caption: "Surplus earnings threshold",
    max: 3000,
    rows: [
      { label: "As legislated", value: 300, text: "£300", plain: true, dashed: true },
      { label: "Kept to Mar 2028", value: 2500, text: "£2,500", tone: "gain" },
    ],
    alt: "Universal Credit surplus earnings threshold: £2,500 is kept to March 2028, rather than falling to £300 as legislated.",
  },
  // "55p a mile for the first 10,000 business miles is made permanent; above that, 25p rises to 35p"
  "mileage-rates": {
    kind: "mileage",
    caption: "Tax-free rate, pence a mile",
    threshold: { miles: 10000, label: "10,000 miles" },
    first: 55,
    above: { before: 25, after: 35 },
    tone: "gain",
    alt: "Tax-free mileage rate: 55p a mile for the first 10,000 business miles, made permanent; above 10,000 miles the rate rises from 25p to 35p from April 2027.",
  },
  // "1 point above 2029-30's in every band, up to 40%"; the bands from the card (9% to 10%, 19% to 20%)
  "company-car-tax": {
    kind: "bars",
    caption: "Company car tax percentage, 2030-31",
    max: 40,
    cap: "Every band +1 point, up to 40%",
    rows: [
      { label: "Zero-emission", base: 9, value: 10, text: "9% → 10%" },
      { label: "1 to 50g CO2/km", base: 19, value: 20, text: "19% → 20%" },
    ],
    tone: "loss",
    alt: "Company car tax percentages for 2030-31 are 1 point above 2029-30's in every band, up to 40%: zero-emission cars 9% to 10%, cars emitting 1 to 50g CO2 a kilometre 19% to 20%.",
  },
  // "The lifetime limit on gains taxed at ... 18% falls from £1 million to £500,000"; "taxed at up to 24% rather than 18%"
  "business-asset-disposal-relief": {
    kind: "bands",
    caption: "Rate on a lifetime's qualifying gains",
    ticks: ["£500,000", "£1 million"],
    rows: [
      { label: "Until 6 Apr 2027", bands: [{ share: 100, text: "18%" }] },
      { label: "From 6 Apr 2027", bands: [{ share: 50, text: "18%" }, { share: 50, text: "Up to 24%", tone: "loss" }] },
    ],
    alt: "Business Asset Disposal Relief: until 6 April 2027 gains up to £1 million are taxed at 18%; from then only the first £500,000, with gains above taxed at up to 24%.",
  },
  // "A 25%-bonus First Time Buyer ISA"
  "first-time-buyer-isa": {
    kind: "stack",
    caption: "Paid towards a first home",
    tall: true,
    parts: [
      { label: "Savings", share: null },
      { label: "25% bonus on the savings", share: 20, tone: "gain" },
    ],
    alt: "First Time Buyer ISA: the government adds a 25% bonus to the savings, paid when they buy a first home.",
  },
  // "two weeks' pay after a birth, now up to £194 a week"
  "parental-allowance": {
    kind: "weeks",
    caption: "After a birth, from April 2029",
    weeks: ["First week", "Second week"],
    amount: "Up to £194",
    alt: "Parental pay for a self-employed father or partner from April 2029: two weeks' pay after a birth, each week up to £194.",
  },
  // "£108 a year on average"; "bills fall for light users, rise for heavy ones"
  "gas-standing-charges": {
    kind: "standing",
    caption: "A year's gas bill by gas used (not to scale)",
    charge: "£108 standing charge",
    light: "Light users pay less",
    heavy: "Heavy users pay more",
    alt: "Gas bills without the standing charge, £108 a year on average: its costs move into unit rates, so before mitigation bills fall for light users and rise for heavy ones.",
  },
};
