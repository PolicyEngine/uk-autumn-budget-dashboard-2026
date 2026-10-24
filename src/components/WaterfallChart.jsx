import { useRef } from "react";
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
} from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";

// The published catalogue supplies the shared measure order and colours.

// Chart metadata for export
const CHART_DESCRIPTION =
  "This chart shows the absolute change in net income by decile, measured in pounds per year. This represents the actual cash amount gained or lost by households in each decile.";

// Format year for display (e.g., 2026 -> "2026-27")
const formatYearRange = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

function WaterfallChart({ rawData, selectedPolicies, selectedYear = 2029 }) {
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

  const waterfallDeciles = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const waterfallSelectedYear = rawData
    ? rawData.filter(
        (row) =>
          parseInt(row.year) === selectedYear &&
          row.decile !== "all" &&
          selectedPolicies.includes(row.reform_id) &&
          isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
      )
    : [];

  const data = waterfallDeciles.map((decile) => {
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

    // Round to nice numbers and make symmetrical
    const roundToNice = (val) => {
      if (val <= 500) return Math.ceil(val / 100) * 100;
      if (val <= 2000) return Math.ceil(val / 500) * 500;
      return Math.ceil(val / 1000) * 1000;
    };

    const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue)) + 50;
    const rounded = roundToNice(maxAbs);

    return [-rounded, rounded];
  };

  const yAxisDomain = calculateYAxisDomain();
  const hasIncompleteResults = data.some((point) => point.incomplete);

  if (!rawData || rawData.length === 0) {
    return (
      <div className="waterfall-chart">
        <h3>Absolute impact by income decile</h3>
        <p className="chart-description">
          This chart shows the absolute change in net income by decile, measured
          in pounds per year.
        </p>
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: "#666",
            backgroundColor: "#f9f9f9",
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

  // Check which policies have non-zero values
  const hasNonZeroValues = (policyName) => {
    return data.some((d) => Math.abs(d[policyName] || 0) > 0.01);
  };

  const activePolicies = ALL_POLICY_NAMES.filter(hasNonZeroValues);

  // Legend items for export: the measures the chart draws, as on screen
  const legendItems = [
    ...activePolicies.map((name) => ({
      color: POLICY_COLORS[name],
      label: bySeriesKey.get(name)?.label ?? name,
      type: "rect",
      group: bySeriesKey.get(name)?.direction === "revenue" ? "raise" : bySeriesKey.get(name)?.direction === "cost" ? "cost" : "other",
    })),
    ...(activePolicies.length > 1
      ? [{ color: "#000000", label: "Net change", type: "line" }]
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
            <NoBreakYear text={chartTitle} />
          </h3>
          <p className="chart-description">
            This chart shows the absolute change in net income by decile,
            measured in pounds per year. This represents the actual cash amount
            gained or lost by households in each decile.
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
                tickFormatter={formatCurrency}
                tick={TICK_STYLE}
                width={axisWidth(yAxisDomain, formatCurrency)}
                axisLine={false}
                tickLine={false}
                ticks={(() => {
                  const [min, max] = yAxisDomain;
                  const range = max - min;
                  let interval = 100;
                  if (range > 1000) interval = 250;
                  if (range > 2000) interval = 500;
                  if (range > 5000) interval = 1000;
                  const ticks = [];
                  for (let i = min; i <= max + 0.001; i += interval) {
                    ticks.push(Math.round(i));
                  }
                  if (!ticks.includes(0)) ticks.push(0);
                  return ticks.sort((a, b) => a - b);
                })()}
              />
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />

              <Tooltip

                {...TOOLTIP_PROPS}

                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}

                content={

                  <ChartTooltip

                    format={(value) => `£${Math.round(value).toLocaleString("en-GB")}`}

                    labelFormat={(label) => `Income decile ${label}`}

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
                  animationDuration={500}
                  animationBegin={0}
                  hide={!hasNonZeroValues(policyName)}
                />
              ))}
              <Line
                // Straight segments: deciles are categories, not a curve
                type="linear"
                dataKey="netChange"
                stroke="#000000"
                strokeWidth={2}
                dot={{ fill: "#000000", stroke: "#ffffff", strokeWidth: 1.5, r: 3.5 }}
                name="netChange"
                animationDuration={500}
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
