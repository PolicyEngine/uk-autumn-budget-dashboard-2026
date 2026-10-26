import { useRef } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "../ChartTooltip";
import GroupedLegend from "../GroupedLegend";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
  CHART_COLOURS,
} from "../../utils/chartTheme";
import { DISPLAY_YEARS, NOT_YET_PUBLISHED } from "../../utils/displayYears";
import { X_AXIS_HEIGHT, plotMargin } from "./chartRows";
import { AGE_GROUPS, YOUNG_BAND } from "../../utils/ageImpact";
import { GROUP_STYLES, changeByYear, niceRange, pounds, signedPounds } from "./youngPeopleData";
import { CHART_MOTION_MS, chartMotion, prefersReducedMotion } from "../../utils/chartMotion";
import TitleIcon from "../TitleIcon";
import ChartMoreInfo from "../ChartMoreInfo";

/** One line per age group, 16 to 24 drawn thicker, all ages dashed. */
export const SERIES = AGE_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  ...GROUP_STYLES[group.key],
}));

export const TREND_DESCRIPTION =
  "Average change per person each year, by age group; 16 to 24 is thicker, the selected year shaded.";

const UNIT = "Change per person (£ a year)";
// Room beside the ticks for the rotated axis title
const TITLE_ROOM = 20;
// The selected year's shading, as the 16 to 24 band in "Average change by age"
const SELECTED_FILL = CHART_COLOURS.highlightBand;

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
        // Moved by a transform, so a year change slides the shading
        <rect
          x={0}
          y={yAxis.y}
          width={selected.width}
          height={yAxis.height}
          fill={SELECTED_FILL}
          style={{
            transform: `translateX(${selected.x}px)`,
            transition: prefersReducedMotion()
              ? undefined
              : `transform ${CHART_MOTION_MS}ms ease-in-out, width ${CHART_MOTION_MS}ms ease-in-out`,
          }}
        />
      )}
      {unpublishedYears.map((year) => {
        const area = band(year);
        if (!area) return null;
        return (
          <g key={year}>
            <rect x={area.x} y={yAxis.y} width={area.width} height={yAxis.height} fill={CHART_COLOURS.mutedFill} />
            <text x={area.centre} y={yAxis.y + 16} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
              <tspan x={area.centre}>Not yet</tspan>
              <tspan x={area.centre} dy={13}>{" published"}</tspan>
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
    reservedLegendHeight: 0,
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
          <h3>
            <TitleIcon name="trend" />
            <span className="title-text">{title}</span>
          </h3>
          <p className="chart-description">{TREND_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={plotMargin(narrow, { right: 16 })}>
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
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
              padding={narrow ? { left: 10, right: 10 } : { left: 28, right: 28 }}
              tick={narrow ? { ...TICK_STYLE, fontSize: 10 } : TICK_STYLE}
              height={X_AXIS_HEIGHT}
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
            <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={{ stroke: CHART_COLOURS.axis }}
              content={
                <ChartTooltip
                  format={pounds}
                  grouped={false}
                  showPlus
                  labelFormat={(year) => fiscalYearTick(year)}
                />
              }
            />
            {/* 16 to 24 drawn last, on top */}
            {[...SERIES.filter((series) => series.key !== YOUNG_BAND), ...SERIES.filter((series) => series.key === YOUNG_BAND)].map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={series.key === YOUNG_BAND ? 3 : 1.75}
                strokeDasharray={series.dash}
                dot={{
                  fill: series.color,
                  stroke: CHART_COLOURS.surface,
                  strokeWidth: 1.5,
                  r: series.key === YOUNG_BAND ? 4.5 : 3,
                }}
                {...chartMotion()}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        <GroupedLegend items={SERIES.map((series) => ({ ...series, type: "line" }))} />
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {/* The same foot as the card beside it, so the pair ends level */}
      <div className="chart-footer">
        <ChartMoreInfo year={Number(selectedYear)}>
          <p>
            Each line is an age group&apos;s average change per person, the sum of each selected policy&apos;s own
            effect; each person counts their household&apos;s change in net income (not equivalised). 16 to 24 is
            drawn thicker and all ages dashed; the shaded year is the one chosen in the bar above.
          </p>
          {unpublished.length > 0 && (
            <p>Not yet published: {unpublished.map((point) => fiscalYearTick(point.year)).join(", ")}.</p>
          )}
        </ChartMoreInfo>
      </div>
    </div>
  );
}

export default TrendCard;
