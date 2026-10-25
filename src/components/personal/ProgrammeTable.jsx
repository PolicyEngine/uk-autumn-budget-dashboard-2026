import { Fragment, useState } from "react";
import { buildChartCsv } from "../../utils/chartCsv";
import { useNarrowViewport } from "../../utils/chartTheme";
import {
  SINGLE_YEAR_METHOD,
  groupTotals,
  money,
  programmeGroups,
  programmeNotes,
  roundProgrammeGroups,
  signedMoney,
} from "../../utils/singleYear";
import ChartDownloadMenu from "../ChartDownloadMenu";
import Disclosure from "../Disclosure";
import { downloadFile } from "../../utils/downloadFile";

const changeClass = (value) => {
  const rounded = Math.round(value);
  if (rounded > 0) return "is-gain";
  if (rounded < 0) return "is-loss";
  return "is-zero";
};

/**
 * Breakdown of household net income, laid out as Spring Statement 2026's
 * personal calculator: Before | After | Change for market income, taxes
 * (as negative amounts), benefits and pension contributions, then net
 * income. Each top row opens to its taxes or benefits, closed at first.
 * Net income shows its before and after only: its change is the headline
 * card above (each fact once). On a phone the table is Item | Change,
 * and each row opens to its before and after too.
 *
 * Whole pounds that agree with the rest of the page (roundProgrammeGroups):
 * the rows add up to net income, each row's after is its before plus its
 * change, and a row whose change is one policy's bar shows the bar's
 * figure.
 *
 * @param {Object} props
 * @param {Array} props.programmes - normaliseHouseholdImpact's programmes
 * @param {{before: number, after: number, change: number}} props.totals - headlineTotals
 * @param {Array} [props.bars] - policyRows(...).all, once the split by policy is in
 * @param {string} props.yearLabel - "2029-30"
 * @param {Object} [props.engine] - The API's versions
 */
export default function ProgrammeTable({ programmes, totals, bars = [], yearLabel, engine = {} }) {
  const narrow = useNarrowViewport();
  const [open, setOpen] = useState(() => new Set());
  const groups = groupTotals(roundProgrammeGroups(programmeGroups(programmes), totals, bars));
  const notes = programmeNotes(groups);
  const title = `Breakdown of household net income, ${yearLabel}`;
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
          units: "£ a year; taxes and pension contributions as negative amounts; the change is the effect on the household's net income",
          source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
          columns: [
            { key: "group", label: "Group" },
            { key: "item", label: "Item" },
            { key: "before", label: "Before (£)", decimals: 0 },
            { key: "after", label: "After (£)", decimals: 0 },
            { key: "change", label: "Change (£)", decimals: 0 },
          ],
          rows: [
            ...groups.flatMap((group) => [
              { group: group.label, item: "Total", ...group.shown },
              ...group.rows.flatMap((row) => [
                { group: group.label, item: row.label, ...row.shown },
                ...row.children.map((child) => ({
                  group: group.label,
                  item: `${row.label}: ${child.label}`,
                  ...child.shown,
                })),
              ]),
            ]),
            { group: "Net income", item: "Total", ...totals },
          ],
        }),
        `household-net-income-breakdown-${yearLabel}.csv`,
        "text/csv;charset=utf-8",
      ),
  };

  const columns = narrow ? 2 : 4;

  // One row: a group (depth 0), a programme (1) or a programme's part (2)
  const renderRow = (row, depth, key, color) => {
    const hasParts = (row.children ?? row.rows ?? []).length > 0;
    // On a phone every row opens (to its before and after)
    const expandable = depth < 2 && (narrow || hasParts);
    const isOpen = open.has(key);
    const parts = depth === 0 ? row.rows : row.children;
    const label = (
      <span className="programme-name">
        {color && <span className="breakdown-dot" style={{ background: color }} aria-hidden="true" />}
        {row.label}
      </span>
    );
    return (
      <Fragment key={key}>
        <tr className={`programme-row depth-${depth}`}>
          <th scope="row">
            {expandable ? (
              <button type="button" className="programme-toggle" aria-expanded={isOpen} onClick={() => toggle(key)}>
                <span className="programme-chevron" aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
                {label}
              </button>
            ) : (
              label
            )}
          </th>
          {!narrow && <td className="num">{money(row.shown.before)}</td>}
          {!narrow && <td className="num">{money(row.shown.after)}</td>}
          <td className={`num change ${changeClass(row.shown.change)}`}>{signedMoney(row.shown.change)}</td>
        </tr>
        {isOpen && narrow && (
          <tr className={`programme-detail depth-${depth}`}>
            <td colSpan={columns}>
              Before {money(row.shown.before)} → after {money(row.shown.after)}
            </td>
          </tr>
        )}
        {isOpen && parts?.map((part) => renderRow(part, depth + 1, `${key}/${part.id}`))}
      </Fragment>
    );
  };

  return (
    <div className="card single-year-card breakdown-card">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
        </div>
        <ChartDownloadMenu formats={formats} chartTitle={title} ariaLabel={`Download table: ${title}`} />
      </div>
      <div className="programme-table-wrap">
        <table className="programme-table breakdown-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Item</span>
              </th>
              {!narrow && (
                <th scope="col" className="num">
                  Before
                </th>
              )}
              {!narrow && (
                <th scope="col" className="num">
                  After
                </th>
              )}
              <th scope="col" className="num">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => renderRow(group, 0, group.id, group.color))}
            <tr className="breakdown-net-row">
              <th scope="row">Net income</th>
              {!narrow && <td className="num">{money(totals.before)}</td>}
              {!narrow && <td className="num">{money(totals.after)}</td>}
              <td className="num">
                {narrow ? (
                  `${money(totals.before)} → ${money(totals.after)}`
                ) : (
                  <span className="visually-hidden">See the headline above.</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Disclosure inCard title="About these figures" contentClassName="breakdown-about">
        {notes.length > 0 && (
          <>
            <h4 className="breakdown-about-heading">Rows in the table</h4>
            <dl className="breakdown-notes">
              {notes.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>{item.note}</dd>
                </div>
              ))}
            </dl>
            <h4 className="breakdown-about-heading">How it is calculated</h4>
          </>
        )}
        <dl className="breakdown-notes">
          {SINGLE_YEAR_METHOD.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
          {engine.policyengine && (
            <div>
              <dt>Versions</dt>
              <dd>
                policyengine {engine.policyengine}
                {engine["policyengine-uk"] ? `, policyengine-uk ${engine["policyengine-uk"]}` : ""}.
              </dd>
            </div>
          )}
        </dl>
      </Disclosure>
    </div>
  );
}
