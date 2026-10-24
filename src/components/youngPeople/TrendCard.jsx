import { useRef } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Customized,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
} from "../../utils/chartTheme";
import { DISPLAY_YEARS, NOT_YET_PUBLISHED } from "../../utils/displayYears";
import { AGE_GROUPS, YOUNG_BAND } from "../../utils/ageImpact";
import { GROUP_STYLES, changeByYear, niceRange, pounds, signedPounds } from "./youngPeopleData";

/** One line per age group, 16 to 24 drawn thicker, all ages dashed. */
export const SERIES = AGE_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  ...GROUP_STYLES[group.key],
}));

export const TREND_DESCRIPTION =
  "Average change in household net income per person in each year, by age group, in pounds a year, adding up the selected policies' own effects. 16 to 24 is drawn thicker; the shaded year is the one selected above.";

const UNIT = "Change per person (£ a year)";
// Room beside the ticks for the rotated axis title
const TITLE_ROOM = 20;
// The selected year's shading, as the 16 to 24 band in "Average change by age"
const SELECTED_FILL = "rgba(49, 151, 149, 0.10)";

/**
 * The selected year's shading, and each unpublished year's grey band with
 * "Not yet published" on two lines: a band a year wide around each point.
 * Drawn under the lines, from the x axis's own scale.
 */
function YearShading({ xAxisMap, yAxisMap, selectedYear, unpublishedYears }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis) return null;
  const years = DISPLAY_YEARS;
  const step = years.length > 1 ? xAxis.scale(years[1]) - xAxis.scale(years[0]) : xAxis.width;
  const band = (year) => {
    const centre = xAxis.scale(year);
    if (centre === undefined || Number.isNaN(centre)) return null;
    const left = Math.max(xAxis.x, centre - step / 2);
    const right = Math.min(xAxis.x + xAxis.width, centre + step / 2);
    return { x: left, width: right - left, centre };
  };
  const selected = band(selectedYear);
  return (
    <g className="young-people-year-shading">
      {selected && !unpublishedYears.includes(selectedYear) && (
        <rect x={selected.x} y={yAxis.y} width={selected.width} height={yAxis.height} fill={SELECTED_FILL} />
      )}
      {unpublishedYears.map((year) => {
        const area = band(year);
        if (!area) return null;
        return (
          <g key={year}>
            <rect x={area.x} y={yAxis.y} width={area.width} height={yAxis.height} fill="#F3F4F6" />
            <text x={area.centre} y={yAxis.y + 16} textAnchor="middle" fontSize={11} fill="#6B7280">
              <tspan x={area.centre}>Not yet</tspan>
              <tspan x={area.centre} dy={13}>published</tspan>
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * How the effect on each age group changes year by year, 16 to 24
 * highlighted, for the selected policies. It shows every year on the page, so
 * the year pill only shades one; a year not yet published is labelled, not
 * drawn as zero.
 */
function TrendCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const data = changeByYear(rows, policies, selectedPolicies, DISPLAY_YEARS);
  const values = data
    .flatMap((point) => SERIES.map((series) => point[series.key]))
    .filter((v) => v !== null);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values));
  const unpublished = data.filter((point) => !point.published);
  const suppressed = data.filter((point) => point.published && point.suppressed.length > 0);
  const labelOf = (key) => SERIES.find((series) => series.key === key)?.label ?? key;
  const first = fiscalYearTick(DISPLAY_YEARS[0]);
  const last = fiscalYearTick(DISPLAY_YEARS[DISPLAY_YEARS.length - 1]);

  const title = `Change by year, ${first} to ${last}`;
  const exportOptions = {
    title,
    description: TREND_DESCRIPTION,
    logo: CHART_LOGO,
    legendItems: SERIES.map((series) => ({
      color: series.color,
      label: series.label,
      type: "line",
      dash: series.dash,
    })),
  };
  const csvText = () =>
    buildChartCsv({
      title: `Average change in household net income per person by year, ${first} to ${last}`,
      units:
        "£ per person per year; the sum of each selected policy's own effect; each person counts their household's change in net income (not equivalised)",
      columns: [
        { key: "yearLabel", label: "Year" },
        ...SERIES.map((series) => ({ key: series.key, label: series.label, decimals: 2 })),
      ],
      rows: data
        .filter((point) => point.published)
        .map((point) => ({ ...point, yearLabel: fiscalYearTick(point.year) })),
      notes: [
        ...unpublished.map((point) => `${fiscalYearTick(point.year)}: ${NOT_YET_PUBLISHED.toLowerCase()}`),
        ...suppressed.map(
          (point) =>
            `${fiscalYearTick(point.year)}, too few survey records: ${point.suppressed.map(labelOf).join(", ")}`,
        ),
      ],
    });
  const download = {
    chartRef,
    name: "young-people-change-by-year",
    exportOptions,
    csv: csvText,
    published: data.some((point) => point.published),
  };
  const yWidth = axisWidth(ticks, signedPounds) + TITLE_ROOM;

  return (
    <div className="young-people-trend">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          <p className="chart-description">{TREND_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ ...chartMargin(narrow, { top: 16 }), right: 16 }}>
            <CartesianGrid {...GRID_PROPS} />
            <Customized
              component={
                <YearShading
                  selectedYear={Number(selectedYear)}
                  unpublishedYears={unpublished.map((point) => point.year)}
                />
              }
            />
            <XAxis
              dataKey="year"
              tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
              tick={TICK_STYLE}
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
              padding={{ left: 28, right: 28 }}
              height={28}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickFormatter={signedPounds}
              tick={TICK_STYLE}
              width={yWidth}
              axisLine={false}
              tickLine={false}
              label={{
                value: UNIT,
                angle: -90,
                position: "insideLeft",
                offset: 12,
                style: AXIS_TITLE_STYLE,
              }}
            />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={{ stroke: "#D1D5DB" }}
              content={
                <ChartTooltip
                  format={pounds}
                  grouped={false}
                  showPlus
                  labelFormat={(year) => fiscalYearTick(year)}
                />
              }
            />
            <Legend
              wrapperStyle={legendWrapperStyle(narrow)}
              content={
                <GroupedLegend
                  items={SERIES.map((series) => ({ ...series, type: "line" }))}
                />
              }
            />
            {/* 16 to 24 drawn last, on top */}
            {[...SERIES.filter((series) => series.key !== YOUNG_BAND), ...SERIES.filter((series) => series.key === YOUNG_BAND)].map((series) => (
              <Line
                key={series.key}
                type="linear"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={series.key === YOUNG_BAND ? 3 : 1.75}
                strokeDasharray={series.dash}
                dot={{
                  fill: series.color,
                  stroke: "#ffffff",
                  strokeWidth: 1.5,
                  r: series.key === YOUNG_BAND ? 4.5 : 3,
                }}
                animationDuration={500}
              />
            ))}
            <Customized component={PolicyEngineLogo} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TrendCard;
