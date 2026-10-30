/**
 * "What we're improving": what the next update of the results changes and
 * what is in progress, as Max approved it (28 October 2026, "Use the
 * widened text"), less the date and the poverty and people-affected item
 * (30 October 2026, Vahid). Shown open above the Limitations topics
 * (ImprovementsNote.jsx); ImprovementsNote.test.jsx holds the words, so an
 * edit here must change the test too.
 */
export const IMPROVEMENTS_NOTE = {
  id: "method-improving",
  title: "What we're improving",
  parts: [
    {
      lead: "The next update of these results will:",
      items: [
        "add national figures for the savings income tax rise, once we have improved our savings income data (the calculator already includes it);",
        "apply the trading allowance to miscellaneous income as well as trading income, which will raise our estimate of its cost;",
        "correct how the Carer's Allowance taper interacts with overlapping benefits, such as the State Pension, in 2030-31;",
        "extend the fuel duty cut to road fuel gases (LPG and natural gas), as the government's costing does;",
        "give the Pension Tax Allowance to everyone who reaches State Pension age during the tax year.",
      ],
    },
    {
      lead: "We are also working on:",
      items: [
        "projecting household electricity spending with retail energy prices rather than general inflation;",
        "adding the Budget's measures to PolicyEngine UK itself, so anyone using our open-source model can run them.",
      ],
    },
  ],
};
