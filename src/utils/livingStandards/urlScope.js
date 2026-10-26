import { createContext, useContext } from "react";

// The Pre-measures forecast's cards also show on Population impact's
// Living standards and Poverty sub-tabs (CurrentLawSection). Each place
// keeps its own pill choices: the cards' address parameters (?ls_from,
// ?ls_growth, …) and the year-range event take this scope as a prefix.
// The Pre-measures forecast has none, so its addresses are unchanged;
// Population impact's copies use "pop_" (?pop_ls_from=2028).
export const UrlScope = createContext("");

/** The address parameter `param` ("ls_from") in this place's scope. */
export function useScopedParam(param) {
  return `${useContext(UrlScope)}${param}`;
}
