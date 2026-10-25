import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_YEARS } from "../utils/displayYears";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Scatter,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { loadVerifiedTable } from "../utils/loadDashboard";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import UnavailableNotice from "./publication/UnavailableNotice";
import SectionHeading from "./SectionHeading";
import Note from "./Note";
import PillSelect from "./PillSelect";
import MeasuresCard from "./youngPeople/MeasuresCard";
import TrendCard from "./youngPeople/TrendCard";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  fiscalYearTick,
  CHART_COLOURS,
} from "../utils/chartTheme";
import {
  AGE_BANDS,
  YOUNG_BAND,
  isPublished,
  meanChangeByBand,
  sharesByGroup,
} from "../utils/ageImpact";
import { SINGLE_AGE_FIRST, SINGLE_AGE_LAST, fitRange, singleAgeBars } from "./youngPeople/youngPeopleData";
import { X_AXIS_HEIGHT, plotMargin } from "./youngPeople/chartRows";
import "./YoungPeopleSection.css";
import { chartMotion, netDot } from "../utils/chartMotion";

/** The section's anchor: link to it as #young-people. */
export const YOUNG_PEOPLE_ANCHOR = "young-people";


// Highlight for the 16 to 24 band, and its legend swatch (the same tint
// on white)
const YOUNG_FILL = "rgba(49, 151, 149, 0.10)";
const YOUNG_SWATCH = CHART_COLOURS.highlightBand;
// Better off, unchanged, worse off: the page's teal and amber, grey between
const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: CHART_COLOURS.gain },
  { key: "pct_unchanged", label: "Unchanged", color: CHART_COLOURS.noChange },
  { key: "pct_worse_off", label: "Worse off", color: CHART_COLOURS.loss },
];

const MEAN_DESCRIPTION =
  "Average change in household net income per person, by age group, in pounds a year. Each person counts their household's change; bars add up each selected policy's own effect.";
const SINGLE_AGE_DESCRIPTION =
  `Average change in household net income per person, for each single year of age from ${SINGLE_AGE_FIRST} to ${SINGLE_AGE_LAST}, in pounds a year. Each person counts their household's change, so children show their household's; each bar adds up the selected policies' own effects.`;
const SHARES_DESCRIPTION =
  "The share of people whose household net income rises or falls by more than 0.01%, by age group and for all ages.";

/** The two views of "Average change by age". */
const AGE_VIEWS = [
  { value: "band", label: "By age group" },
  { value: "single", label: "By single year of age" },
];
// Ticks every five years, with the 16 to 24 band's ends (in bold) in place
// of 15 and 25: a bar apart, both labels would run together
const SINGLE_AGE_TICKS = ["10", "16", "20", "24", "30", "35", "40"];
const SINGLE_AGE_TICKS_NARROW = ["10", "16", "24", "30", "40"];
const YOUNG_ENDS = new Set(["16", "24"]);
// Gains teal, losses amber, under £1 either way grey (as the household
// scatter)
const SIGN_COLOURS = { gain: CHART_COLOURS.gain, loss: CHART_COLOURS.loss, zero: CHART_COLOURS.noChange };
const signColour = (value) =>
  Math.abs(value) < 1 ? SIGN_COLOURS.zero : value > 0 ? SIGN_COLOURS.gain : SIGN_COLOURS.loss;
const UNIT = "Average change per person (£ a year)";

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const signedPounds = (value) =>
  value < 0 ? `-£${Math.abs(Math.round(value)).toLocaleString("en-GB")}` : pounds(value);
const percent = (value) => `${value.toFixed(1)}%`;

/** Ticks for a symmetric domain: steps of 50, 100, 250, 500 or 1,000. */
function niceDomain(maxAbs) {
  const steps = [25, 50, 100, 250, 500, 1000, 2500];
  const step = steps.find((candidate) => maxAbs / candidate <= 4) ?? 5000;
  const top = Math.max(step, Math.ceil(maxAbs / step) * step);
  const ticks = [];
  for (let tick = -top; tick <= top + 1e-9; tick += step) ticks.push(tick);
  return { domain: [-top, top], ticks };
}

/**
 * The age table from each verified artifact (#20's receipt route), typed by
 * the publication contract. A measure whose artifact carries no age table
 * has no rows, so its figures by age are unavailable.
 */
