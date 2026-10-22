import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Customized,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import YearSlider from "./YearSlider";
import UnavailableNotice from "./publication/UnavailableNotice";
import useChartYear from "../hooks/useChartYear";
import { usePovertyByAge } from "../hooks/useDemographicsData";
import { PolicyEngineLogo } from "../utils/chartLogo";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import {
  AXIS_LINE,
  GRID_PROPS,
  TICK_STYLE,
  legendWrapperStyle,
  useNarrowViewport,
} from "../utils/chartTheme";
import { downloadFile } from "../utils/downloadFile";
import { AGE_GROUP, GROUPS } from "../utils/demographics/groups";
import { POVERTY_COLUMNS } from "../utils/demographics/poverty";
import { csvField, formatGenerated } from "../utils/geography/exportTable";
import {
  choiceLabel,
  choiceMeasureNames,
  chooseReform,
} from "../utils/geography/selection";
import { viewState } from "../utils/geography/view";
import { fiscalYearLabel } from "../utils/publication/format";
import "./DemographicChart.css";
import "./PovertyByAgeChart.css";

const TITLE = "Poverty by age group";
const SUBJECT = "poverty rates by age group";
const PLOT_HEIGHT = 350;
const BASELINE_COLOR = "#9CA3AF";
const REFORM_COLOR = "#319795";

const DESCRIPTION =
  "The share of people in each age group in absolute poverty before housing costs (equivalised household income below 60% of the 2024-25 median, held constant in real terms), without and with the selected measures. Ages are those in the 2024 survey data, held in later years.";

/** A published rate: "18.4" → "18.40%". */
const formatRate = (text) => `${Number(text).toFixed(2)}%`;

/** A published change in percentage points: "-2.5" → "−2.50pp". */
function formatChange(text) {
  const value = Number(text);
  if (Math.abs(value) < 0.005) return "0.00pp";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}pp`;
}

/**
 * Poverty rates by age group for the selected measure (or the package) and
 * the card's own year: each of policyengine.py's age groups, without and
 * with the measure, and the change in percentage points. Rates only.
 */
function PovertyByAgeChart({ selectedPolicies = [], policies = [], initialYear }) {
  const poverty = usePovertyByAge();
  const [year, setYear] = useChartYear(initialYear);
  const narrow = useNarrowViewport();
  const titleId = useId();
  const captionId = useId();

  const choice = chooseReform({
    selectedIds: selectedPolicies,
    policyIds: policies.map((policy) => policy.id),
    reforms: poverty.table?.reforms ?? [],
  });
  const view = viewState({ data: poverty, choice, year, subject: SUBJECT });
  const label = choiceLabel(choice, policies);
  const yearLabel = fiscalYearLabel(year);
  const subjectName = choice.kind === "package" ? "the Budget" : "this measure";
  const without = `Without ${subjectName}`;
  const withMeasure = `With ${subjectName}`;

  const rows =
    view.kind === "rows"
      ? GROUPS[AGE_GROUP].map(({ code, name }) => ({
          name,
          row: view.rows.find((row) => row.ageGroup === code) ?? null,
        })).filter((entry) => entry.row)
      : null;
  const plotted = rows?.map(({ name, row }) => ({
    name,
    baseline: Number(row.baselineRate),
    reform: Number(row.reformRate),
  }));

  const exportCsv = () => {
    if (!rows) return;
    const names = choiceMeasureNames(choice, policies);
    const metadata = [
      ["Generated", formatGenerated(new Date())],
      [
        choice.kind === "package" ? "Measures" : "Measure",
        choice.kind === "package" ? `${label}: ${names.join("; ")}` : label,
      ],
      ["Reform", view.reform],
      ["Year", yearLabel],
      [
        "Units",
        "baseline_rate and reform_rate are the per cent of people in the age group in absolute poverty before housing costs, without and with the reform; change_pp is the difference in percentage points",
      ],
      ["Source", "PolicyEngine UK Autumn Budget 2026 dashboard"],
    ];
    const lines = [
      ...metadata.map(([key, value]) => csvField(`# ${key}: ${value}`)),
      POVERTY_COLUMNS.join(","),
      ...rows.map(({ row }) =>
        POVERTY_COLUMNS.map((column) => csvField(row.cells[column])).join(","),
      ),
    ];
    downloadFile(
      `﻿${lines.join("\r\n")}\r\n`,
      `poverty-by-age-group-${view.reform}-${year}.csv`,
      "text/csv;charset=utf-8",
    );
  };

  return (
    <div className="poverty-by-age-chart" role="region" aria-labelledby={titleId}>
      <div className="chart-header">
        <div>
          <h3 id={titleId}>
            {TITLE}, <span className="nowrap">{yearLabel}</span>
          </h3>
          <p className="chart-description">{DESCRIPTION}</p>
        </div>
        {rows && (
          <ChartDownloadMenu
            chartTitle={`${TITLE}, ${yearLabel}`}
            formats={{ csv: exportCsv }}
          />
        )}
      </div>

      <div className="chart-controls poverty-controls">
        <YearSlider selectedYear={year} onYearChange={setYear} />
        {label && (
          <p className="demographic-showing">
            <span className="demographic-showing-label">Showing</span>{" "}
            <span className="demographic-showing-name">{label}</span>
          </p>
        )}
      </div>

      <div className="chart-plot">
        {view.kind === "loading" && (
          <p className="demographic-loading">Loading poverty rates…</p>
        )}
        {view.kind === "notice" && (
          <UnavailableNotice reason={view.reason}>
            {view.detail && <p>{view.detail}</p>}
          </UnavailableNotice>
        )}
        {rows && (
          <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
            <BarChart
              data={plotted}
              layout="vertical"
              margin={{ top: 24, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                domain={[0, "auto"]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={narrow ? 110 : 160}
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ ...TICK_STYLE, fill: "#374151", fontSize: narrow ? 11 : 12 }}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={
                  <ChartTooltip
                    format={(value) => `${value.toFixed(2)}%`}
                    grouped={false}
                  />
                }
              />
              <Legend wrapperStyle={legendWrapperStyle(narrow)} />
              <Bar
                dataKey="baseline"
                name={without}
                fill={BASELINE_COLOR}
                maxBarSize={22}
                isAnimationActive={false}
              />
              <Bar
                dataKey="reform"
                name={withMeasure}
                fill={REFORM_COLOR}
                maxBarSize={22}
                isAnimationActive={false}
              />
              <Customized
                component={<ChartUnitLabel text="People in absolute poverty (%)" />}
              />
              <Customized component={PolicyEngineLogo} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {rows && (
        <div className="chart-footer">
          <table className="poverty-table" aria-labelledby={captionId}>
            <caption id={captionId}>
              Poverty rates by age group: {label}, {yearLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">Age group</th>
                <th scope="col">{without}</th>
                <th scope="col">{withMeasure}</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, row }) => (
                <tr key={row.ageGroup}>
                  <th scope="row">{name}</th>
                  <td>{formatRate(row.baselineRate)}</td>
                  <td>{formatRate(row.reformRate)}</td>
                  <td>{formatChange(row.changePp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PovertyByAgeChart;
