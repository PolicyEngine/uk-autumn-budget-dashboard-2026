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
} from "../utils/chartTheme";
import { DISPLAY_YEARS, DEFAULT_DISPLAY_YEAR, isDisplayYear } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";

// The published catalogue supplies the shared measure order and colours.

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the percentage change in net income by decile, displaying the proportional impact relative to baseline income. Positive values indicate gains; negative values indicate losses.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

const decileOrder = [
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
];

function DistributionalChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR }) {
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

  const formatPercent = (value) => `${value.toFixed(1)}%`;

  // Remove "st", "nd", "rd", "th" from decile labels
  const formatDecile = (value) => {
    return value.replace(/st|nd|rd|th/g, "");
  };

  // Build chart data for internal year
  // Memoised: a re-render with the same year and policies keeps the same
  // array, so Recharts tweens once from the old year instead of restarting
  const data = useMemo(() => {
    const distributionalSelectedYear = rawData
      ? rawData.filter(
          (row) =>
            parseInt(row.year) === selectedYear &&
            selectedPolicies.includes(row.reform_id) &&
            isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
        )
      : [];

    return decileOrder.map((decile) => {
      const dataPoint = { decile };
      let netChange = 0;
      let incomplete = hasUnavailableSelection;
      POLICIES.forEach((policy) => {
        const isSelected = selectedPolicies.includes(policy.id);
        const dataRow = distributionalSelectedYear.find(
          (row) => row.reform_id === policy.id && row.decile === decile,
        );
        const parsedValue = dataRow ? Number.parseFloat(dataRow.value) : NaN;
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
            isDisplayYear(row.year) &&
            selectedPolicies.includes(row.reform_id) &&
            isCatalogueRowDisplayable(catalogue, row.reform_id, row.year) &&
            Math.abs(parseFloat(row.value)) > 0.01,
        )
        .map((row) => row.reform_id),
    );
    return ALL_POLICY_NAMES.filter((name) =>
      ids.has(POLICIES.find((policy) => policy.seriesKey === name)?.id),
    );
  }, [rawData, selectedPolicies, POLICIES, ALL_POLICY_NAMES, catalogue]);

  // Calculate y-axis domain across ALL years, symmetrical around zero
  const calculateYAxisDomain = () => {
    const allYears = DISPLAY_YEARS;
    let minValue = 0;
    let maxValue = 0;

    allYears.forEach((year) => {
      const yearData = rawData
        ? rawData.filter(
            (row) =>
              parseInt(row.year) === year &&
              selectedPolicies.includes(row.reform_id) &&
              isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
          )
        : [];

      decileOrder.forEach((decile) => {
        let positiveSum = 0;
        let negativeSum = 0;

        POLICIES.forEach((policy) => {
          const isSelected = selectedPolicies.includes(policy.id);
          const dataRow = yearData.find(
            (row) => row.reform_id === policy.id && row.decile === decile,
          );
          const parsedValue = isSelected && dataRow ? Number.parseFloat(dataRow.value) : NaN;
          const value = Number.isFinite(parsedValue) ? parsedValue : 0;
          if (value > 0) positiveSum += value;
          else negativeSum += value;
        });

        minValue = Math.min(minValue, negativeSum);
        maxValue = Math.max(maxValue, positiveSum);
      });
    });

    // Round to nice numbers and make symmetrical
    const roundToNice = (val) => {
      if (val <= 1) return Math.ceil(val * 2) / 2; // Round to 0.5
      if (val <= 5) return Math.ceil(val); // Round to 1
      return Math.ceil(val / 2) * 2; // Round to 2
    };

    const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue)) + 0.2;
    const rounded = roundToNice(maxAbs);

    return [-rounded, rounded];
  };

  const yAxisDomain = calculateYAxisDomain();
  const hasIncompleteResults = data.some((point) => point.incomplete);

  if (!rawData || rawData.length === 0) {
    return (
      <div className="distributional-chart">
        <h3>Relative impact by income decile</h3>
        <p className="chart-description">
          This chart shows the percentage change in net income by decile,
          displaying the proportional impact relative to baseline income.
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

  const chartTitle = `Relative impact by income decile, ${formatYearRange(selectedYear)}`;

  const published = (rawData ?? []).some(
    (row) => parseInt(row.year) === selectedYear,
  );
  const exportName = `relative-impact-decile-${selectedYear}`;
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
    csv: () => decileCsv(data, selectedMeasures, { kind: "relative", year: selectedYear }),
    published,
  };

  return (
    <div className="distributional-chart">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            This chart shows the percentage change in net income by decile,
            displaying the proportional impact relative to baseline income.
            Positive values indicate gains; negative values indicate losses.
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
                tickFormatter={formatDecile}
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
                width={axisWidth(yAxisDomain, formatPercent)}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatPercent}
                tick={TICK_STYLE}
                ticks={(() => {
                  const [min, max] = yAxisDomain;
                  const range = max - min;
                  let interval = 0.5;
                  if (range > 4) interval = 1;
                  if (range > 10) interval = 2;
                  const ticks = [];
                  for (let i = min; i <= max + 0.001; i += interval) {
                    ticks.push(Math.round(i * 10) / 10);
                  }
                  if (!ticks.includes(0)) ticks.push(0);
                  return ticks.sort((a, b) => a - b);
                })()}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />

              <Tooltip

                {...TOOLTIP_PROPS}

                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}

                content={

                  <ChartTooltip

                    format={(value) => `${value.toFixed(2)}%`}

                    labelFormat={(label) =>
                      `Income decile ${String(label).replace(/st|nd|rd|th/g, "")}, ${formatYearRange(selectedYear)}`
                    }

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
                type="linear"
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
              <Customized component={<ChartUnitLabel text="Change in net income (%)" />} />
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

export default DistributionalChart;
