import { useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import UnpublishedPlot from "../UnpublishedPlot";
import NoBreakYear from "../NoBreakYear";
import Note from "../Note";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  fiscalYearTick,
} from "../../utils/chartTheme";
import PillSelect from "../PillSelect";
import { AGE_BANDS, YOUNG_BAND, isPublished } from "../../utils/ageImpact";
import { measureComparison, niceRange, pounds, signedPounds, wrapWords } from "./youngPeopleData";
import { chartMotion } from "../../utils/chartMotion";
import { X_AXIS_HEIGHT, plotMargin } from "./chartRows";

/** "Aged 16 to 24", "Aged under 16", "Aged 65 and over". */
export const groupLabel = (band) => {
  const label = AGE_BANDS.find((candidate) => candidate.key === band)?.label ?? band;
  return `Aged ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

/** The two bars per measure: the chosen age group, and all ages. */
export const groupsFor = (band) => [
  { key: "group", label: groupLabel(band), color: "#319795" },
  { key: "all", label: "All ages", color: "#9CA3AF" },
];

export const measuresDescription = (band) => {
  const label = groupLabel(band).replace(/^Aged /, "");
  return `Each selected policy's own average change in household net income per person, in pounds a year, for people aged ${label} and for people of all ages. Largest effect on the chosen age group first.`;
};

const BAND_OPTIONS = AGE_BANDS.map((band) => ({ value: band.key, label: band.label }));

const UNIT = "Average change per person (£ a year)";

/** A measure's name over as many lines as it needs, right-aligned. */
function MeasureTick({ x, y, payload, maxChars }) {
  const lines = wrapWords(payload.value, maxChars);
  const lineHeight = 14;
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text
      x={x - 6}
      y={top}
      textAnchor="end"
      dominantBaseline="middle"
      fontSize={TICK_STYLE.fontSize}
      fill="#374151"
    >
      {lines.map((line, index) => (
        <tspan key={line} x={x - 6} dy={index === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * "Which measures matter most": each selected policy's mean change for a
 * chosen age group (16 to 24 at first) beside its all-ages figure, in the
 * selected year. Every bar is one policy's own run, so nothing is added up.
 */
function MeasuresCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const [band, setBand] = useState(YOUNG_BAND);
  const GROUPS = groupsFor(band);
  const description = measuresDescription(band);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const { shown, noEffect, suppressed } = measureComparison(
    rows,
    policies,
    selectedPolicies,
    selectedYear,
    band,
  );
  const values = shown.flatMap((point) => [point.group, point.all]);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values));

  const title = `Effect of each policy, ${yearLabel}`;
  const exportOptions = {
    title,
    description,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: GROUPS.map((group) => ({ color: group.color, label: group.label, type: "rect" })),
  };
  const notes = [
    ...(noEffect.length ? [`No effect in ${yearLabel}: ${noEffect.join(", ")}`] : []),
    ...(suppressed.length ? [`Not shown, too few survey records: ${suppressed.join(", ")}`] : []),
  ];
  const csvText = () =>
    buildChartCsv({
      title: `Average change in household net income per person by policy, ${yearLabel}`,
      units:
        "£ per person per year; each policy's own effect; each person counts their household's change in net income (not equivalised)",
      columns: [
        { key: "name", label: "Policy" },
        { key: "group", label: GROUPS[0].label, decimals: 2 },
        { key: "all", label: "All ages", decimals: 2 },
      ],
      rows: published ? shown : [],
      notes,
    });
  const download = {
    chartRef,
    name: `young-people-change-by-policy-${band.replace("+", "-plus")}-${selectedYear}`,
    exportOptions,
    csv: csvText,
    published: published && shown.length > 0,
  };
  const tickChars = narrow ? 16 : 24;

  return (
    <div className="young-people-measures">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={title} />
          </h3>
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-controls young-people-controls">
        <PillSelect
          variant="light"
          prefix="Compare"
          name="Age group compared with all ages"
          value={band}
          onChange={setBand}
          options={BAND_OPTIONS}
          stableWidth
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : shown.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={shown}
              layout="vertical"
              margin={plotMargin(narrow)}
              barCategoryGap="22%"
              barGap={2}
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                domain={domain}
                ticks={ticks}
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: UNIT, position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={<MeasureTick maxChars={tickChars} />}
                width={narrow ? 118 : 172}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={<ChartTooltip format={pounds} grouped={false} showPlus />}
              />
              {GROUPS.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.label}
                  fill={group.color}
                  maxBarSize={18}
                  {...chartMotion()}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>None of the selected policies changes household incomes in {yearLabel}.</p>
          </div>
        )}
      </div>
      <div className="chart-legend">
        {published && shown.length > 0 && <GroupedLegend items={GROUPS} />}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && notes.length > 0 && <Note>{notes.join(". ")}.</Note>}
    </div>
  );
}

export default MeasuresCard;
