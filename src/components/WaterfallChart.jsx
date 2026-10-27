import { useMemo, useRef, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Customized,
  Scatter,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { decileCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { SegmentTooltip, TOOLTIP_PROPS } from "./ChartTooltip";
import MeasureKey, { measureOpacity, useMeasureKey, netOpacity } from "./MeasureKey";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import UnavailableNotice from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import {
  barShape,
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  axisWidth,
  CHART_COLOURS,
  divergingAxis,
  tickDecimals,
  noHouseholdChange,
} from "../utils/chartTheme";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { decileSentence, laterDecileNote } from "../utils/plainSentences";
import { laterDecileEnds } from "../utils/laterYears";
import {
  decileMembership,
  exportLegendItems,
  drawnNames,
} from "../utils/legendMembership";

// The published catalogue supplies the shared measure order and colours.

// Chart metadata for export
const CHART_DESCRIPTION =
  "Average change in household net income by income decile, £ a year.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

const waterfallDeciles = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

// The card's "About this chart"
const ABSOLUTE_INFO = {
  how: ["Each bar stacks the selected measures' own effects; the line marks their total."],
  method: { anchor: METHOD_ANCHORS.byIncome, label: "How we group households by income" },
};

function WaterfallChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
  // The measure whose segment is hovered: the others dim
  const [hoveredMeasure, setHoveredMeasure] = useState(null);
  const catalogue = useMeasureCatalogue();
  const {
    displayable: POLICIES,
    allPolicyNames: ALL_POLICY_NAMES,
    policyColors: POLICY_COLORS,
    bySeriesKey,
  } = catalogue;
  const hasUnavailableSelection = selectedPolicies.some(
    (id) => !POLICIES.some((policy) => policy.id === id),
  );


  // Build chart data for internal year
  // Memoised: a re-render with the same year and policies keeps the same
  // array, so Recharts tweens once from the old year instead of restarting
  const data = useMemo(() => {
    const waterfallSelectedYear = rawData
      ? rawData.filter(
          (row) =>
            parseInt(row.year) === selectedYear &&
            row.decile !== "all" &&
            selectedPolicies.includes(row.reform_id) &&
            isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
        )
      : [];

    return waterfallDeciles.map((decile) => {
      const dataPoint = { decile };
      let netChange = 0;
      let incomplete = hasUnavailableSelection;
      POLICIES.forEach((policy) => {
        const isSelected = selectedPolicies.includes(policy.id);
        const dataRow = waterfallSelectedYear.find(
          (row) => row.reform_id === policy.id && row.decile === decile,
        );
        const parsedValue = dataRow ? Number.parseFloat(dataRow.avg_change) : NaN;
        const value = isSelected && Number.isFinite(parsedValue) ? parsedValue : null;
        if (isSelected && value === null) incomplete = true;
        dataPoint[policy.seriesKey] = value;
        if (value !== null) netChange += value;
      });
      dataPoint.netChange = incomplete ? null : netChange;
      dataPoint.incomplete = incomplete;
      return dataPoint;
    });
  }, [rawData, selectedPolicies, selectedYear, POLICIES, hasUnavailableSelection, catalogue]);

  // "Later years differ": the first later year whose lowest- or
  // highest-income tenth moves the other way (plainSentences.js)
  const laterNote = useMemo(() => {
    const ends = { low: data[0]?.netChange, high: data[data.length - 1]?.netChange };
    const later = laterDecileEnds(rawData, { valueKey: "avg_change", ends: ["1", "10"], selectedPolicies, catalogue, selectedYear });
    return laterDecileNote(ends, later, "absolute");
  }, [data, rawData, selectedPolicies, catalogue, selectedYear]);

  // Every selected measure is in the legend in every year (so the legend,
  // and the plot's height, hold still on a year change or Play); one with
  // no effect on any household this year is greyed out, and the note under
  // the chart says why (legendMembership)
  const members = useMemo(
    () => decileMembership(catalogue, rawData, "avg_change", selectedPolicies, selectedYear),
    [catalogue, rawData, selectedPolicies, selectedYear],
  );
  const activePolicies = drawnNames(members);
  const netLabel = activePolicies.length > 1 ? "Net change" : undefined;
  // In a section with a shared key (MeasureKey), the card draws no legend
  const key = useMeasureKey(members, netLabel);
  // The legend took about 160px (300 on a phone) of the chart's height;
  // with the section's key above the pair, the plot keeps its own size
  // With no legend under the plot, room below the axis for the logo
  const LOGO_ROOM = CHART_LOGO.height + CHART_LOGO.padding + 6;
  const plotHeight = key.shared ? (narrow ? 390 : 410) : narrow ? 620 : 480;

  // The y axis for the year shown, from the lowest to the highest stack and
  // always including 0 (not mirrored about 0, so no half of the plot is empty)
  const calculateYAxisDomain = () => {
    // The year shown, so the axis fits its bars
    const allYears = [selectedYear];
    let minValue = 0;
    let maxValue = 0;

    allYears.forEach((year) => {
      const yearData = rawData
        ? rawData.filter(
            (row) =>
              parseInt(row.year) === year &&
              row.decile !== "all" &&
              selectedPolicies.includes(row.reform_id) &&
              isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
          )
        : [];

      waterfallDeciles.forEach((decile) => {
        let positiveSum = 0;
        let negativeSum = 0;

        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = yearData.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          const parsedValue = isSelected && dataRow ? Number.parseFloat(dataRow.avg_change) : NaN;
          const value = Number.isFinite(parsedValue) ? parsedValue : 0;
          if (value > 0) positiveSum += value;
          else negativeSum += value;
        });

        minValue = Math.min(minValue, negativeSum);
        maxValue = Math.max(maxValue, positiveSum);
      });
    });

    // Symmetric about zero when deciles gain and lose (divergingAxis)
    return divergingAxis([minValue, maxValue]);
  };

  const { domain: yAxisDomain, ticks: yAxisTicks } = calculateYAxisDomain();
  const hasIncompleteResults = data.some((point) => point.incomplete);

  if (!rawData || rawData.length === 0) {
    return (
      <div className="waterfall-chart">
        <h3>Absolute impact by income decile</h3>
        <p className="chart-description">
            {CHART_DESCRIPTION}
        </p>
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: CHART_COLOURS.tick,
            backgroundColor: CHART_COLOURS.mutedFill,
            borderRadius: "8px",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.95rem" }}>
            No data available yet for this metric
          </p>
        </div>
      </div>
    );
  }

  // Whole pounds, unless the ticks are closer than £1 apart
  const poundDecimals = tickDecimals(yAxisTicks, 0, 2);
  const formatCurrency = (value) => {
    const absVal = Math.abs(value).toLocaleString("en-GB", {
      minimumFractionDigits: poundDecimals,
      maximumFractionDigits: poundDecimals,
    });
    return value < 0 && Number(absVal.replace(/,/g, "")) !== 0 ? `-£${absVal}` : `£${absVal}`;
  };


  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...exportLegendItems(members, catalogue),
    ...(activePolicies.length > 1
      ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }]
      : []),
  ];

  const chartTitle = `Absolute impact by income decile, ${formatYearRange(selectedYear)}`;

  const published = (rawData ?? []).some(
    (row) => parseInt(row.year) === selectedYear,
  );
  // Only measures that change no household's income this year: the plot's
  // note says so, and the card's sentence does not repeat it as "almost no
  // change" at both ends
  const nothingChanges = published && activePolicies.length === 0 && !hasIncompleteResults;
  const exportName = `absolute-impact-decile-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description: CHART_DESCRIPTION,
    legendItems,
    logo: CHART_LOGO,
  };
  const selectedMeasures = POLICIES.filter((policy) =>
    selectedPolicies.includes(policy.id),
  );
  // One menu: the chart's data as CSV, and the chart as PNG or SVG.
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: () => decileCsv(data, selectedMeasures, { kind: "absolute", year: selectedYear }),
    published,
    // No image of an empty plot: the CSV only, when no measure changes a household
    image: activePolicies.length > 0,
  };

  return (
    <div className="waterfall-chart">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="bars" />
            <span className="title-text">
              <NoBreakYear text={chartTitle} />
            </span>
          </h3>
          {/* One plain sentence; what the chart measures is in More info */}
          <p className="chart-description">
            {(nothingChanges ? null : decileSentence(data, "absolute")) ?? CHART_DESCRIPTION}
            {laterNote && <span className="later-years-note"> {laterNote}</span>}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published && hasIncompleteResults && (
          <UnavailableNotice reason="Some selected measures have no published results for this chart. The net change is unavailable." />
        )}
        {nothingChanges ? (
          // Only measures that change no household's income this year (an
          // employer cost): a note, not an empty plot of zero ticks. A
          // measure with no published result is not 'no change': the
          // unavailable notice above says so and the plot keeps its gaps
          <div className="plot-empty" style={{ minHeight: plotHeight }} role="status">
            <p>{noHouseholdChange(formatYearRange(selectedYear))}</p>
          </div>
        ) : published ? (
          <ResponsiveContainer width="100%" height={plotHeight}>
            <ComposedChart
              data={data}
              margin={{ ...chartMargin(narrow), bottom: key.shared ? LOGO_ROOM : 0 }}
              stackOffset="sign"
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="decile"
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                height={44}
                label={{
                  value: "Income decile",
                  position: "insideBottom",
                  offset: 2,
                  style: AXIS_TITLE_STYLE,
                }}
              />
              <YAxis
                domain={yAxisDomain}
                ticks={yAxisTicks}
                tickFormatter={formatCurrency}
                tick={TICK_STYLE}
                width={axisWidth(yAxisTicks, formatCurrency)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />

              {/* One segment at a time, beside the cursor; the other measures dim */}

              <Tooltip

                {...TOOLTIP_PROPS}

                shared={false}

                cursor={false}

                offset={16}

                content={<SegmentTooltip activeKey={hoveredMeasure} labelOf={(row) => `Income decile ${row.decile}, ${formatYearRange(selectedYear)}`} format={(value) => `£${Math.round(value).toLocaleString("en-GB")}`} netKey="netChange" netLabel="Net change" />}

              />
              {!key.shared && (
                <Legend
                  wrapperStyle={legendWrapperStyle(narrow)}
                  content={
                    <MeasureKey
                      members={members}
                      netLabel={netLabel}
                      highlight={key.highlight}
                      onHighlight={key.setHighlight}
                    />
                  }
                />
              )}
              {ALL_POLICY_NAMES.map((policyName) => (
                <Bar
                  key={policyName}
                  dataKey={policyName}
                  fill={POLICY_COLORS[policyName]}
                  fillOpacity={hoveredMeasure ? (hoveredMeasure === policyName ? 1 : 0.3) : measureOpacity(key.highlight, policyName)}
                  onMouseEnter={() => setHoveredMeasure(policyName)}
                  onMouseLeave={() => setHoveredMeasure(null)}
                  name={bySeriesKey.get(policyName)?.label ?? policyName}
                  stackId="stack"
                  shape={barShape(ALL_POLICY_NAMES)}
                  {...chartMotion()}
                  // Always mounted (a zero series has no height), so a series that
                  // starts in a later year grows in place instead of remounting
                />
              ))}
              <Line
                // Straight segments: deciles are categories, not a curve
                // A smooth net line that never overshoots its points (monotone)
                type="monotone"
                strokeLinejoin="round"
                strokeLinecap="round"
                dataKey="netChange"
                strokeOpacity={netOpacity(key.highlight)}
                stroke={CHART_COLOURS.net}
                strokeWidth={2}
                dot={false}
                name="netChange"
                {...chartMotion()}
                hide={activePolicies.length <= 1}
              />
              {/* The net dots as a Scatter: Recharts hides a Line's own dots while
                  it animates, so they would vanish and pop back on every year
                  change; a Scatter's points tween with the line instead */}
              <Scatter
                dataKey="netChange"
                opacity={netOpacity(key.highlight)}
                shape={netDot}
                legendType="none"
                tooltipType="none"
                {...chartMotion()}
                hide={activePolicies.length <= 1}
              />
              <Customized component={<ChartUnitLabel text="Average change per household (£)" />} />
            <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot
            height={plotHeight}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
      {published && (
        <div className="chart-footer">
          <ChartMoreInfo members={members} year={selectedYear} info={ABSOLUTE_INFO} />
        </div>
      )}
    </div>
  );
}

export default WaterfallChart;
