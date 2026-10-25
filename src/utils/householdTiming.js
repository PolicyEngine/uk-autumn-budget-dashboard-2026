// How long the household calculation usually takes, end to end (headline
// and breakdown): the median of five timed calls to the live API for the
// default household with every measure selected, on 25 October 2026
// (MEASURED_PLACEHOLDER). The processing panel says it, and its bar fills
// over it.
export const TYPICAL_CALCULATION_SECONDS = 20;

// Past this, the panel says the calculation is taking longer than usual
export const SLOW_CALCULATION_SECONDS = 30;

// The second stage (the split by policy and the earnings sweep, asked
// together): its median time, measured the same way
export const DETAIL_CALCULATION_SECONDS = 20;
