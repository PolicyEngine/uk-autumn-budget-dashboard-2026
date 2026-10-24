import { useMemo } from "react";
import {
  isAllTied,
  rankConstituencies,
  selectTopAndBottom,
} from "../utils/constituencyRanking";
import { OUTCOME_LABELS, formatFigure } from "../utils/geography/format";
import ConstituencyRankingTable from "./ConstituencyRankingTable";
import "./ConstituencyRankings.css";

export const TABLE_SIZE = 10;

/**
 * The map card's Rankings view: the 10 constituencies with the highest and
 * the 10 with the lowest average change, side by side (stacked on a
 * phone). Ported from PR #11 (Max Ghenis). It ranks the entries the map
 * card builds from the same published rows it draws; without them
 * (`entries` empty) it shows the tables' outline only, and the card puts
 * its one notice over it.
 *
 * @param {Object} props
 * @param {Array<Object>} props.entries - from rankingEntries
 * @param {"gbp"|"pct"} props.metric
 * @param {"average_change"|"relative_change"} props.outcome
 * @param {string} props.yearLabel
 */
export default function ConstituencyRankings({ entries, metric, outcome, yearLabel }) {
  const ranked = useMemo(() => rankConstituencies(entries, metric), [entries, metric]);
  const ready = ranked.length > 0;
  const { top, bottom, topTie, bottomTie } = ready
    ? selectTopAndBottom(ranked, TABLE_SIZE)
    : { top: [], bottom: [], topTie: null, bottomTie: null };

  if (ready && isAllTied(ranked)) {
    return (
      <div className="constituency-rankings">
        <p className="rankings-note">
          Every constituency has the same average change (
          {formatFigure(outcome, ranked[0].rows[outcome].value)}) in {yearLabel},
          so there is no ranking by {OUTCOME_LABELS[outcome]}.
        </p>
      </div>
    );
  }

  return (
    <div className="constituency-rankings">
      <div className={`rankings-tables ${ready ? "" : "rankings-tables-empty"}`}>
        <ConstituencyRankingTable
          position="top"
          rows={top}
          tie={topTie}
          metric={metric}
          size={TABLE_SIZE}
        />
        {/* Fewer than 11 ranked seats all fit in the top list */}
        {(!ready || bottom.length > 0) && (
          <ConstituencyRankingTable
            position="bottom"
            rows={bottom}
            tie={bottomTie}
            metric={metric}
            size={TABLE_SIZE}
          />
        )}
      </div>
    </div>
  );
}