function useAgeImpactRows(catalogue) {
  const [state, setState] = useState({ catalogue, status: "loading", rows: null });
  useEffect(() => {
    let cancelled = false;
    loadVerifiedTable(catalogue, "age_impact")
      .then((rows) => {
        // No verified age table at all reads as unavailable, not as empty charts
        if (!cancelled) setState({ catalogue, status: rows.length ? "ready" : "unavailable", rows: rows.length ? rows : null });
      })
      .catch(() => {
        if (!cancelled) setState({ catalogue, status: "error", rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogue]);
  return state.catalogue === catalogue ? state : { status: "loading", rows: null };
}

/** A legend of one row of swatches, in the grouped legend's style. */
function RowLegend({ items = OUTCOMES }) {
  return (
    <div className="grouped-legend is-columns young-people-outcome-legend">
      <ul className="grouped-legend-items">
        {items.map((item) => (
          <li key={item.key}>
            <span
              className="grouped-legend-swatch"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <span className="grouped-legend-label">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SINGLE_AGE_LEGEND = [
  { key: "gain", label: "Gain", color: SIGN_COLOURS.gain },
  { key: "loss", label: "Loss", color: SIGN_COLOURS.loss },
  { key: "young", label: "16 to 24 shaded", color: YOUNG_SWATCH },
];

/** The 16 to 24 tick in bold, the others as usual. */
function AgeTick({ x, y, payload, narrow }) {
  const band = AGE_BANDS.find((candidate) => candidate.label === payload.value);
  const young = band?.key === YOUNG_BAND;
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {narrow ? band?.short : payload.value}
    </text>
  );
}

/** A stable symmetric axis for the band view, over every year. */
function useBandDomain(rows, policies, selectedPolicies) {
  return useMemo(() => {
    const years = [...new Set((rows ?? []).map((row) => row.year))];
    let maxAbs = 0;
    for (const year of years) {
      for (const point of meanChangeByBand(rows, policies, selectedPolicies, year)) {
        let up = 0;
        let down = 0;
        for (const policy of policies) {
          const value = point[policy.seriesKey ?? `measure:${policy.id}`] ?? 0;
          if (value > 0) up += value;
          else down += value;
        }
        maxAbs = Math.max(maxAbs, up, -down);
      }
    }
    return niceDomain(maxAbs);
  }, [rows, policies, selectedPolicies]);
}

/** The single-year tick: the 16 to 24 band's ends in bold teal. */
function SingleAgeTick({ x, y, payload }) {
  const young = YOUNG_ENDS.has(payload.value);
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {payload.value}
    </text>
  );
}

/** "Age 22: +£X a year", the swatch in the bar's colour. */
function SingleAgeTooltip({ yearLabel, ...props }) {
  const point = props.payload?.[0]?.payload;
  if (!point || point.netChange === null) return null;
  return (
    <ChartTooltip
      {...props}
      format={(value) => `${pounds(value)} a year`}
      showPlus
      showZero
      labelFormat={(label) => `Age ${label}, ${yearLabel}`}
      single={{ key: "netChange", label: "Net change", color: signColour(point.netChange) }}
    />
  );
}

function MeanChangeCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const {
    allPolicyNames: ALL_POLICY_NAMES,
    policyColors: POLICY_COLORS,
    bySeriesKey,
  } = useMeasureCatalogue();
  const chartRef = useRef(null);
  const [view, setView] = useState("band");
  const single = view === "single";
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const data = meanChangeByBand(rows, policies, selectedPolicies, selectedYear);
  const singleData = singleAgeBars(rows, policies, selectedPolicies, selectedYear);
  const bandAxis = useBandDomain(rows, policies, selectedPolicies);
  // The single-year axis fits the year shown, with a little headroom
  const singleValues = singleData.map((point) => point.netChange).filter((value) => value !== null);
  const singleAxis = fitRange(Math.min(0, ...singleValues), Math.max(0, ...singleValues));
  const { domain, ticks } = single ? singleAxis : bandAxis;

  // Measures with an effect in any shown year, so the legend (and the
  // plot's height) holds still when the year changes or Play runs
  const activeNames = useMemo(
    () =>
      ALL_POLICY_NAMES.filter((name) =>
        DISPLAY_YEARS.some((year) =>
          meanChangeByBand(rows, policies, selectedPolicies, year).some(
            (point) => Math.abs(point[name] ?? 0) > 0.01,
          ),
        ),
      ),
    [rows, policies, selectedPolicies, ALL_POLICY_NAMES],
  );
  const youngLabel = AGE_BANDS.find((band) => band.key === YOUNG_BAND).label;
  const suppressed = data.filter((point) => point.suppressed);
  const missingAges = singleData.filter((point) => point.netChange === null);
  const description = single ? SINGLE_AGE_DESCRIPTION : MEAN_DESCRIPTION;
  const incomplete = data.some((point) => point.incomplete);

  const title = `Average change by age, ${yearLabel}`;
  const exportName = single
    ? `young-people-change-by-single-age-${selectedYear}`
    : `young-people-change-by-age-${selectedYear}`;
  const exportOptions = {
    title,
    description,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: single
      ? [
          { color: SIGN_COLOURS.gain, label: "Gain", type: "rect" },
          { color: SIGN_COLOURS.loss, label: "Loss", type: "rect" },
          { color: YOUNG_SWATCH, label: "16 to 24 shaded", type: "rect" },
        ]
      : [
          ...activeNames.map((name) => ({
            color: POLICY_COLORS[name],
            label: bySeriesKey.get(name)?.label ?? name,
            type: "rect",
            group: bySeriesKey.get(name)?.direction === "revenue" ? "raise" : bySeriesKey.get(name)?.direction === "cost" ? "cost" : "other",
          })),
          ...(activeNames.length > 1
            ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }]
            : []),
        ],
  };
  const selectedNames = policies
    .filter((policy) => selectedPolicies.includes(policy.id))
    .map((policy) => ({ key: policy.seriesKey ?? `measure:${policy.id}`, label: policy.label ?? policy.name, decimals: 2 }));
  const units =
    "£ per person per year; each person counts their household's change in net income (not equivalised)";
  const csvText = () =>
    single
      ? buildChartCsv({
          title: `Average change in household net income per person by single year of age, ${yearLabel}`,
          units: `${units}; the sum of each selected policy's own effect`,
          columns: [
            { key: "label", label: "Age" },
            { key: "netChange", label: "Net change", decimals: 2 },
          ],
          rows: published ? singleData.filter((point) => point.netChange !== null) : [],
          notes: missingAges.length
            ? [`Not shown, too few survey records: ages ${missingAges.map((p) => p.label).join(", ")}`]
            : [],
        })
      : buildChartCsv({
          title: `Average change in household net income per person by age, ${yearLabel}`,
          units,
          columns: [
            { key: "label", label: "Age" },
            ...selectedNames,
            { key: "netChange", label: "Net change", decimals: 2 },
          ],
          rows: published ? data.filter((point) => !point.suppressed) : [],
          notes: suppressed.length
            ? [`Not shown, too few survey records: ${suppressed.map((p) => p.label).join(", ")}`]
            : [],
        });
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: csvText,
    published,
  };
  const notShown = single
    ? missingAges.length > 0 && `ages ${missingAges.map((p) => p.label).join(", ")}`
    : suppressed.length > 0 && suppressed.map((p) => p.label).join(", ");

  return (
    <div className="young-people-mean">
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
          prefix="Show"
          name="Average change by age shown"
          value={view}
          onChange={setView}
          options={AGE_VIEWS}
          stableWidth
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {published && incomplete && (
          <UnavailableNotice reason="Some selected measures have no published results by age. The net change is unavailable for those age groups." />
        )}
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : single ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={singleData} margin={plotMargin(narrow)} barCategoryGap="14%">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1="16" x2="24" fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="label"
                ticks={narrow ? SINGLE_AGE_TICKS_NARROW : SINGLE_AGE_TICKS}
                interval={0}
                tick={<SingleAgeTick />}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: "Age", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                width={axisWidth(ticks, signedPounds)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.text} strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={<SingleAgeTooltip yearLabel={yearLabel} />}
              />
              <Bar dataKey="netChange" name="Net change" {...chartMotion()}>
                {singleData.map((point) => (
                  <Cell key={point.label} fill={signColour(point.netChange ?? 0)} />
                ))}
              </Bar>
              <Customized component={<ChartUnitLabel text={UNIT} />} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={plotMargin(narrow)} stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1={youngLabel} x2={youngLabel} fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="label"
                tick={<AgeTick narrow={narrow} />}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                height={X_AXIS_HEIGHT}
                label={{ value: "Age group", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                width={axisWidth(ticks, signedPounds)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.text} strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={
                  <ChartTooltip
                    format={pounds}
                    labelFormat={(label) => `Aged ${label.toLowerCase()}, ${yearLabel}`}
                    netKey="netChange"
                    netLabel="Net change"
                  />
                }
              />
              {ALL_POLICY_NAMES.map((name) => (
                <Bar
                  key={name}
                  dataKey={name}
                  name={bySeriesKey.get(name)?.label ?? name}
                  fill={POLICY_COLORS[name]}
                  stackId="stack"
                  {...chartMotion()}
                  // Always mounted (a zero series has no height), so a series that
                  // starts in a later year grows in place instead of remounting
                />
              ))}
              <Line
                type="linear"
                dataKey="netChange"
                name="netChange"
                stroke={CHART_COLOURS.net}
                strokeWidth={2}
                dot={false}
                {...chartMotion()}
                hide={activeNames.length <= 1}
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
                hide={activeNames.length <= 1}
              />
              <Customized component={<ChartUnitLabel text={UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {published &&
          (single ? (
            <RowLegend items={SINGLE_AGE_LEGEND} />
          ) : (
            <GroupedLegend
              names={activeNames}
              netLabel={activeNames.length > 1 ? "Net change" : undefined}
            />
          ))}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && notShown && <Note>Not shown, as too few survey records: {notShown}.</Note>}
    </div>
  );
}

/** The group tick: 16 to 24 in bold, all ages after a gap, as usual. */
function GroupTick({ x, y, payload, narrow }) {
  const band = AGE_BANDS.find((candidate) => candidate.label === payload.value);
  const young = band?.key === YOUNG_BAND;
  const label = narrow ? (band ? band.short : "All") : payload.value;
  return (
    <text
      x={x - 6}
      y={y}
      textAnchor="end"
      dominantBaseline="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young || !band ? 600 : 400}
    >
      {label}
    </text>
  );
}

function SharesCard({ rows, policies, selectedPolicies, selectedYear, narrow, height, combinedId }) {
  const chartRef = useRef(null);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const shares = sharesByGroup(rows, policies, selectedPolicies, selectedYear, combinedId);
  const data = shares
    ? shares.groups
        .filter((group) => !group.suppressed)
        .map((group) => ({ group: group.label, key: group.key, ...pick(group.row) }))
    : [];
  const thin = shares ? shares.groups.filter((group) => group.suppressed) : [];

  const title = `Better and worse off, ${yearLabel}`;
  const exportName = `young-people-better-worse-off-${selectedYear}`;
  const exportOptions = {
    title,
    description: SHARES_DESCRIPTION,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: OUTCOMES.map((outcome) => ({
      color: outcome.color,
      label: outcome.label,
      type: "rect",
    })),
  };
  const csvText = () =>
    buildChartCsv({
      title: `People better off, unchanged and worse off by age group, ${yearLabel}`,
      units: "% of people in the group; a change of more than 0.01% of household net income",
      columns: [
        { key: "group", label: "Age group" },
        ...OUTCOMES.map((outcome) => ({
          key: outcome.key,
          label: `${outcome.label} (%)`,
          decimals: 2,
        })),
      ],
      rows: data,
      notes: thin.length
        ? [`Not shown, too few survey records: ${thin.map((group) => group.label).join(", ")}`]
        : [],
    });
  // Until the year is published, only its CSV (the menu says why otherwise)
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: csvText,
    published: data.length > 0,
  };

  return (
    <div className="young-people-shares">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={title} />
          </h3>
          <p className="chart-description">{SHARES_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={title}
          disabledReason={
            shares || !published ? undefined : "Choose one policy or all policies"
          }
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : data.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={plotMargin(narrow)}
              barCategoryGap="22%"
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              {/* The 16 to 24 row's highlight, as in "Average change by age" */}
              <ReferenceArea
                y1={AGE_BANDS.find((band) => band.key === YOUNG_BAND).label}
                y2={AGE_BANDS.find((band) => band.key === YOUNG_BAND).label}
                fill={YOUNG_FILL}
                ifOverflow="visible"
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{
                  value: "Share of people in the group",
                  position: "insideBottom",
                  offset: 0,
                  style: AXIS_TITLE_STYLE,
                }}
              />
              <YAxis
                type="category"
                dataKey="group"
                tick={<GroupTick narrow={narrow} />}
                width={narrow ? 52 : 96}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={
                  <ChartTooltip
                    format={percent}
                    grouped={false}
                    labelFormat={(label) =>
                      `${label === "All ages" ? label : `Aged ${label.toLowerCase()}`}, ${yearLabel}`
                    }
                  />
                }
              />
              {OUTCOMES.map((outcome) => (
                <Bar
                  key={outcome.key}
                  dataKey={outcome.key}
                  name={outcome.label}
                  fill={outcome.color}
                  stackId="share"
                  {...chartMotion()}
                >
                  {/* The share on the segment, where it fits */}
                  <LabelList
                    dataKey={outcome.key}
                    position="center"
                    formatter={(value) => (value >= (narrow ? 14 : 8) ? `${Math.round(value)}%` : "")}
                    fill={outcome.key === "pct_unchanged" ? CHART_COLOURS.text : CHART_COLOURS.surface}
                    fontSize={12}
                    fontWeight={600}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>
              These shares come from one simulation of the selected policies
              together, so they are shown for a single policy or for all
              policies.
            </p>
          </div>
        )}
      </div>
      <div className="chart-legend">{data.length > 0 && <RowLegend />}</div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && thin.length > 0 && (
        <Note>Not shown, as too few survey records: {thin.map((group) => group.label).join(", ")}.</Note>
      )}
    </div>
  );
}

const pick = (row) =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome.key, row[outcome.key]]));

/**
 * "Young people (under 25)": how the selected policies change household
 * incomes by age group (ONS age bands) and single year of age, with young
 * people aged 16 to 24 highlighted. It loads age tables from verified
 * artifacts and follows the page's policy and year pills.
 */
function YoungPeopleSection({ selectedPolicies, selectedYear, policies }) {
  const narrow = useNarrowViewport();
  const catalogue = useMeasureCatalogue();
  const { status, rows: publishedRows } = useAgeImpactRows(catalogue);
  const { combinedId } = catalogue;
  const rows = useMemo(() => publishedRows?.filter((row) =>
    isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
  ) ?? null, [publishedRows, catalogue]);

  // A link to #young-people: the section renders after the page's data
  // loads, too late for the browser's own jump, so scroll once it is here.
  const scrolled = useRef(false);
  useEffect(() => {
    if (status !== "ready" || scrolled.current) return;
    scrolled.current = true;
    if (typeof window !== "undefined" && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
      document.getElementById(YOUNG_PEOPLE_ANCHOR)?.scrollIntoView();
    }
  }, [status]);

  const props = { rows, policies, selectedPolicies, selectedYear, narrow, combinedId };
  return (
    <>
      <SectionHeading
        id={YOUNG_PEOPLE_ANCHOR}
        className="young-people-heading"
        title="Young people (under 25)"
        subtitle="How the selected policies change household incomes by age group, with young people aged 16 to 24 highlighted."
      />
      <section className="report-section young-people-section" aria-label="Young people (under 25)">
        {status === "ready" ? (
          <>
            <div className="charts-grid">
              {/* Both plots the same height: the nine policy rows set it */}
              <MeanChangeCard {...props} height={narrow ? 360 : 400} />
              <MeasuresCard {...props} height={narrow ? 460 : 400} />
            </div>
            <div className="charts-grid">
              <SharesCard {...props} height={narrow ? 340 : 330} />
              <TrendCard {...props} height={narrow ? 340 : 330} />
            </div>
          </>
        ) : (
          <p className="view-status" role="status">
            {status === "loading" ? "Loading results by age…" : "Results by age are not available."}
          </p>
        )}
      </section>
    </>
  );
}

export default YoungPeopleSection;
