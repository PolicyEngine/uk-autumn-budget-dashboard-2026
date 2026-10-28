// Growth across the distribution, with the selected measures: the
// Pre-measures forecast's "Growth across the distribution" chart (current
// law) with the same pills, read with the measures from
// public/data/income_growth_with_measures.csv. Shown on Population impact's
// Living standards sub-tab; its twin without the measures links here and
// this links back.
//
// The run that stands for the selection is the one every card uses
// (distributionRunOf): one policy's own run, else the published combined
// run of exactly the selected policies, else the shared "not published
// yet" notice.

import { useEffect, useMemo, useState } from "react";
import ViewCard from "./ViewCard";
import useQuintileGrowthView from "./sections/DecileGrowthSection";
import { useOutlook } from "./useOutlook";
import { distributionRunOf, missingPackageNote } from "../../utils/incomePosition";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { GROWTH_WITH_MEASURES_FILE, changesNothing, loadGrowthWithMeasures, resetGrowthWithMeasures } from "../../utils/livingStandards/growthWithMeasures";
import { PlotSkeleton } from "../publication/LoadingSkeleton";
import { defaultRange, rangeYears, useYearRange } from "../../utils/livingStandards/yearRange";

export const WITH_MEASURES_TITLE = "Growth across the distribution, with the selected policies";
export const WITH_MEASURES_ANCHOR = "growth-with-measures";

// Shows: the measures' effect first (see GrowthWithMeasuresCard); each
// label says what is plotted (Pavel's review, LS3); short enough for one line in the Options pill at 390px (round 3).
// Each description is behind the ⓘ beside "Show" (Pavel asked what growth with the policies means)
export const SHOWS = [
  {
    value: "difference",
    label: "Effect (pp)",
    description: "How much the selected policies change each group's real income growth, in percentage points.",
  },
  {
    value: "growth",
    label: "Growth with the policies (%)",
    description: "Each group's real income growth with the selected policies in place: the current-law forecast plus the policies' effect.",
  },
];

// The file is read and parsed once per session (loadGrowthWithMeasures),
// the parse kept here so a remount draws at once
let cache = null;
function useGrowthFile() {
  const [state, setState] = useState(() => cache ?? { status: "loading", rows: null });
  useEffect(() => {
    if (cache) return undefined;
    let cancelled = false;
    loadGrowthWithMeasures()
      .then((rows) => {
        cache = { status: "ready", rows };
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
  resetGrowthWithMeasures();
}

/**
 * @param {Object} props
 * @param {string[]} props.selectedPolicies - The selected measures' ids
 * @param {React.ReactNode} props.twinLink - The link to the chart without the measures
 */
export default function GrowthWithMeasuresCard({ selectedPolicies, twinLink, selectedYear = null }) {
  const { data } = useOutlook();
  const file = useGrowthFile();
  // The header's selection: one policy's run, or the combined run of exactly them
  const catalogue = useMeasureCatalogue();
  const run = distributionRunOf(selectedPolicies, catalogue);
  // The pills read their choices once, so the chart waits for both files;
  // its card holds its place at once, a skeleton in the plot's size
  if (!data || file.status === "loading") {
    return (
      <div className="ls-card" id={WITH_MEASURES_ANCHOR}>
        <div className="chart-header">
          <div>
            <h3>
              <span className="title-text">{WITH_MEASURES_TITLE}</span>
            </h3>
          </div>
        </div>
        <PlotSkeleton label="Loading growth with the selected policies" height={320} />
      </div>
    );
  }
  if (file.status !== "ready") return null;
  return <LoadedCard data={data} rows={file.rows} run={run} twinLink={twinLink} selectedYear={selectedYear} />;
}

function LoadedCard({ data, rows, run, twinLink, selectedYear }) {
  // Opens on growth with the policies (%), as Vahid asked; the effect in
  // pp is one choice away
  const [show, setShow] = useState("growth");
  const [range, setRange] = useYearRange(rangeYears(data), defaultRange(rangeYears(data)));
  // One object per run and choice, so the view's own memos hold
  const measures = useMemo(() => ({ rows, reformId: run.reformId, mode: show }), [rows, run.reformId, show]);
  const view = useQuintileGrowthView(data, range, setRange, measures, selectedYear);
  const noEffect = useMemo(() => changesNothing(rows, run.reformId), [rows, run.reformId]);
  const notPublished = missingPackageNote(run, rows, "Growth");
  if (noEffect || notPublished || !view) {
    return (
      <div className="ls-card ls-card-empty" id={WITH_MEASURES_ANCHOR}>
        <div className="chart-header">
          <div>
            <h3>
              <span className="title-text">{WITH_MEASURES_TITLE}</span>
            </h3>
            <div className="chart-description">
              {twinLink && <p className="ls-card-subtitle">{twinLink}</p>}
              <p>
                {noEffect
                  ? "The selected policies do not change this income: it is household income as official income statistics (HBAI) count it, which leaves out fuel duty, VAT, employer National Insurance and capital gains, so growth is the same as without them."
                  : notPublished || "There are no results for this selection."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  // The link to its twin sits in About this chart
  return (
    <ViewCard
      id={WITH_MEASURES_ANCHOR}
      title={WITH_MEASURES_TITLE}
      moreNotes={[twinLink && <span key="twin">{twinLink}</span>]}
      icon="bars"
      name="Growth with policies view"
      value={show}
      onChange={setShow}
      views={SHOWS.map((s) => ({ ...s, view }))}
    />
  );
}
