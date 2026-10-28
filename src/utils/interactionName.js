// The gap between a run of several policies together and the sum of each on
// its own. A measure whose published description says its values are
// modelled, replacing the survey's, sets them on both sides of its runs and
// of the run together, while the other policies on their own keep the
// survey's. The gap then holds a baseline difference too (Methodology,
// "Policies added up"). Read from the published text, as MODELLING_FACTS
// reads it, so no measure is named here.
import { MODELLED_NOT_SURVEY } from "./measureModelling";

export function interactionName(measures) {
  return (measures ?? []).some((measure) => MODELLED_NOT_SURVEY.test(measure?.description ?? ""))
    ? "Interaction and baseline difference"
    : "Interaction";
}
