import { useMemo, useRef, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, ReferenceLine, Customized, Scatter } from "recharts";
import { Tooltip } from "./ViewportTooltip";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { decileCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { SegmentTooltip, TOOLTIP_PROPS } from "./ChartTooltip";
import MeasureKey, { measureOpacity, useMeasureKey, netOpacity } from "./MeasureKey";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import UnavailableNotice from "./publication/UnavailableNotice";
import WithheldDecileTick from "./WithheldDecileTick";
import { isWithheldDecileValue, WITHHELD_DECILE_MESSAGE } from "../utils/decileWithholding";
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
import { DEFAULT_DISPLAY_YEAR, useDisplayYears } from "../utils/displayYears";
import { chartMotion, netDotTitled } from "../utils/chartMotion";
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
  how: ["Each bar stacks the selected policies' own effects; the line marks their total."],
  method: { anchor: METHOD_ANCHORS.byIncome, label: "How we group households by income" },
};

/**
 * @param {Object} props
 * @param {string} [props.title] - The title before the year (DecileImpactCard
 *   gives the merged card's)
 * @param {React.ReactNode} [props.controls] - Controls under the sentence
 * @param {Object} [props.info] - About this chart, in place of the card's own
 */
function WaterfallChart({ rawData, selectedPolicies, selectedYear = DEFAULT_DISPLAY_YEAR, title = "Absolute impact by income decile", controls = null, info = ABSOLUTE_INFO }) {
  const chartRef = useRef(null);
  const narrow = useNarrowViewport();
  // The measure whose segment is hovered: the others dim
  const [hoveredMeasure, setHoveredMeasure] = useState(null);
  const catalogue = useMeasureCatalogue();
  const shownYears = useDisplayYears();
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
      let unavailable = hasUnavailableSelection;
      let withheld = false;
      POLICIES.forEach((policy) => {
        const isSelected = selectedPolicies.includes(policy.id);
        const dataRow = waterfallSelectedYear.find(
          (row) => row.reform_id === policy.id && row.decile === decile,
        );
        const parsedValue = dataRow ? Number.parseFloat(dataRow.avg_change) : NaN;
        const value = isSelected && Number.isFinite(parsedValue) ? parsedValue : null;
        if (isSelected && value === null) {
          incomplete = true;
          if (dataRow && isWithheldDecileValue(dataRow.avg_change)) withheld = true;
          else unavailable = true;
        }
        dataPoint[policy.seriesKey] = value;
        if (value !== null) netChange += value;
      });
      // A withheld decile shows nothing: no other policy's bar and no net
      // dot, as the bars beside a withheld member would give its figure
      // back (#290 6480462886, as on the decile % chart)
      if (withheld) POLICIES.forEach((policy) => { dataPoint[policy.seriesKey] = null; });
      dataPoint.netChange = incomplete ? null : netChange;
      dataPoint.incomplete = incomplete;
      dataPoint.unavailable = unavailable;
      dataPoint.withheld = withheld;
      return dataPoint;
    });
  }, [rawData, selectedPolicies, selectedYear, POLICIES, hasUnavailableSelection, catalogue]);

  // "Later years differ": the first later year whose lowest- or
  // highest-income tenth moves the other way (plainSentences.js), as the
  // decile sentence's last clause, or alone when there is no sentence
  const { laterNote, laterNoteAlone } = useMemo(() => {
    const ends = { low: data[0]?.netChange, high: data[data.length - 1]?.netChange };
    const later = laterDecileEnds(rawData, { valueKey: "avg_change", ends: ["1", "10"], selectedPolicies, catalogue, selectedYear, years: shownYears });
    return {
      laterNote: laterDecileNote(ends, later, "absolute"),
      laterNoteAlone: laterDecileNote(ends, later, "absolute", { standalone: true }),
    };
  }, [data, rawData, selectedPolicies, catalogue, selectedYear, shownYears]);

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
  // In a section with a shared key (MeasureKey), the card draws no legend.
  // No MeasureKeyProvider wraps DecileImpactCard (only AgeSection has one;
  // All households dropped its section key on 27 Oct), so in the app
  // key.shared is false and the chart draws its own legend under its axis.
  // The key.shared branches here and below run only under a provider, as
  // in CatalogueCharts.test.jsx.
  const key = useMeasureKey(members, netLabel);
  // With its own legend the chart is 480px (620 on a phone); the legend
  // takes its height from those, between the axis and the logo. Under a
  // section key there is no legend to make room for, so the chart is
  // shorter, 410px (390 on a phone), with room below the axis for the logo
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
          if (!Number.isFinite(parsedValue)) return;
          const value = parsedValue;
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
  const hasUnavailableResults = data.some((point) => point.unavailable);
  const withheldDeciles = new Set(data.filter((point) => point.withheld).map((point) => point.decile));

  if (!rawData || rawData.length === 0) {
    return (
      <div className="waterfall-chart">
        <h3>{title}</h3>
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

  const chartTitle = `${title}, ${formatYearRange(selectedYear)}`;

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
          {/* One plain sentence; what the chart measures is in About this chart */}
          <p className="chart-description">
            {(nothingChanges ? null : decileSentence(data, "absolute", laterNote)) ?? (
              <>
                {CHART_DESCRIPTION}
                {laterNoteAlone && <span className="later-years-note"> {laterNoteAlone}</span>}
              </>
            )}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={chartTitle} />
      </div>
      {controls && <div className="chart-controls ls-controls">{controls}</div>}

      <div ref={chartRef} className="chart-plot">
        {published && hasUnavailableResults && (
          <UnavailableNotice reason="Some selected policies have no published results for this chart. The net change is unavailable." />
        )}
        {/* The note's line is always kept, hidden in a year with nothing
            withheld, so the card holds its height as Play moves through the
            years (Vahid, 28 Oct: it jumped in 2030-31) */}
        {published && (
          <p
            className="chart-description"
            aria-hidden={withheldDeciles.size > 0 ? undefined : "true"}
            style={withheldDeciles.size > 0 ? undefined : { visibility: "hidden" }}
          >
            * Income deciles {withheldDeciles.size > 0 ? [...withheldDeciles].map((decile) => String(decile).replace(/st|nd|rd|th/g, "")).join(", ") : "7, 9"}: <span>{WITHHELD_DECILE_MESSAGE}</span>.
          </p>
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
          // Its own fixed height, never 100%: the withheld-deciles note's
          // line is always above it in the plot (hidden in a year with none
          // withheld), so at 100% it would take the plot's height, note
          // included, and grow by the note's height on every resize,
          // without end, and the household scatter beside it with it
          // (#290, 6479887743, in 2030-31; then every year once the line was
          // always kept: 2,312px to 52,629px in 20s at 1440px, 28 Oct)
          <ResponsiveContainer width="100%" height={plotHeight}>
            <ComposedChart
              data={data}
              margin={{ ...chartMargin(narrow), bottom: key.shared ? LOGO_ROOM : 0 }}
              stackOffset="sign"
            >
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="decile"
                tick={<WithheldDecileTick withheldDeciles={withheldDeciles} />}
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
              {/* A withheld decile is marked where its bar would be, so the
                  break in the net line reads as "not published", never as
                  a value (Vahid, 29 Oct) */}
              {[...withheldDeciles].map((decile) => (
                <ReferenceLine
                  key={`withheld-${decile}`}
                  x={decile}
                  stroke={CHART_COLOURS.noChange}
                  strokeDasharray="2 4"
                  className="decile-withheld-mark"
                  label={{ value: "Not published", angle: -90, position: "center", fill: CHART_COLOURS.noChange, fontSize: 11 }}
                />
              ))}

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
                shape={netDotTitled((row) => `Decile ${String(row.decile).replace(/st|nd|rd|th/g, "")}: net change ${formatCurrency(row.netChange)}`)}
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
          <ChartMoreInfo members={members} year={selectedYear} info={info} />
        </div>
      )}
    </div>
  );
}

export default WaterfallChart;
