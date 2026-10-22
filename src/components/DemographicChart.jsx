import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { TOOLTIP_PROPS } from "./ChartTooltip";
import OutcomeToggle from "./OutcomeToggle";
import PillSelect from "./PillSelect";
import YearSlider from "./YearSlider";
import UnavailableNotice from "./publication/UnavailableNotice";
import useChartYear from "../hooks/useChartYear";
import { useDemographicsData } from "../hooks/useDemographicsData";
import { PolicyEngineLogo } from "../utils/chartLogo";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import {
  AXIS_LINE,
  GRID_PROPS,
  TICK_STYLE,
  useNarrowViewport,
} from "../utils/chartTheme";
import { downloadFile } from "../utils/downloadFile";
import {
  AGE_GROUP,
  DEMOGRAPHIC_LEVELS,
  EMPLOYMENT,
  GROUPS,
  LEVEL_LABELS,
  YOUNG_PEOPLE,
} from "../utils/demographics/groups";
import { OUTCOMES } from "../utils/geography/columns";
import {
  EXPORT_NOTES,
  buildCsv,
  buildTxt,
  formatGenerated,
} from "../utils/geography/exportTable";
import {
  DIRECTION_SHORT_LABELS,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  WITHHELD_NOTE,
  describeRow,
  formatFigure,
  formatInterval,
} from "../utils/geography/format";
import { lookupRow } from "../utils/geography/rows";
import {
  choiceLabel,
  choiceMeasureNames,
  chooseReform,
} from "../utils/geography/selection";
import { viewState } from "../utils/geography/view";
import { fiscalYearLabel } from "../utils/publication/format";
import "./DemographicChart.css";

const TITLE = "Results by group";
const SUBJECT = "results by group";
const PLOT_HEIGHT = 350;
const COLORS = Object.freeze({ reported: "#319795", approximate: "#319795" });
const OPACITY = Object.freeze({ reported: 1, approximate: 0.45 });

/** The outcome switch's labels: each figure is an average over people. */
const OUTCOME_LABELS = Object.freeze({
  average_change: "£ a year",
  relative_change: "% of income",
});

const OUTCOME_CAPTIONS = Object.freeze({
  average_change:
    "Average change in household net income of the people in each group, in £ a year",
  relative_change:
    "Average change in household net income of the people in each group, as a percentage of their household net income before the change",
});

const UNITS =
  "average_change is the average change in household net income of the people in a group, in £ per year (each person counts their household's change); relative_change is that change as a ratio of their household net income before it (0.0123 is 1.23%)";

const DESCRIPTION =
  "The average change in household net income of the people in each group, with its 90% interval: each person counts their household's change. Ages and employment statuses are those in the 2024 survey data, held in later years, so a 2029-30 age band holds the people who were that age in 2024. Some figures are not published, to protect survey respondents' confidentiality.";

/** A note under the chart for groupings that need one. */
const LEVEL_NOTES = Object.freeze({
  [YOUNG_PEOPLE]:
    "18 to 24-year-olds, by whether they are in work or education (approved training counts). This is not the ONS's NEET measure, which covers 16 to 24-year-olds.",
  [EMPLOYMENT]:
    "Employment status as recorded in the 2024 survey data. Dependent children are a group of their own.",
});

// A published string as a number for plotting only; labels and tooltips
// show the published digits (see utils/geography/format).
const plotted = (outcome, text) =>
  outcome === "relative_change" ? Number(text) * 100 : Number(text);

/** One entry per group of the level, in display order, published or not. */
function groupEntries(table, { level, reform, year, outcome }) {
  return GROUPS[level].map(({ code, name }) => {
    const row = lookupRow(table, { level, areaCode: code, reform, year, outcome });
    const status = row ? row.tier : "missing";
    if (!row || row.tier === "withheld") {
      return { code, name, row, status, value: null, error: null };
    }
    const value = plotted(outcome, row.value);
    return {
      code,
      name,
      row,
      status,
      value,
      error: [value - plotted(outcome, row.lo), plotted(outcome, row.hi) - value],
    };
  });
}

const STATUS_NOTES = Object.freeze({
  withheld: "Not published",
  missing: "No data",
});

