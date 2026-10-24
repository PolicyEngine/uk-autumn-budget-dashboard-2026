import { Fragment, useState } from "react";
import { buildChartCsv } from "../../utils/chartCsv";
import { useNarrowViewport } from "../../utils/chartTheme";
import { largestChangesSentence, money, programmeGroups, signedMoney } from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { downloadFile } from "../../utils/downloadFile";

const changeClass = (value) => {
  const rounded = Math.round(value);
  if (rounded > 0) return "is-gain";
  if (rounded < 0) return "is-loss";
  return "is-zero";
};

/**
 * Change by tax and benefit: each programme before and after the selected
 * policies, and the change, grouped into taxes (as negative amounts),
 * benefits, and earnings and other income. No net income row: the totals
 * are the headline tiles. Income tax and Universal Credit open to their
 * parts, closed at first. On a phone the table is Programme | Change, and
 * each row opens to its before and after.
 *
 * @param {Object} props
 * @param {Array} props.programmes - normaliseHouseholdImpact's programmes
 * @param {string} props.yearLabel - "2029-30"
 */
export default function ProgrammeTable({ programmes, yearLabel }) {
  const narrow = useNarrowViewport();
  const [open, setOpen] = useState(() => new Set());
  const groups = programmeGroups(programmes);
  const title = `Taxes and benefits before and after, ${yearLabel}`;
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const formats = {
    csv: () =>
      downloadFile(
        buildChartCsv({
          title,
          units: "£ a year; taxes as negative amounts; the change is the effect on the household's net income",
          source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
          columns: [
            { key: "group", label: "Group" },
            { key: "programme", label: "Programme" },
            { key: "before", label: "Before (£)", decimals: 0 },
            { key: "after", label: "After (£)", decimals: 0 },
            { key: "change", label: "Change (£)", decimals: 0 },
          ],
          rows: groups.flatMap((group) =>
            group.rows.flatMap((row) => [
              { group: group.label, programme: row.label, before: row.before, after: row.after, change: row.change },
              ...row.children.map((child) => ({
                group: group.label,
                programme: `${row.label}: ${child.label}`,
                before: child.before,
                after: child.after,
                change: child.change,
              })),
            ]),
          ),
        }),
        `taxes-and-benefits-${yearLabel}.csv`,
        "text/csv;charset=utf-8",
      ),
  };

  const columns = narrow ? 2 : 4;

  const renderRow = (row, depth = 0) => {
    // On a phone every row opens (to its before and after); on a wider
    // screen only rows with parts do
    const expandable = narrow || row.children.length > 0;
    const isOpen = open.has(row.id);
    const label = (
      <span className={`programme-name depth-${depth}`}>
        {row.label}
      </span>
    );
    return (
      <Fragment key={`${depth}-${row.id}`}>
        <tr className={`programme-row depth-${depth}`}>
          <th scope="row">
            {expandable && depth === 0 ? (
              <button
                type="button"
                className="programme-toggle"
                aria-expanded={isOpen}
                onClick={() => toggle(row.id)}
              >
                <span className="programme-chevron" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
                {label}
              </button>
            ) : (
              label
            )}
          </th>
          {!narrow && <td className="num">{money(row.before)}</td>}
          {!narrow && <td className="num">{money(row.after)}</td>}
          <td className={`num change ${changeClass(row.change)}`}>{signedMoney(row.change)}</td>
        </tr>
        {isOpen && narrow && depth === 0 && (
          <tr className="programme-detail">
            <td colSpan={columns}>
              Before {money(row.before)} → after {money(row.after)}
            </td>
          </tr>
        )}
        {isOpen && depth === 0 && row.children.map((child) => renderRow(child, 1))}
      </Fragment>
    );
  };

  return (
    <div className="card single-year-card">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          <p className="chart-description">{largestChangesSentence(groups)}</p>
        </div>
        <ChartDownloadMenu formats={formats} chartTitle={title} ariaLabel={`Download table: ${title}`} />
      </div>
      <div className="programme-table-wrap">
        <table className="programme-table">
          <thead>
            <tr>
              <th scope="col">Programme</th>
              {!narrow && <th scope="col" className="num">Before</th>}
              {!narrow && <th scope="col" className="num">After</th>}
              <th scope="col" className="num">Change</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.id}>
              <tr className="programme-group">
                <th scope="colgroup" colSpan={columns}>
                  {group.label}
                </th>
              </tr>
              {group.rows.map((row) => renderRow(row))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="single-year-quiet">Totals are in the tiles above.</p>
    </div>
  );
}
