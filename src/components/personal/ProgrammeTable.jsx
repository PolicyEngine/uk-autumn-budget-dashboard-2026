import { Fragment, useRef, useState } from "react";
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
import TitleIcon from "../TitleIcon";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { htmlImageFormats } from "../../utils/chartDownloads";
import ChartMoreInfo from "../ChartMoreInfo";
import { HOUSEHOLD_ABOUT_ID, METHOD_ANCHORS } from "../methodology/anchors";
import MeasureRowLabel from "../MeasureRowLabel";
import Tip from "../Tip";
import { usePolicyParameters } from "../PolicyChange";
import { parameterChange, policyTabs } from "../../utils/policyBreakdown";
import { vatRowLabel } from "../../utils/singleYear";
import { policyDetailsFor } from "../../utils/policyDetails";
import { formatValue } from "../../utils/policyParameters";

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
// so a rise in the amount is a fall in what you pay). Market income, taxes
// and benefits are always named; pension contributions only when they move.
const GROUP_WORDS = [
  { id: "income", noun: "market income", up: "rises", down: "falls", always: true },
  { id: "tax", noun: "taxes", up: "fall", down: "rise", always: true },
  { id: "benefit", noun: "benefits", up: "rise", down: "fall", always: true },
  { id: "pension", noun: "pension contributions", up: "fall", down: "rise", always: false },
];

// "Fuel duty" -> "fuel duty"; "VAT" and "Council Tax" keep their capitals;
// the "VAT change" row is just "VAT" in a sentence about changes
const inSentence = (label) => {
  const text = String(label ?? "").replace(/ change$/, "");
  return /[A-Z]/.test(text.slice(1)) ? text : text.charAt(0).toLowerCase() + text.slice(1);
};

// The row behind most of a group's change: "from fuel duty" when it is the
// only row that moves, "mostly fuel duty" when it is more than half
const mainRow = (group, change) => {
  const moving = (group.rows ?? []).filter((row) => Math.round(row.shown?.change ?? 0) !== 0);
  if (!moving.length) return "";
  if (moving.length === 1) return `, all from ${inSentence(moving[0].label)}`;
  const top = moving.reduce((a, b) => (Math.abs(b.shown.change) > Math.abs(a.shown.change) ? b : a));
  const share = Math.round(top.shown.change) / change;
  return share > 0.5 ? `, mostly ${inSentence(top.label)}` : "";
};

/**
 * The card's one line, under its title: each group the policies change, by
 * how much a year and which row is most of it, then those they leave
 * alone: "Taxes fall by £9 a year, mostly fuel duty; market income and
 * benefits are unchanged." The net change is the result card's.
 */