/** A group's name on the axis; a withheld or missing group also says so in the plot. */
function GroupTick({ x, y, payload, entries, labelWidth, fontSize }) {
  const entry = entries.find((candidate) => candidate.name === payload.value);
  const note = entry ? STATUS_NOTES[entry.status] : undefined;
  return (
    <g>
      <Text
        x={x - 6}
        y={y}
        width={labelWidth}
        textAnchor="end"
        verticalAnchor="middle"
        fontSize={fontSize}
        fill="#374151"
      >
        {payload.value}
      </Text>
      {note && (
        <text
          className="demographic-tick-note"
          x={x + 8}
          y={y}
          dy="0.35em"
          fontSize={fontSize}
          fill="#6B7280"
          fontStyle="italic"
        >
          {note}
        </text>
      )}
    </g>
  );
}

function GroupTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  const described = describeRow(entry.row);
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{entry.name}</p>
      {!described && <p className="chart-tooltip-note">No data</p>}
      {described && described.value === null && (
        <p className="chart-tooltip-note">{WITHHELD_NOTE}</p>
      )}
      {described && described.value !== null && (
        <>
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-name">Change</span>
            <span className="chart-tooltip-value">{described.value}</span>
          </div>
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-name">90% interval</span>
            <span className="chart-tooltip-value">{described.interval}</span>
          </div>
          {entry.status === "approximate" && (
            <p className="chart-tooltip-note">{TIER_DESCRIPTIONS.approximate}</p>
          )}
        </>
      )}
    </div>
  );
}

function FigureRow({ entry, outcome }) {
  const { row, status } = entry;
  const published = status === "reported" || status === "approximate";
  return (
    <tr>
      <th scope="row">{entry.name}</th>
      <td>{published ? formatFigure(outcome, row.value) : STATUS_NOTES[status]}</td>
      <td>{published ? formatInterval(outcome, row.lo, row.hi) : ""}</td>
      <td>{published ? DIRECTION_SHORT_LABELS[row.direction] : ""}</td>
      <td>{row ? TIER_LABELS[row.tier] : ""}</td>
    </tr>
  );
}

/**
 * Results by demographic group for the selected measure (or the package)
 * and the card's own year: the average change in household net income of
 * the people in each group, by age group, age band, 18 to 24-year-olds in
 * or not in work or education, or (when published) employment status.
 * Figures are drawn as published; a withheld group says "Not published"
 * and a group with no row says "No data". Nothing is summed.
 */
