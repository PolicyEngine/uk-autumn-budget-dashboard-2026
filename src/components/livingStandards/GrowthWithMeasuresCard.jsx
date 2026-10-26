// Growth across the distribution, with the selected measures: the
// OBR forecast's "Growth across the distribution" chart (current
// law) with the same pills, read with the measures from
// public/data/income_growth_with_measures.csv. Shown on Population impact's
// Living standards sub-tab; its twin without the measures links here and
// this links back.
//
// The run that stands for the selection is the one the household position
// card uses (distributionRunFor): a single measure's own run, else the
// package's, with a note when only part of the package is selected.

import { useEffect, useState } from "react";
import ViewCard from "./ViewCard";
import useQuintileGrowthView from "./sections/DecileGrowthSection";
import { useOutlook } from "./useOutlook";
import { COMBINED_REFORM_ID, distributionRunFor } from "../../utils/incomePosition";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { GROWTH_WITH_MEASURES_FILE, changesNothing, parseGrowthWithMeasures } from "../../utils/livingStandards/growthWithMeasures";
import { rangeYears, useYearRange } from "../../utils/livingStandards/yearRange";
import { headlineStartYear, headlineYear } from "../../utils/livingStandards/outlook";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const WITH_MEASURES_TITLE = "Growth across the distribution, with the selected measures";
export const WITH_MEASURES_ANCHOR = "growth-with-measures";

// Shows: the measures' effect first (see GrowthWithMeasuresCard)
const SHOWS = [
  { value: "difference", label: "Difference from current law" },
  { value: "growth", label: "Growth with measures" },
];

// The file is read once per page
let cache = null;
function useGrowthFile() {
  const [state, setState] = useState(() => cache ?? { status: "loading", rows: null });
  useEffect(() => {
    if (cache) return undefined;
    let cancelled = false;
    fetch(`${BASE}/data/${GROWTH_WITH_MEASURES_FILE}`)
      .then((response) => {
        if (!response.ok) throw new Error(`${GROWTH_WITH_MEASURES_FILE}: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        cache = { status: "ready", rows: parseGrowthWithMeasures(text) };
        if (!cancelled) setState(cache);
      })
      .catch((error) => {
        console.error(`Error loading ${GROWTH_WITH_MEASURES_FILE}:`, error);
        if (!cancelled) setState({ status: "error", rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** For tests: forget the loaded file. */
export function clearGrowthWithMeasuresCache() {
  cache = null;
}

/**
 * @param {Object} props
 * @param {string[]} props.selectedPolicies - The selected measures' ids
 * @param {React.ReactNode} props.twinLink - The link to the chart without the measures
 */
export default function GrowthWithMeasuresCard({ selectedPolicies, twinLink }) {
  const { data } = useOutlook();
  const file = useGrowthFile();
  // Every measure the catalogue publishes: the package's run is exact only
  // when all of them are selected and it was run with exactly those
  const catalogue = useMeasureCatalogue();
  const run = distributionRunFor(
    selectedPolicies,
    (catalogue?.displayable ?? []).map((measure) => measure.id),
    catalogue?.combinedId ? (catalogue.manifest?.combined?.[catalogue.combinedId]?.measures ?? null) : null,
  );
  // The pills read their choices once, so the card waits for both files
  if (!data || file.status !== "ready") return null;
  return <LoadedCard data={data} rows={file.rows} run={run} twinLink={twinLink} />;
}

function LoadedCard({ data, rows, run, twinLink }) {
  // The difference reads best: a measure moves growth by hundredths of a
  // point, too little to see beside growth of a percent or two
  const [show, setShow] = useState("difference");
  const [range, setRange] = useYearRange(rangeYears(data), [headlineStartYear(data), headlineYear(data)]);
  const view = useQuintileGrowthView(data, range, setRange, { rows, reformId: run.reformId, mode: show });
  const noEffect = changesNothing(rows, run.reformId);
  const packageNote =
    !run.exact && run.reformId === COMBINED_REFORM_ID
      ? "With part of the package selected, this is the whole package (runs for part of it are not published)."
      : null;
  const subtitle = (
    <>
      With the measures: real growth of each group&apos;s median income.{packageNote ? ` ${packageNote}` : ""} {twinLink}
    </>
  );
  if (noEffect || !view) {
    return (
      <div className="ls-card ls-card-empty" id={WITH_MEASURES_ANCHOR}>
        <div className="chart-header">
          <div>
            <h3>
              <span className="title-text">{WITH_MEASURES_TITLE}</span>
            </h3>
            <p className="ls-card-subtitle">{subtitle}</p>
            <p className="chart-description">
              {noEffect
                ? "The selected measures do not change this income: it is household income as official income statistics (HBAI) count it, which leaves out fuel duty, VAT, employer National Insurance and capital gains, so growth is the same as without them."
                : "There are no results for this selection."}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div id={WITH_MEASURES_ANCHOR} className="ls-card-anchor">
      <ViewCard
        title={WITH_MEASURES_TITLE}
        subtitle={subtitle}
        icon="bars"
        name="Growth with measures view"
        value={show}
        onChange={setShow}
        views={SHOWS.map((s) => ({ ...s, view }))}
      />
    </div>
  );
}
