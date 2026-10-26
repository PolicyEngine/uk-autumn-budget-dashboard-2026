import { useRef, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Customized,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { revenueCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { SegmentTooltip, TOOLTIP_PROPS } from "./ChartTooltip";
import MeasureKey, { measureOpacity, netOpacity } from "./MeasureKey";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import UnavailableNotice from "./publication/UnavailableNotice";
import {
  barShape,
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  fiscalYearTick,
  shortFiscalYearTick,
  axisWidth,
  CHART_COLOURS,
  divergingAxis,
} from "../utils/chartTheme";
import {
  NOT_YET_PUBLISHED,
} from "../utils/displayYears";
import { chartMotion, chartTransition } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";
import SelectedYearShade from "./SelectedYearShade";
import { revenueSentence } from "../utils/plainSentences";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";

// Net impact labels, one per year: the signed total in a small white tag
// beside its dot on the net line, always just above the dot (below it only
// where the dot is too near the top of the plot), and moved clear of the
// tag beside it. They are part of the chart's SVG, so the SVG and PNG
// downloads carry them too.
// A net that rounds to zero (a year before a measure starts) has no sign
const formatNetLabel = (value) => {
  const shown = Math.abs(value).toFixed(1);
  if (Number(shown) === 0) return `£${shown}bn`;
  return value < 0 ? `-£${shown}bn` : `+£${shown}bn`;
};


// The net line's dot radius (the Line's dot below)
const DOT_RADIUS = 4;

function NetImpactLabels({ xAxisMap, yAxisMap, data, narrow, show, line, selectedYear }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  // On a narrow plot six tags collide: label only the year shown (the
  // tooltip gives every year's net)
  const crowded = xAxis.width < 460;
  const fontSize = narrow ? 11 : 12;
  const gap = 6;
  const band = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 0;
  // The tags already placed, left to right
  const placed = [];
  return (
    <g className="net-impact-labels">
      {data.map((point) => {
        const net = point.netImpact;
        const unpublished = point.unpublished || net === null || net === undefined;
        // Net tags show with two or more measures; a not-yet-published tag
        // always shows, so the empty year is never read as zero.
        if (!show && !unpublished) return null;
        if (crowded && !unpublished && point.year !== selectedYear) return null;
        const text = unpublished ? NOT_YET_PUBLISHED : formatNetLabel(net);
        // On a phone the not-yet-published tag takes two lines, in smaller
        // type, so it fits its year's band beside the last bar
        const twoLine = unpublished && narrow;
        const lines = twoLine ? ["Not yet", "published"] : [text];
        const size = twoLine ? 10 : fontSize;
        const longest = Math.max(...lines.map((line) => line.length));
        const width = Math.ceil(longest * size * 0.6) + (twoLine ? 6 : 10);
        const height = size + 8 + (lines.length - 1) * (size + 2);
        // Kept inside the plot, so a wide tag at either end is not clipped
        const x = Math.min(
          Math.max(xAxis.scale(point.year) + band / 2, xAxis.x + width / 2),
          xAxis.x + xAxis.width - width / 2,
        );
        // A year not yet published has no bars: its tag sits just above the
        // zero line. Otherwise the tag sits just above the year's net dot,
        // or just below it where above would leave the plot
        const plotTop = yAxis.y;
        const plotBottom = yAxis.y + yAxis.height;
        const anchor = yAxis.scale(unpublished ? 0 : net);
        const clearance = gap + DOT_RADIUS;
        let top = anchor - clearance - height;
        if (top < plotTop) top = anchor + clearance;
        // With one measure there is no net line: the tag sits past the end
        // of its bar (below a cost, above a gain), inside it only where the
        // plot has no room
        if (!line && !unpublished) {
          top = net < 0 ? anchor + gap : anchor - gap - height;
          if (top + height > plotBottom || top < plotTop) {
            top = net < 0 ? anchor - gap - height : anchor + gap;
          }
        }
        // Clear of the tag before it (on a narrow plot two can meet): the
        // other side of the dot, or failing that past the other tag
        const previous = placed[placed.length - 1];
        const meets = (y) =>
          previous &&
          Math.abs(previous.x - x) < (previous.width + width) / 2 + 2 &&
          y < previous.top + previous.height + 2 &&
          y + height + 2 > previous.top;
        if (meets(top)) {
          const flipped = top < anchor ? anchor + clearance : anchor - clearance - height;
          top = meets(flipped) || flipped < plotTop || flipped + height > plotBottom
            ? previous.top + previous.height + 2
            : flipped;
        }
        top = Math.min(Math.max(top, plotTop), plotBottom - height);
        placed.push({ x, top, width, height });
        return (
          <g key={point.year}>
            <rect
              x={x - width / 2}
              y={top}
              width={width}
              height={height}
              rx={4}
              ry={4}
              fill={unpublished ? CHART_COLOURS.mutedFill : CHART_COLOURS.surface}
              stroke={CHART_COLOURS.axis}
              strokeWidth={1}
            />
            <text
              x={x}
              y={top + height / 2 - ((lines.length - 1) * (size + 2)) / 2}
              fill={unpublished ? CHART_COLOURS.tick : CHART_COLOURS.text}
              fontSize={size}
              fontWeight={unpublished ? 500 : 600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {lines.map((line, index) => (
                <tspan key={line} x={x} dy={index === 0 ? 0 : size + 2}>
                  {index === 0 ? line : ` ${line}`}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * The measures in the chart's order: the catalogue's (#104), raise revenue,
 * then cost revenue, each group by size (total absolute £bn over the
 * published years), largest first, then measures with no published costing.
 * The stack (largest nearest zero), the legend and the tooltip all take
 * this order, which is also the order of the measures' shades (largest
 * darkest), so a stack shades monotonically on every selection.
 */
export function measureOrder(data, catalogue) {
  const order = (key) => catalogue.bySeriesKey.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...catalogue.allPolicyNames].sort((a, b) => order(a) - order(b));
}

// Chart metadata for export
const CHART_TITLE = "Revenue impact";
const CHART_DESCRIPTION =
  `Change in government revenue each year, £bn. Above zero raises revenue; below zero costs the Treasury.`;

// The card's "About this chart"
const REVENUE_INFO = {
  how: [
    "Above zero the measures raise money; below zero they cost the Treasury.",
    "The net line adds up the selected measures' separate figures.",
    "The Plan 2 student loan measure is costed as the change in loan repayments.",
  ],
  method: { anchor: METHOD_ANCHORS.publicFinances, label: "How we cost the measures" },
};

function BudgetaryImpactChart({ data, selectedYear }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
  // The measure highlighted from the key (MeasureKey); the others fade
  const [highlight, setHighlight] = useState(null);
  // The measure whose segment is hovered: the others dim
  const [hoveredMeasure, setHoveredMeasure] = useState(null);
  const catalogue = useMeasureCatalogue();
  const {
    displayable,
    allPolicyNames: ALL_POLICY_NAMES,
    policyColors: POLICY_COLORS,
    bySeriesKey,
  } = catalogue;

  if (!data || data.length === 0) return null;
  if (!displayable.length) return <UnavailableNotice reason="Revenue figures are unavailable until approved results verify." />;

  const formatCurrencyTick = (value) =>
    value < 0 ? `-£${Math.abs(value)}bn` : `£${value}bn`;

  // Check which policies have non-zero values for legend/tooltip
  const hasNonZeroValues = (policyName) => {
    return data.some((d) => Math.abs(d[policyName] || 0) > 0.001);
  };

  const orderedPolicies = measureOrder(data, catalogue);
  const activePolicies = orderedPolicies.filter(hasNonZeroValues);
  // The key's chips: the measures with revenue in some year (a measure with
  // none has nothing to show here)
  const keyMembers = activePolicies.map((key) => {
    const measure = bySeriesKey.get(key);
    return { id: measure?.id ?? key, key, name: measure?.label ?? key, description: measure?.description, muted: false };
  });
  const netLabel = activePolicies.length > 1 ? "Net impact" : undefined;

  // Y axis: symmetric about zero when the year's stacks go both ways
  // (divergingAxis), with about 5% room past the tallest stack; from zero
  // when every bar has one sign
  const stackExtent = (sign) =>
    Math.max(
      0,
      ...data.map((d) =>
        ALL_POLICY_NAMES.reduce((sum, name) => {
          const v = d[name] || 0;
          return sign * v > 0 ? sum + Math.abs(v) : sum;
        }, 0),
      ),
    );
  const { domain: yAxisDomain, ticks: yAxisTicks } = divergingAxis([
    stackExtent(1),
    -stackExtent(-1),
  ]);

  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: bySeriesKey.get(name)?.label ?? name,
      type: "rect",
      group: bySeriesKey.get(name)?.direction === "revenue" ? "raise" : bySeriesKey.get(name)?.direction === "cost" ? "cost" : "other",
    })),
    ...(activePolicies.length > 1
      ? [{ color: CHART_COLOURS.net, label: "Net impact", type: "line" }]
      : []),
  ];

  const exportName = "revenue-impact";
  const exportOptions = {
    title: CHART_TITLE,
    description: CHART_DESCRIPTION,
    legendItems,
    logo: CHART_LOGO,
    // The key is above the plot, not a Recharts legend: crop nothing
    reservedLegendHeight: 0,
  };
  // One menu: the chart's data as CSV, and the chart as PNG or SVG.
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: () => revenueCsv(data, activePolicies.map((key) => bySeriesKey.get(key))),
  };

  return (
    <div className="budgetary-impact-chart">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="landmark" />
            <span className="title-text">Revenue impact</span>
          </h3>
          {/* One plain sentence for the selected year; what the chart
              measures is in More info */}
          <p className="chart-description">
            {revenueSentence(data.find((point) => point.year === selectedYear)?.netImpact, fiscalYearTick(selectedYear)) ?? CHART_DESCRIPTION}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={CHART_TITLE} />
      </div>

      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={narrow ? 520 : 500}>
          <ComposedChart
            data={data}
            margin={chartMargin(narrow, { top: 24 })}
            stackOffset="sign"
          >
            <CartesianGrid {...GRID_PROPS} />
            {/* The year chosen in the title band, shaded behind its bars */}
            {data.some((point) => point.year === selectedYear) && (
              <Customized component={<SelectedYearShade value={selectedYear} />} />
            )}
            <XAxis
              dataKey="year"
              tick={TICK_STYLE}
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
              tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
            />
            <YAxis
              domain={yAxisDomain}
              width={axisWidth(yAxisTicks, formatCurrencyTick)}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatCurrencyTick}
              tick={TICK_STYLE}
              interval={0}
              ticks={yAxisTicks}
            />

            {/* One segment at a time, beside the cursor; the other measures dim */}

            <Tooltip

              {...TOOLTIP_PROPS}

              shared={false}

              cursor={false}

              offset={16}

              content={<SegmentTooltip activeKey={hoveredMeasure} labelOf={(row) => fiscalYearTick(row.year)} format={(value) => `£${value.toFixed(1)}bn`} netKey="netImpact" netLabel="Net impact" />}

            />
            {orderedPolicies.map((policyName) => (
              <Bar
                key={policyName}
                dataKey={policyName}
                fill={POLICY_COLORS[policyName]}
                fillOpacity={hoveredMeasure ? (hoveredMeasure === policyName ? 1 : 0.3) : measureOpacity(highlight, policyName)}
                onMouseEnter={() => setHoveredMeasure(policyName)}
                onMouseLeave={() => setHoveredMeasure(null)}
                name={bySeriesKey.get(policyName)?.label ?? policyName}
                stackId="stack"
                shape={barShape(orderedPolicies)}
                {...chartMotion()}
                // Always mounted (a zero series has no height), so a series that
                // starts in a later year grows in place instead of remounting
              />
            ))}
            <Line
              // A smooth net line that never overshoots its points (monotone)
              type="monotone"
              strokeLinejoin="round"
              strokeLinecap="round"
              dataKey="netImpact"
              strokeOpacity={netOpacity(highlight)}
              stroke={CHART_COLOURS.net}
              strokeWidth={1.75}
              dot={{ fill: CHART_COLOURS.net, stroke: CHART_COLOURS.surface, strokeWidth: 1.5, r: DOT_RADIUS }}
              name="netImpact"
              {...chartMotion()}
              hide={activePolicies.length <= 1}
            />
            <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
            <Customized
              component={
                <NetImpactLabels
                  data={data}
                  narrow={narrow}
                  selectedYear={selectedYear}
                  show
                  line={activePolicies.length > 1}
                />
              }
            />
            <Customized component={<ChartUnitLabel text="Impact (£bn)" />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* The measures' key under the plot (MeasureKey), unboxed in the card: click
          chips to highlight several together. The logo below it. */}
      <div className="revenue-key">
        <MeasureKey
          members={keyMembers}
          netLabel={netLabel}
          highlight={highlight}
          onHighlight={setHighlight}
          placement="section"
          label="Measures"
        />
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      <div className="chart-footer">
        <ChartMoreInfo year={selectedYear} info={REVENUE_INFO} />
      </div>
    </div>
  );
}

export default BudgetaryImpactChart;
