import { useState } from "react";
import SingleAgeCard from "./SingleAgeCard";
import { MeanChangeCard } from "../YoungPeopleSection";

const VIEW_OPTIONS = [
  { value: "groups", label: "Age groups", summary: "Age groups" },
  { value: "single", label: "Single year of age", summary: "Single years" },
];

/**
 * By age's "Average change by age": one card, two views in its Options
 * pill. Age groups: the bands, the chosen one highlighted, each measure's
 * part stacked. Single year of age: the chosen group's ages and ten either
 * side, the group shaded, the five-year average and State Pension age, with
 * each measure stacked as an option.
 */
export default function AgeChangeCard({ extraOptions = [], ...props }) {
  const [view, setView] = useState("groups");
  const options = [...extraOptions, { label: "View", value: view, onChange: setView, options: VIEW_OPTIONS }];
  return view === "groups" ? (
    <MeanChangeCard {...props} bandsOnly extraOptions={options} />
  ) : (
    <SingleAgeCard {...props} title="Average change by age" extraOptions={options} />
  );
}
