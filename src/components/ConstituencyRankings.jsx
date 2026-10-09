import { useMemo, useState } from "react";
import { useConstituencyResults } from "../hooks/useConstituencyResults";
import { formatYearRange } from "../utils/constituencyData";
import {
  RANK_METRICS,
  buildRankingCsv,
  isAllTied,
  rankConstituencies,
  selectTopAndBottom,
} from "../utils/constituencyRanking";
import { downloadFile } from "../utils/downloadFile";
import ConstituencyRankingTable, {
  formatPercent,
  formatPounds,
} from "./ConstituencyRankingTable";
import "./ConstituencyRankings.css";

const TABLE_SIZE = 10;

// Excel reads a CSV as UTF-8 only with a byte-order mark ("Ynys Môn").
const UTF8_BOM = "﻿";

// Drill builds set NEXT_PUBLIC_MOCK=1; their numbers must never read as real.
const isMockBuild = () => process.env.NEXT_PUBLIC_MOCK === "1";

export default function ConstituencyRankings({
  selectedPolicies = [],
  selectedYear = 2029,
}) {
  const [metric, setMetric] = useState("gbp");
  const { loading, availability, aggregated, regionLookup, policies } =
    useConstituencyResults(selectedPolicies, selectedYear);

  const ranked = useMemo(
    () => rankConstituencies(aggregated, metric),
    [aggregated, metric],
  );

  // Same flag as the map: no tables unless constituency results exist.
  if (loading || !availability.available || !ranked.length) {
    return null;
  }

  const { top, bottom, topTie, bottomTie } = selectTopAndBottom(
    ranked,
    TABLE_SIZE,
  );
  const mock = isMockBuild();
  const yearLabel = formatYearRange(selectedYear);

  const handleDownload = () => {
    const csv = buildRankingCsv(aggregated, {
      metric,
      regionLookup,
      year: selectedYear,
      yearLabel,
      policies,
      mock,
    });
    const prefix = mock ? "MOCK-" : "";
    downloadFile(
      `${UTF8_BOM}${csv}`,
      `${prefix}constituency-rankings-${selectedYear}-by-${metric}.csv`,
      "text/csv;charset=utf-8",
    );
  };

  const tableProps = { metric, regionLookup };

  return (
    <section
      className="constituency-rankings"
      aria-labelledby="constituency-rankings-title"
    >
      <div className="rankings-header">
        <div>
          <h2 id="constituency-rankings-title">
            {mock && <span className="rankings-mock-badge">MOCK DATA</span>}
            Constituency rankings, {yearLabel}
          </h2>
          <p className="chart-description">
            The {TABLE_SIZE} constituencies with the highest and the{" "}
            {TABLE_SIZE} with the lowest average annual change in household net
            income from the selected policies, using the same estimates as the
            map. An = sign marks constituencies tied on the exact modelled
            value.
          </p>
        </div>
        <div className="rankings-controls">
          <div className="rankings-toggle" role="group" aria-label="Rank by">
            {Object.entries(RANK_METRICS).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                aria-pressed={metric === key}
                className={metric === key ? "active" : ""}
                onClick={() => setMetric(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rankings-download"
            onClick={handleDownload}
          >
            Download all {ranked.length} (CSV)
          </button>
        </div>
      </div>
      {isAllTied(ranked) ? (
        <p className="rankings-note">
          Every constituency has the same average change (
          {metric === "gbp"
            ? formatPounds(ranked[0].average_gain)
            : formatPercent(ranked[0].relative_change)}
          ) in {yearLabel}, so there is no ranking by{" "}
          {RANK_METRICS[metric].label}.
        </p>
      ) : (
        <div className="rankings-tables">
          <ConstituencyRankingTable
            position="top"
            rows={top}
            tie={topTie}
            {...tableProps}
          />
          <ConstituencyRankingTable
            position="bottom"
            rows={bottom}
            tie={bottomTie}
            {...tableProps}
          />
        </div>
      )}
    </section>
  );
}
