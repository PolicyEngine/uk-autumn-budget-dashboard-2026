// How long each stage of the household calculation usually takes, said in
// the waiting panels, whose bars fill over it. The headline (net income
// before and after) comes first: five uncached calls to the live API on
// 25 October 2026 took 14-17 seconds. The split by policy and the earnings
// sweep follow in about a minute on the API's current capacity.
export const HEADLINE_SECONDS = 15;
export const DETAIL_SECONDS = 60;

// Past these, the panels say the calculation is taking longer than usual
export const SLOW_HEADLINE_SECONDS = 45;
export const SLOW_DETAIL_SECONDS = 150;

// What each stage's panel says it usually takes
export const STAGE_TIMES = {
  headline: { typical: HEADLINE_SECONDS, slow: SLOW_HEADLINE_SECONDS, text: "Usually about 15 seconds" },
  detail: { typical: DETAIL_SECONDS, slow: SLOW_DETAIL_SECONDS, text: "Usually about a minute" },
};
