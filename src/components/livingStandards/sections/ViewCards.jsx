// The two-view cards of the Baseline outlook: Incomes over time (median
// income or inequality), Growth across the distribution (by decile or by
// quintile, between two chosen years) and Poverty over time (rate or depth). Every view's
// hook runs on each render, so each keeps its own pill choices while the
// other is shown. The contract (docs/DATA_CONTRACT.md) requires every block
// these read.

import { useState } from "react";
import ViewCard from "../ViewCard";
import useHouseholdIncomeView from "./LivingStandardsSection";
import useInequalityView from "./InequalitySection";
import useDecileView from "./DecileGrowthSection";
import usePovertyRateView from "./PovertySection";
import useDepthView from "./DeepPovertySection";
import { useYearRange } from "../../../utils/livingStandards/yearRange";
import { headlineStartYear, headlineYear } from "../../../utils/livingStandards/outlook";

export function IncomesOverTimeCard({ data }) {
  const [show, setShow] = useState("income");
  const income = useHouseholdIncomeView(data);
  const inequality = useInequalityView(data);
  return (
    <ViewCard
      title="Incomes over time"
      name="Income view"
      value={show}
      onChange={setShow}
      views={[
        { value: "income", label: "Household income", badge: "Income", view: income },
        { value: "inequality", label: "Inequality", view: inequality },
      ]}
    />
  );
}
IncomesOverTimeCard.requires = "living_standards";

export function GrowthCard({ data }) {
  const [show, setShow] = useState("decile");
  // One year range for both views (and every card comparing two years)
  const years = (data.income_by_decile?.bhc?.by_year || []).map((row) => row.year);
  const [range, setRange] = useYearRange(years, [headlineStartYear(data), headlineYear(data)]);
  const decile = useDecileView(data, "decile", range, setRange);
  const quintile = useDecileView(data, "quintile", range, setRange);
  return (
    <ViewCard
      title="Growth across the distribution"
      name="Distribution view"
      value={show}
      onChange={setShow}
      views={[
        { value: "decile", label: "By decile", view: decile },
        { value: "quintile", label: "By quintile", view: quintile },
      ]}
    />
  );
}
GrowthCard.requires = "income_by_decile";

export function PovertyOverTimeCard({ data }) {
  const [show, setShow] = useState("rate");
  const rate = usePovertyRateView(data);
  const depth = useDepthView(data);
  return (
    <ViewCard
      title="Poverty over time"
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
