import { useRef, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Customized } from "recharts";
import { Tooltip } from "./ViewportTooltip";
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
import { laterRevenueNote, revenueSentence } from "../utils/plainSentences";
import { zeroReason } from "../utils/legendMembership";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";

// A year not yet published gets a small grey tag just above the zero line,
// so its empty band is never read as zero. The years' nets are not printed
// on the plot: the sentence states the net and the tooltip gives every
// year's exactly. The tags are part of the chart's SVG, so the SVG and PNG
// downloads carry them too.

// The net line's dot radius (the Line's dot below)
const DOT_RADIUS = 4;

function UnpublishedLabels({ xAxisMap, yAxisMap, data, narrow }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const gap = 6;
  const band = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 0;
  return (
    <g className="net-impact-labels">
      {data.map((point) => {
        const net = point.netImpact;
        const unpublished = point.unpublished || net === null || net === undefined;
        if (!unpublished) return null;
        // On a phone the tag takes two lines, in smaller type, so it fits
        // its year's band beside the last bar
        const lines = narrow ? ["Not yet", "published"] : [NOT_YET_PUBLISHED];
        const size = narrow ? 10 : 12;
        const longest = Math.max(...lines.map((line) => line.length));
        const width = Math.ceil(longest * size * 0.6) + (narrow ? 6 : 10);
        const height = size + 8 + (lines.length - 1) * (size + 2);
        // Kept inside the plot, so a wide tag at either end is not clipped
        const x = Math.min(
          Math.max(xAxis.scale(point.year) + band / 2, xAxis.x + width / 2),
          xAxis.x + xAxis.width - width / 2,
        );
        const plotTop = yAxis.y;
        const plotBottom = yAxis.y + yAxis.height;
        const anchor = yAxis.scale(0);
        let top = anchor - gap - DOT_RADIUS - height;
        if (top < plotTop) top = anchor + gap + DOT_RADIUS;
        top = Math.min(Math.max(top, plotTop), plotBottom - height);
        return (
          <g key={point.year}>
            <rect
              x={x - width / 2}
              y={top}
              width={width}
              height={height}
              rx={4}
              ry={4}
              fill={CHART_COLOURS.mutedFill}
              stroke={CHART_COLOURS.axis}
              strokeWidth={1}
            />
            <text
              x={x}
              y={top + height / 2 - ((lines.length - 1) * (size + 2)) / 2}
              fill={CHART_COLOURS.tick}
              fontSize={size}
              fontWeight={500}
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
  `Change in government revenue each year, £bn. Above zero raises revenue; below zero costs the government.`;

// The card's "About this chart"
const REVENUE_INFO = {
  how: ["Each policy is costed on its own against current law. The net line is their sum and leaves out any interaction between them."],
  method: { anchor: METHOD_ANCHORS.publicFinances, label: "How we cost the policies" },
};

function BudgetaryImpactChart({ data, selectedYear, selectedPolicies = [] }) {
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
  const netLabel = activePolicies.length > 1 ? "Net change" : undefined;
  // No selected measure moves revenue in any year shown (2026-27 is shown
  // whenever one does in it, utils/displayYears.js): a note with the
  // reason, not five "£0.0bn" tags on an empty £0-£0.05bn axis
  const noRevenue = activePolicies.length === 0 && data.every((point) => !point.unpublished && point.netImpact != null);
  const outOfYears = noRevenue
    ? orderedPolicies
        .map((key) => bySeriesKey.get(key))
        // Unselected measures are zeros in the data too: only the selection's
        .filter((measure) => measure && selectedPolicies.includes(measure.id))
        .map((measure) => ({ measure, reason: zeroReason(measure, selectedYear) }))
        .filter(({ reason }) => reason.kind === "not_in_force")
        .map(({ measure, reason }) => `${measure.name ?? measure.label}: ${reason.text}`)
    : [];
  const yearSpan = `${fiscalYearTick(data[0].year)} to ${fiscalYearTick(data[data.length - 1].year)}`;

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
      ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }]
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
  // "Later years differ": the first later year in which the measures turn
  // from costing revenue to raising it, or back (plainSentences.js)
  const laterRevenue = laterRevenueNote(
    data.find((point) => point.year === selectedYear)?.netImpact,
    data
      .filter((point) => point.year > selectedYear && !point.unpublished)
      .map((point) => ({ yearLabel: fiscalYearTick(point.year), net: point.netImpact })),
  );
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
              measures is in About this chart */}
          <p className="chart-description">
            {(noRevenue ? null : revenueSentence(data.find((point) => point.year === selectedYear)?.netImpact, fiscalYearTick(selectedYear))) ?? CHART_DESCRIPTION}
            {laterRevenue && <span className="later-years-note"> {laterRevenue}</span>}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={CHART_TITLE} period={yearSpan} />
      </div>

      <div ref={chartRef}>
        {noRevenue ? (
          <div className="plot-empty" style={{ minHeight: 240 }} role="status">
            <p>
              None of the selected policies changes revenue in {yearSpan}.
              {outOfYears.length > 0 && ` ${outOfYears.join("; ")}.`}
            </p>
          </div>
        ) : (
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

              content={<SegmentTooltip activeKey={hoveredMeasure} labelOf={(row) => fiscalYearTick(row.year)} format={(value) => `£${value.toFixed(1)}bn`} netKey="netImpact" netLabel="Net change" />}

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
                <UnpublishedLabels data={data} narrow={narrow} />
              }
            />
            <Customized component={<ChartUnitLabel text="Impact (£bn)" />} />
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>

      {/* The measures' key under the plot (MeasureKey), unboxed in the card: click
          chips to highlight several together. The logo below it. */}
      {!noRevenue && (
      <div className="revenue-key">
        <MeasureKey
          members={keyMembers}
          netLabel={netLabel}
          highlight={highlight}
          onHighlight={setHighlight}
          placement="section"
          label="Policies"
        />
      </div>
      )}
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      <div className="chart-footer">
        <ChartMoreInfo
          year={selectedYear}
          info={REVENUE_INFO}
        />
      </div>
    </div>
  );
}

export default BudgetaryImpactChart;
