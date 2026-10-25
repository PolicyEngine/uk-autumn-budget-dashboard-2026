import { useMemo, useRef } from "react";
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
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import UnavailableNotice from "./publication/UnavailableNotice";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  axisWidth,
  CHART_COLOURS,
  zeroBasedAxis,
  HOVER_CURSOR,
} from "../utils/chartTheme";
import { DEFAULT_DISPLAY_YEAR, isDisplayYear } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";

// The published catalogue supplies the shared measure order and colours.

// Chart metadata for export
const CHART_DESCRIPTION =
  "Average change in household net income by income decile, £ a year.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

const waterfallDeciles = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

function WaterfallChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
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

  // The measures with a non-zero effect in any shown year, not just this
  // one: the legend (and so the plot's height) stays the same from year to
  // year, so a year change or Play tweens the bars instead of rescaling
  const activePolicies = useMemo(() => {
    const ids = new Set(
      (rawData ?? [])
        .filter(
          (row) =>
            row.decile !== "all" && isDisplayYear(row.year) &&
            selectedPolicies.includes(row.reform_id) &&
            isCatalogueRowDisplayable(catalogue, row.reform_id, row.year) &&
            Math.abs(parseFloat(row.avg_change)) > 0.01,
        )
        .map((row) => row.reform_id),
    );
    return ALL_POLICY_NAMES.filter((name) =>
      ids.has(POLICIES.find((policy) => policy.seriesKey === name)?.id),
    );
  }, [rawData, selectedPolicies, POLICIES, ALL_POLICY_NAMES, catalogue]);

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

    return zeroBasedAxis([minValue, maxValue]);
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

  const formatCurrency = (value) => {
    const absVal = Math.abs(value).toLocaleString("en-GB", {
      maximumFractionDigits: 0,
    });
    return value < 0 ? `-£${absVal}` : `£${absVal}`;
  };


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

  const chartTitle = `Absolute impact by income decile, ${formatYearRange(selectedYear)}`;

  const published = (rawData ?? []).some(
    (row) => parseInt(row.year) === selectedYear,
  );
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
          <p className="chart-description">
            {CHART_DESCRIPTION}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>

      <div ref={chartRef}>
        {published && hasIncompleteResults && (
          <UnavailableNotice reason="Some selected measures have no published results for this chart. The net change is unavailable." />
        )}
        {published ? (
          <ResponsiveContainer width="100%" height={narrow ? 620 : 480}>
            <ComposedChart
              data={data}
              margin={chartMargin(narrow)}
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

              <Tooltip

                {...TOOLTIP_PROPS}

                cursor={HOVER_CURSOR}

                content={

                  <ChartTooltip

                    format={(value) => `£${Math.round(value).toLocaleString("en-GB")}`}

                    labelFormat={(label) => `Income decile ${label}, ${formatYearRange(selectedYear)}`}

                    netKey="netChange"

                    netLabel="Net change"

                  />

                }

              />
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                content={
                  <GroupedLegend
                    names={activePolicies}
                    netLabel={activePolicies.length > 1 ? "Net change" : undefined}
                  />
                }
              />
              {ALL_POLICY_NAMES.map((policyName) => (
                <Bar
                  key={policyName}
                  dataKey={policyName}
                  fill={POLICY_COLORS[policyName]}
                  name={bySeriesKey.get(policyName)?.label ?? policyName}
                  stackId="stack"
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
            height={narrow ? 620 : 480}
            yearLabel={formatYearRange(selectedYear)}
          />
        )}
      </div>
    </div>
  );
}

export default WaterfallChart;
