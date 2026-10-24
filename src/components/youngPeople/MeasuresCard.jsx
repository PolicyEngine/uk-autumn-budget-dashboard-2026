import { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Customized,
  Legend,
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
import UnpublishedPlot from "../UnpublishedPlot";
import NoBreakYear from "../NoBreakYear";
import Note from "../Note";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  fiscalYearTick,
} from "../../utils/chartTheme";
import { isPublished } from "../../utils/ageImpact";
import { measureComparison, niceRange, pounds, signedPounds, wrapWords } from "./youngPeopleData";

/** The two groups each measure is shown for. */
export const GROUPS = [
  { key: "young", label: "Aged 16 to 24", color: "#319795" },
  { key: "all", label: "All ages", color: "#9CA3AF" },
];

export const MEASURES_DESCRIPTION =
  "Each selected policy's own average change in household net income per person, in pounds a year, for young people aged 16 to 24 and for people of all ages. Largest effect on young people first.";

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
 * "Which measures matter most": each selected policy's mean change for
 * young people aged 16 to 24 beside its all-ages figure, in the selected
 * year. Every bar is one policy's own run, so nothing is added up.
 */
function MeasuresCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const { shown, noEffect, suppressed } = measureComparison(
    rows,
    policies,
    selectedPolicies,
    selectedYear,
  );
  const values = shown.flatMap((point) => [point.young, point.all]);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values));

  const title = `Effect of each policy, ${yearLabel}`;
  const exportOptions = {
    title,
    description: MEASURES_DESCRIPTION,
    logo: CHART_LOGO,
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
        { key: "young", label: "Aged 16 to 24", decimals: 2 },
        { key: "all", label: "All ages", decimals: 2 },
      ],
      rows: published ? shown : [],
      notes,
    });
  const download = {
    chartRef,
    name: `young-people-change-by-policy-${selectedYear}`,
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
          <p className="chart-description">{MEASURES_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef}>
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : shown.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={shown}
              layout="vertical"
              margin={chartMargin(narrow, { top: 8 })}
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
                height={44}
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
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                content={<GroupedLegend items={GROUPS} />}
              />
              {GROUPS.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.label}
                  fill={group.color}
                  maxBarSize={18}
                  animationDuration={500}
                  animationBegin={0}
                />
              ))}
              <Customized component={PolicyEngineLogo} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>None of the selected policies changes household incomes in {yearLabel}.</p>
          </div>
        )}
      </div>
      {published && notes.length > 0 && <Note>{notes.join(". ")}.</Note>}
    </div>
  );
}

export default MeasuresCard;
