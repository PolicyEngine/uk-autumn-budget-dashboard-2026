import { Fragment, useState } from "react";
import { buildChartCsv } from "../../utils/chartCsv";
import { useNarrowViewport } from "../../utils/chartTheme";
import {
  groupTotals,
  money,
  programmeGroups,
  programmeNotes,
  roundProgrammeGroups,
  signedMoney,
} from "../../utils/singleYear";
import { ChevronRight } from "lucide-react";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartMoreInfo from "../ChartMoreInfo";
import { HOUSEHOLD_ABOUT_ID, METHOD_ANCHORS } from "../methodology/anchors";

// A row's note from the API, without any internal constant's name in
// brackets ("(COUNCIL_TAX_BAND_D)")
const plainNote = (text) => String(text ?? "").replace(/\s*\([A-Z][A-Z0-9_]{3,}\)/g, "");
import { downloadFile } from "../../utils/downloadFile";

/** "+£60", "−£12", or a muted "—" for no change. */
const changeText = (value) => (Math.round(value) === 0 ? "—" : signedMoney(value));

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
 * income. Each top row shows its taxes or benefits, open at first.
 * Net income is the total row, with its change (the rows add up to it).
 * On a phone the table is Item | Change, with one switch to show Before
 * and After.
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
// Each group in words: what "up" means for it (taxes are negative amounts,
// so a rise in the amount is a fall in what you pay)
const GROUP_WORDS = {
  income: { noun: "income", up: "rises", down: "falls" },
  tax: { noun: "taxes", up: "fall", down: "rise" },
  benefit: { noun: "benefits", up: "rise", down: "fall" },
  pension: { noun: "pension contributions", up: "fall", down: "rise" },
};

/**
 * The card's one line: each group the policies change, by how much a year,
 * then those they leave alone: "Your taxes fall by £60 a year with the
 * selected policies; income and benefits are unchanged."
 */
export function breakdownSentence(groups) {
  const moved = [];
  const still = [];
  for (const group of groups) {
    const words = GROUP_WORDS[group.id];
    if (!words) continue;
    const change = Math.round(group.shown?.change ?? 0);
    if (change === 0) still.push(words.noun);
    else moved.push(`${words.noun} ${change > 0 ? words.up : words.down} by ${money(Math.abs(change))} a year`);
  }
  const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
  if (!moved.length) return "The selected policies leave your income, taxes and benefits unchanged.";
  const first = `Your ${list(moved)} with the selected policies`;
  if (!still.length) return `${first}.`;
  return `${first}; ${list(still)} ${still.length === 1 && still[0] === "income" ? "is" : "are"} unchanged.`;
}

export default function ProgrammeTable({ programmes, totals, bars = [], yearLabel, engine = {} }) {
  const narrow = useNarrowViewport();
  const groups = groupTotals(roundProgrammeGroups(programmeGroups(programmes), totals, bars));
  // Open at first: each group shows its taxes or benefits
  const [open, setOpen] = useState(
    () => new Set(groups.filter((group) => (group.rows ?? []).length > 0).map((group) => group.id)),
  );
  const notes = programmeNotes(groups);
  const title = `Your income, taxes and benefits, ${yearLabel}`;
  const sentence = breakdownSentence(groups);
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

  // On a phone the table is Item | Change; Before and After open together
  // with one switch above it
  const [showBoth, setShowBoth] = useState(false);
  const wide = !narrow || showBoth;

  // One row: a group (depth 0, semibold on a tint), a programme (1) or a
  // programme's part (2). Every row keeps a chevron's width, so names at
  // one depth start at one indent whether or not they open.
  const renderRow = (row, depth, key) => {
    const parts = depth === 0 ? row.rows : row.children;
    const expandable = depth < 2 && (parts ?? []).length > 0;
    const isOpen = open.has(key);
    const name = <span className="programme-name">{row.label}</span>;
    return (
      <Fragment key={key}>
        <tr className={`programme-row depth-${depth}${depth === 0 ? " is-group" : ""}`}>
          <th scope="row">
            {expandable ? (
              <button type="button" className="programme-toggle" aria-expanded={isOpen} onClick={() => toggle(key)}>
                <ChevronRight className={`programme-chevron${isOpen ? " is-open" : ""}`} size={14} strokeWidth={2} aria-hidden="true" />
                {name}
              </button>
            ) : (
              <span className="programme-leaf">
                <span className="programme-chevron-space" aria-hidden="true" />
                {name}
              </span>
            )}
          </th>
          {wide && <td className="num">{money(row.shown.before)}</td>}
          {wide && <td className="num">{money(row.shown.after)}</td>}
          <td className={`num change ${changeClass(row.shown.change)}`}>{changeText(row.shown.change)}</td>
        </tr>
        {isOpen && parts?.map((part) => renderRow(part, depth + 1, `${key}/${part.id}`))}
      </Fragment>
    );
  };

  return (
    // The section heading above names the table and its year; the card
    // has the one sentence, the download and the table
    <div className="card single-year-card breakdown-card">
      <div className="chart-header breakdown-header">
        {/* One line beside the download: which groups the policies
            change, and by how much */}
        <p className="chart-description">{sentence}</p>
        <ChartDownloadMenu formats={formats} chartTitle={title} ariaLabel={`Download table: ${title}`} />
      </div>
      {narrow && (
        <button
          type="button"
          className="light-pill-button breakdown-columns-toggle"
          aria-pressed={showBoth}
          onClick={() => setShowBoth((value) => !value)}
        >
          {showBoth ? "Hide before and after" : "Show before and after"}
        </button>
      )}
      <div className="programme-table-wrap">
        <table className={`programme-table breakdown-table${wide ? "" : " is-change-only"}`} aria-label={title}>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Item</span>
              </th>
              {wide && (
                <th scope="col" className="num">
                  Before
                </th>
              )}
              {wide && (
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
            {groups.map((group) => renderRow(group, 0, group.id))}
            <tr className="breakdown-net-row">
              <th scope="row">
                <span className="programme-leaf">
                  <span className="programme-chevron-space" aria-hidden="true" />
                  <span className="programme-name">Net income</span>
                </span>
              </th>
              {wide && <td className="num">{money(totals.before)}</td>}
              {wide && <td className="num">{money(totals.after)}</td>}
              {/* The table's total: the rows above add up to it */}
              <td className={`num change ${changeClass(totals.change)}`}>{changeText(totals.change)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div id={HOUSEHOLD_ABOUT_ID} className="chart-footer">
        <ChartMoreInfo
          info={{
            // Only how this table's own rows are estimated; the household
            // calculation's method is in Methodology
            how: notes.map((item) => (
              <span key={item.id}>
                <strong>{item.label}</strong>: {plainNote(item.note)}
              </span>
            )),
            method: { anchor: METHOD_ANCHORS.householdCalc, label: "How the household calculation works" },
          }}
        />
      </div>
    </div>
  );
}
