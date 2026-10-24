import { useMemo, useState } from "react";
import ChartDownloadMenu from "./ChartDownloadMenu";
import PillSelect from "./PillSelect";
import { useConstituencyView } from "../hooks/useConstituencyView";
import {
  RANK_METRICS,
  buildRankingCsv,
  isAllTied,
  rankConstituencies,
  rankingEntries,
  selectTopAndBottom,
} from "../utils/constituencyRanking";
import { downloadFile } from "../utils/downloadFile";
import { OUTCOME_LABELS, formatFigure } from "../utils/geography/format";
import { choiceMeasureNames } from "../utils/geography/selection";
import { fiscalYearLabel } from "../utils/publication/format";
import ConstituencyRankingTable, {
  APPROXIMATE_MARK,
  APPROXIMATE_NOTE,
  isApproximate,
} from "./ConstituencyRankingTable";
import "./ConstituencyRankings.css";

const TABLE_SIZE = 10;
const CHART_TITLE = "Constituency rankings";

// Excel reads a CSV as UTF-8 only with a byte-order mark ("Ynys Môn").
const UTF8_BOM = "﻿";

// Drill builds set NEXT_PUBLIC_MOCK=1; their numbers must never read as real.
const isMockBuild = () => process.env.NEXT_PUBLIC_MOCK === "1";

// The map's order: % of income first.
const METRIC_OPTIONS = ["pct", "gbp"].map((metric) => ({
  value: metric,
  label: OUTCOME_LABELS[RANK_METRICS[metric].outcome],
}));

/**
 * The 10 constituencies with the highest and the 10 with the lowest
 * average change, and a CSV of every constituency, from the same published
 * rows as the map. It reads the map's state (useConstituencyView), so it
 * has figures exactly when the map draws them: the same release routing,
 * the same published-file gate. Otherwise it keeps its layout, with empty
 * tables and a disabled download, and says nothing of its own: the map's
 * notice is the page's one notice for results by constituency.
 */
export default function ConstituencyRankings({
  selectedPolicies = [],
  selectedYear = 2029,
  policies = [],
}) {
  const [metric, setMetric] = useState("pct");
  const { outcome } = RANK_METRICS[metric];
  const { view, choice, table, features } = useConstituencyView({
    selectedPolicies,
    policies,
    selectedYear,
    outcome,
  });
  const reform = view.kind === "rows" ? view.reform : null;
  const yearLabel = fiscalYearLabel(selectedYear);
  const title = `${CHART_TITLE}, ${yearLabel}`;

  const entries = useMemo(
    () => rankingEntries(features, table, { reform, year: selectedYear }),
    [features, table, reform, selectedYear],
  );
  const ranked = useMemo(() => rankConstituencies(entries, metric), [entries, metric]);
  const ready = Boolean(reform) && ranked.length > 0;
  const mock = ready && isMockBuild();

  const handleDownload = () => {
    const csv = buildRankingCsv(entries, {
      metric,
      year: selectedYear,
      yearLabel,
      measures: choiceMeasureNames(choice, policies),
      mock,
    });
    downloadFile(
      `${UTF8_BOM}${csv}`,
      `${mock ? "MOCK-" : ""}constituency-rankings-${reform}-${selectedYear}-by-${metric}.csv`,
      "text/csv;charset=utf-8",
    );
  };

  const { top, bottom, topTie, bottomTie } = ready
    ? selectTopAndBottom(ranked, TABLE_SIZE)
    : { top: [], bottom: [], topTie: null, bottomTie: null };

  return (
    <div
      className="constituency-rankings"
      role="region"
      aria-labelledby="constituency-rankings-title"
    >
      <div className="chart-header">
        <div>
          <h3 id="constituency-rankings-title">
            {mock && <span className="rankings-mock-badge">MOCK DATA</span>}
            {CHART_TITLE}, <span className="nowrap">{yearLabel}</span>
          </h3>
          <p className="chart-description">
            The {TABLE_SIZE} constituencies with the highest and the{" "}
            {TABLE_SIZE} with the lowest average change in household net
            income, from the same figures as the map.
          </p>
        </div>
        {ready ? (
          <ChartDownloadMenu
            formats={{ csv: handleDownload }}
            chartTitle={title}
            ariaLabel={`Download all ${entries.length} constituencies: ${title}`}
          />
        ) : (
          <ChartDownloadMenu
            formats={{}}
            chartTitle={title}
            disabledReason="Available when results are published"
          />
        )}
      </div>

      {ready && (
        <div className="rankings-controls">
          <PillSelect
            variant="light"
            name="Rank by"
            prefix="Rank by"
            value={metric}
            onChange={setMetric}
            options={METRIC_OPTIONS}
          />
        </div>
      )}

      {ready && isAllTied(ranked) ? (
        <p className="rankings-note">
          Every constituency has the same average change (
          {formatFigure(outcome, ranked[0].rows[outcome].value)}) in{" "}
          {yearLabel}, so there is no ranking by{" "}
          {OUTCOME_LABELS[outcome]}.
        </p>
      ) : (
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
      )}
      {[...top, ...bottom].some(isApproximate) && (
        <p className="rankings-note">{APPROXIMATE_MARK} {APPROXIMATE_NOTE}</p>
      )}
    </div>
  );
}
