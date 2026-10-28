// How long the household calculation usually takes, said in every waiting
// panel (the headline's and the slower parts'), whose bars fill over it.
// The headline shows as soon as it is back. Five uncached calls to the
// live API on 25 October 2026 took 14-17 seconds for the headline; on 27
// October the test API took 14-15 seconds for the headline and 21-25 for
// the split by policy and the sweep, with all eight pre-Budget candidate
// measures, asked at the same time.
export const TYPICAL_CALCULATION_SECONDS = 30;

// Past this, the panels say the calculation is taking longer than usual
export const SLOW_CALCULATION_SECONDS = 60;

// Past this, the panels say it is still working and why it can be slow (a
// cold start), so a first run never looks stuck
export const STILL_WORKING_SECONDS = 20;
export const STILL_WORKING_TEXT = "Still working: this can take up to a minute the first time";

// What every waiting panel says it usually takes
export const STAGE_TIMES = {
  headline: { typical: TYPICAL_CALCULATION_SECONDS, slow: SLOW_CALCULATION_SECONDS, text: "Usually 15–30 seconds" },
  detail: { typical: TYPICAL_CALCULATION_SECONDS, slow: SLOW_CALCULATION_SECONDS, text: "Usually 15–30 seconds" },
};
