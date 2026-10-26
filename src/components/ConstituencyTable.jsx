import { useMemo, useState } from "react";
import { RANK_METRICS, rankConstituencies } from "../utils/constituencyRanking";
import { formatFigure } from "../utils/geography/format";
import Tip from "./Tip";
import "./ConstituencyTable.css";

export const APPROXIMATE_MARK = "≈";
export const APPROXIMATE_NOTE =
  "Approximate: few survey households, so the interval understates the uncertainty.";

const collator = new Intl.Collator("en-GB");

/** A seat's state for the table: its row's tier, or no data. */
function stateOf(row) {
  if (!row) return "no-data";
  if (row.tier === "withheld" || row.value === "") return "withheld";
  return row.tier === "approximate" ? "approximate" : "reported";
}

function Figure({ row, outcome }) {
  const state = stateOf(row);
  if (state === "no-data") return <span className="ctable-na">No data</span>;
  if (state === "withheld") return <span className="ctable-na">Not published</span>;
  return (
    <>
      {state === "approximate" && (
        <Tip content={APPROXIMATE_NOTE}>
          <span className="ctable-approximate">
            <span aria-hidden="true">{APPROXIMATE_MARK} </span>
            <span className="visually-hidden">approximately </span>
          </span>
        </Tip>
      )}
      {formatFigure(outcome, row.value)}
    </>
  );
}

const COLUMNS = [
  { key: "rank", label: "#", sortable: false },
  { key: "name", label: "Constituency" },
  { key: "region", label: "Region" },
  { key: "value", label: "Change in household income" },
];

/**
 * The constituency card's Table view: every constituency, filtered by the
 * card's search box (`query`, a name or region), sortable by name, region or the change (largest gain
 * first by default). Constituencies without a figure keep the foot of the
 * list whichever way the change is sorted, with why there is none.
 *
 * Ported from María Juaristi's table in the high value council tax
 * surcharge map (PolicyEngine/uk-mansion-tax,
 * create_estimates_2028_29_map.py at 599f41d1, renderTable()).
 *
 * @param {Object} props
 * @param {Array<Object>} props.entries - from rankingEntries
 * @param {"gbp"|"pct"} props.metric - Which figure the value column shows
 * @param {string} [props.query] - The search box's text
 */
export default function ConstituencyTable({ entries, metric, query = "" }) {
  const [sort, setSort] = useState({ key: "value", dir: -1 });
  const { field, outcome } = RANK_METRICS[metric];

  const rows = useMemo(() => {
    const ranks = new Map(
      rankConstituencies(entries, metric).map((entry) => [entry.constituency_code, entry]),
    );
    return entries.map((entry) => ({
      code: entry.constituency_code,
      name: entry.constituency_name,
      region: entry.region || entry.country,
      value: entry[field],
      rank: ranks.get(entry.constituency_code)?.rank ?? null,
      tied: ranks.get(entry.constituency_code)?.tied ?? false,
      row: entry.rows[outcome],
    }));
  }, [entries, metric, field, outcome]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (row) => !q || row.name.toLowerCase().includes(q) || row.region.toLowerCase().includes(q),
    );
    const byName = (a, b) => collator.compare(a.name, b.name);
    return list.sort((a, b) => {
      if (sort.key === "value") {
        const aNone = a.value === null;
        const bNone = b.value === null;
        if (aNone || bNone) return aNone - bNone || byName(a, b);
        return sort.dir * (a.value - b.value) || byName(a, b);
      }
      return (
        sort.dir * collator.compare(a[sort.key], b[sort.key]) ||
        (a.value === null) - (b.value === null) ||
        (b.value ?? 0) - (a.value ?? 0)
      );
    });
  }, [rows, query, sort]);

  const counts = useMemo(() => {
    const tally = { reported: 0, approximate: 0, withheld: 0 };
    for (const row of rows) {
      const state = stateOf(row.row);
      if (state in tally) tally[state] += 1;
    }
    return tally;
  }, [rows]);

  const onSort = (key) =>
    setSort((previous) => ({
      key,
      dir: previous.key === key ? -previous.dir : key === "value" ? -1 : 1,
    }));

  const ariaSort = (key) =>
    sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none";

  return (
    <div className="ctable">
      <div className="ctable-head">
        <p className="ctable-count" aria-live="polite">
          {shown.length} of {rows.length} constituencies; {counts.reported} reported
          {counts.approximate > 0 && `, ${counts.approximate} approximate`}
          {counts.withheld > 0 && `, ${counts.withheld} not published`}
        </p>
      </div>
      <div className="ctable-scroll">
        <table className="ctable-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`ctable-col-${column.key}`}
                  aria-sort={column.sortable === false ? undefined : ariaSort(column.key)}
                >
                  {column.sortable === false ? (
                    <span aria-label="Rank">{column.label}</span>
                  ) : (
                    <button type="button" onClick={() => onSort(column.key)}>
                      {column.key === "value"
                        ? `${column.label} (${metric === "gbp" ? "£" : "%"})`
                        : column.label}
                      <span className="ctable-sort" aria-hidden="true">
                        {sort.key === column.key ? (sort.dir > 0 ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.code} data-code={row.code}>
                <td className="ctable-col-rank">
                  {row.rank !== null && (
                    <>
                      {row.tied && <span aria-hidden="true">=</span>}
                      {row.rank}
                    </>
                  )}
                </td>
                <th scope="row" className="ctable-col-name">
                  {row.name}
                  <span className="ctable-region-inline">{row.region}</span>
                </th>
                <td className="ctable-col-region">{row.region}</td>
                <td className="ctable-col-value">
                  <Figure row={row.row} outcome={outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="ctable-empty">No constituency or region matches “{query}”.</p>}
      </div>
      {counts.approximate > 0 && (
        <p className="ctable-note">
          {APPROXIMATE_MARK} {APPROXIMATE_NOTE}
        </p>
      )}
    </div>
  );
}