export function breakdownSentence(groups) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const moved = [];
  const still = [];
  for (const words of GROUP_WORDS) {
    const group = byId.get(words.id);
    if (!group && !words.always) continue;
    const change = Math.round(group?.shown?.change ?? 0);
    if (change === 0) {
      if (words.always) still.push(words.noun);
    } else {
      moved.push(`${words.noun} ${change > 0 ? words.up : words.down} by ${money(Math.abs(change))} a year${mainRow(group, change)}`);
    }
  }
  if (!moved.length) return "No change to your taxes or benefits.";
  const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
  const parts = [...moved];
  if (still.length) parts.push(`${list(still)} ${still.length === 1 && still[0] === "market income" ? "is" : "are"} unchanged`);
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export default function ProgrammeTable({
  programmes,
  totals,
  bars = [],
  split = null,
  splitStatus = null,
  policies = [],
  household = null,
  salaryUsed = null,
  year = null,
  yearLabel,
  engine = {},
  parameterTables,
}) {
  const narrow = useNarrowViewport();
  // The VAT row named by what moves it: VAT on fuel duty when only the fuel
  // duty policy does (HH5)
  const vatLabel = vatRowLabel(split?.rows, (id) => policyDetailsFor(policies.find((policy) => policy.id === id))?.type);
  const relabel = (rows) => rows?.map((row) => ({ ...row, ...(row.id === "vat_change" ? { label: vatLabel } : {}), ...(row.rows ? { rows: relabel(row.rows) } : {}), ...(row.children ? { children: relabel(row.children) } : {}) }));
  const groups = relabel(groupTotals(roundProgrammeGroups(programmeGroups(programmes), totals, bars)));
  // One tab per selected policy that changes this household, from the
  // split by policy once it is in (policyBreakdown.js)
  const parameters = usePolicyParameters(parameterTables);
  const { tabs: policyTabList, noEffect } = policyTabs({
    bars: split,
    groups,
    policies,
    parameters,
    year,
    household,
    salaryUsed,
  });
  const [tab, setTab] = useState("summary");
  // The tab row whenever the page asks for the split by policy: until it is
  // in (or if it fails), Summary alone with a quiet note why
  const showTabs = policyTabList.length > 0 || splitStatus !== null || noEffect.length > 0;
  const pendingNote =
    split || !splitStatus || splitStatus === "ready"
      ? null
      : splitStatus === "error"
        ? "The breakdown by policy is unavailable"
        : "Breakdown by policy loading…";
  const activePolicy = policyTabList.find((item) => item.id === tab) ?? null;
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

  // The table, for its image downloads
  const [table, setTable] = useState(null);
  const summaryFormats = {
    // The table as an image, as every card's (chartDownloads)
    ...htmlImageFormats(() => table, `household-net-income-breakdown-${yearLabel}`),
    csv: () =>
      downloadFile(
        buildChartCsv({
          title,
          units: "£ a year; taxes and pension contributions as negative amounts; the change is the effect on the household's net income",
          source: "PolicyEngine UK household calculation, UK Autumn Budget 2026 dashboard",
          columns: [
            { key: "group", label: "Group" },
            { key: "item", label: "Item" },
            { key: "before", label: "Current law (£)", decimals: 0 },
            { key: "after", label: "With the policies (£)", decimals: 0 },
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
  const policyTitle = activePolicy ? `${title}: ${activePolicy.name}` : title;
  const policyFile = activePolicy ? `household-${activePolicy.id.replace(/_/g, "-")}-${yearLabel}` : "";
  const formats = activePolicy
    ? {
        ...htmlImageFormats(() => table, policyFile),
        csv: () =>
          downloadFile(
            buildChartCsv({
              title: policyTitle,
              units:
                "As shown in each row (£ a year, pence a litre or a rate); taxes as negative amounts; the effect is the change in the household's net income from this policy alone",
              source: "PolicyEngine UK household calculation and the model's policy parameters, UK Autumn Budget 2026 dashboard",
              columns: [
                { key: "section", label: "Section" },
                { key: "item", label: "Item" },
                { key: "before", label: "Current law" },
                { key: "after", label: "With the policies" },
                { key: "change", label: "Change" },
              ],
              rows: policyCsvRows(activePolicy),
            }),
            `${policyFile}.csv`,
            "text/csv;charset=utf-8",
          ),
      }
    : summaryFormats;

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
          {/* A change-only row (VAT change) has no before; its after is
              the change, signed as the other taxes */}
          {wide && (
            <td className={`num${row.changeOnly ? " is-none" : ""}`}>{row.changeOnly ? "—" : money(row.shown.before)}</td>
          )}
          {wide && <td className="num">{row.changeOnly ? changeText(row.shown.after) : money(row.shown.after)}</td>}
          <td className={`num change ${changeClass(row.shown.change)}`}>{changeText(row.shown.change)}</td>
        </tr>
        {isOpen && parts?.map((part) => renderRow(part, depth + 1, `${key}/${part.id}`))}
      </Fragment>
    );
  };

  return (
    // Headed as every other card: icon, title with its year and the
    // download, then one sentence on what the policies change. With the
    // split by policy in, tabs under the title: Summary (this table) and
    // one per policy that changes the household
    <div className="card single-year-card breakdown-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="layers" />
            <span className="title-text">{title}</span>
          </h3>
          {/* Named against the waterfall above: that is by policy, this by
              tax and benefit; both add up to the same change (HH5) */}
          <p className="chart-description">By tax and benefit.{!showTabs && ` ${sentence}`}</p>
        </div>
        <ChartDownloadMenu formats={formats} chartTitle={policyTitle} ariaLabel={`Download table: ${policyTitle}`} />
      </div>
      {showTabs && (
        <BreakdownTabs
          tabs={policyTabList}
          value={activePolicy ? activePolicy.id : "summary"}
          onChange={setTab}
          noEffect={noEffect}
          note={pendingNote}
        />
      )}
      {/* Each tab's one line: the Summary's sentence, or the policy's
          one-line summary (policyDetails.js; none for a measure it does
          not describe) */}
      {showTabs && !activePolicy && <p className="chart-description breakdown-tab-line">{sentence}</p>}
      {activePolicy?.how && (
        <p className="chart-description breakdown-tab-line">
          <span className="breakdown-how">How it works:</span> {activePolicy.how}
        </p>
      )}
      {narrow && (
        <button
          type="button"
          className="light-pill-button breakdown-columns-toggle"
          aria-pressed={showBoth}
          onClick={() => setShowBoth((value) => !value)}
        >
          {showBoth ? "Hide both columns" : "Show both columns"}
        </button>
      )}
      {activePolicy ? (
        <div
          className="programme-table-wrap"
          role="tabpanel"
          id={`breakdown-panel-${activePolicy.id}`}
          aria-labelledby={`breakdown-tab-${activePolicy.id}`}
        >
          <PolicyTable tab={activePolicy} wide={wide} setTable={setTable} title={policyTitle} />
        </div>
      ) : (
      <div
        className="programme-table-wrap"
        {...(showTabs
          ? { role: "tabpanel", id: "breakdown-panel-summary", "aria-labelledby": "breakdown-tab-summary" }
          : {})}
      >
        <table ref={setTable} className={`programme-table breakdown-table${wide ? "" : " is-change-only"}`} aria-label={title}>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Item</span>
              </th>
              {wide && (
                <th scope="col" className="num">
                  Current law
                </th>
              )}
              {wide && (
                <th scope="col" className="num">
                  With the policies
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
      )}
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

/** A policy tab's rows as CSV rows, with each figure as the table shows it. */
export function policyCsvRows(tab) {
  const rows = [];
  for (const row of tab.parameters) {
    rows.push({
      section: "What changes",
      item: row.label,
      before: formatValue(row.before, row.unit),
      after: formatValue(row.after, row.unit),
      change: parameterChange(row) ?? "",
    });
  }
  for (const row of tab.household) {
    if (row.kind === "heading") {
      rows.push({ section: "For your household", item: row.label, before: "", after: "", change: "" });
      continue;
    }
    const cells = householdCells(row);
    rows.push({ section: "For your household", item: row.label, before: cells.before, after: cells.after, change: cells.change });
  }
  rows.push({ section: "Effect on your net income", item: "Effect on your net income", before: "", after: "", change: signedMoney(tab.effect) });
  const blank = (value) => (value === "—" ? "" : value);
  return rows.map((row) => ({ ...row, before: blank(row.before), after: blank(row.after), change: blank(row.change) }));
}

/** A household row's three cells as text. */
function householdCells(row) {
  if (row.kind === "part") {
    // A part of the effect: its before and after where it has them (a
    // change-only row, VAT change, has no before)
    const none = row.before === null || row.before === undefined;
    return {
      before: none || row.changeOnly ? "—" : money(row.before),
      after: none ? "—" : row.changeOnly ? changeText(row.after) : money(row.after),
      change: changeText(row.change),
      changeClass: changeClass(row.change),
    };
  }
  if (row.kind === "step") {
    const diff = Math.round(row.after) - Math.round(row.before);
    return { before: money(row.before), after: money(row.after), change: diff === 0 ? "—" : signedMoney(diff), changeClass: diff === 0 ? "is-zero" : "is-neutral" };
  }
  // An input: the same before and after
  return { before: money(row.before), after: money(row.after), change: "—", changeClass: "is-zero" };
}

const sectionRow = (label, wide) => (
  <tr className="programme-row depth-0 is-group is-section">
    <th scope="rowgroup" colSpan={wide ? 4 : 2}>
      <span className="programme-leaf">
        <span className="programme-chevron-space" aria-hidden="true" />
        <span className="programme-name">{label}</span>
      </span>
    </th>
  </tr>
);

const leaf = (label) => (
  <span className="programme-leaf">
    <span className="programme-chevron-space" aria-hidden="true" />
    <span className="programme-name">{label}</span>
  </span>
);

/**
 * One policy's table, in the Summary's style: What changes (its
 * parameters for the year), For your household (inputs, checked steps and
 * the rows it alone moves) and the highlighted effect on net income.
 */
function PolicyTable({ tab, wide, setTable, title }) {
  return (
    <table ref={setTable} className={`programme-table breakdown-table policy-table${wide ? "" : " is-change-only"}`} aria-label={title}>
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
        {tab.parameters.length > 0 && sectionRow("What changes", wide)}
        {tab.parameters.map((row) => {
          const change = parameterChange(row);
          return (
            <tr key={`p-${row.id}`} className="programme-row depth-1">
              <th scope="row">{leaf(row.label)}</th>
              {wide && <td className="num">{formatValue(row.before, row.unit)}</td>}
              {wide && <td className="num">{formatValue(row.after, row.unit)}</td>}
              <td className={`num change ${change ? "is-neutral" : "is-zero"}`}>{change ?? "—"}</td>
            </tr>
          );
        })}
        {tab.household.length > 0 && sectionRow("For your household", wide)}
        {tab.household.map((row) => {
          // A heading inside the section: its name alone
          if (row.kind === "heading") {
            return (
              <tr key={`h-${row.id}`} className="programme-row depth-1 is-subheading">
                <th scope="rowgroup" colSpan={wide ? 4 : 2}>
                  {leaf(row.label)}
                </th>
              </tr>
            );
          }
          const cells = householdCells(row);
          return (
            <tr key={`h-${row.id}`} className={`programme-row depth-${row.depth ?? 1}`}>
              <th scope="row">{leaf(row.label)}</th>
              {wide && <td className={`num${cells.before === "—" ? " is-none" : ""}`}>{cells.before}</td>}
              {wide && <td className={`num${cells.after === "—" ? " is-none" : ""}`}>{cells.after}</td>}
              <td className={`num change ${cells.changeClass}`}>{cells.change}</td>
            </tr>
          );
        })}
        <tr className="breakdown-effect-row">
          <th scope="row">{leaf("Effect on your net income")}</th>
          {wide && <td className="num is-none">—</td>}
          {wide && <td className="num is-none">—</td>}
          <td className={`num change ${changeClass(tab.effect)}`}>{changeText(tab.effect)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * The card's tabs: Summary, then one per policy that changes the household
 * (the policy's badge label: its tinted icon and short name), and the rest
 * folded into a muted "+N with no effect for you". A WAI-ARIA tablist with
 * automatic activation: Left/Right (wrapping) and Home/End move to a tab
 * and show it; only the chosen tab is in the Tab order. On a phone the row
 * scrolls sideways.
 */
function BreakdownTabs({ tabs, value, onChange, noEffect, note = null }) {
  const refs = useRef({});
  const all = [{ id: "summary", label: "Summary" }, ...tabs];
  const onKeyDown = (event) => {
    const current = all.findIndex((tab) => tab.id === value);
    const last = all.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = all[next];
    onChange(tab.id);
    refs.current[tab.id]?.focus();
  };
  return (
    <div className="breakdown-tabs-bar">
      <div className="breakdown-tabs" role="tablist" aria-label="Summary or one policy" onKeyDown={onKeyDown}>
        {all.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                refs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`breakdown-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={selected ? `breakdown-panel-${tab.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              className={`breakdown-tab${selected ? " is-selected" : ""}`}
              onClick={() => onChange(tab.id)}
            >
              {tab.measure ? <MeasureRowLabel measure={tab.measure} compact tip={false} /> : <span className="breakdown-tab-text">{tab.label}</span>}
            </button>
          );
        })}
      </div>
      {note && (
        <span className="breakdown-no-effect" role="status">
          {note}
        </span>
      )}
      {noEffect.length > 0 && (
        <Tip content={`No effect for your household: ${noEffect.map((item) => item.name).join("; ")}`}>
          <span className="breakdown-no-effect" tabIndex={0}>
            +{noEffect.length} with no effect for you
          </span>
        </Tip>
      )}
    </div>
  );
}
