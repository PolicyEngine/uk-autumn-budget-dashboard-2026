import { ManifestError } from "./manifest";

export const CURRENT_RELEASE = "uk-autumn-budget-2026";
export const CURRENT_BUDGET = Object.freeze({ id: CURRENT_RELEASE, date: "2026-10-28" });

/** Identity must be explicit: historic or unidentified snapshots never authorise figures. */
export function assertCurrentRelease(manifest) {
  if (manifest?.release !== CURRENT_RELEASE || manifest?.budget?.id !== CURRENT_BUDGET.id || manifest?.budget?.date !== CURRENT_BUDGET.date) {
    throw new ManifestError(["release or Budget identity is not the 2026 Budget"]);
  }
  return manifest;
}
