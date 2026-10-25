// How long the household calculation usually takes, said in every waiting
// panel (the headline's and the slower parts'), whose bars fill over it.
// The headline itself often comes back sooner, and shows as soon as it
// does; five uncached calls to the live API on 25 October 2026 took 14-17
// seconds for the headline, longer when the API is busy.
export const TYPICAL_CALCULATION_SECONDS = 60;

// Past this, the panels say the calculation is taking longer than usual
export const SLOW_CALCULATION_SECONDS = 90;

// What every waiting panel says it usually takes
export const STAGE_TIMES = {
  headline: { typical: TYPICAL_CALCULATION_SECONDS, slow: SLOW_CALCULATION_SECONDS, text: "Usually around 60 seconds" },
  detail: { typical: TYPICAL_CALCULATION_SECONDS, slow: SLOW_CALCULATION_SECONDS, text: "Usually around 60 seconds" },
};
