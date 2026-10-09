import { useMemo, useState } from "react";
import { useConstituencyResults } from "../hooks/useConstituencyResults";
import { formatYearRange } from "../utils/constituencyData";
import {
  RANK_METRICS,
  buildRankingCsv,
  rankConstituencies,
  selectTopAndBottom,
} from "../utils/constituencyRanking";
import { downloadFile } from "../utils/downloadFile";
import "./ConstituencyRankings.css";

const TABLE_SIZE = 10;

const formatPounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
}).format;

const formatPercent = (value) => {
  const magnitude = Math.abs(value).toFixed(2);
  if (Number(magnitude) === 0) return "0.00%";
  return `${value > 0 ? "+" : "-"}${magnitude}%`;
};

// Drill builds set NEXT_PUBLIC_MOCK=1; their numbers must never read as real.
const isMockBuild = () => process.env.NEXT_PUBLIC_MOCK === "1";

function RankingTable({ title, caption, rows, metric, regionLookup }) {
  return (
    <div className="ranking-table-wrapper">
      <h3>{title}</h3>
      <table className="ranking-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Constituency</th>
            <th scope="col" className="col-region">
              Region or country
            </th>
            <th scope="col" className={metric === "gbp" ? "ranked" : ""}>
              Change (£)
            </th>
            <th scope="col" className={metric === "pct" ? "ranked" : ""}>
              Change (%)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const region =
              regionLookup.get(row.constituency_code)?.region ?? "";
            return (
              <tr key={row.constituency_code}>
                <td title={row.tied ? "Tied" : undefined}>
                  {row.tied ? "=" : ""}
                  {row.rank}
                </td>
                <th scope="row">
                  {row.constituency_name}
                  {/* Narrow screens drop the region column and show it here */}
                  <span className="region-inline">{region}</span>
                </th>
                <td className="col-region">{region}</td>
                <td className={`number ${metric === "gbp" ? "ranked" : ""}`}>
                  {formatPounds(row.average_gain)}
                </td>
                <td className={`number ${metric === "pct" ? "ranked" : ""}`}>
                  {formatPercent(row.relative_change)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ConstituencyRankings({
  selectedPolicies = [],
  selectedYear = 2029,
}) {
  const [metric, setMetric] = useState("gbp");
  const { loading, availability, aggregated, regionLookup } =
    useConstituencyResults(selectedPolicies, selectedYear);

  const ranked = useMemo(
    () => rankConstituencies(aggregated, metric),
    [aggregated, metric],
  );
  const { top, bottom } = selectTopAndBottom(ranked, TABLE_SIZE);

  // Same flag as the map: no tables unless constituency results exist.
  if (loading || !availability.available || !ranked.length) {
    return null;
  }

  const mock = isMockBuild();
  const yearLabel = formatYearRange(selectedYear);

  const handleDownload = () => {
    const csv = buildRankingCsv(aggregated, {
      metric,
      regionLookup,
      year: selectedYear,
      policies: selectedPolicies,
      mock,
    });
    const prefix = mock ? "MOCK-" : "";
    downloadFile(
      csv,
      `${prefix}constituency-rankings-${selectedYear}-by-${metric}.csv`,
      "text/csv;charset=utf-8",
    );
  };

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
      <div className="rankings-tables">
        <RankingTable
          title={`Top ${top.length}`}
          caption="Highest average change, highest first"
          rows={top}
          metric={metric}
          regionLookup={regionLookup}
        />
        <RankingTable
          title={`Bottom ${bottom.length}`}
          caption="Lowest average change, lowest first"
          rows={bottom}
          metric={metric}
          regionLookup={regionLookup}
        />
      </div>
    </section>
  );
}
