import { useState } from "react";
import SingleAgeCard, { everySingleAgeWithheld } from "./SingleAgeCard";
import { MeanChangeCard } from "../YoungPeopleSection";
import { ALL_BAND, meanChangeByBand } from "../../utils/ageImpact";
import { AGE_GROUP_OPTIONS } from "../../utils/ageGroups";
import { selectionPackageKey } from "../../utils/geography/selection";

const VIEW_OPTIONS = [
  { value: "single", label: "Single year of age", summary: "Single years" },
  { value: "groups", label: "Age groups", summary: "Age groups" },
];

/**
 * Whether By age falls back to the age bands: every single age of the
 * chosen group is withheld (a package withholds what its members withhold,
 * #347) while some band is published. Where the bands are withheld too, the
 * single-age view's own "Not shown" message stays.
 */
export function bandsFallback({ catalogue, rows, policies, selectedPolicies, selectedYear, group }) {
  if (!everySingleAgeWithheld({ catalogue, rows, policies, selectedPolicies, selectedYear, group })) return false;
  const packageRun = selectionPackageKey(catalogue?.manifest, selectedPolicies);
  return meanChangeByBand(rows, policies, selectedPolicies, selectedYear, packageRun).some(
    (point) => point.netChange !== null && point.netChange !== undefined && !point.combinationUnavailable,
  );
}

/** Whether the address names a group the section reads (?age=), as AgeSection does. */
function groupInAddress() {
  if (typeof window === "undefined") return false;
  const age = new URLSearchParams(window.location.search).get("age");
  return AGE_GROUP_OPTIONS.some((option) => option.key === age);
}

/**
 * By age's "Average change by age": one card, two views in its Options
 * pill: All ages, Age groups, By policy by default. Age groups: the bands, the chosen one highlighted, each measure's
 * part stacked. Single year of age: the chosen group's own ages, the
 * five-year average and State Pension age, with each measure stacked as an
 * option. When every single age is withheld but the bands are published,
 * the bands are shown, with no note on the card, and Options shows Age groups chosen and
 * Single year of age disabled (the reader's choice is kept for a year or
 * selection with single ages). Age groups opens on By policy, where each
 * policy's part can be shown.
 */
export default function AgeChangeCard({ extraOptions = [], ...props }) {
  // Opens on All ages (Vahid, 29 Oct) unless the address names a group; the
  // other cards keep the section's own default. Once the reader picks a
  // group, in this card or another, this card follows the shared choice.
  const [ownGroup, setOwnGroup] = useState(() => (groupInAddress() ? null : ALL_BAND));
  // The shared group last seen: when it changes (the reader picked a group in
  // another card), drop this card's own, during render so no frame draws the
  // old group (React's "adjusting state when a prop changes")
  const [sharedGroup, setSharedGroup] = useState(props.group);
  if (sharedGroup !== props.group) {
    setSharedGroup(props.group);
    setOwnGroup(null);
  }
  const group = ownGroup ?? props.group;
  props = { ...props, group };
  extraOptions = extraOptions.map((option) =>
    option.label === "Age group"
      ? { ...option, value: group, onChange: (next) => { setOwnGroup(null); option.onChange(next); } }
      : option,
  );
  const [chosen, setView] = useState("groups");
  // Held here, so the reader's Policies choice survives a switch of view
  const [packageView, setPackageView] = useState("policy");
  const fallback = bandsFallback(props);
  const view = fallback ? "groups" : chosen;
  const viewOptions = fallback
    ? // Disabled, with no explanation line under the control
      VIEW_OPTIONS.map((option) => (option.value === "single" ? { ...option, disabled: true } : option))
    : VIEW_OPTIONS;
  const options = [...extraOptions, { label: "View", value: view, onChange: setView, options: viewOptions }];
  return view === "groups" ? (
    <MeanChangeCard {...props} bandsOnly extraOptions={options} defaultPackageView="policy" packageView={packageView} onPackageViewChange={setPackageView} />
  ) : (
    <SingleAgeCard {...props} title="Average change by age" extraOptions={options} />
  );
}
