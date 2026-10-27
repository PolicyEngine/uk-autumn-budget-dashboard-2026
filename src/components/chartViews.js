/**
 * Every view that draws charts, the map or the household calculator, as one
 * chunk that App.jsx loads on first use (utils/lazyView). One chunk, not one
 * per view: the bundler copies a module shared by two dynamic imports into
 * each, so separate imports shipped Recharts and the cards' helpers five
 * times over. The text views (Policies, Methodology) load on their own.
 */
export { default as BudgetaryImpactChart } from "./BudgetaryImpactChart";
export { ObrComparisonCard } from "./OBRComparisonTable";
export { default as ConstituencyMap } from "./ConstituencyMap";
export { default as DecileImpactCard } from "./DecileImpactCard";
export { default as HouseholdScatter } from "./HouseholdScatter";
export { default as AgeSection } from "./AgeSection";
export { default as GrowthWithMeasuresCard } from "./livingStandards/GrowthWithMeasuresCard";
export { default as SummaryMetricChart, SUMMARY_METRICS } from "./SummaryMetricChart";
export { PovertyMeasuresRow } from "./MeasuresPovertyCard";
export { default as PersonalImpactTab } from "./PersonalImpactTab";
export { default as LivingStandardsTab } from "./livingStandards/LivingStandardsTab";

// A string the build keeps in this chunk, so the root layout can find the
// chunk's files and the document head can request them for a link to a
// chart view (utils/chartChunk.js)
export { CHART_VIEWS_MARKER } from "../utils/chartChunk";
