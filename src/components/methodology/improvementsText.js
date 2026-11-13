/**
 * Remaining work for the adoption candidate, with PR 376 and E3 integrated.
 * The 28 October note and 30 October exclusions remain the starting point;
 * the savings and Pension Tax Allowance items are now implemented in those
 * dependencies, and the upstream model already has the Budget measures.
 * This describes source integration, not newly regenerated results.
 * Keep the neutral later-update lead for the work still outstanding.
 */
export const IMPROVEMENTS_NOTE = {
  id: "method-improving",
  title: "What we're improving",
  parts: [
    {
      lead: "A later update of these results will:",
      items: [
        "apply the trading allowance to miscellaneous income as well as trading income, which will raise our estimate of its cost;",
        "correct how the Carer's Allowance taper interacts with overlapping benefits, such as the State Pension, in 2030-31;",
        "extend the fuel duty cut to road fuel gases (LPG and natural gas), as the government's costing does.",
      ],
    },
    {
      lead: "We are also working on:",
      items: [
        "projecting household electricity spending with retail energy prices rather than general inflation.",
      ],
    },
  ],
};
