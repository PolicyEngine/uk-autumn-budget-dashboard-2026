// The gap between a run of several policies together and the sum of each on
// its own. With the Plan 2 measure selected it also holds a baseline
// difference: that measure and the run together count modelled student loan
// repayments, the other policies the survey's (Methodology, "Policies added
// up").
export const PLAN_2_ID = "plan_2_threshold_unfreeze";

export function interactionName(ids) {
  return (ids ?? []).includes(PLAN_2_ID) ? "Interaction and baseline difference" : "Interaction";
}
