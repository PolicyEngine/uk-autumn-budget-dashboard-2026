/**
 * Open a Population impact sub-tab from a link elsewhere on the page (the
 * £0 note's "Public finances"): the sub-tabs listen for this event.
 */
export const OPEN_POPULATION_SUB = "population:open-sub";

export const populationSubHref = (sub) => `?tab=dashboard&sub=${sub}`;

export function openPopulationSub(sub) {
  window.dispatchEvent(new CustomEvent(OPEN_POPULATION_SUB, { detail: sub }));
}