function DemographicChart({ selectedPolicies = [], policies = [], initialYear }) {
  const data = useDemographicsData();
  const [year, setYear] = useChartYear(initialYear);
  const [outcome, setOutcome] = useState("relative_change");
  const [grouping, setGrouping] = useState(AGE_GROUP);
  const narrow = useNarrowViewport();
  const titleId = useId();
  const captionId = useId();

  const table = data.table;
  const groupings = useMemo(() => {
    const employment = table?.rows.some((row) => row.level === EMPLOYMENT);
    return DEMOGRAPHIC_LEVELS.filter(
      (level) => level !== EMPLOYMENT || employment,
    );
  }, [table]);
  const level = groupings.includes(grouping) ? grouping : AGE_GROUP;

  const choice = chooseReform({
    selectedIds: selectedPolicies,
    policyIds: policies.map((policy) => policy.id),
    reforms: table?.reforms ?? [],
  });
  const view = viewState({ data, choice, year, outcome, level, subject: SUBJECT });
  const label = choiceLabel(choice, policies);
  const yearLabel = fiscalYearLabel(year);
  const entries =
    view.kind === "rows"
      ? groupEntries(table, { level, reform: view.reform, year, outcome })
      : null;

  const labelWidth = narrow ? 110 : 160;
  const fontSize = narrow ? 11 : 12;
  const unit = outcome === "relative_change" ? "%" : "£";
  const formatTick = (value) =>
    unit === "%" ? `${value}%` : `£${value.toLocaleString("en-GB")}`;

  const exportFile = (kind) => {
    if (view.kind !== "rows") return;
    const exported = GROUPS[level].flatMap(({ code }) =>
      OUTCOMES.map((each) =>
        lookupRow(table, {
          level,
          areaCode: code,
          reform: view.reform,
          year,
          outcome: each,
        }),
      ),
    ).filter(Boolean);
    const names = choiceMeasureNames(choice, policies);
    const metadata = [
      ["Generated", formatGenerated(new Date())],
      [
        choice.kind === "package" ? "Measures" : "Measure",
        choice.kind === "package" ? `${label}: ${names.join("; ")}` : label,
      ],
      ["Reform", view.reform],
      ["Year", yearLabel],
      ["Grouping", LEVEL_LABELS[level]],
      ["Units", UNITS],
      ["Source", "PolicyEngine UK Autumn Budget 2026 dashboard"],
    ];
    const notes = [
      ...EXPORT_NOTES,
      "area_code and area_name hold each group's code and name.",
      "Ages and employment statuses are those in the 2024 survey data, held in later years.",
    ];
    const filename = `results-by-group-${level}-${view.reform}-${year}`;
    if (kind === "csv") {
      downloadFile(
        buildCsv(exported, metadata),
        `${filename}.csv`,
        "text/csv;charset=utf-8",
      );
    } else {
      downloadFile(
        buildTxt(exported, {
          title: `${TITLE}: UK Autumn Budget 2026 dashboard`,
          metadata,
          notes,
        }),
        `${filename}.txt`,
        "text/plain;charset=utf-8",
      );
    }
  };

  return (
    <div
      className="demographic-chart"
      role="region"
      aria-labelledby={titleId}
    >
      <div className="chart-header">
        <div>
          <h3 id={titleId}>
            {TITLE}, <span className="nowrap">{yearLabel}</span>
          </h3>
          <p className="chart-description">{DESCRIPTION}</p>
        </div>
        {entries && (
          <ChartDownloadMenu
            chartTitle={`${TITLE}, ${yearLabel}`}
            formats={{
              csv: () => exportFile("csv"),
              txt: () => exportFile("txt"),
            }}
          />
        )}
      </div>

      <div className="chart-controls demographic-controls">
        <YearSlider selectedYear={year} onYearChange={setYear} />
        <PillSelect
          variant="light"
          name="Group people by"
          prefix="Group by"
          value={level}
          onChange={setGrouping}
          options={groupings.map((each) => ({
            value: each,
            label: LEVEL_LABELS[each],
          }))}
        />
        <OutcomeToggle
          value={outcome}
          onChange={setOutcome}
          labels={OUTCOME_LABELS}
        />
        {label && (
          <p className="demographic-showing">
            <span className="demographic-showing-label">Showing</span>{" "}
            <span className="demographic-showing-name">{label}</span>
          </p>
        )}
      </div>

      <div className="chart-plot">
        {view.kind === "loading" && (
          <p className="demographic-loading">Loading results by group…</p>
        )}
        {view.kind === "notice" && (
          <UnavailableNotice reason={view.reason}>
            {view.detail && <p>{view.detail}</p>}
          </UnavailableNotice>
        )}
        {entries && (
          <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
            <BarChart
              data={entries}
              layout="vertical"
              margin={{ top: 24, right: 16, left: 0, bottom: 36 }}
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={formatTick}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={labelWidth + 12}
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={
                  <GroupTick
                    entries={entries}
                    labelWidth={labelWidth}
                    fontSize={fontSize}
                  />
                }
              />
              <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={<GroupTooltip />}
              />
              <Bar
                dataKey="value"
                name={OUTCOME_LABELS[outcome]}
                maxBarSize={28}
                isAnimationActive={false}
              >
                {entries.map((entry) => (
                  <Cell
                    key={entry.code}
                    fill={COLORS[entry.status] ?? COLORS.reported}
                    fillOpacity={OPACITY[entry.status] ?? 1}
                  />
                ))}
                <ErrorBar
                  dataKey="error"
                  direction="x"
                  width={6}
                  stroke="#374151"
                  strokeWidth={1}
                />
              </Bar>
              <Customized
                component={
                  <ChartUnitLabel
                    text={
                      unit === "%"
                        ? "Change in household net income (%)"
                        : "Change in household net income (£ a year)"
                    }
                  />
                }
              />
              <Customized component={PolicyEngineLogo} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {entries && (
        <div className="chart-footer demographic-notes">
          <ul className="demographic-key">
            <li>
              <span className="demographic-swatch" aria-hidden="true" />
              Reported
            </li>
            <li>
              <span
                className="demographic-swatch demographic-swatch-approximate"
                aria-hidden="true"
              />
              Approximate: few survey households, so the interval understates
              the uncertainty
            </li>
          </ul>
          {LEVEL_NOTES[level] && <p>{LEVEL_NOTES[level]}</p>}
          <table className="visually-hidden" aria-labelledby={captionId}>
            <caption id={captionId}>
              {OUTCOME_CAPTIONS[outcome]}: {label}, {yearLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Change</th>
                <th scope="col">90% interval</th>
                <th scope="col">Direction</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <FigureRow key={entry.code} entry={entry} outcome={outcome} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DemographicChart;
