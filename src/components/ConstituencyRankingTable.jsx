import { RANK_METRICS, describeList } from "../utils/constituencyRanking";
import { OUTCOME_LABELS, formatFigure } from "../utils/geography/format";

export const APPROXIMATE_MARK = "≈";
export const APPROXIMATE_NOTE =
  "Approximate: few survey households, so the interval understates the uncertainty.";

/** Whether either of a constituency's figures rests on few survey households. */
export const isApproximate = (entry) =>
  Object.values(entry.rows ?? {}).some((row) => row?.tier === "approximate");

function Figure({ row, outcome }) {
  if (!row || row.tier === "withheld" || row.value === "") {
    return <span className="ranking-no-figure">Not published</span>;
  }
  return (
    <>
      {row.tier === "approximate" && (
        <span className="ranking-approximate" title={APPROXIMATE_NOTE}>
          <span aria-hidden="true">{APPROXIMATE_MARK} </span>
          <span className="visually-hidden">approximately </span>
        </span>
      )}
      {formatFigure(outcome, row.value)}
    </>
  );
}

/**
 * One ranked list. `position` is "top" (highest first) or "bottom" (lowest
 * first); `tie` reports a tied group that the list's cut splits. With no
 * rows, the table keeps its header and `size` empty rows, so the card's
 * layout is final before results are published.
 */
export default function ConstituencyRankingTable({ position, rows, metric, tie, size }) {
  const sort = position === "top" ? "descending" : "ascending";
  const { outcome } = RANK_METRICS[metric];
  const heading = position === "top" ? "Top" : "Bottom";
  const unit = metric === "gbp" ? "£" : "%";

  // Half a card wide, so one figure: the one ranked by. The CSV has both.
  return (
    <div className="ranking-table-wrapper">
      <h4>
        {heading} {rows.length || size}
        {rows.length > 0 && (
          <span className="ranking-table-kind">
            : {describeList(rows, metric, position).toLowerCase()}
          </span>
        )}
      </h4>
      <table className="ranking-table">
        {rows.length > 0 && (
          <caption className="visually-hidden">
            {describeList(rows, metric, position)} ({OUTCOME_LABELS[outcome]})
          </caption>
        )}
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Constituency</th>
            <th
              scope="col"
              className="number"
              aria-sort={rows.length ? sort : undefined}
            >
              Change ({unit})
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 &&
            Array.from({ length: size }, (_, index) => (
              <tr key={index} className="ranking-placeholder-row" aria-hidden="true">
                <td colSpan={3}>
                  <span className="ranking-placeholder-bar" />
                </td>
              </tr>
            ))}
          {rows.map((row) => (
            <tr key={row.constituency_code}>
              <td>
                {row.tied && (
                  <>
                    <span aria-hidden="true">=</span>
                    <span className="visually-hidden">tied </span>
                  </>
                )}
                {row.rank}
              </td>
              <th scope="row">
                {row.constituency_name}
                {/* The region or country, under the name */}
                <span className="region-inline">
                  <span className="visually-hidden">, </span>
                  {row.region}
                </span>
              </th>
              <td className="number">
                <Figure row={row.rows[outcome]} outcome={outcome} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tie && (
        <p className="ranking-tie-note">
          {tie.total} constituencies are tied at rank ={tie.rank}; this table
          shows {tie.shown} of them, in name order. The CSV lists them all.
        </p>
      )}
    </div>
  );
}
