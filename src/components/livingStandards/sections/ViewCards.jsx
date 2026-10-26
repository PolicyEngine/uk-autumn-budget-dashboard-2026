// The current-law cards (CurrentLawSection): Incomes over time (household
// income), Inequality over time, Growth across the distribution (by quintile,
// between two chosen years) and Poverty over time (rate or depth). Every view's
// hook runs on each render, so each keeps its own pill choices while the
// other is shown. The contract (docs/DATA_CONTRACT.md) requires every block
// these read.

import { useState } from "react";
import ViewCard from "../ViewCard";
import TwinLink from "../../TwinLink";
import useHouseholdIncomeView from "./LivingStandardsSection";
import useInequalityView from "./InequalitySection";
import useQuintileGrowthView from "./DecileGrowthSection";
import usePovertyRateView from "./PovertySection";
import useDepthView from "./DeepPovertySection";
import { rangeYears, useYearRange } from "../../../utils/livingStandards/yearRange";
import { headlineStartYear, headlineYear } from "../../../utils/livingStandards/outlook";

export function IncomesOverTimeCard({ data }) {
  // The shared two-year range (?ls_from, ?ls_to) drives each view's sentence
  const [range, setRange] = useYearRange(rangeYears(data), [headlineStartYear(data), headlineYear(data)]);
  const income = useHouseholdIncomeView(data, range, setRange);
  // A single view: household income (inequality is its own card, beside
  // the measures' effect on it); ViewCard shows no Show pill
  return (
    <ViewCard
      title="Incomes over time"
      icon="trend"
      name="Income view"
      value="income"
      onChange={() => {}}
      views={[{ value: "income", label: "Household income", badge: "Income", view: income }]}
    />
  );
}
IncomesOverTimeCard.requires = "living_standards";

export function InequalityOverTimeCard({ data }) {
  // The years come from the section's Years compared, above the cards
  // (SectionYearRange), so the card has no years pill of its own
  const [range] = useYearRange(rangeYears(data), [headlineStartYear(data), headlineYear(data)]);
  const inequality = useInequalityView(data, range, null);
  return (
    <ViewCard
      title="Inequality over time (current law)"
      icon="trend"
      name="Inequality view"
      value="inequality"
      onChange={() => {}}
      views={[{ value: "inequality", label: "Inequality", view: inequality }]}
    />
  );
}
InequalityOverTimeCard.requires = "inequality";

// The id of this card, which its twin with the measures links to
export const GROWTH_CURRENT_LAW_ANCHOR = "growth-current-law";

export function GrowthCard({ data, onShowTab }) {
  // One year range for the card (and every card comparing two years)
  const years = (data.income_by_decile?.bhc?.quintile_by_year || []).map((row) => row.year);
  const [range, setRange] = useYearRange(years, [headlineStartYear(data), headlineYear(data)]);
  const quintile = useQuintileGrowthView(data, range, setRange);
  // A single view: ViewCard shows no Show pill. Its twin with the measures
  // is on Population impact's Living standards (GrowthWithMeasuresCard).
  return (
    <ViewCard
      id={GROWTH_CURRENT_LAW_ANCHOR}
      title="Growth across the distribution"
      subtitle={
        // Only the link to the twin; "without the measures" is said in
        // About this chart
        <TwinLink tab="dashboard" sub="living" onShow={onShowTab} label="With the measures" anchor="growth-with-measures" />
      }
      icon="bars"
      name="Distribution view"
      value="quintile"
      onChange={() => {}}
      views={[{ value: "quintile", label: "By quintile", view: quintile }]}
    />
  );
}
GrowthCard.requires = "income_by_decile";

export function PovertyOverTimeCard({ data }) {
  const [show, setShow] = useState("rate");
  const [range, setRange] = useYearRange(rangeYears(data), [headlineStartYear(data), headlineYear(data)]);
  const rate = usePovertyRateView(data, range, setRange);
  const depth = useDepthView(data);
  return (
    <ViewCard
      title="Poverty over time"
      icon="users"
      name="Poverty view"
      value={show}
      onChange={setShow}
      views={[
        { value: "rate", label: "Rate", view: rate },
        { value: "depth", label: "Depth", view: depth },
      ]}
    />
  );
}
PovertyOverTimeCard.requires = "poverty";
