// How long the household calculation usually takes, from Calculate to the
// last chart (the headline, then the split by policy and the earnings
// sweep): said in the processing panels, whose bars fill over it. Set at
// 60 seconds, a round figure readers can plan on; five timed calls to the
// live API on 25 October 2026 took about 15 seconds for the headline.
export const TYPICAL_CALCULATION_SECONDS = 60;

// Past this, the panels say the calculation is taking longer than usual
export const SLOW_CALCULATION_SECONDS = 90;
