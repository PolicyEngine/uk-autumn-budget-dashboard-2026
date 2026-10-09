import { RANK_METRICS, describeList } from "../utils/constituencyRanking";

export const formatPounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
}).format;

export const formatPercent = (value) => {
  const magnitude = Math.abs(value).toFixed(2);
  if (Number(magnitude) === 0) return "0.00%";
  return `${value > 0 ? "+" : "-"}${magnitude}%`;
};

/**
 * One ranked list. `position` is "top" (highest first) or "bottom" (lowest
 * first); `tie` reports a tied group that the list's cut splits.
 */
export default function ConstituencyRankingTable({
  position,
  rows,
  metric,
  regionLookup,
  tie,
}) {
  const sort = position === "top" ? "descending" : "ascending";
  const sortFor = (key) => (metric === key ? sort : undefined);
  const ranked = (key) => (metric === key ? "ranked" : "");

  return (
    <div className="ranking-table-wrapper">
      <h3>
        {position === "top" ? "Top" : "Bottom"} {rows.length}
      </h3>
      <table className="ranking-table">
        <caption>
          {describeList(rows, metric, position)} ({RANK_METRICS[metric].label})
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Constituency</th>
            <th scope="col" className="col-region">
              Region or country
            </th>
            <th
              scope="col"
              className={ranked("gbp")}
              aria-sort={sortFor("gbp")}
            >
              Change (£)
            </th>
            <th
              scope="col"
              className={ranked("pct")}
              aria-sort={sortFor("pct")}
            >
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
                  {/* Narrow screens drop the region column and show it here */}
                  <span className="region-inline">
                    <span className="visually-hidden">, </span>
                    {region}
                  </span>
                </th>
                <td className="col-region">{region}</td>
                <td className={`number ${ranked("gbp")}`}>
                  {formatPounds(row.average_gain)}
                </td>
                <td className={`number ${ranked("pct")}`}>
                  {formatPercent(row.relative_change)}
                </td>
              </tr>
            );
          })}
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
